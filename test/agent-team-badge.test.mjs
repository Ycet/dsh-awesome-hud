// dsh-awesome-hud — v0.21.9：会话模块在「智能体团队协作」开启时追加紫色 Agent Team 标签。
//  1) 判定只认官方 agentTeam 投影的 `enabled === true`：缺失、关闭、类型异常一律不显示；
//  2) 标签是纯展示（无 onClick），右侧追加在模型标签之后，容器在模型信息缺失时仍然渲染；
//  3) 样式复用 --hud-lane-5 紫色，文案中英成对；旧的产物截断提示已彻底移除。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { extractConst, extractFunction, hudClient, moduleOf, nodes } from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "lib/client.js"), "utf8");

/** 在沙箱里加载 isAgentTeamEnabled，直接测投影判定。 */
function loadIsAgentTeamEnabled() {
  const context = vm.createContext({});
  vm.runInContext(extractFunction("isAgentTeamEnabled"), context);
  return (projectionValues) => context.isAgentTeamEnabled(projectionValues);
}

/** 打开会话页的 HUD 面板，返回「会话」模块元素（真实 HudPanel 传参路径）。 */
function openSession(projectionValues) {
  const summary = { cwd: "/ws/s1", updatedAt: 1 };
  if (projectionValues !== undefined) summary.projectionValues = projectionValues;
  const state = { current: "s1", byId: { s1: summary } };
  const client = hudClient({
    state,
    current: "s1",
    workspaces: [{ path: "/ws/s1", title: "S1", updatedAt: 1, sessionIds: ["s1"] }],
    respond: () => ({ ok: true, isRepo: true }),
  });
  // 传入 current 后 shell.overlay 默认直接挂载面板，没有悬浮按钮，直接取面板元素。
  const panel = client.panel();
  const session = moduleOf(panel, "SessionModule");
  assert.ok(session, "会话页必须渲染会话模块");
  return session;
}

/** 取出会话模块渲染出的模型 / 团队标签。 */
function chipsOf(session) {
  return nodes(session.type({ ...session.props })).filter((node) => node.props?.className === "hud-model-chip");
}

/** 容器类名是否存在。 */
function hasChipsRow(session) {
  return nodes(session.type({ ...session.props })).some((node) => node.props?.className === "hud-model-chips");
}

const isAgentTeamEnabled = loadIsAgentTeamEnabled();

test("纯函数：只有 agentTeam.enabled === true 才算开启", () => {
  assert.equal(isAgentTeamEnabled({ agentTeam: { enabled: true } }), true);
  assert.equal(isAgentTeamEnabled({ agentTeam: { enabled: true, tasks: [], failure: "x" } }), true);
  // 关闭态、缺失投影、旧版 DSH 常见形态。
  assert.equal(isAgentTeamEnabled({ agentTeam: { enabled: false, tasks: [] } }), false);
  assert.equal(isAgentTeamEnabled({}), false);
  assert.equal(isAgentTeamEnabled({ todos: [] }), false);
  // 数据异常：非对象、null、数组、字符串、enabled 非布尔真值。
  assert.equal(isAgentTeamEnabled(null), false);
  assert.equal(isAgentTeamEnabled(undefined), false);
  assert.equal(isAgentTeamEnabled([]), false);
  assert.equal(isAgentTeamEnabled("team"), false);
  assert.equal(isAgentTeamEnabled({ agentTeam: null }), false);
  assert.equal(isAgentTeamEnabled({ agentTeam: [] }), false);
  assert.equal(isAgentTeamEnabled({ agentTeam: "true" }), false);
  assert.equal(isAgentTeamEnabled({ agentTeam: { enabled: "true" } }), false);
});

test("HudPanel 把投影结果传给会话模块，并渲染紫色 Agent Team 标签", () => {
  const session = openSession({ agentTeam: { enabled: true, tasks: [] } });
  assert.equal(session.props.agentTeamEnabled, true, "必须把 isAgentTeamEnabled(projection) 传给会话模块");
  assert.equal(session.props.modelBadge, null, "本用例没有模型目录快照，模型标签为空");

  assert.equal(hasChipsRow(session), true, "模型信息缺失时容器仍要渲染");
  const chips = chipsOf(session);
  assert.equal(chips.length, 1, "只有团队标签");
  assert.equal(chips[0].props["data-team"], "true");
  assert.equal(chips[0].props.title, "sessionTeamTitle", "悬停使用本地化文案键");
  assert.equal(chips[0].children.join(""), "sessionTeamBadge", "标签文案走字典键");
  assert.equal(chips[0].props.onClick, undefined, "纯展示，不可点击");
});

test("关闭团队协作或不支持投影时完全不渲染标签", () => {
  const disabled = openSession({ agentTeam: { enabled: false, tasks: [] } });
  assert.equal(disabled.props.agentTeamEnabled, false);
  assert.equal(chipsOf(disabled).length, 0);
  assert.equal(hasChipsRow(disabled), false, "关闭态不占位");

  // 旧版 DSH：会话快照里没有 projectionValues。
  const missing = openSession(undefined);
  assert.equal(missing.props.agentTeamEnabled, false);
  assert.equal(chipsOf(missing).length, 0);
  assert.equal(hasChipsRow(missing), false);

  // 数据异常：enabled 不是布尔 true。
  const broken = openSession({ agentTeam: { enabled: "true" } });
  assert.equal(broken.props.agentTeamEnabled, false);
  assert.equal(chipsOf(broken).length, 0);
});

test("渲染接线：容器条件、属性与样式", () => {
  assert.match(source, /const agentTeamEnabled = isAgentTeamEnabled\(projection\);/);
  assert.match(source, /agentTeamEnabled,\n/);
  assert.match(source, /props\.modelBadge === null && props\.agentTeamEnabled !== true \? null : react\.createElement\("div", \{ className: "hud-model-chips" \},/);
  assert.match(source, /"data-team": "true",/);
  assert.match(source, /\.hud-model-chip\[data-team=true\]\{color:var\(--hud-lane-5\);background:color-mix\(in srgb,var\(--hud-lane-5\) 14%,transparent\)\}/);
  // 一行放不下两个标签时换行：容器允许折行，行间距 4px、列间距 6px。
  assert.match(source, /\.hud-model-chips\{display:flex;align-items:center;flex-wrap:wrap;gap:4px 6px\}/);
});

test("产物截断提示已彻底移除：渲染、字典、样式与死代码", () => {
  assert.doesNotMatch(source, /hud-output-hint/);
  assert.doesNotMatch(source, /outputsLimitHint/);
  assert.doesNotMatch(source, /const limit = Number\.isSafeInteger\(props\.limit\)/);
  const { zh, en } = hudClient().dictionaries[0];
  assert.equal(zh.outputsLimitHint, undefined);
  assert.equal(en.outputsLimitHint, undefined);
});

test("文案：标签与悬停说明在中英词典里成对存在", () => {
  const { zh, en } = hudClient().dictionaries[0];
  assert.equal(zh.sessionTeamBadge, "Agent Team");
  assert.equal(en.sessionTeamBadge, "Agent Team");
  assert.equal(zh.sessionTeamTitle, "本会话已开启智能体团队协作");
  assert.equal(en.sessionTeamTitle, "Agent teamwork is on for this session");
});

test("说明页：会话一节补团队标签说明，产物一节保持不变", () => {
  const { zh, en } = hudClient().dictionaries[0];
  assert.equal(typeof zh.guideSessionShowTeam, "string");
  assert.equal(typeof en.guideSessionShowTeam, "string");
  const sections = vm.runInNewContext(`${extractConst("GUIDE_SECTIONS")}\nGUIDE_SECTIONS;`);
  const session = sections.find((section) => section.key === "session");
  assert.ok(session.groups[0].items.includes("guideSessionShowTeam"), "会话一节要列出团队标签说明");
  const outputs = sections.find((section) => section.key === "outputs");
  assert.ok(outputs.groups[0].items.includes("guideOutputsShowOrder"), "产物一节仍描述排序与条数");
  assert.equal(outputs.groups[0].items.some((key) => /LimitHint/.test(key)), false, "产物一节不再引用截断提示");
});
