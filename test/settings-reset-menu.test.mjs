// dsh-awesome-hud — v0.21.0：「恢复默认设置」三项菜单（鼠标位置 / 范围 / 置灰 / 关闭）
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  MODULE_KEYS, defaultModules, defaultUsageDisplay, defaultContextSettings, normalizeContextSettings,
  normalizeModuleOrder, defaultPanelSettings, normalizePanelSettings,
} from '../lib/settings.js';
import { extractFunction, extractConst, clientSource as source } from './helpers/client-harness.mjs';

const USAGE_SETTING_KEYS = ['deepseek', 'opencode', 'codex'];
const MODULE_LABELS = Object.fromEntries(MODULE_KEYS.map(key => [key, () => `label:${key}`]));

/** 有状态 hooks 运行时：设置弹窗的草稿在多次渲染之间保留。 */
function createRuntime(options = {}) {
  const slots = [];
  const refs = [];
  let cursor = 0;
  const context = vm.createContext({
    primitives: null,
    Icon: 'Icon',
    t: key => key,
    interpolate: value => value,
    isImeComposing: () => false,
    IME_INPUT_PROPS: {},
    suppressNativeDragImage: () => {},
    MODULE_KEYS: [...MODULE_KEYS],
    MODULE_LABELS,
    USAGE_SETTING_KEYS,
    normalizeUsageFolded: value => (['none', 'deepseek', 'oc-5h', 'oc-1w', 'oc-1m', 'codex-5h', 'codex-1w'].includes(value) ? value : 'none'),
    defaultModules,
    defaultUsageDisplay,
    defaultContextSettings,
    normalizeContextSettings,
    normalizeModuleOrder,
    defaultPanelSettings,
    normalizePanelSettings,
    NOTE_COUNT_MIN: 5,
    NOTE_COUNT_MAX: 20,
    defaultNoteSettings: () => ({ maxCount: 5, popupEdit: false }),
    normalizeNoteMaxCount: (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(20, Math.max(5, Math.round(number))) : 5;
    },
    defaultGitSettings: () => ({ view: 'list' }),
    normalizeGitView: value => value === 'tree' ? 'tree' : 'list',
    normalizeGitSettings: raw => ({ view: raw?.view === 'tree' ? 'tree' : 'list' }),
    GIT_VIEW_DEFAULT: 'list',
    normalizeNoteSettings: (raw) => ({
      maxCount: raw !== null && raw !== undefined && Number.isFinite(Number(raw.maxCount))
        ? Math.min(20, Math.max(5, Math.round(Number(raw.maxCount)))) : 5,
      popupEdit: raw?.popupEdit === true,
    }),
    noteCountViolations: () => [],
    toast: () => {},
    window: { clearTimeout() {}, setTimeout() {}, innerWidth: options.innerWidth ?? 1280, innerHeight: options.innerHeight ?? 800 },
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
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
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
    `const HUD_MENU_WIDTH = 200;
     const HUD_MENU_ITEM_HEIGHT = 29;
     const HUD_MENU_DIVIDER_HEIGHT = 9;
     const HUD_MENU_PADDING = 12;
     const HUD_MENU_MARGIN = 8;
     const RESET_MENU_WIDTH = 248;
     const HUD_SELECT_WIDTH_MIN = 180;
     const HUD_SELECT_WIDTH_MAX = 320;
     const HUD_SELECT_ITEM_HEIGHT = 34;
     const HUD_SELECT_PADDING = 4;
     ${extractConst('HUD_CHEVRON_PATH')}
     ${extractConst('HUD_CHECK_PATH')}
     ${extractFunction('officialIcon')}
     ${extractFunction('officialControl')}
     ${extractFunction('viewportSize')}
     ${extractFunction('clampMenuPosition')}
     ${extractFunction('menuAnchorFrom')}
     ${extractFunction('HudMenu')}
     ${extractFunction('hudSelectMenuWidth')}
     ${extractFunction('selectMenuPlacement')}
     ${extractFunction('HudSelectGlyph')}
     ${extractFunction('HudSelect')}
     ${extractFunction('HudSwitch')}
     ${extractFunction('HudSegmented')}
     ${extractFunction('HudNumberStepper')}
     ${extractFunction('SettingRow')}
     ${extractFunction('sameOrder')}
     ${extractFunction('sameSettingsDraft')}
     ${extractFunction('isDefaultModulesSettings')}
     ${extractFunction('isDefaultFeatureSettings')}
     ${extractFunction('isDefaultDraft')}
     ${extractFunction('useOverlayDismiss')}
     ${extractFunction('pinButtonState')}
     ${extractFunction('moveKeyToFront')}
     ${extractFunction('restoreKeyAt')}
     ${extractFunction('normalizePinned')}
     ${extractFunction('SettingsDialog')}`,
    context,
  );
  const expand = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: (node.children ?? []).flat(Infinity).map(expand) };
  };
  let props = null;
  let last = null;
  return {
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
    note: { maxCount: 5, popupEdit: false },
    balanceAvailable: true,
    usageAvailability: { deepseek: true, opencode: true, codex: true },
    usageReasons: {},
    onClose() {},
    onConfirm() {},
    ...overrides,
  };
}

const cls = (node) => node?.props?.className;
const nodes = (root) => {
  const out = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    out.push(node);
    walk(node.children ?? []);
  };
  walk(root);
  return out;
};
const byRole = (root, role) => nodes(root).filter(node => node.props?.role === role);
const textOf = (node) => (typeof node === 'string' ? node : (node?.children ?? []).flat(Infinity).map(textOf).join(''));
const resetButton = (tree) => nodes(tree).find(node => node.type === 'button' && node.props?.['data-kind'] === 'reset');
const confirmButton = (tree) => nodes(tree).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
const menuItems = (tree) => nodes(tree).filter(node => node.type === 'button' && node.props?.role === 'menuitem');
const openMenu = (runtime, event = { preventDefault() {}, stopPropagation() {}, clientX: 320, clientY: 480 }) => {
  const tree = runtime.render();
  const button = resetButton(tree);
  assert.ok(button, '应有「恢复默认设置」按钮');
  button.props.onClick(event);
  return runtime.render();
};
const clickItem = (runtime, index = 0) => {
  const tree = runtime.render();
  const items = menuItems(tree);
  assert.ok(items.length >= 3, '菜单应已打开');
  items[index].props.onClick();
  return runtime.render();
};
const confirmPayload = (runtime, onConfirm) => {
  const tree = runtime.render();
  confirmButton(tree).props.onClick();
  return onConfirm;
};

test('点击按钮在鼠标位置弹出三项菜单（顺序固定，菜单加宽到 248px）', () => {
  const runtime = createRuntime();
  runtime.render(baseProps({ modules: { ...defaultModules(), git: false } }));
  const tree = openMenu(runtime);

  const menu = byRole(tree, 'menu')[0];
  assert.ok(menu, '应渲染 role=menu');
  assert.equal(menu.props['aria-label'], 'settingsResetMenu');
  assert.equal(menu.props.style.width, 248, '菜单加宽，文案不截断');
  assert.equal(menu.props.style.left, 320);
  assert.equal(menu.props.style.top, 480);
  assert.deepEqual(menuItems(tree).map(textOf), [
    'settingsResetAll', 'settingsResetModules', 'settingsResetModuleSettings',
  ]);
  // 按钮标记为弹出菜单。
  const button = resetButton(tree);
  assert.equal(button.props['aria-haspopup'], 'menu');
  assert.equal(button.props['aria-expanded'], true);
});

test('菜单坐标夹取到视口内（含 248px 宽度）', () => {
  const runtime = createRuntime();
  runtime.render(baseProps({ modules: { ...defaultModules(), git: false } }));
  const tree = openMenu(runtime, { preventDefault() {}, stopPropagation() {}, clientX: 1270, clientY: 795 });
  const menu = byRole(tree, 'menu')[0];
  assert.equal(menu.props.style.left, 1280 - 248 - 8, '右侧夹取');
  assert.ok(menu.props.style.top <= 795, '底部夹取');
});

test('「恢复所有设置」：左右两栏草稿全部回到默认', () => {
  const calls = [];
  const runtime = createRuntime();
  runtime.render(baseProps({
    modules: { ...defaultModules(), git: false },
    usage: { ...defaultUsageDisplay(), folded: 'oc-5h' },
    pinned: 'context',
    order: ['git', ...normalizeModuleOrder(null).filter(key => key !== 'git')],
    panel: { style: 'sidebar', side: 'left', newSessionOpen: true, chatOpen: false },
    note: { maxCount: 8, popupEdit: true },
    onConfirm: (...args) => calls.push(args),
  }));
  openMenu(runtime);
  clickItem(runtime, 0);
  confirmPayload(runtime, calls);
  assert.equal(calls.length, 1, '重置只改草稿，仍需确认');
  const [draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, , pinnedDraft] = calls[0];
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), defaultModules());
  assert.equal(usageDraft.folded, 'none');
  assert.deepEqual(JSON.parse(JSON.stringify(orderDraft)), normalizeModuleOrder(null));
  assert.deepEqual(JSON.parse(JSON.stringify(contextDraft)), defaultContextSettings());
  assert.deepEqual(JSON.parse(JSON.stringify(panelDraft)), defaultPanelSettings());
  assert.deepEqual(JSON.parse(JSON.stringify(noteDraft)), { maxCount: 5, popupEdit: false });
  // v0.21.2：恢复默认一并取消置顶。
  assert.equal(pinnedDraft, '');
});

test('「恢复 hud 模块启用状态、排序」：只复位左栏，右栏草稿保持', () => {
  const calls = [];
  const runtime = createRuntime();
  runtime.render(baseProps({
    modules: { ...defaultModules(), git: false },
    order: ['git', ...normalizeModuleOrder(null).filter(key => key !== 'git')],
    usage: { ...defaultUsageDisplay(), folded: 'oc-1w' },
    pinned: 'context',
    panel: { style: 'sidebar', side: 'right', newSessionOpen: false, chatOpen: true },
    note: { maxCount: 7, popupEdit: true },
    onConfirm: (...args) => calls.push(args),
  }));
  openMenu(runtime);
  clickItem(runtime, 1);
  confirmPayload(runtime, calls);
  const [draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, , pinnedDraft] = calls[0];
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), defaultModules());
  assert.deepEqual(JSON.parse(JSON.stringify(orderDraft)), normalizeModuleOrder(null));
  assert.equal(usageDraft.folded, 'oc-1w');
  // v0.21.2：置顶属于左栏，随左栏一起复位。
  assert.equal(pinnedDraft, '');
  assert.equal(panelDraft.style, 'sidebar');
  assert.deepEqual(JSON.parse(JSON.stringify(noteDraft)), { maxCount: 7, popupEdit: true });
});

test('「恢复 hud 模块功能设置」：只复位右栏，模块开关与排序保持', () => {
  const calls = [];
  const changedOrder = ['git', ...normalizeModuleOrder(null).filter(key => key !== 'git')];
  const runtime = createRuntime();
  runtime.render(baseProps({
    modules: { ...defaultModules(), git: false },
    order: changedOrder,
    usage: { ...defaultUsageDisplay(), folded: 'oc-5h' },
    pinned: 'context',
    panel: { style: 'sidebar', side: 'right', newSessionOpen: false, chatOpen: true },
    note: { maxCount: 7, popupEdit: true },
    onConfirm: (...args) => calls.push(args),
  }));
  openMenu(runtime);
  clickItem(runtime, 2);
  confirmPayload(runtime, calls);
  const [draft, usageDraft, orderDraft, , panelDraft, noteDraft, , pinnedDraft] = calls[0];
  assert.equal(draft.git, false, '模块开关保持');
  assert.deepEqual(JSON.parse(JSON.stringify(orderDraft)), changedOrder, '排序保持');
  assert.equal(usageDraft.folded, 'none');
  // v0.21.2：只复位右栏时置顶保持不动。
  assert.equal(pinnedDraft, 'context', '置顶属于左栏，右栏复位不影响它');
  assert.equal(panelDraft.style, 'card');
  assert.deepEqual(JSON.parse(JSON.stringify(noteDraft)), { maxCount: 5, popupEdit: false });
});

test('置灰规则：全部默认时按钮置灰；单项按自身范围是否已默认置灰', () => {
  // 全部默认：按钮置灰。
  const allDefault = createRuntime();
  const tree = allDefault.render(baseProps());
  assert.equal(resetButton(tree).props.disabled, true);

  // 只有右栏改动：模块项置灰、功能项可点。
  const rightOnly = createRuntime();
  rightOnly.render(baseProps({ usage: { ...defaultUsageDisplay(), folded: 'oc-5h' } }));
  let items = menuItems(openMenu(rightOnly));
  assert.deepEqual(items.map(item => item.props.disabled), [false, true, false]);

  // 只有左栏改动：功能项置灰、模块项可点。
  const leftOnly = createRuntime();
  leftOnly.render(baseProps({ modules: { ...defaultModules(), git: false } }));
  items = menuItems(openMenu(leftOnly));
  assert.deepEqual(items.map(item => item.props.disabled), [false, false, true]);

  // 两栏都改：三项都可点。
  const both = createRuntime();
  both.render(baseProps({ modules: { ...defaultModules(), git: false }, note: { maxCount: 6, popupEdit: false } }));
  items = menuItems(openMenu(both));
  assert.deepEqual(items.map(item => item.props.disabled), [false, false, false]);
});

test('点击菜单外侧关闭菜单；选择一项后菜单收起且不自动保存', () => {
  const calls = [];
  const runtime = createRuntime();
  runtime.render(baseProps({ modules: { ...defaultModules(), git: false }, onConfirm: (...args) => calls.push(args) }));
  const opened = openMenu(runtime);
  // HudMenu 的透明遮罩：点击即关闭。
  const overlay = nodes(opened).find(node => node.props?.style?.position === 'fixed' && node.props?.style?.inset === 0 && typeof node.props?.onClick === 'function');
  assert.ok(overlay, '应有可点击的透明遮罩');
  overlay.props.onClick();
  let tree = runtime.render();
  assert.equal(byRole(tree, 'menu').length, 0);

  // 重新打开并选择一项：菜单收起、未确认前不发保存请求。
  openMenu(runtime);
  tree = clickItem(runtime, 1);
  assert.equal(byRole(tree, 'menu').length, 0, '选择后收起');
  assert.equal(calls.length, 0, '不自动保存');
  assert.equal(confirmButton(tree).props.disabled, false, '重置后「保存设置」可点');
});

test('源码接线：三项菜单文案、宽度、锚点与 Esc/外点关闭', () => {
  assert.match(source, /settingsResetAll: "恢复所有设置",/);
  assert.match(source, /settingsResetModules: "恢复 hud 模块启用状态、排序",/);
  assert.match(source, /settingsResetModuleSettings: "恢复 hud 模块功能设置",/);
  assert.match(source, /settingsResetAlreadyDefault: "已是默认值",/);
  assert.match(source, /const RESET_MENU_WIDTH = 248;/);
  assert.match(source, /width: RESET_MENU_WIDTH,/);
  assert.match(source, /onClick: openResetMenu,/);
  assert.match(source, /const anchor = menuAnchorFrom\(event\);/);
  assert.match(source, /const resetAllSettings = \(\) => \{/);
  assert.match(source, /const resetModulesSettings = \(\) => \{/);
  assert.match(source, /const resetFeatureSettings = \(\) => \{/);
  // 置灰原因与范围判定。
  assert.match(source, /disabled: modulesDefault && featuresDefault, reason: t\("settingsResetAlreadyDefault"\)/);
  assert.match(source, /disabled: modulesDefault, reason: t\("settingsResetAlreadyDefault"\)/);
  assert.match(source, /disabled: featuresDefault, reason: t\("settingsResetAlreadyDefault"\)/);
});
