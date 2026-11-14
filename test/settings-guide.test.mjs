// dsh-awesome-hud — v0.18.5：设置弹窗「使用说明」标签页
// 覆盖：标签行结构与默认页、随时切换、目录/内容与大纲一致、图标、草稿保留、
// 底部栏常驻、目录高亮纯函数、中英文字典齐全、样式与接线。
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  MODULE_KEYS, defaultModules, defaultUsageDisplay, defaultContextSettings, normalizeContextSettings,
  normalizeModuleOrder, defaultPanelSettings, normalizePanelSettings,
} from '../lib/settings.js';
import { extractFunction, extractConst, hudClient, nodes, clientSource } from './helpers/client-harness.mjs';
import { assetFileFor } from '../lib/index.js';

const USAGE_SETTING_KEYS = ['deepseek', 'opencode', 'codex', 'showJump'];
const MODULE_LABELS = Object.fromEntries(MODULE_KEYS.map(key => [key, () => `label:${key}`]));

/**
 * 极简 hooks 运行时（与 settings-dialog-layout 同一套思路）：
 * state 按调用顺序保存在槽位里，setState 后由测试重新渲染，从而真实走一遍
 * 「点标签 → 渲染说明页 → 点回设置页」的交互。
 */
function createRuntime(primitives = null) {
  const slots = [];
  const refs = [];
  let cursor = 0;
  const context = vm.createContext({
    primitives,
    Icon: 'Icon',
    t: key => key,
    isImeComposing: () => false,
    suppressNativeDragImage: () => {},
    MODULE_KEYS: [...MODULE_KEYS],
    MODULE_LABELS,
    USAGE_SETTING_KEYS,
    defaultModules,
    defaultUsageDisplay,
    defaultContextSettings,
    normalizeContextSettings,
    normalizeModuleOrder,
    defaultPanelSettings,
    normalizePanelSettings,
    window: { clearTimeout() {}, setTimeout() {} },
    document: { activeElement: null },
  });
  context.react = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({
      type,
      props: children.length === 0 ? (props ?? {}) : { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
      children,
    }),
    useState(init) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    useEffect() {},
    useCallback(fn) { return fn; },
  };
  context.react_dom = { createPortal: node => node };
  vm.runInContext(
    [
      extractFunction('guideActiveKey'),
      extractConst('GUIDE_SECTIONS'),
      extractFunction('officialControl'),
      extractFunction('HudSwitch'),
      extractFunction('HudSegmented'),
      extractFunction('SettingRow'),
      extractFunction('SettingsGuide'),
      extractFunction('isDefaultDraft'),
      extractFunction('contextPinState'),
      extractFunction('SettingsDialog'),
    ].join('\n'),
    context,
  );
  // 顶层 const 不是全局对象属性，需要在同一词法环境里取值。
  const exposed = vm.runInContext('({ sections: GUIDE_SECTIONS, activeKey: guideActiveKey })', context);
  // 官方控件保留为叶子节点，便于断言「确实用了官方组件」；其余本地函数组件展开成元素树。
  const keep = new Set([primitives?.Switch, primitives?.SegmentedControl].filter(Boolean));
  const expand = node => {
    if (node === null || typeof node !== 'object') return node;
    if (typeof node.type === 'function' && !keep.has(node.type)) return expand(node.type(node.props));
    return { ...node, children: (node.children ?? []).flat(Infinity).map(expand) };
  };
  let props = null;
  let last = null;
  return {
    sections: JSON.parse(JSON.stringify(exposed.sections)),
    guideActiveKey: exposed.activeKey,
    render(nextProps) {
      if (nextProps !== undefined) props = nextProps;
      cursor = 0;
      last = expand(context.SettingsDialog(props));
      return last;
    },
    get element() { return last; },
  };
}

function baseProps(overrides = {}) {
  return {
    modules: defaultModules(),
    usage: defaultUsageDisplay(),
    context: defaultContextSettings(),
    order: normalizeModuleOrder(null),
    panel: defaultPanelSettings(),
    balanceAvailable: true,
    usageAvailability: { deepseek: true, opencode: true, codex: true },
    usageReasons: {},
    onClose() {},
    onConfirm() {},
    ...overrides,
  };
}

const classOf = node => node?.props?.className;
const byClass = (root, name) => nodes(root).filter(node => classOf(node) === name);
const textOf = node => {
  if (typeof node === 'string') return node;
  if (node === null || typeof node !== 'object') return '';
  return (node.children ?? []).flat(Infinity).map(textOf).join('');
};
const findTab = (root, key) => nodes(root).find(node => node.type === 'button' && node.props?.role === 'tab' && node.props?.id === `hud-settings-tab-${key}`);
const clickTab = (root, key) => findTab(root, key).props.onClick();
const switchesOf = root => nodes(root).filter(node => node.type === 'button' && node.props?.role === 'switch');

test('标签行：默认停在「HUD 设置」，两个 role=tab 且 aria 属性完整', () => {
  const runtime = createRuntime();
  const dialog = runtime.render(baseProps());

  const tabs = nodes(dialog).filter(node => node.type === 'button' && node.props?.role === 'tab');
  assert.equal(tabs.length, 2);
  assert.deepEqual(tabs.map(textOf), ['settingsTitle', 'settingsGuideTab'], '标签顺序固定：HUD 设置 → 使用说明');
  assert.deepEqual(tabs.map(node => node.props['aria-selected']), [true, false]);
  assert.deepEqual(tabs.map(node => node.props['data-active']), [true, false]);
  assert.deepEqual(tabs.map(node => node.props.tabIndex), [0, -1]);
  assert.equal(tabs[0].props.id, 'hud-settings-tab-settings');
  assert.equal(tabs[1].props.id, 'hud-settings-tab-guide');
  assert.equal(tabs[0].props['aria-controls'], 'hud-settings-panel-settings');
  assert.equal(tabs[1].props['aria-controls'], 'hud-settings-panel-guide');
  assert.equal(nodes(dialog).filter(node => node.props?.role === 'tablist').length, 1);
  // 两个标签各带图标：设置页用官方 outline 齿轮（assets/icons/settings-outline.svg），说明页用「提示」图标（assets/icons/hint.svg）。
  assert.deepEqual(tabs.map(tab => nodes(tab).find(node => node.type === 'Icon').props.name), ['settings-outline', 'hint']);

  // 默认只渲染设置页；说明页不渲染。
  const body = byClass(dialog, 'hud-settings-body');
  assert.equal(body.length, 1, '头部与底部之间应有共享高度容器');
  assert.equal(byClass(body[0], 'hud-settings-panes').length, 1);
  assert.equal(byClass(body[0], 'hud-settings-guide').length, 0);
});

test('点「使用说明」切到说明页，再点「HUD 设置」切回（随时切换）', () => {
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'guide');
  dialog = runtime.render();

  const guide = byClass(dialog, 'hud-settings-guide');
  assert.equal(guide.length, 1, '说明页应渲染');
  assert.equal(guide[0].props.role, 'tabpanel');
  assert.equal(guide[0].props.id, 'hud-settings-panel-guide');
  assert.equal(guide[0].props['aria-labelledby'], 'hud-settings-tab-guide');

  clickTab(dialog, 'settings');
  dialog = runtime.render();
  const panes = byClass(dialog, 'hud-settings-panes');
  assert.equal(panes.length, 1, '再切回设置页');
  assert.equal(panes[0].props['data-hidden'], false);
  assert.equal(byClass(dialog, 'hud-settings-guide').length, 0);
});

test('说明页：11 个模块小节，按「展示 / 功能 / 设置」分组且与大纲一致', () => {
  const runtime = createRuntime();
  const sections = runtime.sections;
  assert.equal(sections.length, 12, '每个模块一个小节');
  assert.deepEqual(sections.map(section => section.key), [
    'panel', 'session', 'context', 'usage', 'git', 'outputs', 'subagents', 'tasks', 'plans', 'mcp', 'note', 'todo',
  ]);

  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'guide');
  dialog = runtime.render();

  const toc = byClass(dialog, 'hud-guide-toc-item');
  assert.equal(toc.length, sections.length, '左侧目录项与大纲数量一致');
  assert.deepEqual(toc.map(textOf), sections.map(section => section.title));

  // 按最新要求：只有「HUD 面板」一节带「设置」分组，其余模块只讲展示与功能。
  const withSettings = sections.filter(section => section.groups.some(group => group.kind === 'set')).map(section => section.key);
  assert.deepEqual(withSettings, ['panel']);

  const rendered = byClass(dialog, 'hud-guide-section');
  assert.equal(rendered.length, sections.length);
  for (const [index, section] of sections.entries()) {
    const node = rendered[index];
    assert.equal(node.props.id, `hud-guide-section-${section.key}`);
    assert.equal(textOf(byClass(node, 'hud-guide-section-title')[0]), section.title);
    const groups = byClass(node, 'hud-guide-group');
    assert.equal(groups.length, section.groups.length, `${section.key} 的分组数量与大纲一致`);
    let total = 0;
    for (const [groupIndex, group] of section.groups.entries()) {
      const label = byClass(groups[groupIndex], 'hud-guide-group-label')[0];
      const expectedLabel = group.kind === 'show' ? 'guideKindShow' : group.kind === 'set' ? 'guideKindSet' : 'guideKindAct';
      assert.equal(textOf(label), expectedLabel, `${section.key}/${group.kind} 分组标签`);
      const items = byClass(groups[groupIndex], 'hud-guide-item');
      assert.deepEqual(items.map(textOf), group.items, `${section.key}/${group.kind} 的要点应与大纲一致`);
      // v0.19.0：便笺一节新增图片 / 从聊天导入等能力（`/` 与 `@` 补全已移除），「功能」分组上限放宽到 8 条。
      assert.ok(items.length >= 1 && items.length <= 8, `${section.key}/${group.kind} 要点数量应克制（1–8 条）`);
      total += items.length;
    }
    // v0.19.0：panel 一节同时讲「固定展示」与「悬停展示」，上限放宽到 16 条；其余仍按 12 条克制。
    const limit = section.key === 'panel' ? 16 : 12;
    assert.ok(total >= 3 && total <= limit, `${section.key} 整节要点总数应为 3–${limit} 条（保持简短）`);
  }
});

test('说明页不渲染图标：目录项与小节标题只有文字（图标只加在「使用说明」标签上）', () => {
  const runtime = createRuntime();
  const sections = runtime.sections;
  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'guide');
  dialog = runtime.render();

  const toc = byClass(dialog, 'hud-guide-toc-item');
  assert.equal(toc.length, sections.length);
  for (const item of toc) assert.equal(nodes(item).filter(node => node.type === 'Icon').length, 0, '左侧目录项不再带图标');

  const rendered = byClass(dialog, 'hud-guide-section');
  assert.equal(rendered.length, sections.length);
  for (const section of rendered) {
    const title = byClass(section, 'hud-guide-section-title')[0];
    assert.equal(nodes(title).filter(node => node.type === 'Icon').length, 0, '右侧小节标题不再带图标');
    assert.equal(textOf(title), sections[rendered.indexOf(section)].title);
  }
});

test('切换标签不丢设置草稿：切走再切回，开关仍是改后的值，确认时照常提交', () => {
  const confirmations = [];
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps({ onConfirm: (...args) => confirmations.push(args) }));

  // 设置页「HUD面板通用设置」第一个开关：新建会话页默认展示（默认关）。
  const panelCard = () => byClass(dialog, 'hud-settings-section hud-settings-section-card')[0];
  assert.equal(switchesOf(panelCard())[0].props['aria-checked'], false);
  switchesOf(panelCard())[0].props.onClick();
  dialog = runtime.render();

  clickTab(dialog, 'guide');
  dialog = runtime.render();
  clickTab(dialog, 'settings');
  dialog = runtime.render();

  assert.equal(switchesOf(panelCard())[0].props['aria-checked'], true, '切走再切回仍保留改后的草稿');

  nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm').props.onClick();
  assert.equal(confirmations.length, 1);
  const panelDraft = JSON.parse(JSON.stringify(confirmations[0][4]));
  assert.equal(panelDraft.newSessionOpen, true);
});

test('切换标签时弹窗高度不变：设置页保持挂载（隐藏）+ 说明页绝对定位覆盖同一区域', () => {
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps());
  const bodyBefore = byClass(dialog, 'hud-settings-body')[0];
  const panesBefore = byClass(bodyBefore, 'hud-settings-panes')[0];
  assert.ok(panesBefore);
  assert.equal(panesBefore.props['data-hidden'], false);
  assert.equal(byClass(bodyBefore, 'hud-settings-guide').length, 0);

  clickTab(dialog, 'guide');
  dialog = runtime.render();
  const bodyAfter = byClass(dialog, 'hud-settings-body')[0];
  const panesAfter = byClass(bodyAfter, 'hud-settings-panes')[0];
  const guideAfter = byClass(bodyAfter, 'hud-settings-guide')[0];
  assert.ok(panesAfter, '说明页打开时设置页仍挂载，作为高度基准');
  assert.equal(panesAfter.props['data-hidden'], true, '此时设置页不可见也不可交互');
  assert.equal(panesAfter.props['aria-hidden'], true);
  assert.ok(guideAfter, '说明页覆盖在同一区域上');
  assert.equal(bodyAfter.children.filter(Boolean).length, 2, 'body 中同时存在高度基准与说明页');

  // 样式保证「隐藏但仍占位」与「绝对定位覆盖」，因此两个标签下弹窗高度完全一致。
  assert.match(clientSource, /\.hud-settings-body\{flex:1 1 auto;min-height:0;position:relative;display:flex;align-items:stretch\}/);
  assert.match(clientSource, /\.hud-settings-panes\[data-hidden=true\]\{visibility:hidden;pointer-events:none\}/);
  assert.match(clientSource, /\.hud-settings-guide\{position:absolute;inset:0;display:flex;align-items:stretch\}/);
});

test('说明页底部栏常驻：默认设置下「恢复默认」禁用，确认仍可提交', () => {
  const confirmations = [];
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps({ onConfirm: (...args) => confirmations.push(args) }));
  clickTab(dialog, 'guide');
  dialog = runtime.render();

  const footerButtons = nodes(dialog).filter(node => node.type === 'button' && node.props?.['data-kind']);
  assert.deepEqual(footerButtons.map(node => node.props['data-kind']), ['reset', 'cancel', 'confirm']);
  assert.equal(footerButtons[0].props.disabled, true, '没有改动时「恢复默认」置灰');
  footerButtons[2].props.onClick();
  assert.equal(confirmations.length, 1);
});

test('guideActiveKey：首屏 / 阈值边界 / 末尾 / 负滚动位置 / 空大纲', () => {
  const runtime = createRuntime();
  const activeKey = runtime.guideActiveKey;
  const keys = ['a', 'b', 'c'];
  const offsets = [0, 120, 260];
  assert.equal(activeKey(keys, offsets, 0), 'a', '首屏停在第一节');
  assert.equal(activeKey(keys, offsets, 100), 'a', '未越过阈值仍是第一节');
  assert.equal(activeKey(keys, offsets, 104), 'b', '越过阈值切到第二节');
  assert.equal(activeKey(keys, offsets, 243), 'b');
  assert.equal(activeKey(keys, offsets, 244), 'c');
  assert.equal(activeKey(keys, offsets, 100000), 'c', '滚到底停在最后一节');
  assert.equal(activeKey(keys, offsets, -50), 'a', '负滚动位置回落第一节');
  assert.equal(activeKey([], [], 0), '');
});

test('双语：大纲与标签引用的键在 zh / en 字典中都存在且非空', () => {
  const sections = vm.runInNewContext(`${extractConst('GUIDE_SECTIONS')}\nGUIDE_SECTIONS;`);
  const keys = ['settingsGuideTab', 'guideKindShow', 'guideKindAct', 'guideKindSet'];
  for (const section of sections) {
    keys.push(section.title);
    for (const group of section.groups) keys.push(...group.items);
  }

  const client = hudClient();
  const dicts = client.dictionaries[0];
  assert.ok(dicts !== undefined, '应注册中英字典');
  for (const key of keys) {
    assert.equal(typeof dicts.zh[key], 'string', `中文缺键：${key}`);
    assert.equal(typeof dicts.en[key], 'string', `英文缺键：${key}`);
    assert.ok(dicts.zh[key].length > 0 && dicts.en[key].length > 0, `${key} 不应为空`);
  }

  // 新增说明键两侧数量一致（不出现单侧漏写）。
  const guideKeys = dict => Object.keys(dict).filter(key => key.startsWith('guide') || key === 'settingsGuideTab').sort();
  assert.deepEqual(guideKeys(dicts.zh), guideKeys(dicts.en));
});

test('样式：目录 240px 与设置页左栏对齐、内容区独立滚动、选中标签品牌色下划线', () => {
  assert.match(clientSource, /\.hud-settings-head\{padding:0 14px;height:48px;align-items:stretch\}/);
  assert.match(clientSource, /\.hud-settings-tab\[data-active=true\]\{color:var\(--dsw-alias-label-primary\);border-bottom-color:var\(--dsw-alias-state-business-primary\)\}/);
  assert.match(clientSource, /\.hud-settings-body\{flex:1 1 auto;min-height:0;position:relative;display:flex;align-items:stretch\}/);
  assert.match(clientSource, /\.hud-guide-toc\{flex:none;width:240px;box-sizing:border-box;overflow-y:auto/);
  assert.match(clientSource, /\.hud-guide-content\{flex:1 1 auto;min-width:0;overflow-y:auto/);
  assert.match(clientSource, /\.hud-guide-section\{display:flex;flex-direction:column;gap:8px;scroll-margin-top:8px/);
  assert.match(clientSource, /\.hud-guide-group\{display:flex;flex-direction:column;gap:3px;min-width:0\}/);
  assert.match(clientSource, /\.hud-guide-group-label\{font-size:11px;line-height:16px;font-weight:600;color:var\(--dsw-alias-label-secondary\)\}/);
  assert.match(clientSource, /\.hud-guide-item\{font-size:12\.5px;line-height:19px;color:var\(--dsw-alias-label-secondary\);overflow-wrap:anywhere\}/);
});

test('接线：SettingsDialog 持有标签状态，说明页与设置页共享高度容器', () => {
  assert.match(clientSource, /const \[tab, setTab\] = react\.useState\("settings"\);/);
  assert.match(clientSource, /role: "tablist"/);
  assert.match(clientSource, /className: "hud-settings-body" \},/);
  assert.match(clientSource, /"data-hidden": tab !== "settings", "aria-hidden": tab !== "settings", className: "hud-settings-panes" \},/);
  assert.match(clientSource, /tab === "guide" \? react\.createElement\(SettingsGuide, \{ panelId: "hud-settings-panel-guide", labelledBy: "hud-settings-tab-guide" \}\) : null\),/);
  assert.match(clientSource, /function SettingsGuide\(props\) \{/);
  assert.match(clientSource, /function guideActiveKey\(keys, offsets, scrollTop, threshold = 16\) \{/);
  // 「使用说明」标签左侧用 assets/icons/hint.svg；大纲与页面内不再配图标。
  assert.match(clientSource, /react\.createElement\(Icon, \{ name: "hint", size: 14, color: "inherit" \}\)/);
  assert.match(clientSource, /className: "hud-guide-group",/);
  assert.match(clientSource, /"data-kind": group.kind,/);
  assert.doesNotMatch(clientSource, /\{ key: "panel", icon:/);
});

test('宿主资产白名单已放行标签图标（hint.svg 与 settings-outline.svg）', () => {
  for (const name of ['hint.svg', 'settings-outline.svg']) {
    const asset = assetFileFor(name);
    assert.ok(asset.path.endsWith(`/assets/icons/${name}`), asset.path);
    assert.equal(asset.contentType, 'image/svg+xml');
  }
  // 白名单同时承担防路径穿越：未登记文件名直接抛错。
  assert.throws(() => assetFileFor('../package.json'));
});
