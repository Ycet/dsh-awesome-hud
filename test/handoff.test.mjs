// dsh-awesome-hud — v0.21.2：上下文「交接」（fork 子代理生成交接文档）
//
// 覆盖点：
//   1. 内置提示词：用户给定原文逐字保留 + 末尾语言要求；
//   2. 宿主 handoff 接口：provider=fork、delivery=caller、parent 是恰好存活的 Agent、
//      maxDepth 取自 resolveMaxDepth、label 收敛；
//   3. 失败分流：无存活 agent → 404、子代理服务缺失 → 503、fork 提供者缺失 → 503、
//      宿主拒绝（并发/深度上限）→ 409；
//   4. 路由白名单收录 handoff；
//   5. 客户端：「压缩」改为拆分按钮（文字区 + 分隔线 + 下拉图标）、菜单项「交接」、
//      运行中两半一起禁用、成功/失败提示文案中英齐备。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { apply, HANDOFF_PROMPT, HANDOFF_PROMPT_LINES, HANDOFF_PROMPT_LANGUAGE } from "../lib/index.js";
import { clientSource, hudClient, nodes, moduleOf } from "./helpers/client-harness.mjs";

const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

/**
 * 用户给定的交接提示词原文（测试内独立抄写，避免与实现共用同一份串导致「改坏了也通过」）。
 * 六段原文 + 一段追加的语言要求。
 */
const SPEC_PROMPT_LINES = [
  "Compact the current conversation into a handoff document for another agent to pick up.",
  "Write a handoff document that summarizes the current conversation so that a new agent can continue the work. Save it to the `docs/handoff/` folder in the root of the current workspace.",
  "Include a \"Suggested Skills\" section in the document that lists the skills the next agent should call using the Skill tool.",
  "Do not repeat content already captured in other artifacts (specifications, plans, ADRs, issues, commits, diffs). Reference them by path or URL.",
  "Redact any sensitive information, such as API keys, passwords, or personally identifiable information.",
  "If the user passes parameters, treat them as a description of what the next session will focus on, and adjust the document accordingly.",
];

/** 真实 host 路由 + 假 agents / subagents 服务。 */
function createHarness(options = {}) {
  const {
    hasAgent = true,
    subagentsMissing = false,
    noFork = false,
    activationError = null,
    maxDepth = 2,
  } = options;
  const captured = [];
  const routes = [];
  const agent = { id: "fixture" };
  const services = {
    sessions: { get: (id) => (id === "fixture" ? { header: { cwd: "/workspace" } } : undefined) },
    agents: { get: (id) => (hasAgent && id === "fixture" ? agent : undefined) },
  };
  if (!subagentsMissing) {
    services.subagents = {
      getProvider: (name) => (name === "fork" && !noFork ? { name: "fork" } : undefined),
      // null = 服务未给出上限（真实 DSH 的 resolveMaxDepth 可能返回 undefined）
      resolveMaxDepth: () => (maxDepth === null ? undefined : maxDepth),
      startActivation: async (spec) => {
        captured.push(spec);
        if (activationError !== null) throw activationError;
        return { childId: "child-1", name: "handoff", result: Promise.resolve({}) };
      },
    };
  }
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => fn(),
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  apply(ctx, { modules: { get: () => ({}) }, usage: { get: () => ({}) } });
  const api = routes.find((route) => route.path === "/awesome-hud/api").handler;
  const call = async (endpoint, body = { sessionId: "fixture" }) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: "POST", url: `/awesome-hud/api/${endpoint}`, headers: { host: "127.0.0.1:1234" } });
    let status;
    let result;
    await api(req, { writeHead: (code) => { status = code; }, end: (data) => { result = JSON.parse(data); } });
    return { status, ...result };
  };
  return { call, captured, agent };
}

test("内置提示词：用户原文逐字保留，末尾追加语言要求", () => {
  assert.equal(HANDOFF_PROMPT_LINES.length, SPEC_PROMPT_LINES.length + 1);
  for (let index = 0; index < SPEC_PROMPT_LINES.length; index += 1) {
    assert.equal(HANDOFF_PROMPT_LINES[index], SPEC_PROMPT_LINES[index], `第 ${index + 1} 段必须与原文一致`);
  }
  assert.equal(HANDOFF_PROMPT_LINES[SPEC_PROMPT_LINES.length], HANDOFF_PROMPT_LANGUAGE);
  assert.equal(HANDOFF_PROMPT_LANGUAGE, "Write the document in the primary language of this conversation.");
  // 段落之间空一行，整体以最后一段结尾（不额外加空行）
  assert.equal(HANDOFF_PROMPT, [...SPEC_PROMPT_LINES, HANDOFF_PROMPT_LANGUAGE].join("\n\n"));
  assert.equal(HANDOFF_PROMPT.endsWith(LANGUAGE_TAIL()), true);
});

/** 提示词末尾不得有换行/空白。 */
function LANGUAGE_TAIL() {
  return HANDOFF_PROMPT_LANGUAGE;
}

test("宿主 handoff：以 fork 子代理静默生成交接文档", async () => {
  const harness = createHarness();
  const response = await harness.call("handoff", { sessionId: "fixture", label: "交接文档" });
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(response.ok, true);
  assert.equal(response.subagentId, "child-1");
  assert.equal(harness.captured.length, 1);
  const spec = harness.captured[0];
  assert.equal(spec.provider, "fork");
  // 静默完成：delivery=caller（不回传主会话）
  assert.equal(spec.delivery, "caller");
  assert.equal(spec.label, "交接文档");
  // parent 必须是恰好存活的同一个 Agent 对象。
  // v0.21.2 修复：DSH 0.2.2-rc.3 桌面端内置的 startActivation 读**扁平**字段（spec.parent），
  // 新版布局读 spec.request；插件两种形状同时带上，这里两者都要校验。
  for (const shape of [spec, spec.request]) {
    assert.equal(shape.parent, harness.agent, "parent 必须是同一个 Agent 对象");
    assert.equal(shape.prompt.length, 1);
    assert.equal(shape.prompt[0].type, "text");
    assert.equal(shape.prompt[0].text, HANDOFF_PROMPT);
    assert.equal(shape.maxDepth, 2);
  }
  assert.ok(spec.signal !== undefined, "必须传 AbortSignal");
});

test("宿主 handoff：label 缺省/超长回退英文默认值，maxDepth 缺失时不传", async () => {
  const harness = createHarness({ maxDepth: null });
  const response = await harness.call("handoff", { sessionId: "fixture", label: "" });
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(harness.captured[0].label, "Handoff");
  const captured = harness.captured[0];
  assert.equal("maxDepth" in captured, false, "扁平形状：未给值时不得传 maxDepth");
  assert.equal("maxDepth" in captured.request, false, "嵌套形状：未给值时不得传 maxDepth");
});

test("宿主 handoff 失败分流：无存活 agent / 服务缺失 / 无 fork / 宿主拒绝", async () => {
  const noAgent = createHarness({ hasAgent: false });
  const missingAgent = await noAgent.call("handoff");
  assert.equal(missingAgent.status, 404);
  assert.equal(missingAgent.code, "missing");
  assert.equal(noAgent.captured.length, 0);

  const noService = createHarness({ subagentsMissing: true });
  const missingService = await noService.call("handoff");
  assert.equal(missingService.status, 503);
  assert.equal(missingService.code, "unavailable");

  const noFork = createHarness({ noFork: true });
  const unsupported = await noFork.call("handoff");
  assert.equal(unsupported.status, 503);
  assert.equal(unsupported.code, "unsupported");
  assert.equal(noFork.captured.length, 0);

  const rejected = createHarness({ activationError: Object.assign(new Error("too many subagents"), { code: "subagent/limit" }) });
  const limited = await rejected.call("handoff");
  assert.equal(limited.status, 409);
  assert.equal(limited.code, "subagent/limit");
  assert.match(limited.error, /too many subagents/);

  // 缺少合法会话 id
  const bad = await createHarness().call("handoff", {});
  assert.equal(bad.status, 400);
});

test("宿主：handoff 已进入路由方法白名单与接口注释表", () => {
  assert.match(hostSource, /method === "handoff"/);
  assert.match(hostSource, /\/\/        handoff     → \{ok, subagentId\}/);
});

test("客户端：压缩按钮改为拆分按钮，左半压缩右半下拉", () => {
  const client = hudClient({
    state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, displayTitle: "Session A" } } },
    current: "sess",
    workspaces: [{ workspaceId: "w1", path: "/work/session", title: "Session", updatedAt: 2, sessionIds: ["sess"] }],
  });
  const panel = client.panel();
  const context = moduleOf(panel, "ContextModule");
  assert.ok(context !== undefined, "上下文模块必须渲染");
  const tree = context.type(context.props);
  const split = nodes(tree).find((node) => node.props?.className === "hud-split");
  assert.ok(split !== undefined, "必须出现拆分按钮容器");
  const halves = nodes(split).filter((node) => node.type === "button");
  assert.equal(halves.length, 2, "拆分按钮由文字区与下拉区两个按钮组成");
  assert.equal(halves[0].props.className, "hud-split-main");
  assert.equal(halves[0].children[0], "contextCompress", "左半是「压缩」文字");
  assert.equal(halves[1].props.className, "hud-split-toggle");
  assert.equal(halves[1].props["aria-haspopup"], "menu");
  assert.equal(halves[1].props["aria-expanded"], false);
  assert.equal(halves[1].props["aria-label"], "contextHandoffMenu");
  // 中间有 1px 分隔线
  assert.ok(nodes(split).some((node) => node.props?.className === "hud-split-divider" && node.props?.["aria-hidden"] === "true"));
  // 旧的整块 hud-btn-small 已被替换
  assert.equal(nodes(tree).some((node) => node.props?.className === "hud-btn-small"), false);
});

test("客户端：会话运行中两个半边一起禁用（与压缩同口径）", () => {
  const client = hudClient({
    state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, displayTitle: "Session A", running: true } } },
    current: "sess",
    workspaces: [{ workspaceId: "w1", path: "/work/session", title: "Session", updatedAt: 2, sessionIds: ["sess"] }],
  });
  const context = moduleOf(client.panel(), "ContextModule");
  const tree = context.type({ ...context.props, running: true });
  const halves = nodes(tree).filter((node) => node.type === "button" && String(node.props?.className ?? "").startsWith("hud-split-"));
  assert.equal(halves.length, 2);
  for (const half of halves) assert.equal(half.props.disabled, true, `${half.props.className} 必须禁用`);
});

test("客户端接线：菜单项「交接」调用 handoff 接口并给成功/失败提示", () => {
  // 菜单项：标签 contextHandoff、run 走 startHandoff，锚定在下拉按钮下方（右侧对齐）
  assert.match(clientSource, /items: \[\{ key: "handoff", label: t\("contextHandoff"\), run: startHandoff \}\],/);
  assert.match(clientSource, /const toggleHandoffMenu = \(event\) => \{/);
  assert.match(clientSource, /await call\("handoff", \{ sessionId: targetSession, label: t\("handoffLabel"\) \}\);/);
  assert.match(clientSource, /toast\(t\("handoffStarted"\), "success"\);/);
  assert.match(clientSource, /toast\(interpolate\(t\("handoffFailed"\), \{ detail: error\?\.message \?\? String\(error\) \}\), "error"\);/);
  // 宿主错误码映射成本地化文案（缺失 agent / 无 fork 提供者），其余原样展示
  assert.match(clientSource, /if \(code === "missing"\) toast\(t\("handoffNoAgent"\), "error"\);/);
  assert.match(clientSource, /else if \(code === "unsupported"\) toast\(t\("handoffUnsupported"\), "error"\);/);
  // 运行中禁用：disabled 同时覆盖压缩中 / 运行中 / 交接请求中
  assert.match(clientSource, /const disabled = compacting \|\| props\.running \|\| handoffBusy;/);
  // 下拉菜单复用官方圆角菜单（portal 到 body，不受面板裁切）
  assert.match(clientSource, /handoffMenu === null \? null : react\.createElement\(HudMenu, \{/);
  // 菜单宽度与「压缩」拆分按钮同宽：打开时实测按钮宽度写进状态，菜单直接用该值
  assert.match(clientSource, /const splitRef = react\.useRef\(null\);/);
  assert.match(clientSource, /const width = Math\.max\(72, Math\.round\(rect\.width\)\);/);
  assert.match(clientSource, /x: Math\.max\(8, Math\.round\(rect\.right - width\)\),/);
  assert.match(clientSource, /width: handoffMenu\.width,/);
  assert.doesNotMatch(clientSource, /width: 168,/);
  // 拆分按钮样式：两个半边共用圆角胶囊，中间 1px 分隔线
  assert.match(clientSource, /\.hud-split\{flex:none;display:inline-flex;align-items:stretch;box-sizing:border-box;border:1px solid var\(--dsw-alias-border-l2\);border-radius:8px;/);
  assert.match(clientSource, /\.hud-split-divider\{flex:none;width:1px;background:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 14%,transparent\)\}/);
});

test("客户端文案：交接相关键中英齐备", () => {
  const client = hudClient();
  const [dicts] = client.dictionaries;
  for (const ns of ["zh", "en"]) {
    for (const key of ["contextHandoffMenu", "contextHandoff", "handoffLabel", "handoffStarted", "handoffFailed", "handoffNoAgent", "handoffUnsupported"]) {
      assert.equal(typeof dicts[ns][key], "string", `${ns}.${key} 必须是字符串`);
      assert.ok(dicts[ns][key].length > 0, `${ns}.${key} 不能为空`);
    }
  }
  assert.equal(dicts.zh.contextHandoff, "交接");
  assert.equal(dicts.en.contextHandoff, "Handoff");
  assert.equal(dicts.zh.handoffLabel, "交接文档");
  assert.equal(dicts.en.handoffLabel, "Handoff document");
});
