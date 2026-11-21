// dsh-awesome-hud — 「产物 / Outputs」模块（v0.21.5 语义）：
//  0) 只认**本会话及其子会话**证据：write/edit 的 file_path 与 present 的 files[].path；
//     不再扫描工作区、不读每轮摘要，避免其它会话的产物与用户自己的编辑混进来。
//  1) 汇总本会话**所有轮次**里指定格式、位于工作区内、仍存在的改动文件；
//     按最后改动轮次倒序，最多展示 OUTPUT_LIMIT（10）个；界面默认先显示前 3 个、可展开全部。
//  2) 点击行在官方右侧栏打开文件内容：地址按 DSH 的 file 资源语法逐段编码。
//  3) 客户端：默认位于 git 之上、无产物时整模块隐藏、新建会话页不展示。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTPUT_EXTENSIONS,
  OUTPUT_LIMIT,
  Config,
  collectOutputs,
  isOutputCandidatePath,
  sessionFileAddress,
} from "../lib/index.js";
import {
  clientSource as source,
  extractArrowHandler,
  extractConst,
  extractFunction,
  hudClient,
} from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 构造一条 workspace/changes 事件（只带 host 侧真正用到的字段）。 */
const changeEvent = (seq, turn) => ({ type: "workspace/changes", seq, data: { turn } });

/** 构造一个按 seq 返回摘要的 summaryFor。 */
const summariesOf = (table) => (seq) => table[seq];

test("格式白名单：16 种扩展名且大小写不敏感，其它一律排除", () => {
  assert.deepEqual(
    [...OUTPUT_EXTENSIONS].sort(),
    ["cd", "clark", "csv", "docx", "gif", "html", "jpeg", "jpg", "md", "pdf", "png", "pptx", "svg", "webp", "xlsx"].sort(),
    "白名单应恰为约定的 16 项",
  );
  for (const ext of OUTPUT_EXTENSIONS) {
    assert.equal(isOutputCandidatePath(`docs/a.${ext}`), true, `.${ext} 应入选`);
    assert.equal(isOutputCandidatePath(`docs/a.${ext.toUpperCase()}`), true, `.${ext.toUpperCase()} 应入选`);
  }
  for (const path of ["a.ts", "a.json", "a.png.bak", "a", "docs/", "../a.md", "/abs/a.md", "C:/a.md", "a/b/../c.md", ""]) {
    assert.equal(isOutputCandidatePath(path), false, `${path} 不应入选`);
  }
  assert.equal(isOutputCandidatePath(undefined), false);
});

/** 构造一条 durable 的 write/edit 工具调用（v0.21.4 起产物唯一的证据来源）。 */
const writeCall = (seq, turn, path, name = "write", time) => ({
  type: "tool/call",
  seq,
  ...(time === undefined ? {} : { time }),
  data: { turn, name, arguments: JSON.stringify({ file_path: path }) },
});

test("collectOutputs：跨全部轮次取并集，同一文件以最后一次改动为准", async () => {
  const events = [];
  for (let turn = 1; turn <= 30; turn += 1) {
    events.push(writeCall(turn * 10, turn, `docs/t${turn}.md`));
    // shared.md 每轮都改一次：同一路径只保留最后一条，轮次取 30。
    events.push(writeCall(turn * 10 + 1, turn, "docs/shared.md"));
  }
  const base = { sessionId: "s1", events, exists: async () => true };
  const output = await collectOutputs(base);
  assert.equal(output.total, 31, "去重后的候选总数 = 30 个独立文件 + 1 个共享文件");
  assert.equal(output.files.length, 10, "展示仍受 10 条上限约束");
  assert.equal(output.truncated, true);
  assert.equal(output.files.map((file) => file.path).includes("docs/t1.md"), false, "最早的轮次排在 10 名之外");

  const all = await collectOutputs({ ...base, limit: 100 });
  const allPaths = all.files.map((file) => file.path);
  assert.ok(allPaths.includes("docs/t1.md"), "放大上限后能拿到最早轮次的文件");
  assert.equal(allPaths.filter((path) => path === "docs/shared.md").length, 1, "同一文件只出现一次");
  const shared = all.files.find((file) => file.path === "docs/shared.md");
  assert.equal(shared.turn, 30, "重复改动取最后一次轮次");
  assert.equal(all.files[0].turn, 30, "按最后改动倒序");
});

test("collectOutputs：按最后改动倒序，最多 10 个并标记截断", async () => {
  const events = [];
  for (let index = 1; index <= 30; index += 1) events.push(writeCall(index, 1, `out/f${index}.png`));
  const output = await collectOutputs({ sessionId: "s1", events, exists: async () => true });
  assert.equal(OUTPUT_LIMIT, 10);
  assert.equal(output.files.length, 10, "只返回 10 个");
  assert.equal(output.total, 30);
  assert.equal(output.truncated, true);
  assert.equal(output.files[0].path, "out/f30.png", "同一轮内按事件序号倒序");
  const small = await collectOutputs({ sessionId: "s1", events, exists: async () => true, limit: 3 });
  assert.equal(small.files.length, 3);
  assert.equal(small.truncated, true);
  const exact = await collectOutputs({ sessionId: "s1", events: events.slice(0, 3), exists: async () => true });
  assert.equal(exact.truncated, false, "不足 10 个时不算截断");
});

test("collectOutputs：只保留仍存在的文件，且存在性检查有次数上限", async () => {
  const events = [];
  for (let index = 1; index <= 30; index += 1) events.push(writeCall(index, 1, `out/f${index}.md`));
  const checks = [];
  const output = await collectOutputs({
    sessionId: "s1",
    events,
    limit: 100,
    exists: async (path) => {
      checks.push(path);
      // 前 10 个已被删除
      const index = Number(path.match(/f(\d+)\.md/)[1]);
      return index > 10;
    },
  });
  assert.equal(output.files.length, 20, "删除的文件不进列表");
  assert.equal(output.files[0].path, "out/f30.md");
  assert.equal(new Set(checks).size, checks.length, "同一路径不重复检查");
  assert.ok(output.stats <= 64, "存在性检查次数受 statLimit 约束");

  const capped = await collectOutputs({ sessionId: "s1", events, exists: async () => false, statLimit: 5 });
  assert.equal(capped.files.length, 0);
  assert.equal(capped.stats, 5, "到达次数上限即停止检查");
});

test("collectOutputs：坏事件安全跳过，不抛错", async () => {
  const events = [
    null, undefined, { type: "other", seq: 1 }, { type: "tool/call" },
    { type: "tool/call", seq: 2, data: { turn: 1, name: "write", arguments: "not json" } },
    writeCall(3, 1, "a.md"),
    writeCall(4, 1, "b.pdf"),
    writeCall(5, 2, "src/deep/a.png"),
  ];
  const output = await collectOutputs({ sessionId: "s1", events, exists: async () => true });
  assert.deepEqual(output.files.map((file) => file.path), ["src/deep/a.png", "b.pdf", "a.md"]);
  const nested = output.files[0];
  assert.equal(nested.name, "a.png");
  assert.equal(nested.dir, "src/deep");
  assert.equal(output.files[2].display, "a.md", "工具证据的展示名就是路径");
});

test("会话文件地址：逐段编码，`:` 保持字面，与 DSH 的 file 资源语法一致", () => {
  assert.equal(sessionFileAddress("s1", "src/a.md"), "dsh-resource://file/session/s1/src/a.md");
  assert.equal(
    sessionFileAddress("s 1", "src/a b#c?.md"),
    "dsh-resource://file/session/s%201/src/a%20b%23c%3F.md",
    "空格/#/? 逐段编码",
  );
  assert.equal(sessionFileAddress("s1", "docs/报告.md"), "dsh-resource://file/session/s1/docs/%E6%8A%A5%E5%91%8A.md");
  assert.equal(sessionFileAddress("s1", "a:b.md"), "dsh-resource://file/session/s1/a:b.md", "`:` 保持字面");
  assert.equal(sessionFileAddress("s1", "./x/y.png"), "dsh-resource://file/session/s1/x/y.png", "去掉前导 ./");
});

test("宿主契约：默认开启、命令在白名单里、图标资产已放行", async () => {
  const outputsSchema = Config.dict.modules.dict.outputs;
  assert.equal(outputsSchema.type, "boolean", "modules.outputs 是布尔开关");
  assert.equal(outputsSchema.meta.default, true, "新模块默认开启");
  const hostSource = await readFile(join(root, "lib/index.js"), "utf8");
  assert.match(hostSource, /method === "outputs"/, "outputs 必须在 API 方法白名单里");
  assert.match(hostSource, /"outputs\.svg": "svg"/, "图标必须在资产白名单里");
  await access(join(root, "assets/icons/outputs.svg"));
});

test("客户端接线：默认位于 git 之上、新建会话页不展示、说明页与文案齐全", () => {
  const moduleKeys = vm.runInNewContext(`${extractConst("MODULE_KEYS")}\nMODULE_KEYS;`);
  const newSessionKeys = vm.runInNewContext(`${extractConst("NEW_SESSION_MODULE_KEYS")}\nNEW_SESSION_MODULE_KEYS;`);
  assert.equal(moduleKeys.indexOf("outputs"), moduleKeys.indexOf("git") - 1, "默认位于 git 之上");
  assert.equal(newSessionKeys.includes("outputs"), false, "新建会话页不展示该模块");
  assert.match(source, /outputs: \(\) => activeModules\.outputs === false \|\| outputs === null \|\| \(Array\.isArray\(outputs\.files\) \? outputs\.files\.length : 0\) === 0 \? null : react\.createElement\(OutputsModule/, "无产物时渲染门直接返回 null");
  assert.doesNotMatch(source, /supported: outputs\.supported !== false/, "不再向组件传 supported");
  assert.match(source, /const refreshOutputs = async \(\) => \{/, "轮询存在");
  assert.match(source, /const polls = \[refreshGit, refreshSubagents, refreshPlans, refreshOutputs\]/, "并入 5 秒轮询批次");
  assert.match(source, /setOutputs\(null\);/, "新建会话页/切会话时清空快照");
  // v0.21.2：折叠状态按会话保存，默认集里产物是展开（false）。
  assert.match(source, /const FOLD_MODULE_KEYS = Object\.freeze\(\["context", "usage", "git", "outputs"/);
  assert.match(source, /return \{ context: false, tasks: false, subagents: false, plans: false, outputs: false/, "默认集包含产物且为展开");
  assert.match(source, /icon: "outputs"/);
  // 说明页第 12 节
  assert.match(source, /\{ key: "outputs", title: "guideOutputsTitle"/);
  const sections = vm.runInNewContext(`${extractConst("GUIDE_SECTIONS")}\nGUIDE_SECTIONS;`);
  assert.equal(sections.length, 12, "说明页新增一节");
  // v0.21.2：单小节「模块说明」，不再分展示 / 功能。
  assert.deepEqual(plain(sections.find((section) => section.key === "outputs").groups.map((group) => group.key)), ["module"]);
  // 中英文案成对
  const { zh, en } = hudClient().dictionaries[0];
  for (const key of ["outputsModule", "outputsLimitHint", "outputsOpenFailed",
    "guideOutputsTitle", "guideOutputsShowList", "guideOutputsShowOrder", "guideOutputsOpen", "guideOutputsScope"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文`);
    assert.equal(typeof en[key], "string", `${key} 需要英文`);
  }
  // 无产物时整模块不渲染，因此不再保留空态文案。
  for (const key of ["outputsEmpty", "outputsUnsupported"]) {
    assert.equal(zh[key], undefined, `${key} 应已移除`);
    assert.equal(en[key], undefined, `${key} 应已移除`);
  }
});

/**
 * 在沙箱里跑真实的 OutputsModule，验证渲染结果而不依赖宿主。
 * 这里给出一套最小但「有状态」的 hooks 运行时：state/ref 按调用顺序存槽位，
 * 重新调用 render 即可看到 setState 后的结果；定时器由 window 桩攒起来，测试可手动触发。
 * controls.expanded 用来模拟「已展开」的初始 state；controls.next 保留最后一次 setState 的值。
 */
function loadOutputsModule(dict, controls = {}, extra = {}) {
  const states = [];
  const refs = [];
  const timers = new Map();
  const effects = [];
  let cursor = 0;
  let nextTimer = 1;
  const timersByDelay = (delay) => [...timers].filter(([, timer]) => timer.delay === delay && timer.cleared !== true);
  const context = vm.createContext({
    Set,
    Number,
    Math,
    react: {
      Fragment: "fragment",
      useState: (init) => {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof init === "function" ? init() : init;
        return [states[index], (next) => {
          const value = typeof next === "function" ? next(states[index]) : next;
          states[index] = value;
          controls.next = value;
        }];
      },
      useRef: (init) => {
        const index = cursor++;
        if (!(index in refs)) refs[index] = { current: init };
        return refs[index];
      },
      useEffect: (effect) => { effects.push(effect); return undefined; },
      createElement: (type, props, ...children) => ({
        type: typeof type === "string" ? type : type?.name ?? "Component",
        props: props ?? {},
        children,
      }),
    },
    react_dom: { createPortal: (node) => node },
    document: { body: {} },
    window: {
      setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay, cleared: false }); return id; },
      clearTimeout: (id) => { const timer = timers.get(id); if (timer !== undefined) timer.cleared = true; },
      addEventListener() {}, removeEventListener() {},
      innerWidth: 1280, innerHeight: 800,
    },
    ModuleHead: (props) => ({ type: "ModuleHead", props, children: [] }),
    HudMenu: (props) => ({ type: "HudMenu", props, children: [] }),
    resolveComposerTarget: async () => null,
    copyWithToast: async () => false,
    call: async () => { throw new Error("no host"); },
    toast: () => {},
    t: (key) => dict[key] ?? key,
    interpolate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
    ...extra,
  });
  vm.runInContext(
    `${extractConst("LIST_PREVIEW_COUNT")}\n${extractConst("OUTPUT_TIP_DELAY_MS")}\n${extractFunction("fileHoverTipPlacement")}\n${extractFunction("previewListRows")}\n${extractFunction("listMoreButton")}\n${extractFunction("outputExtensionOf")}\n${extractFunction("outputFileMention")}\n${extractFunction("chatAddToastKey")}\nasync ${extractFunction("addPathToChat")}\n${extractFunction("OutputsModule")}\nthis.OutputsModule = OutputsModule; this.outputExtensionOf = outputExtensionOf; this.outputFileMention = outputFileMention; this.previewListRows = previewListRows; this.fileHoverTipPlacement = fileHoverTipPlacement; this.OUTPUT_TIP_DELAY_MS = OUTPUT_TIP_DELAY_MS;`,
    context,
  );
  // 预置「已展开」的初始 state（组件内是 useState(false)，槽位 0 即展开态）。
  if (controls.expanded !== undefined) states[0] = controls.expanded === true;
  const render = (props) => {
    cursor = 0;
    effects.length = 0;
    return context.OutputsModule(props);
  };
  const fireTimers = (delay) => {
    for (const [, timer] of timersByDelay(delay)) {
      if (timer.cleared === true) continue;
      timer.cleared = true;
      timer.fn();
    }
  };
  return {
    render,
    fireTimers,
    timersByDelay,
    context,
    rowsView: context.previewListRows,
    placement: context.fileHoverTipPlacement,
    delay: context.OUTPUT_TIP_DELAY_MS,
  };
}

const walk = (node) => {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (typeof node !== "object") return [node];
  return [node, ...(node.children ?? []).flatMap(walk)];
};
const textOf = (node) => walk(node).filter((child) => typeof child === "string" || typeof child === "number").join("");

test("组件：计数、文件名与目录、截断提示；无产物时整个模块不渲染", () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh);
  const opened = [];
  const files = [
    { path: "docs/a.md", display: "docs/a.md", name: "a.md", dir: "docs" },
    { path: "out.png", display: "out.png", name: "out.png", dir: "" },
  ];
  const tree = runtime.render({ files, limit: 10, truncated: true, fold: false, onOpen: (file) => opened.push(file.path), onFoldChange: () => {} });
  assert.equal(tree.type, "div");
  // v0.20.0：产物列表有自己的容器类，供「文件行向右缩进」的样式作用域使用。
  assert.equal(tree.props.className, "hud-section hud-output-section");
  const head = walk(tree).find((node) => node.type === "ModuleHead");
  assert.equal(head.props.icon, "outputs");
  assert.equal(head.props.countText, "2", "计数为文件数");
  assert.equal(head.props.title, zh.outputsModule);
  const rows = walk(tree).filter((node) => node.type === "button");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].props.className, "hud-output-row");
  // v0.20.0：改用自定义悬停提示（0.5s、跟随鼠标），不再挂原生 title（避免两个提示同时出现）。
  assert.equal(rows[0].props.title, undefined);
  assert.equal(typeof rows[0].props.onMouseEnter, "function");
  assert.equal(typeof rows[0].props.onMouseMove, "function");
  assert.equal(typeof rows[0].props.onMouseLeave, "function");
  assert.equal(rows[0].props["aria-label"], "docs/a.md");
  assert.deepEqual(rows[0].children.map((child) => [child.type, child.children[0]]), [
    ["span", "md"],
    ["span", "a.md"],
    ["span", "docs"],
  ]);
  assert.equal(rows[0].children[0].props.className, "hud-output-ext");
  assert.equal(rows[0].children[0].props["data-len"], "2");
  assert.equal(rows[1].children.filter((child) => child !== null).length, 2, "无目录时渲染后缀标签与文件名");
  assert.equal(rows[1].children[0].children[0], "png");
  rows[0].props.onClick();
  assert.deepEqual(opened, ["docs/a.md"]);
  assert.match(textOf(tree), /仅展示最近改动的 10 个文件/, "截断时给出提示");

  // v0.19.2：没有产物时整个模块不渲染（与子代理 / 任务 / 计划清单一致）。
  assert.equal(runtime.render({ files: [], limit: 10, truncated: false, fold: false }), null, "无产物时不渲染模块");
  assert.equal(runtime.render({ files: [], supported: false, limit: 10, truncated: false, fold: false }), null, "能力不可用时同样隐藏");
  assert.equal(runtime.render({ limit: 10, truncated: false, fold: false }), null, "快照缺失时也隐藏");

  const folded = runtime.render({ files, limit: 10, truncated: false, fold: true, onFoldChange: () => {} });
  assert.equal(walk(folded).filter((node) => node.type === "button").length, 0, "折叠时不渲染列表行");
});

test("v0.19.2：列表默认只给前 3 个，超过时提供「展开其余 n 个文件 / 收起」", () => {
  const { zh } = hudClient().dictionaries[0];
  const files = Array.from({ length: 8 }, (_, index) => ({
    path: `docs/f${index + 1}.md`,
    display: `docs/f${index + 1}.md`,
    name: `f${index + 1}.md`,
    dir: "docs",
  }));

  // 纯函数：折叠只取前 3 个，展开给全部；remaining 与是否可展开无关，始终是「超出 3 个的数量」。
  const collapsed = loadOutputsModule(zh);
  assert.equal(collapsed.rowsView(files, false).rows.length, 3);
  assert.equal(collapsed.rowsView(files, false).remaining, 5);
  assert.equal(collapsed.rowsView(files, false).expanded, false);
  assert.equal(collapsed.rowsView(files, true).rows.length, 8);
  assert.equal(collapsed.rowsView(files, true).remaining, 5);
  assert.equal(collapsed.rowsView(files, true).expanded, true);
  // 不超过 3 个时无需展开：直接全量展示，不出现入口。
  assert.equal(collapsed.rowsView(files.slice(0, 2), false).rows.length, 2);
  assert.equal(collapsed.rowsView(files.slice(0, 2), false).remaining, 0);
  assert.equal(collapsed.rowsView(files.slice(0, 3), false).expanded, true, "恰好 3 个时不折叠");

  // 折叠态：3 行 + 第 3 行下方的「展开其余 5 个文件」。
  const foldControls = {};
  const collapsedModule = loadOutputsModule(zh, foldControls);
  const foldedTree = collapsedModule.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const rows = walk(foldedTree).filter((node) => node.type === "button" && node.props.className === "hud-output-row");
  assert.equal(rows.length, 3, "折叠时只渲染 3 行");
  assert.equal(rows[2].props["aria-label"], "docs/f3.md", "第 3 行就是切分点");
  const more = walk(foldedTree).find((node) => node.type === "button" && node.props.className === "hud-list-more");
  assert.ok(more, "超过 3 个时出现展开入口");
  assert.match(textOf(more), /展开其余 5 个文件/);
  more.props.onClick();
  assert.equal(foldControls.next, true, "点击展开");

  // 展开态：全部行 + 最后一行下方的「收起」。
  const openControls = { expanded: true };
  const expandedModule = loadOutputsModule(zh, openControls);
  const expandedTree = expandedModule.render({ files, limit: 10, truncated: true, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const expandedRows = walk(expandedTree).filter((node) => node.type === "button" && node.props.className === "hud-output-row");
  assert.equal(expandedRows.length, 8, "展开后渲染全部行");
  const collapse = walk(expandedTree).find((node) => node.type === "button" && node.props.className === "hud-list-more");
  assert.match(textOf(collapse), /收起/);
  collapse.props.onClick();
  assert.equal(openControls.next, false, "点击收起");
  // 截断提示仍在最后一行下方。
  assert.match(textOf(expandedTree), /仅展示最近改动的 10 个文件/);

  // 3 个及以内不出现任何展开 / 收起入口。
  const smallTree = expandedModule.render({ files: files.slice(0, 3), limit: 10, truncated: false, fold: false });
  assert.equal(walk(smallTree).find((node) => node.props?.className === "hud-list-more"), undefined, "不超过 3 个时没有入口");
});

test("v0.20.0：悬停 0.5 秒在鼠标位置弹出与 git 一致的路径提示", () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh);
  assert.equal(runtime.delay, 500, "悬停延迟固定为 0.5 秒");
  const files = [{ path: "docs/a.md", display: "docs/a.md", name: "a.md", dir: "docs" }];

  let tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  let row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onMouseEnter({ clientX: 300, clientY: 200 });
  // 计时器未到：不弹提示。
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "0.5 秒内不出现提示");

  runtime.fireTimers(500);
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const tip = walk(tree).find((node) => node.props?.className === "hud-file-tip");
  assert.ok(tip, "悬停超过 0.5 秒后出现提示");
  assert.equal(tip.props.role, "tooltip");
  // 内容与 git 变更文件行的提示一致：只有完整相对路径，没有标签行。
  assert.equal(textOf(tip), "docs/a.md");
  // 定位与 git 共用：鼠标右下 12 / 18px，宽度按剩余空间收敛。
  assert.deepEqual([tip.props.style.left, tip.props.style.top, tip.props.style.maxWidth], [312, 218, 960]);
  assert.equal(tip.props.style.transform, undefined, "空间足够时显示在鼠标下方");

  // 鼠标移动后按最后一次位置弹提示（不是进入点）。
  row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onMouseLeave();
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onMouseEnter({ clientX: 100, clientY: 100 });
  row.props.onMouseMove({ clientX: 420, clientY: 320 });
  runtime.fireTimers(500);
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const moved = walk(tree).find((node) => node.props?.className === "hud-file-tip");
  assert.deepEqual([moved.props.style.left, moved.props.style.top], [432, 338], "按最后一次 mousemove 定位");
});

test("v0.20.0：离开 / 按下 / 点击都会收起提示", () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh);
  const files = [{ path: "out.png", display: "out.png", name: "out.png", dir: "" }];
  const opened = [];
  const props = { files, limit: 10, truncated: false, fold: false, onOpen: (file) => opened.push(file.path), onFoldChange: () => {} };
  const rowOf = (tree) => walk(tree).filter((node) => node.type === "button" && node.props.className === "hud-output-row")[0];

  // 500ms 内离开：计时器被取消，不再弹提示。
  let tree = runtime.render(props);
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  rowOf(tree).props.onMouseLeave();
  runtime.fireTimers(500);
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "离开后不再弹出");

  // 弹出后离开：立即收起。
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  runtime.fireTimers(500);
  tree = runtime.render(props);
  assert.ok(walk(tree).find((node) => node.props?.className === "hud-file-tip"));
  rowOf(tree).props.onMouseLeave();
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "离开即收起");

  // 弹出后按下（拖拽 / 右键）也会收起。
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  runtime.fireTimers(500);
  tree = runtime.render(props);
  rowOf(tree).props.onPointerDown();
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "按下即收起");

  // 弹出后点击：先收起提示，再打开文件。
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  runtime.fireTimers(500);
  tree = runtime.render(props);
  rowOf(tree).props.onClick();
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "点击即收起");
  assert.deepEqual(opened, ["out.png"], "点击仍然打开文件");
});

test("v0.20.0：fileHoverTipPlacement 靠近底部翻到上方、靠右收进视口、窄视口收敛宽度", () => {
  const runtime = loadOutputsModule(hudClient().dictionaries[0].zh);
  const placement = runtime.placement;
  const plainPlacement = (x, y, width, height) => JSON.parse(JSON.stringify(placement(x, y, width, height)));
  // 与 git 文件行同一套算法：右下 12 / 18px，最左保留 8px，宽度按剩余空间收敛。
  assert.deepEqual(plainPlacement(300, 200, 1280, 800), { left: 312, top: 218, below: true, maxWidth: 960 });
  // 底部空间不足（800 - 24 = 776 < 798）：翻到鼠标上方并上移 8px。
  assert.deepEqual(plainPlacement(300, 780, 1280, 800), { left: 312, top: 772, below: false, maxWidth: 960 });
  // 靠右：向左收到视口内，宽度收敛到剩余空间（1280 - 1072 - 8 = 200）。
  assert.deepEqual(plainPlacement(1270, 100, 1280, 800), { left: 1072, top: 118, below: true, maxWidth: 200 });
  // 窄视口：左侧留 8px，宽度至少 120。
  assert.deepEqual(plainPlacement(10, 10, 200, 800), { left: 8, top: 28, below: true, maxWidth: 184 });
});

test("v0.20.0：文件行向右缩进、悬停提示复用 git 的路径提示样式", () => {
  // 文件行与「展开其余 / 收起」按模块标题文字对齐（14px 模块内边距 + 24px 缩进）。
  assert.match(source, /\.hud-output-section \.hud-output-row,\.hud-output-section \.hud-list-more\{padding-left:24px\}/);
  // 悬停提示：复用 git 变更文件行的 .hud-file-tip（等宽、可换行、跟随鼠标），只显示完整相对路径。
  assert.match(source, /className: "hud-file-tip",\s*\n\s*role: "tooltip",/);
  assert.match(source, /}, tip\.text\),/);
  assert.match(source, /setTip\(\{ text: file\.path, \.\.\.fileHoverTipPlacement\(x, y, window\.innerWidth, window\.innerHeight\) \}\);/);
  // git 文件行与产物共用同一套定位。
  assert.match(source, /setFileTip\(\{ text, \.\.\.fileHoverTipPlacement\(x, y, window\.innerWidth, window\.innerHeight\) \}\);/);
  // 旧的两行标签气泡已移除。
  assert.doesNotMatch(source, /\.hud-output-tip/);
  assert.doesNotMatch(source, /outputsTipDir|outputsTipRoot|outputsTipName|outputsTipPath/);
  // 说明页要点：显示完整相对路径。
  const { zh, en } = hudClient().dictionaries[0];
  assert.match(zh.guideOutputsHover, /完整相对路径/);
  assert.match(en.guideOutputsHover, /full relative path/);
});

test("点击打开：调用 sidebarRight.openResource；服务缺失或抛错时 toast", () => {
  const make = (ctxOverrides) => {
    const toasts = [];
    const opened = [];
    const context = vm.createContext({
      ctx: {
        get: (key) => {
          if (key !== "sidebarRight") return undefined;
          return ctxOverrides?.sidebarRight;
        },
      },
      toast: (text, kind) => toasts.push({ text, kind }),
      t: (key) => ({ outputsOpenFailed: "无法在右侧栏打开该文件。" })[key] ?? key,
    });
    vm.runInContext(`${extractArrowHandler("openOutputFile")}\nthis.openOutputFile = openOutputFile;`, context);
    return { openOutputFile: context.openOutputFile, toasts, opened };
  };

  const collected = [];
  const ok = make({ sidebarRight: { openResource: (address) => collected.push(address) } });
  ok.openOutputFile({ path: "docs/a.md", address: "dsh-resource://file/session/s1/docs/a.md" });
  assert.deepEqual(collected, ["dsh-resource://file/session/s1/docs/a.md"], "地址原样交给右侧栏");
  assert.equal(ok.toasts.length, 0, "打开成功不打扰用户");

  const missing = make(undefined);
  missing.openOutputFile({ path: "docs/a.md", address: "dsh-resource://file/session/s1/docs/a.md" });
  assert.equal(missing.toasts.length, 1);
  assert.equal(missing.toasts[0].kind, "error");
  assert.match(missing.toasts[0].text, /右侧栏/);

  const throwing = make({ sidebarRight: { openResource: () => { throw new Error("no surface"); } } });
  throwing.openOutputFile({ path: "docs/a.md", address: "dsh-resource://file/session/s1/docs/a.md" });
  assert.equal(throwing.toasts.length, 1, "抛错也要给出提示");

  const noAddress = make({ sidebarRight: { openResource: () => {} } });
  noAddress.openOutputFile({ path: "docs/a.md" });
  assert.equal(noAddress.toasts.length, 1, "缺地址视为打开失败");
});

// —— v0.21.2：产物改为「本会话可归因」证据，不再扫描工作区 ——

/** 构造一条 tool/call 事件（arguments 为 JSON 字符串，与 DSH durable 事件一致）。 */
const toolCallEvent = (seq, turn, name, filePath) => ({
  type: "tool/call",
  seq,
  data: { turn, name, arguments: JSON.stringify({ file_path: filePath }) },
});

test("collectOutputs：本会话 write/edit 的路径进产物，只读工具与非法路径不入列", async () => {
  const events = [
    toolCallEvent(1, 1, "write", "/work/proj/out/generated.html"),
    toolCallEvent(2, 1, "edit", "docs/edited.md"),
    toolCallEvent(3, 1, "read", "out/read-only.md"),
    toolCallEvent(4, 1, "bash", "out/shell.md"),
    toolCallEvent(5, 2, "write", "/tmp/outside.md"),
    toolCallEvent(6, 2, "write", "notes.txt"),
    { type: "tool/call", seq: 7, data: { turn: 2, name: "write", arguments: "not json" } },
  ];
  const output = await collectOutputs({
    sessionId: "s1",
    cwd: "/work/proj",
    events,
    exists: async () => true,
  });
  assert.deepEqual(plain(output.files.map((file) => file.path)), ["docs/edited.md", "out/generated.html"], "绝对路径按 cwd 归一；read/bash/txt/工作区外都丢弃");
  assert.equal(output.total, 2);
  assert.equal(output.files[1].address.startsWith("dsh-resource://file/session/s1/"), true);
});

test("collectOutputs：工具证据按事件时间倒序，时间缺失时退回轮次与序号", async () => {
  const timed = await collectOutputs({
    sessionId: "s1",
    cwd: "/work/proj",
    events: [writeCall(8, 2, "out/late.md", "write", 3000), writeCall(9, 3, "out/new.md", "edit", 1000)],
    exists: async () => true,
  });
  assert.deepEqual(plain(timed.files.map((file) => file.path)), ["out/late.md", "out/new.md"], "事件时间大的在前");

  const legacy = await collectOutputs({
    sessionId: "s1",
    events: [writeCall(1, 2, "b.md"), writeCall(2, 3, "a.md")],
    exists: async () => true,
  });
  assert.deepEqual(plain(legacy.files.map((file) => file.path)), ["a.md", "b.md"], "无时间戳时轮次大的在前");
});

/** 构造一条 present 工具调用（v0.21.5 起的第二类产物证据：交付声明）。 */
const presentCall = (seq, turn, files, time) => ({
  type: "tool/call",
  seq,
  ...(time === undefined ? {} : { time }),
  data: { turn, name: "present", arguments: JSON.stringify({ files }) },
});

test("v0.21.5：present 交付的文件列入产物，绝对路径按工作区归一", async () => {
  const events = [
    presentCall(1, 1, [
      { path: "docs/report.md", description: "报告" },
      { path: "/work/proj/out/chart.PNG", description: "图表" },
      { path: "docs/code.ts", description: "代码" },
      { path: "docs/archive.zip", description: "压缩包" },
      { path: "   ", description: "空路径" },
    ]),
    presentCall(2, 1, ["docs/list-form.md"]),
    { type: "tool/call", seq: 3, data: { turn: 1, name: "present", arguments: "not json" } },
  ];
  const output = await collectOutputs({ sessionId: "s1", cwd: "/work/proj", events, exists: async () => true });
  assert.deepEqual(
    plain(output.files.map((file) => file.path)).sort(),
    ["docs/list-form.md", "docs/report.md", "out/chart.PNG"],
    "对象与字符串两种写法都收录，绝对路径归一，白名单外与空路径丢弃",
  );
  assert.equal(output.total, 3);
  assert.equal(output.files.every((file) => file.address.startsWith("dsh-resource://file/session/s1/")), true);
});

test("v0.21.5：present 的工作区外路径丢弃，同一路径保留最晚一次交付", async () => {
  const events = [
    presentCall(10, 1, [{ path: "docs/same.md" }], 1000),
    presentCall(20, 2, [{ path: "/tmp/outside.md" }, { path: "../escape.md" }], 2000),
    presentCall(30, 3, [{ path: "docs/same.md" }, { path: "docs/same.md" }], 3000),
  ];
  const output = await collectOutputs({ sessionId: "s1", cwd: "/work/proj", events, exists: async () => true });
  assert.deepEqual(plain(output.files.map((file) => file.path)), ["docs/same.md"]);
  assert.equal(output.files[0].turn, 3, "同一路径取最晚的交付事件");
  assert.equal(output.files[0].time, 3000);
});

test("v0.21.5：present 与 write/edit 共用去重、上限与存在性检查", async () => {
  const events = [
    writeCall(5, 1, "docs/shared.md", "write", 500),
    presentCall(9, 1, [{ path: "docs/shared.md" }, { path: "docs/delivered.md" }], 900),
  ];
  const output = await collectOutputs({
    sessionId: "s1",
    cwd: "/work/proj",
    events,
    exists: async (path) => path !== "docs/delivered.md",
  });
  assert.deepEqual(plain(output.files.map((file) => file.path)), ["docs/shared.md"], "交付与写出去重后只留一条，文件不存在时剔除");
  assert.equal(output.files[0].seq, 9, "更晚的 present 事件覆盖更早的 write");
  assert.equal(output.stats, 2, "存在性检查按候选逐个进行");
});

test("v0.21.2：宿主不再扫描工作区，产物只吃本会话证据", async () => {
  const host = await import("../lib/index.js");
  assert.equal("collectWorkspaceOutputs" in host, false, "工作区扫描已移除");
  assert.equal("mergeOutputFiles" in host, false, "两路合并已移除");
  assert.equal("resolveSessionStartedAt" in host, false, "会话起点时间只服务扫描，已移除");
  const text = await readFile(join(root, "lib/index.js"), "utf8");
  assert.match(text, /const collected = await collectOutputs\(\{/);
  assert.match(text, /\t+\t+\t+\tcwd,\n/);
  assert.doesNotMatch(text, /collectWorkspaceOutputs/);
  assert.doesNotMatch(text, /mtimeMs/);
});

test("v0.21.0：产物右键菜单：五项、分割线、添加至聊天/定位/复制与禁用态", async () => {
  const { zh } = hudClient().dictionaries[0];
  const refs = [];
  const copies = [];
  const calls = [];
  const runtime = loadOutputsModule(zh, {}, {
    resolveComposerTarget: async (sessionId) => ({
      sessionId,
      input: {
        addFiles: (items, ids) => { refs.push([items, ids]); return true; },
        focus() {},
      },
    }),
    copyWithToast: async (text, label) => { copies.push([text, label]); return true; },
    call: async (method, body) => { calls.push([method, body]); return { opened: true }; },
  });
  const files = [{ path: "docs/a.md", name: "a.md", dir: "docs", display: "docs/a.md", absolutePath: "/abs/docs/a.md" }];
  const props = { files, limit: 10, truncated: false, fold: false, sessionId: "s1", sendSessionId: "s1", onOpen() {}, onFoldChange() {} };
  let tree = runtime.render(props);
  const row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  assert.ok(row, "应渲染产物行");
  assert.equal(row.children[0].props.className, "hud-output-ext");
  assert.equal(row.children[0].children[0], "md");
  row.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 30, clientY: 40 });
  tree = runtime.render(props);
  const menu = walk(tree).find((node) => node.type === "HudMenu");
  assert.ok(menu, "右键应打开菜单");
  assert.equal(menu.props.x, 30);
  assert.equal(menu.props.y, 40);
  const items = JSON.parse(JSON.stringify(menu.props.items.map((item) => ({
    key: item.key, label: item.label, disabled: item.disabled === true, separatorBefore: item.separatorBefore === true,
    icon: item.icon,
  }))));
  assert.deepEqual(items.map((item) => item.key), ["add-to-chat", "reveal", "copy-name", "copy-relative", "copy-absolute"]);
  assert.equal(items[0].icon.asset, "at");
  assert.equal(items[1].icon.asset, "folder");
  assert.equal(items[2].separatorBefore, true, "复制组前应有分割线");
  assert.equal(items[2].icon.asset, "copy");
  assert.equal(items[4].disabled, false);

  // 添加至聊天：生成官方 @ 引用并通过 input.addFiles 插入。
  menu.props.items[0].run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refs.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(refs[0])), [[{
    source: "reference", ref: "@docs/a.md", label: "a.md", appearance: "file", clipboardText: "@docs/a.md",
  }], []]);

  // 定位：调用 Host workspace/reveal-file，使用产物相对路径。
  menu.props.items[1].run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["workspace/reveal-file", { sessionId: "s1", path: "docs/a.md" }]]);

  // 三个复制项：名称 / 相对路径 / 绝对路径。
  menu.props.items[2].run();
  menu.props.items[3].run();
  menu.props.items[4].run();
  assert.deepEqual(copies, [
    ["a.md", zh.copiedOutputName],
    ["docs/a.md", zh.copiedOutputRelativePath],
    ["/abs/docs/a.md", zh.copiedOutputAbsolutePath],
  ]);
});

test("v0.21.0：无目标会话 / 旧宿主绝对路径 / 带空格路径的菜单边界", async () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh, {}, { resolveComposerTarget: async () => null });
  assert.equal(runtime.context.outputFileMention("a b/c.md"), '@"a b/c.md"');
  assert.equal(runtime.context.outputFileMention('a"b.md'), null, '含引号不支持 @ 引用');
  const files = [{ path: "a b/c.md", name: "c.md", dir: "a b", display: "a b/c.md" }];
  const props = { files, limit: 10, truncated: false, fold: false, sessionId: "", sendSessionId: "", onOpen() {}, onFoldChange() {} };
  let tree = runtime.render(props);
  const row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 20 });
  tree = runtime.render(props);
  const menu = walk(tree).find((node) => node.type === "HudMenu");
  const items = menu.props.items;
  assert.equal(items[0].disabled, true, "无目标会话时添加至聊天置灰");
  assert.equal(items[0].reason, zh.chatAddNoTarget);
  assert.equal(items[4].disabled, true, "旧宿主缺 absolutePath 时绝对路径复制置灰");
});

// —— v0.21.3：产物收录子会话（子代理）写出的文件 ——

/** 构造一条带事件时间的 `write` / `edit` 工具调用事件（时间用于跨会话排序）。 */
const timedToolCall = (seq, time, path, name = "write") => ({ ...toolCallEvent(seq, 0, name, path), time });

test("v0.21.3：sources 里的子会话候选一并汇总，按改动时间倒序且与主会话去重", async () => {
  const output = await collectOutputs({
    sessionId: "s1",
    cwd: "/ws",
    events: [timedToolCall(1, 100, "docs/main.md")],
    exists: async () => true,
    sources: [
      {
        cwd: "/ws",
        events: [timedToolCall(1, 300, "docs/handoff/a.md"), timedToolCall(2, 200, "docs/main.md")],
      },
    ],
  });
  assert.deepEqual(
    output.files.map((file) => file.path),
    ["docs/handoff/a.md", "docs/main.md"],
    "子会话产物按时间插进列表，不另起一段",
  );
  assert.equal(output.total, 2, "同一路径只算一条候选");
  // 去重保留先扫描到的主会话记录（产物模块以主会话的展示信息为准）。
  const shared = output.files.find((file) => file.path === "docs/main.md");
  assert.equal(shared.source, "session");
  assert.equal(output.files[0].source, "subagent", "子会话产物标记来源");
  // 子会话同样只认 write / edit 与白名单后缀。
  const filtered = await collectOutputs({
    sessionId: "s1",
    cwd: "/ws",
    exists: async () => true,
    sources: [
      {
        cwd: "/ws",
        events: [
          timedToolCall(1, 10, "notes.txt", "write"),
          timedToolCall(2, 20, "docs/a.md", "bash"),
          timedToolCall(3, 30, "docs/b.md", "edit"),
        ],
      },
    ],
  });
  assert.deepEqual(filtered.files.map((file) => file.path), ["docs/b.md"], "非白名单后缀与其它工具都不收录");
});

test("v0.21.3：不同工作区的子会话按主工作区换算路径，越界文件丢弃", async () => {
  const output = await collectOutputs({
    sessionId: "s1",
    cwd: "/ws",
    exists: async () => true,
    sources: [
      // 与主会话共用工作区：路径原样保留。
      { cwd: "/ws", events: [timedToolCall(1, 10, "docs/same.md")] },
      // 运行在 worktree 里：绝对路径落在主工作区内，换算成主会话相对路径。
      { cwd: "/ws/worktrees/wt", events: [timedToolCall(1, 20, "docs/wt.md")] },
      // 运行在完全无关的目录：换算后越界，直接丢弃。
      { cwd: "/elsewhere", events: [timedToolCall(1, 30, "docs/outside.md")] },
      // 坏数据：sources 里混入 null 不应让整次收集失败。
      null,
    ],
  });
  assert.deepEqual(
    output.files.map((file) => file.path),
    ["worktrees/wt/docs/wt.md", "docs/same.md"],
    "worktree 产物换算进主工作区，工作区外的丢弃",
  );
});

test("v0.21.3：子会话产物与主会话共用上限、stat 预算与右侧栏地址", async () => {
  const childEvents = [];
  for (let index = 1; index <= 12; index += 1) childEvents.push(timedToolCall(index, index, `out/f${index}.png`));
  let stats = 0;
  const output = await collectOutputs({
    sessionId: "s1",
    cwd: "/ws",
    exists: async () => { stats += 1; return true; },
    sources: [{ cwd: "/ws", events: childEvents }],
  });
  assert.equal(output.files.length, 10, "上限对合并后的列表生效");
  assert.equal(output.truncated, true);
  assert.equal(output.stats, stats, "stats 与实际检查次数一致");
  assert.equal(output.files[0].path, "out/f12.png", "最新改动在前");
  assert.equal(output.files[0].address, "dsh-resource://file/session/s1/out/f12.png", "地址用主会话 id 拼");

  const capped = await collectOutputs({
    sessionId: "s1",
    cwd: "/ws",
    exists: async () => true,
    statLimit: 3,
    sources: [{ cwd: "/ws", events: childEvents }],
  });
  assert.equal(capped.stats, 3, "子会话候选同样受 stat 预算约束");
});

// v0.21.6：目录引用必须与官方 @ 引用同一形状（尾斜杠 + appearance "folder" + 标签带斜杠），
// 否则输入框会把文件夹渲染成文件芯片。
test("目录引用与官方形状一致：@dir/、appearance folder、标签带尾斜杠", async () => {
  const inserted = [];
  const context = vm.createContext({
    resolveComposerTarget: async () => ({
      input: { addFiles: (refs) => { inserted.push(refs[0]); return true; }, focus: () => {} },
    }),
  });
  vm.runInContext(
    `${extractFunction("outputFileMention")}\nasync ${extractFunction("addPathToChat")}\nthis.addPathToChat = addPathToChat; this.outputFileMention = outputFileMention;`,
    context,
  );
  const status = await context.addPathToChat("s1", "docs/guides", "guides", true);
  assert.equal(status, "ok");
  assert.deepEqual(JSON.parse(JSON.stringify(inserted)), [{
    source: "reference",
    ref: "@docs/guides/",
    label: "guides/",
    appearance: "folder",
    clipboardText: "@docs/guides/",
  }]);
  const spaced = context.outputFileMention("docs/my notes", true);
  assert.equal(spaced, '@"docs/my notes/"', "含空格的目录用引号包住并保留尾斜杠");
  assert.equal(context.outputFileMention("docs/a.md", false), "@docs/a.md", "文件路径不带尾斜杠");
});
