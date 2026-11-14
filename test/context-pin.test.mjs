// dsh-awesome-hud — v0.18.7：「上下文模块位置固定」
//
// 覆盖点：
//   1. 设置模型：context.pinned 默认关闭，host 侧收敛/白名单与 schema 同步；
//   2. 可用性判定 contextPinState：仅「已启用模块排序首位是 context」时允许，隐藏给单独原因；
//   3. 设置弹窗：上下文卡片新增一行开关，不满足条件时置灰并给出行内原因；
//   4. 面板：固定生效时上下文节点移出滚动容器渲染到 .hud-panel-pin，未开启时结构与旧版一致；
//   5. 样式：固定区限高 + 内部滚动；中英字典键齐备。
//   6. v0.19.2：上下文卡片内「始终显示分段进度条」排到「上下文模块位置固定」上方。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  MODULE_KEYS, defaultModules, defaultContextSettings, normalizeContextSettings, normalizeSettings,
  sanitizeContextPatch, isDefaultSettings, defaultSettings,
} from '../lib/settings.js';
import { clientSource, extractFunction, hudClient, nodes } from './helpers/client-harness.mjs';

const source = clientSource;
const hostSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');

/** 在独立 vm 上下文里跑「顺序归一化 + 固定可用性判定」的真实源码。 */
function pinContext() {
  const context = vm.createContext({ MODULE_KEYS: [...MODULE_KEYS] });
  vm.runInContext(
    `${extractFunction('defaultModuleOrder')}\n${extractFunction('normalizeModuleOrder')}\n${extractFunction('contextPinState')}\nthis.pin = contextPinState;`,
    context,
  );
  return vm.runInContext('this.pin', context);
}

const workingWorkspace = () => ({
  workspaceId: 'w1',
  path: '/work/session',
  title: 'Session',
  updatedAt: 2,
  sessionIds: ['sess'],
});

test('设置模型：pinned 默认关闭，host 侧收敛与白名单一并生效', () => {
  assert.equal(defaultContextSettings().pinned, false);
  // 旧数据缺 pinned → 默认关闭（升级后面板观感不变）
  assert.equal(normalizeContextSettings({ barStyle: 'segmented' }).pinned, false);
  assert.equal(normalizeContextSettings({ pinned: true }).pinned, true);
  assert.equal(normalizeContextSettings({ pinned: 'yes' }).pinned, false);
  assert.equal(normalizeSettings({ context: { pinned: true } }).context.pinned, true);
  // 写侧白名单接受布尔 pinned，拒绝非布尔
  assert.deepEqual(sanitizeContextPatch({ pinned: true }), { patch: { pinned: true }, changed: false });
  assert.equal(sanitizeContextPatch({ pinned: 1 }), null);
  // 「恢复默认」判定把 pinned 纳入比较
  assert.equal(isDefaultSettings(defaultSettings()), true);
  assert.equal(isDefaultSettings({ ...defaultSettings(), context: { ...defaultContextSettings(), pinned: true } }), false);
});

test('host schema 收录 pinned：z.boolean().default(false)', () => {
  assert.match(hostSource, /context: z\.object\(\{[\s\S]{0,220}pinned: z\.boolean\(\)\.default\(false\),/);
});

test('客户端默认值与收敛同样带 pinned', () => {
  assert.match(source, /return \{ barStyle: "default", showStats: true, showUsage: true, pinned: false \};/);
  assert.match(source, /pinned: typeof value\.pinned === "boolean" \? value\.pinned : base\.pinned,/);
});

test('contextPinState：首位可用、被排到后面禁用、被隐藏给 hidden 原因', () => {
  const pin = pinContext();
  const modules = defaultModules();
  // 默认顺序 context 居首 → 可固定
  assert.deepEqual(JSON.parse(JSON.stringify(pin(MODULE_KEYS, modules))), { allowed: true, reason: null });
  assert.deepEqual(JSON.parse(JSON.stringify(pin(null, modules))), { allowed: true, reason: null });
  // 把 balance 拖到 context 之前 → 不可固定
  const reordered = ['balance', 'context', ...MODULE_KEYS.filter((key) => key !== 'balance' && key !== 'context')];
  assert.deepEqual(JSON.parse(JSON.stringify(pin(reordered, modules))), { allowed: false, reason: 'order' });
  // 隐藏上下文 → 单独原因
  assert.deepEqual(JSON.parse(JSON.stringify(pin(MODULE_KEYS, { ...modules, context: false }))), { allowed: false, reason: 'hidden' });
  // 排在前面的模块被隐藏时跳过：context 成为首个启用项 → 仍可固定
  assert.deepEqual(JSON.parse(JSON.stringify(pin(reordered, { ...modules, balance: false }))), { allowed: true, reason: null });
});

test('设置弹窗：上下文卡片新增位置固定开关，草稿状态参与判定并提交', () => {
  // 用弹窗草稿（排序 + 模块开关）实时判定，不依赖已确认的设置
  assert.match(source, /const contextPin = contextPinState\(orderDraft, draft\);/);
  // v0.20.0：可用时给简短说明，不可用时优先显示原因。
  assert.match(source, /label: t\("settingsContextPin"\),\n\s*\/\/ 位置固定：可用时给简短说明；不可用时优先说明原因。\n\s*hint: contextPin\.allowed \? t\("settingsContextPinHint"\) : t\(contextPin\.reason === "hidden" \? "settingsContextPinHidden" : "settingsContextPinOrder"\),/);
  assert.match(source, /checked: contextDraft\.pinned === true,/);
  assert.match(source, /disabled: !contextPin\.allowed,\n\s*label: t\("settingsContextPin"\),\n\s*onChange: \(next\) => setContextDraft\(\(prev\) => \(\{ \.\.\.prev, pinned: next \}\)\),/);
});

test('面板：未开启固定时结构与旧版一致（无 .hud-panel-pin，上下文仍在滚动区首位）', () => {
  const client = hudClient({
    state: { current: 'sess', byId: { sess: { cwd: '/work/session', updatedAt: 2, displayTitle: 'Session A' } } },
    current: 'sess',
    workspaces: [workingWorkspace()],
  });
  const panel = client.panel();
  assert.equal(nodes(panel).some((node) => node.props?.className === 'hud-panel-pin'), false);
  const body = nodes(panel).find((node) => node.props?.className === 'hud-panel-body');
  assert.ok(body !== undefined, '滚动容器必须存在');
  const firstModule = nodes(body).slice(1)[0];
  assert.equal(firstModule?.type?.name, 'ContextModule', '默认顺序下上下文仍是滚动区第一项');
});

test('面板：固定生效时上下文移到 .hud-panel-pin，滚动区不再重复渲染', () => {
  // 判定与渲染两处接线
  assert.match(source, /const contextPin = contextPinState\(moduleOrder, modules \?\? defaultModules\(\)\);/);
  assert.match(source, /const contextPinned = contextSettings\?\.pinned === true && contextPin\.allowed && activeModules\.context !== false;/);
  assert.match(source, /context: \(\) => activeModules\.context === false \|\| contextPinned \? null : contextNode\(\),/);
  assert.match(source, /contextPinned\n\s*\? react\.createElement\("div", \{ className: "hud-panel-pin" \}, contextNode\(\)\)\n\s*: null,/);
  // 固定区插在会话模块之后、滚动容器之前
  const sessionIndex = source.indexOf('react.createElement(SessionModule, {');
  const pinIndex = source.indexOf('className: "hud-panel-pin"');
  const bodyIndex = source.indexOf('className: "hud-panel-body", ref: bodyRef');
  assert.ok(sessionIndex > 0 && pinIndex > sessionIndex && bodyIndex > pinIndex, '固定区必须夹在会话模块与滚动容器之间');
});

test('样式：固定区不参与收缩、限高并内部滚动，隐藏滚动条', () => {
  // v0.18.7 修复：flex:none —— 面板撑满时若允许收缩，固定区会被压扁、统计行被裁掉。
  assert.match(source, /\.hud-panel-pin\{flex:none;min-height:0;max-height:55vh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;border-top:1px solid color-mix\(in srgb,var\(--dsw-alias-label-primary\) 9%,transparent\)\}/);
  assert.doesNotMatch(source, /\.hud-panel-pin\{flex:0 1 auto/);
  assert.match(source, /\.hud-panel-pin::-webkit-scrollbar\{width:0;height:0;display:none\}/);
});

test('中英字典都补齐位置固定三项文案', () => {
  const client = hudClient();
  const [dicts] = client.dictionaries;
  assert.ok(dicts !== undefined, '字典必须已注册');
  for (const ns of ['zh', 'en']) {
    for (const key of ['settingsContextPin', 'settingsContextPinOrder', 'settingsContextPinHidden']) {
      assert.equal(typeof dicts[ns][key], 'string', `${ns}.${key} 必须是字符串`);
      assert.ok(dicts[ns][key].length > 0, `${ns}.${key} 不能为空`);
    }
  }
  assert.equal(dicts.zh.settingsContextPin, '上下文模块位置固定');
  assert.equal(dicts.en.settingsContextPin, 'Pin the context module in place');
});

test('新建会话页不展示上下文：固定块自然不出现', () => {
  // 新建会话页的模块白名单不含 context（panelVisibleModules 过滤），
  // 固定判定里的 activeModules.context !== false 因此恒为假，固定块不会被渲染。
  assert.match(source, /const NEW_SESSION_MODULE_KEYS = \["balance", "git", "mcp", "note", "todo"\];/);
  assert.match(source, /const contextPinned = contextSettings\?\.pinned === true && contextPin\.allowed && activeModules\.context !== false;/);
});

test('「恢复默认」的激活态把 pinned 计入比较', () => {
  // 只翻动「位置固定」也应视为「已改动」，否则恢复默认按钮不会激活、也无法复位。
  assert.match(source, /\|\| context\.pinned !== defaultContext\.pinned\) return false;/);
});

test('v0.19.2：「始终显示分段进度条」位于「上下文模块位置固定」上方', () => {
  // 卡片内顺序：会话统计 → Token 用量 → 分段进度条 → 位置固定。
  const stats = source.indexOf('label: t("settingsContextStats")');
  const usage = source.indexOf('label: t("settingsContextUsage")');
  const bar = source.indexOf('label: t("settingsContextBarStyle")');
  const pin = source.indexOf('label: t("settingsContextPin")');
  assert.ok(stats > 0 && usage > stats, '会话统计在 Token 用量之前');
  assert.ok(bar > usage, '分段进度条在 Token 用量之后');
  assert.ok(pin > bar, '分段进度条在「位置固定」之前');
});
