// dsh-awesome-hud — v0.20.0：Git commit 弹窗内的「AI 生成提示词」回归
//  1) 宿主：默认模板 / 占位符渲染 / 提示词收敛 / schema 默认值 / generate 链路接线；
//  2) 客户端：默认折叠、展开后回填（默认或自定义）、编辑保存、恢复默认、空值与失败提示。
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_COMMIT_PROMPT, COMMIT_PROMPT_PLACEHOLDERS, renderCommitPromptTemplate, Config,
  generateCommitMessage, formatStyledDate,
} from "../lib/index.js";
import {
  COMMIT_PROMPT_MAX_LENGTH, normalizeCommitPrompt, defaultSettings, normalizeSettings, commitPromptOf,
} from "../lib/settings.js";
import { clientSource, extractFunction, hudClient } from "./helpers/client-harness.mjs";

const HOST_SOURCE = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

test("宿主：默认模板包含全部占位符，且作为空模板的回退值", () => {
  for (const key of COMMIT_PROMPT_PLACEHOLDERS) {
    assert.match(DEFAULT_COMMIT_PROMPT, new RegExp(`\\{\\{${key}\\}\\}`), `默认模板缺少 {{${key}}}`);
  }
  assert.equal(renderCommitPromptTemplate("", {}), DEFAULT_COMMIT_PROMPT, "空模板回退默认");
  assert.equal(renderCommitPromptTemplate(null, {}), DEFAULT_COMMIT_PROMPT);
  assert.equal(renderCommitPromptTemplate("   ", {}), DEFAULT_COMMIT_PROMPT, "纯空白同样回退");
});

test("宿主：renderCommitPromptTemplate 注入动态值、保留未知占位符、压缩空行", () => {
  const rendered = renderCommitPromptTemplate("A {{today}} B {{project}} C {{spec}} D {{sessionContext}} E", {
    today: "261114", project: "P v1.0.0", spec: "SPEC-TEXT", sessionContext: "",
  });
  assert.equal(rendered, "A 261114 B P v1.0.0 C SPEC-TEXT D  E");

  // 未知占位符原样保留，用户能看出自己写错了名字。
  assert.equal(renderCommitPromptTemplate("x {{foo}} y", { spec: "s" }), "x {{foo}} y");
  // 会话上下文为空时不留大段空行（模板里的空占位符会被压缩）。
  assert.equal(renderCommitPromptTemplate("a\n\n{{sessionContext}}\n\nb", { sessionContext: "" }), "a\n\nb");
  // 自定义模板不依赖占位符也能原样生效。
  assert.equal(renderCommitPromptTemplate("只用英文，不加项目名。", {}), "只用英文，不加项目名。");
  // CRLF 归一。
  assert.equal(renderCommitPromptTemplate("a\r\nb", {}), "a\nb");
});

test("宿主：提示词收敛——换行归一、去首尾空白、超长截断、坏输入回落默认", () => {
  assert.equal(normalizeCommitPrompt("  a\r\nb  "), "a\nb");
  assert.equal(normalizeCommitPrompt(""), "");
  assert.equal(normalizeCommitPrompt(undefined), "");
  assert.equal(normalizeCommitPrompt(42), "");
  const long = "x".repeat(COMMIT_PROMPT_MAX_LENGTH + 100);
  assert.equal(normalizeCommitPrompt(long).length, COMMIT_PROMPT_MAX_LENGTH);
  assert.equal(defaultSettings().commitPrompt, "");
  assert.equal(normalizeSettings({ commitPrompt: " a \r\nb " }).commitPrompt, "a\nb");
  assert.equal(normalizeSettings({ commitPrompt: 1 }).commitPrompt, "");
  assert.equal(commitPromptOf({ commitPrompt: "x" }), "x");
  assert.equal(commitPromptOf({}), "");
  // schema 默认值为空字符串（= 使用内置默认模板）。
  assert.equal(Config.dict.commitPrompt.meta.default, "");
});

test("宿主接线：generate 使用保存的提示词模板，git/prompt 读写并回传默认模板", () => {
  // 生成函数签名接收模板，并用 renderCommitPromptTemplate 注入动态值。
  assert.match(HOST_SOURCE, /export async function generateCommitMessage\(ctx, subprocess, cwd, sessionId, promptTemplate\) \{/);
  assert.match(HOST_SOURCE, /const customPrompt = typeof promptTemplate === "string" && promptTemplate\.trim\(\) !== "";/);
  assert.match(HOST_SOURCE, /const system = renderCommitPromptTemplate\(customPrompt \? promptTemplate : DEFAULT_COMMIT_PROMPT, \{/);
  assert.match(HOST_SOURCE, /spec: LOCAL_COMMIT_SPEC,/);
  assert.match(HOST_SOURCE, /today,/);
  assert.match(HOST_SOURCE, /project: pkg === null/);
  assert.match(HOST_SOURCE, /sessionContext: sessionContext === ""/);
  // 用户消息只携带 diff；日期前缀与版本校验只在默认提示词下执行。
  assert.match(HOST_SOURCE, /const prompt = \["Staged changes \(git diff --staged\):", body\]\.join\("\\n"\);/);
  assert.match(HOST_SOURCE, /if \(!customPrompt\) \{[\s\S]{0,220}head\[1\] !== today/);
  assert.match(HOST_SOURCE, /if \(!customPrompt && !exempt\(message\)\) \{/);
  // commit-ai 读取已保存的自定义提示词（空字符串 = 默认模板）。
  assert.match(HOST_SOURCE, /return await generateCommitMessage\(ctx, subprocess, cwd, sessionId, currentCommitPrompt\(\)\);/);
  // git/prompt：无 prompt 字段读取，有则保存（""=恢复默认），返回 { default, custom, persistent }。
  assert.match(HOST_SOURCE, /async "git\/prompt"\(payload\) \{/);
  assert.match(HOST_SOURCE, /return \{ default: DEFAULT_COMMIT_PROMPT, custom: currentCommitPrompt\(\), persistent: settingsScope !== null \};/);
  // 写入时带上全部设置字段（与 settingsHandler 一致），避免清空其它设置。
  assert.match(HOST_SOURCE, /await settingsScope\.update\(\{[\s\S]{0,420}modules: current\.modules,[\s\S]{0,260}panel: current\.panel,[\s\S]{0,40}commitPrompt: next,[\s\S]{0,40}\}\);/);
  assert.match(HOST_SOURCE, /memoryCommitPrompt = next;/);
  assert.match(HOST_SOURCE, /method === "git\/prompt"/, "路由白名单必须放行 git/prompt");
});

/**
 * 极简有状态 hooks 运行时：state/effects 按调用顺序存槽位，重新 render 即可看到 setState 结果；
 * call 由测试注入响应，用来观察「读取 / 保存 / 恢复默认」发出的请求。
 */
function loadCommitPromptSection(dict, options = {}) {
  const states = [];
  const effects = [];
  const calls = [];
  const toasts = [];
  let cursor = 0;
  let respond = options.respond ?? (async () => ({ ok: true, default: "DEFAULT PROMPT", custom: "", persistent: true }));
  const context = vm.createContext({
    react: {
      useState: (init) => {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof init === "function" ? init() : init;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useEffect: (effect) => { effects.push(effect); return undefined; },
      createElement: (type, props, ...children) => ({
        type: typeof type === "string" ? type : type?.name ?? "Component",
        props: props ?? {},
        children,
      }),
    },
    Icon: (props) => ({ type: "Icon", props, children: [] }),
    IME_INPUT_PROPS: { onCompositionStart() {}, onCompositionEnd() {}, onCompositionUpdate() {} },
    t: (key) => dict[key] ?? key,
    interpolate: (text, values) => Object.entries(values ?? {}).reduce((next, [key, value]) => next.replace(`{${key}}`, String(value)), text),
    call: async (method, payload) => {
      calls.push({ method, payload });
      return respond(method, payload);
    },
    toast: (text) => { toasts.push(text); },
  });
  vm.runInContext(`${extractFunction("CommitPromptSection")}; this.CommitPromptSection = CommitPromptSection;`, context);
  const render = () => {
    cursor = 0;
    effects.length = 0;
    return context.CommitPromptSection();
  };
  const runEffects = () => {
    for (const effect of [...effects]) effect();
    effects.length = 0;
  };
  return {
    render,
    runEffects,
    calls,
    toasts,
    setRespond: (next) => { respond = next; },
  };
}

const walk = (node) => {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (typeof node !== "object") return [node];
  return [node, ...(node.children ?? []).flatMap(walk)];
};
const byClass = (node, className) => walk(node).filter((child) => child.props?.className === className);
const textOf = (node) => walk(node).filter((child) => typeof child === "string" || typeof child === "number").join("");
/** vm 里创建的对象跨 realm，deepEqual 前先转成本域普通对象。 */
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** 生成链路的桩环境：临时工作区（package.json）+ git 输出 + 捕获 system/messages 的 llm。 */
async function withGenerateStub(run) {
  const dir = await mkdtemp(join(tmpdir(), "hud-commit-prompt-"));
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "probe-app", version: "1.2.3" }));
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
    const subprocess = {
      spawn({ argv }) {
        const joined = argv.join(" ");
        const text = joined === "git diff --staged" ? diff
          : joined === "git diff --staged --name-only" ? "a.txt\n"
            : "";
        return {
          done: Promise.resolve({ exitCode: 0 }),
          collected: { stdout: { readFrom: () => ({ text }) }, stderr: { readFrom: () => ({ text: "" }) } },
        };
      },
    };
    const captured = [];
    const ctx = {
      get(name) {
        if (name !== "llm") return undefined;
        return {
          stream: async function* (request) {
            captured.push(request);
            yield { type: "text-delta", text: "CUSTOM OUTPUT ONLY" };
            yield { type: "finish", reason: { kind: "stop" } };
          },
        };
      },
    };
    return await run({ dir, diff, subprocess, ctx, captured });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("宿主：自定义提示词完整接管生成——原样返回，不再补日期前缀/版本号", async () => {
  await withGenerateStub(async ({ dir, diff, subprocess, ctx, captured }) => {
    const custom = "请只输出一行：CUSTOM OUTPUT ONLY。不要日期前缀，不要版本号。";
    const result = await generateCommitMessage(ctx, subprocess, dir, "", custom);
    assert.equal(result.message, "CUSTOM OUTPUT ONLY", "自定义提示词下不得改写模型输出");
    assert.equal(captured[0].system, custom, "system 必须换成自定义提示词");
    // 用户消息只携带 diff，不再重复写死的默认指令（避免与自定义提示词冲突）。
    assert.equal(captured[0].messages[0].content[0].text, `Staged changes (git diff --staged):\n${diff}`);
  });
});

test("宿主：未自定义提示词时保留默认保障——补日期前缀并强制版本号", async () => {
  await withGenerateStub(async ({ dir, subprocess, ctx, captured }) => {
    const result = await generateCommitMessage(ctx, subprocess, dir, "");
    const today = formatStyledDate(new Date());
    assert.match(result.message, new RegExp(`^\\[${today}\\] probe-app v1\\.2\\.4：CUSTOM OUTPUT ONLY`), "默认路径仍补日期前缀并强制版本号");
    assert.match(captured[0].system, /Follow this local commit convention EXACTLY:/);
    assert.match(captured[0].system, /Today's date in YYMMDD is \d{6}/);
    assert.match(captured[0].system, /The project name is probe-app and its CURRENT version is 1\.2\.3/);
  });
});

test("客户端：默认折叠，展开后回填默认提示词；无自定义时不显示「已自定义」", async () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadCommitPromptSection(zh);
  let tree = runtime.render();
  assert.equal(byClass(tree, "hud-commit-prompt").length, 1, "提示词区域存在");
  assert.equal(byClass(tree, "hud-commit-prompt-input").length, 0, "默认折叠，不渲染输入框");
  assert.equal(byClass(tree, "hud-commit-prompt-badge").length, 0);

  runtime.runEffects();
  await settle();
  tree = runtime.render();
  assert.deepEqual(plain(runtime.calls[0]), { method: "git/prompt", payload: {} }, "挂载时读取提示词");

  // 展开。
  byClass(tree, "hud-commit-prompt-head")[0].props.onClick();
  tree = runtime.render();
  const input = byClass(tree, "hud-commit-prompt-input")[0];
  assert.ok(input, "展开后显示输入框");
  assert.equal(input.props.value, "DEFAULT PROMPT");
  assert.equal(input.props.disabled, false);
  assert.match(textOf(byClass(tree, "hud-commit-prompt-placeholders")[0]), /\{\{spec\}\}/, "展示占位符说明");
  // 未改动时「保存」置灰、「恢复默认」置灰。
  const buttons = walk(tree).filter((node) => node.type === "button" && node.props?.className?.includes?.("hud-btn"));
  assert.equal(buttons.find((node) => node.props.className === "hud-btn-ai").props.disabled, true, "未改动时保存禁用");
  assert.equal(buttons.find((node) => node.props.className === "hud-btn-small").props.disabled, true, "无自定义时恢复默认禁用");
});

test("客户端：编辑后保存发送自定义提示词；与默认一致时按默认（空字符串）保存", async () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadCommitPromptSection(zh);
  let tree = runtime.render();
  runtime.runEffects();
  await settle();
  tree = runtime.render();
  byClass(tree, "hud-commit-prompt-head")[0].props.onClick();
  tree = runtime.render();
  byClass(tree, "hud-commit-prompt-input")[0].props.onChange({ target: { value: "CUSTOM {{today}}" } });
  tree = runtime.render();
  const save = walk(tree).find((node) => node.type === "button" && node.props?.className === "hud-btn-ai");
  assert.equal(save.props.disabled, false, "有改动后可保存");

  runtime.setRespond(async (method, payload) => ({ ok: true, default: "DEFAULT PROMPT", custom: payload.prompt, persistent: true }));
  save.props.onClick();
  await settle();
  tree = runtime.render();
  assert.deepEqual(plain(runtime.calls.at(-1)), { method: "git/prompt", payload: { prompt: "CUSTOM {{today}}" } });
  assert.match(textOf(byClass(tree, "hud-commit-prompt-note")[0]), /已保存提示词/);
  assert.match(runtime.toasts.at(-1), /已保存提示词/, "保存成功同时给出 toast");
  assert.equal(byClass(tree, "hud-commit-prompt-badge").length, 1, "保存自定义后显示「已自定义」");
  assert.equal(byClass(tree, "hud-commit-prompt-input")[0].props.value, "CUSTOM {{today}}");

  // 把输入框改回默认内容再保存：按「默认」保存（空字符串），不会留下等价的自定义提示词。
  byClass(tree, "hud-commit-prompt-input")[0].props.onChange({ target: { value: " DEFAULT PROMPT " } });
  tree = runtime.render();
  runtime.setRespond(async (method, payload) => ({ ok: true, default: "DEFAULT PROMPT", custom: payload.prompt, persistent: true }));
  walk(tree).find((node) => node.type === "button" && node.props?.className === "hud-btn-ai").props.onClick();
  await settle();
  assert.deepEqual(plain(runtime.calls.at(-1).payload), { prompt: "" }, "与默认一致时保存空字符串");
});

test("客户端：恢复默认清空自定义提示词并回填默认模板", async () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadCommitPromptSection(zh, {
    respond: async () => ({ ok: true, default: "DEFAULT PROMPT", custom: "CUSTOM", persistent: true }),
  });
  let tree = runtime.render();
  runtime.runEffects();
  await settle();
  tree = runtime.render();
  byClass(tree, "hud-commit-prompt-head")[0].props.onClick();
  tree = runtime.render();
  assert.equal(byClass(tree, "hud-commit-prompt-input")[0].props.value, "CUSTOM");
  assert.equal(byClass(tree, "hud-commit-prompt-badge").length, 1, "有自定义时显示徽标");

  runtime.setRespond(async (method, payload) => ({ ok: true, default: "DEFAULT PROMPT", custom: payload.prompt, persistent: true }));
  walk(tree).find((node) => node.type === "button" && node.props?.className === "hud-btn-small").props.onClick();
  await settle();
  tree = runtime.render();
  assert.deepEqual(plain(runtime.calls.at(-1)), { method: "git/prompt", payload: { prompt: "" } });
  assert.equal(byClass(tree, "hud-commit-prompt-input")[0].props.value, "DEFAULT PROMPT");
  assert.equal(byClass(tree, "hud-commit-prompt-badge").length, 0, "恢复默认后不再显示徽标");
  assert.match(textOf(byClass(tree, "hud-commit-prompt-note")[0]), /已恢复默认提示词/);
  assert.match(runtime.toasts.at(-1), /已恢复默认提示词/);
});

test("客户端：空提示词不可保存；保存失败给出原因；旧宿主提示仅本次运行有效", async () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadCommitPromptSection(zh, {
    respond: async () => ({ ok: true, default: "DEFAULT PROMPT", custom: "", persistent: false }),
  });
  let tree = runtime.render();
  runtime.runEffects();
  await settle();
  tree = runtime.render();
  byClass(tree, "hud-commit-prompt-head")[0].props.onClick();
  tree = runtime.render();
  // 旧宿主（persistent=false）给出提示。
  assert.match(textOf(walk(byClass(tree, "hud-commit-prompt")).find((node) => node.props?.["data-kind"] === "warn")), /本次运行/);

  byClass(tree, "hud-commit-prompt-input")[0].props.onChange({ target: { value: "   " } });
  tree = runtime.render();
  assert.equal(walk(tree).find((node) => node.type === "button" && node.props?.className === "hud-btn-ai").props.disabled, true, "空提示词不能保存");

  byClass(tree, "hud-commit-prompt-input")[0].props.onChange({ target: { value: "CUSTOM" } });
  tree = runtime.render();
  runtime.setRespond(async () => { throw new Error("boom"); });
  walk(tree).find((node) => node.type === "button" && node.props?.className === "hud-btn-ai").props.onClick();
  await settle();
  tree = runtime.render();
  assert.match(textOf(byClass(tree, "hud-commit-prompt-note")[0]), /提示词保存失败：boom/);
});

test("客户端接线：commit 弹窗在暂存数量与提交输入框上方渲染提示词区域", () => {
  assert.match(clientSource, /react\.createElement\(CommitPromptSection, null\)/);
  const modalStart = clientSource.indexOf('className: "hud-modal-body hud-commit-modal-body"');
  const promptIndex = clientSource.indexOf("react.createElement(CommitPromptSection, null)", modalStart);
  const noteIndex = clientSource.indexOf('className: "hud-commit-note"', modalStart);
  assert.ok(modalStart > 0 && promptIndex > modalStart && noteIndex > promptIndex, "提示词区域必须在 note 之前");
  // 样式：折叠默认、可编辑文本域、占位符说明、错误/警告配色。
  assert.match(clientSource, /\.hud-commit-prompt-head\{display:flex;align-items:center;gap:6px;width:100%;min-width:0;border:0;background:0 0;padding:2px 0;/);
  assert.match(clientSource, /\.hud-commit-prompt-input\{width:100%;box-sizing:border-box;min-height:110px;max-height:200px;resize:vertical;/);
  assert.match(clientSource, /\.hud-commit-prompt-note\[data-kind=error\]\{color:var\(--dsw-alias-state-error-primary\)\}/);
  assert.match(clientSource, /\.hud-commit-modal-body\{overflow-y:auto;overscroll-behavior:contain\}/);
  // 文案：中英成对。
  const { zh, en } = hudClient().dictionaries[0];
  for (const key of ["gitPromptTitle", "gitPromptCustom", "gitPromptHint", "gitPromptPlaceholders", "gitPromptSave", "gitPromptRestore", "gitPromptSaved", "gitPromptRestored", "gitPromptLoadFailed", "gitPromptSaveFailed", "gitPromptNotPersistent"]) {
    assert.equal(typeof zh[key], "string", `中文缺键：${key}`);
    assert.equal(typeof en[key], "string", `英文缺键：${key}`);
  }
});
