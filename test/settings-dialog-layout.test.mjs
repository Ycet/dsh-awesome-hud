// dsh-awesome-hud — v0.18.2：HUD 设置弹窗左右分栏、右栏卡片分区与官方控件
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  MODULE_KEYS, defaultModules, defaultUsageDisplay, defaultContextSettings, normalizeContextSettings,
  normalizeModuleOrder, defaultPanelSettings, normalizePanelSettings,
} from '../lib/settings.js';
import { extractFunction, extractConst, nodes, clientSource as clientSource } from './helpers/client-harness.mjs';

const USAGE_SETTING_KEYS = ['deepseek', 'opencode', 'codex'];
const MODULE_LABELS = Object.fromEntries(MODULE_KEYS.map(key => [key, () => `label:${key}`]));

/**
 * 极简 hooks 运行时：state 按调用顺序保存在同一批槽位里，setState 后由测试重新渲染，
 * 这样「点开关 → 再确认」这类交互可以真实验证，而不是只看初始渲染。
 */
function createRuntime(primitives, options = {}) {
  const slots = [];
  const refs = [];
  let cursor = 0;
  const context = vm.createContext({
    // primitives 缺失时 officialControl 返回 null → 走本地回退控件
    primitives,
    Icon: 'Icon',
    t: key => ({
      noteWorkspaceCount: '{path} ({count})',
      noteCapRejected: 'cannot save: {workspaces} limit {count}',
    }[key] ?? key),
    interpolate: (template, values) => String(template).replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? '')),
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
    // v0.20.0：便笺条数上限（设置卡片 + 保存校验）
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
    normalizeNoteSettings: (raw) => ({ maxCount: raw !== null && raw !== undefined && Number.isFinite(Number(raw.maxCount)) ? Math.min(20, Math.max(5, Math.round(Number(raw.maxCount)))) : 5, popupEdit: raw?.popupEdit === true }),
    noteCountViolations: options.noteViolations ?? (() => []),
    toast: (message) => { (options.toasts ?? []).push(message); },
    window: { clearTimeout() {}, setTimeout() {} },
    document: { activeElement: null },
  });
  context.react = {
    Fragment: 'fragment',
    // 与 React 一致：变参 children 同时挂到 props.children（SettingRow 等组件按此读取）。
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
    `const HUD_MENU_WIDTH = 200;
     const HUD_MENU_ITEM_HEIGHT = 29;
     const HUD_MENU_DIVIDER_HEIGHT = 9;
     const HUD_MENU_PADDING = 12;
     const HUD_MENU_MARGIN = 8;
     const RESET_MENU_WIDTH = ${248};
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
     ${extractFunction('guideActiveKey')}
     ${extractConst('GUIDE_SECTIONS')}
     ${extractFunction('SettingsGuide')}
     ${extractFunction('sameOrder')}
     ${extractFunction('sameSettingsDraft')}
     ${extractFunction('isDefaultModulesSettings')}
     ${extractFunction('isDefaultFeatureSettings')}
     ${extractFunction('isDefaultDraft')}
     ${extractFunction('contextPinState')}
     ${extractFunction('SettingsDialog')}`,
    context,
  );
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
    git: { view: "list" },
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
const byClassContains = (root, name) => nodes(root).filter(node => typeof classOf(node) === 'string' && classOf(node).split(' ').includes(name));
const textOf = node => {
  if (typeof node === 'string') return node;
  if (node === null || typeof node !== 'object') return '';
  return (node.children ?? []).flat(Infinity).map(textOf).join('');
};

test('左右分栏：左栏模块清单，右栏五个卡片式设置分区', () => {
  const runtime = createRuntime(null);
  const dialog = runtime.render(baseProps());

  const panes = byClass(dialog, 'hud-settings-panes');
  assert.equal(panes.length, 1, '弹窗主体应为左右分栏容器');
  assert.equal(byClass(dialog, 'hud-settings-pane hud-settings-pane-modules').length, 1);
  assert.equal(byClass(dialog, 'hud-settings-pane hud-settings-pane-detail').length, 1);

  // 左栏：9 张模块卡片 + 拖动手柄（启停仍用勾选框）。
  const left = byClass(dialog, 'hud-settings-pane hud-settings-pane-modules')[0];
  assert.equal(byClass(left, 'hud-settings-card').length, MODULE_KEYS.length);
  assert.equal(byClass(left, 'hud-settings-grip').length, MODULE_KEYS.length);
  assert.equal(nodes(left).filter(node => node.type === 'input').length, MODULE_KEYS.length);
  assert.equal(nodes(left).filter(node => node.props?.role === 'switch').length, 0, '左栏保留勾选框，不换开关');

  // 右栏：面板 / 上下文 / 用量 / git变更 / 便笺 五张卡片，顺序固定（v0.21.0 新增 git变更）。
  const right = byClass(dialog, 'hud-settings-pane hud-settings-pane-detail')[0];
  const cards = byClass(right, 'hud-settings-section hud-settings-section-card');
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map(card => textOf(byClass(card, 'hud-settings-section-title')[0])), [
    'settingsPanelTitle', 'settingsContextTitle', 'settingsUsageTitle', 'settingsGitTitle', 'settingsNoteTitle',
  ]);
});

test('HUD 面板设置：样式与侧位分段控件 + 两处默认开合开关', () => {
  const runtime = createRuntime(null);
  const card = byClass(runtime.render(baseProps()), 'hud-settings-section hud-settings-section-card')[0];
  const rows = byClass(card, 'hud-setting-row');
  // v0.20.0：样式 + 侧位 + 两处默认开合 = 4 行；样式行必须在侧位行上方。
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => textOf(byClass(row, 'hud-setting-name')[0])), [
    'settingsPanelStyle', 'settingsPanelSide', 'settingsPanelNewSessionOpen', 'settingsPanelChatOpen',
  ]);

  // 样式与侧位：本地回退的分段控件（官方 SegmentedControl 缺失时）。
  const segs = byClass(card, 'hud-seg');
  assert.equal(segs.length, 2, '样式与侧位各一个分段控件');
  const styleOptions = segs[0].children.filter(node => node?.props?.role === 'radio');
  assert.deepEqual(styleOptions.map(node => textOf(node)), ['settingsPanelStyleCard', 'settingsPanelStyleSidebar']);
  assert.equal(styleOptions[0].props['aria-checked'], true, 'v0.20.0 默认卡片样式');
  assert.equal(styleOptions[1].props['aria-checked'], false);
  const options = segs[1].children.filter(node => node?.props?.role === 'radio');
  assert.deepEqual(options.map(node => textOf(node)), ['settingsPanelSideLeft', 'settingsPanelSideRight']);
  assert.equal(options[0].props['aria-checked'], false);
  assert.equal(options[1].props['aria-checked'], true, '默认右侧展开');

  // 两处默认开合：回退 Switch（button[role=switch]）。
  const switches = nodes(card).filter(node => node.type === 'button' && node.props?.role === 'switch');
  assert.equal(switches.length, 2);
  assert.equal(switches[0].props['aria-checked'], false, '新建会话页默认隐藏');
  assert.equal(switches[1].props['aria-checked'], true, '聊天会话页默认展示');
});

test('点击侧位分段 / 开关后，确认时把面板草稿一起提交', () => {
  const confirmations = [];
  const runtime = createRuntime(null);
  runtime.render(baseProps({ onConfirm: (...args) => confirmations.push(args) }));

  // 切到边栏样式、切到左侧，并打开「新建会话页默认展示」。
  let card = byClass(runtime.element, 'hud-settings-section hud-settings-section-card')[0];
  byClass(card, 'hud-seg')[0].children[1].props.onClick();
  card = byClass(runtime.render(), 'hud-settings-section hud-settings-section-card')[0];
  byClass(card, 'hud-seg')[1].children[0].props.onClick();
  card = byClass(runtime.render(), 'hud-settings-section hud-settings-section-card')[0];
  const switches = nodes(card).filter(node => node.type === 'button' && node.props?.role === 'switch');
  switches[0].props.onClick();

  // 再渲染一次读取最新草稿，然后确认。
  const dialog = runtime.render();
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  confirm.props.onClick();
  assert.equal(confirmations.length, 1);
  const panelDraft = confirmations[0][4];
  assert.deepEqual(JSON.parse(JSON.stringify(panelDraft)), { style: 'sidebar', side: 'left', newSessionOpen: true, chatOpen: true });
});

test('「恢复默认设置」点击后在鼠标位置弹出三项菜单，选「恢复所有设置」全部复位', () => {
  const confirmations = [];
  const runtime = createRuntime(null);
  const changed = {
    panel: { side: 'left', newSessionOpen: true, chatOpen: false },
    usage: { ...defaultUsageDisplay(), folded: 'oc-5h' },
  };
  runtime.render(baseProps({ ...changed, onConfirm: (...args) => confirmations.push(args) }));

  // 与默认值不同 → 按钮可用；点击后先弹出菜单（不立即复位）。
  let dialog = runtime.render();
  let reset = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'reset');
  assert.equal(reset.props.disabled, false);
  assert.equal(reset.props['aria-haspopup'], 'menu');
  reset.props.onClick({ preventDefault() {}, stopPropagation() {}, clientX: 320, clientY: 480 });

  dialog = runtime.render();
  const menu = nodes(dialog).find(node => node.props?.role === 'menu');
  assert.ok(menu, '应渲染三项重置菜单');
  const items = nodes(menu).filter(node => node.type === 'button' && node.props?.role === 'menuitem');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(item => textOf(item)), ['settingsResetAll', 'settingsResetModules', 'settingsResetModuleSettings']);
  // 左栏默认、右栏已改动：模块项置灰，功能项可点。
  assert.equal(items[0].props.disabled, false);
  assert.equal(items[1].props.disabled, true);
  assert.equal(items[2].props.disabled, false);

  items[0].props.onClick();
  dialog = runtime.render();
  reset = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'reset');
  assert.equal(reset.props.disabled, true, '复位后按钮应回到禁用态');
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  confirm.props.onClick();
  const [draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft] = confirmations[0];
  assert.deepEqual(JSON.parse(JSON.stringify(panelDraft)), defaultPanelSettings());
  assert.equal(usageDraft.folded, 'none');
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), defaultModules());
  assert.deepEqual(JSON.parse(JSON.stringify(orderDraft)), normalizeModuleOrder(null));
  assert.deepEqual(JSON.parse(JSON.stringify(contextDraft)), defaultContextSettings());
  assert.deepEqual(JSON.parse(JSON.stringify(noteDraft)), { maxCount: 5, popupEdit: false });
});

test('设置弹窗高度固定：右栏独立滚动，不因新增设置行变高', () => {
  // v0.19.0：展示方式新增一行后，弹窗体高度由 CSS 固定（约等于 0.18.7 的内容高度），
  // 右栏自己滚动承载超长内容，弹窗本身不再随内容增高。
  assert.match(clientSource, /\.hud-settings-modal-card\{width:min\(760px,calc\(100vw - 40px\)\);height:min\(760px,calc\(100vh - 24px\)\);max-height:calc\(100vh - 24px\)\}/);
  assert.match(clientSource, /\.hud-settings-body\{flex:1 1 auto;min-height:0;position:relative;display:flex;align-items:stretch\}/);
  // 右栏可滚动、左栏不滚动（保持原设计）
  assert.match(clientSource, /\.hud-settings-pane-detail\{flex:1 1 auto;min-width:0;overflow-y:auto;overscroll-behavior:contain;/);
  assert.match(clientSource, /\.hud-settings-pane-modules\{flex:none;width:240px;display:flex;flex-direction:column;gap:8px;padding:12px 12px 12px 14px;overflow:hidden;/);
  // 右栏卡片之间保留间距，滚动时不会贴边
  assert.match(clientSource, /\.hud-settings-pane-detail\{[^}]*gap:14px/);
});

test('primitives 可用时右栏直接使用官方 Switch / SegmentedControl', () => {
  const OfficialSwitch = function OfficialSwitch() {};
  const OfficialSegmented = function OfficialSegmented() {};
  const runtime = createRuntime({ Switch: OfficialSwitch, SegmentedControl: OfficialSegmented });
  const dialog = runtime.render(baseProps());

  const official = nodes(dialog).filter(node => node.type === OfficialSwitch);
  // 面板 2 + 上下文 4（三项展示 + v0.18.7 位置固定）+ 用量 3（三行数据；折叠展示用下拉）
  // + 便笺 1（v0.21.0 弹窗编辑）= 10
  assert.equal(official.length, 10, '所有启停项都应走官方 Switch');
  // v0.21.0：分段控件 3 个（面板样式 + 侧位 + git 变更查看方式）。
  assert.equal(nodes(dialog).filter(node => node.type === OfficialSegmented).length, 3);
  // 官方组件必须收到受控 props。
  const first = official[0];
  assert.equal(typeof first.props.checked, 'boolean');
  assert.equal(typeof first.props.onChange, 'function');
  assert.equal(typeof first.props.label, 'string');
  const segs = nodes(dialog).filter(node => node.type === OfficialSegmented);
  const seg = segs.find(node => node.props.id === 'hud-settings-panel-side');
  assert.ok(seg, '侧位应使用官方分段控件');
  // 跨 realm 数组不能直接 deepEqual，先转本域普通对象。
  assert.deepEqual(JSON.parse(JSON.stringify(seg.props.options.map(option => option.value))), ['left', 'right']);
  assert.equal(seg.props.value, 'right');
  assert.equal(seg.props.id, 'hud-settings-panel-side');
  // v0.20.0：样式行同样走官方分段控件，默认 card。
  const styleSeg = segs.find(node => node.props.id === 'hud-settings-panel-style');
  assert.ok(styleSeg, '样式应使用官方分段控件');
  assert.deepEqual(JSON.parse(JSON.stringify(styleSeg.props.options.map(option => option.value))), ['card', 'sidebar']);
  assert.equal(styleSeg.props.value, 'card');
  // v0.21.0：git 变更查看方式同样走官方分段控件，默认 list。
  const gitSeg = segs.find(node => node.props.id === 'hud-settings-git-view');
  assert.ok(gitSeg, 'git 变更查看方式应使用官方分段控件');
  assert.deepEqual(JSON.parse(JSON.stringify(gitSeg.props.options.map(option => option.value))), ['list', 'tree']);
  assert.equal(gitSeg.props.value, 'list');
});

test('置灰设置项：原因文字走红字样式，未置灰行保持次要色', () => {
  // v0.20.1：所有置灰设置行的说明小字改为错误色（红字），直接写明不可用原因。
  assert.match(clientSource, /\.hud-setting-row\[data-disabled=true\] \.hud-setting-hint\{color:var\(--dsw-alias-state-error-primary\)\}/);
  // 行名仍用次要色，保持「名称灰、原因红」的层次。
  assert.match(clientSource, /\.hud-setting-row\[data-disabled=true\] \.hud-setting-name\{color:var\(--dsw-alias-label-secondary\)\}/);

  const runtime = createRuntime(null);
  // 把「git」排到首位，让「上下文模块位置固定」因排序原因置灰。
  const order = ['git', ...MODULE_KEYS.filter(key => key !== 'git')];
  const dialog = runtime.render(baseProps({
    order,
    usageAvailability: { deepseek: true, opencode: false, codex: false },
    usageReasons: { opencode: 'settingsUsageOpencodeMissing', codex: 'settingsUsageCodexUnconfigured' },
  }));
  const cards = byClass(dialog, 'hud-settings-section hud-settings-section-card');
  const contextRows = byClass(cards[1], 'hud-setting-row');
  const pinRow = contextRows[contextRows.length - 1];
  assert.equal(pinRow.props['data-disabled'], true, '排序不允许时「上下文模块位置固定」置灰');
  assert.equal(textOf(byClass(pinRow, 'hud-setting-hint')[0]), 'settingsContextPinOrder', '置灰原因写在说明小字里');
  const pinSwitch = nodes(pinRow).find(node => node.type === 'button' && node.props?.role === 'switch');
  assert.equal(pinSwitch.props.disabled, true, '置灰行完全不可点击');

  // 未置灰行仍显示常规说明（不是原因文案）。
  assert.equal(contextRows[0].props['data-disabled'], false);
  // 上下文卡片顺序：会话统计 → Token 用量 → 分段进度条 → 位置固定（v0.19.2）。
  assert.equal(textOf(byClass(contextRows[0], 'hud-setting-hint')[0]), 'settingsContextStatsHint');

  // 用量两行：原因同样落在说明小字里，codex 区分「插件不可用」与「已启用但未登录」。
  const usageRows = byClass(cards[2], 'hud-setting-row');
  assert.equal(textOf(byClass(usageRows[1], 'hud-setting-hint')[0]), 'settingsUsageOpencodeMissing');
  assert.equal(textOf(byClass(usageRows[2], 'hud-setting-hint')[0]), 'settingsUsageCodexUnconfigured');
  // 组件侧按 missing 标记挑选原因键。
  assert.match(clientSource, /codex: t\(codexUsageReasonKey\(codex\)\)/);
  assert.match(clientSource, /function codexUsageReasonKey\(state\) \{/);
  assert.match(clientSource, /opencode: opencode\?\.missing === true \? t\("settingsUsageOpencodeMissing"\) : t\("settingsUsageOpencodeUnconfigured"\)/);
});

test('用量设置：三项恒列出，未安装/未配置置灰并给出行内原因', () => {
  const runtime = createRuntime(null);
  const dialog = runtime.render(baseProps({
    usageAvailability: { deepseek: true, opencode: false, codex: false },
    usageReasons: { opencode: 'settingsUsageOpencodeMissing', codex: 'settingsUsageCodexMissing' },
  }));
  const cards = byClass(dialog, 'hud-settings-section hud-settings-section-card');
  const usageCard = cards[2];
  const rows = byClass(usageCard, 'hud-setting-row');
  assert.equal(rows.length, 4, '三行用量数据 + 折叠后展示信息');

  // 名称用图标区分数据源；置灰行带 data-disabled 与原因文案。
  assert.deepEqual(rows.map(row => textOf(byClass(row, 'hud-setting-name')[0])), [
    'settingsUsageDeepseek', 'settingsUsageOpencode', 'settingsUsageCodex', 'settingsUsageFolded',
  ]);
  assert.equal(rows[0].props['data-disabled'], false, 'DeepSeek 走内置官方余额源，恒可切换');
  assert.equal(rows[1].props['data-disabled'], true);
  assert.equal(rows[2].props['data-disabled'], true);
  assert.equal(rows[3].props['data-disabled'], false);
  assert.equal(textOf(byClass(rows[1], 'hud-setting-hint')[0]), 'settingsUsageOpencodeMissing');
  assert.equal(textOf(byClass(rows[2], 'hud-setting-hint')[0]), 'settingsUsageCodexMissing');
  assert.equal(textOf(byClass(rows[3], 'hud-setting-hint')[0]), 'settingsUsageFoldedHint');

  // 置灰开关必须是 disabled，且点击不会改草稿；折叠下拉里不可用选项同样置灰。
  const switches = rows.slice(0, 3).map(row => nodes(row).find(node => node.type === 'button' && node.props?.role === 'switch'));
  assert.equal(switches[0].props.disabled, false);
  assert.equal(switches[1].props.disabled, true);
  assert.equal(switches[2].props.disabled, true);
  // v0.21.0：折叠展示改为官方样式下拉（本地回退路径）。
  const trigger = nodes(rows[3]).find(node => node.type === 'button' && node.props?.className === 'hud-select-trigger');
  assert.ok(trigger, '折叠展示用下拉菜单');
  assert.equal(trigger.props['aria-haspopup'], 'menu');
  assert.equal(trigger.props['aria-expanded'], false);
  assert.equal(textOf(trigger), 'settingsUsageFoldedNone', '默认选中「无」');
  trigger.props.onClick({ preventDefault() {}, stopPropagation() {} });
  const opened = runtime.render();
  const items = nodes(opened).filter(node => node.type === 'button' && node.props?.role === 'menuitemradio');
  assert.equal(items.length, 7, '七个额度选项恒列出');
  assert.deepEqual(JSON.parse(JSON.stringify(items.map(item => item.props.key))),
    ['none', 'deepseek', 'oc-5h', 'oc-1w', 'oc-1m', 'codex-5h', 'codex-1w']);
  assert.deepEqual(JSON.parse(JSON.stringify(items.filter(item => item.props.disabled).map(item => item.props.key))),
    ['oc-5h', 'oc-1w', 'oc-1m', 'codex-5h', 'codex-1w'], '不可用额度置灰不可选');
  assert.equal(items[0].props['aria-checked'], true);
  // 点选可用项 → 草稿更新，触发器显示新标签。
  items[1].props.onClick();
  const reopened = runtime.render();
  const trigger2 = nodes(reopened).find(node => node.type === 'button' && node.props?.className === 'hud-select-trigger');
  assert.equal(textOf(trigger2), 'settingsUsageFoldedDeepseek');
});

test('侧位控件关闭「新建会话页默认展示」时开关为关，且不误触禁用项', () => {
  const runtime = createRuntime(null);
  const dialog = runtime.render(baseProps({ panel: { side: 'right', newSessionOpen: true, chatOpen: false } }));
  const card = byClass(dialog, 'hud-settings-section hud-settings-section-card')[0];
  const switches = nodes(card).filter(node => node.type === 'button' && node.props?.role === 'switch');
  assert.equal(switches[0].props['aria-checked'], true);
  assert.equal(switches[1].props['aria-checked'], false);
});

test('左栏与右栏的滚动约定：左栏不滚动、右栏独立滚动（CSS 断言）', async () => {
  const { clientSource } = await import('./helpers/client-harness.mjs');
  const css = clientSource;
  assert.match(css, /\.hud-settings-panes\{flex:1 1 auto;min-height:0;display:flex;align-items:stretch\}/);
  assert.match(css, /\.hud-settings-pane-modules\{flex:none;width:240px;[^}]*overflow:hidden/);
  assert.match(css, /\.hud-settings-pane-detail\{flex:1 1 auto;min-width:0;overflow-y:auto/);
  // 卡片式分区 + 矮窗口紧凑模式（保证 9 张模块卡片仍全部露出）。
  assert.match(css, /\.hud-settings-section-card\{display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px;border:1px solid/);
  assert.match(css, /@media\(max-height:640px\)\{/);
  assert.match(css, /\.hud-settings-list\{display:flex;flex-direction:column;gap:6px;min-height:0;flex:none\}/);
});

test('新建会话页不展示的模块：左栏保持真实开关状态，但置灰且不可点击', () => {
  // 本页不渲染 上下文 / 子代理任务 / 任务 / 计划清单（与控制端 NEW_SESSION_MODULE_KEYS 对应）
  const lockedModules = ['context', 'subagents', 'tasks', 'plans'];
  const confirmations = [];
  const runtime = createRuntime(null);
  runtime.render(baseProps({ lockedModules, onConfirm: (...args) => confirmations.push(args) }));

  const cards = byClass(runtime.element, 'hud-settings-card');
  const byKey = new Map(cards.map(card => [textOf(byClass(card, 'hud-settings-card-name')[0]), card]));
  // 卡片顺序与 MODULE_KEYS 一致，这里按名称反查
  const nameOf = key => `label:${key}`;
  for (const key of MODULE_KEYS) {
    const card = byKey.get(nameOf(key));
    assert.ok(card, `缺少 ${key} 的卡片`);
    const input = nodes(card).find(node => node.type === 'input');
    const locked = lockedModules.includes(key);
    assert.equal(card.props['data-locked'], locked, `${key} 的锁定态不符`);
    // 关键：锁定项仍是「启用」状态（真实设置），不是被页面过滤成关闭
    assert.equal(input.props.checked, true, `${key} 应保持启用状态`);
    assert.equal(input.props.disabled, locked, `${key} 的可点性不符`);
    if (locked) assert.equal(byClass(card, 'hud-settings-card-label')[0].props.title, 'settingsModuleLocked');
  }

  // 锁定项即使被点击也不改草稿：确认时模块设置原样提交
  const lockedCard = byKey.get(nameOf('subagents'));
  const lockedInput = nodes(lockedCard).find(node => node.type === 'input');
  // 跨 realm：vm 里创建的函数不满足宿主 realm 的 instanceof Function，用 typeof 判断。
  assert.equal(typeof lockedInput.props.onChange, 'function');
  assert.equal(lockedInput.props.disabled, true, '禁用后原生点击不会触发 onChange');

  // 只有改动后才能保存：这里关掉一个可编辑模块（git），锁定项保持原样。
  const gitCard = byKey.get(nameOf('git'));
  const gitInput = nodes(gitCard).find(node => node.type === 'input');
  gitInput.props.onChange({ target: { checked: false } });
  const dialog = runtime.render();
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  assert.equal(confirm.props.disabled, false, '改动后可保存');
  confirm.props.onClick();
  const submitted = JSON.parse(JSON.stringify(confirmations[0][0]));
  assert.equal(submitted.git, false);
  for (const key of ['context', 'subagents', 'tasks', 'plans']) {
    assert.equal(submitted[key], true, `本页不展示的 ${key} 不得被写成关闭`);
  }
});

test('锁定项保留用户真实的关闭状态（不强行改成启用）', () => {
  const runtime = createRuntime(null);
  const modules = { ...defaultModules(), tasks: false };
  runtime.render(baseProps({ modules, lockedModules: ['context', 'subagents', 'tasks', 'plans'] }));
  const cards = byClass(runtime.element, 'hud-settings-card');
  const taskCard = cards.find(card => textOf(byClass(card, 'hud-settings-card-name')[0]) === 'label:tasks');
  const input = nodes(taskCard).find(node => node.type === 'input');
  assert.equal(input.props.checked, false, '真实设置为关闭就显示关闭（只置灰，不改值）');
  assert.equal(input.props.disabled, true);
  assert.equal(taskCard.props['data-off'], true);
});

test('便笺设置卡片：数字步进器 5–20，确认时随设置一起提交 note', () => {
  const calls = [];
  const runtime = createRuntime(null);
  const dialog = runtime.render(baseProps({ onConfirm: (...args) => calls.push(args) }));
  const cards = byClass(dialog, 'hud-settings-section hud-settings-section-card');
  const noteCard = cards.find(card => textOf(byClass(card, 'hud-settings-section-title')[0]) === 'settingsNoteTitle');
  assert.ok(noteCard, '右栏应有「便笺」设置卡片');
  const rows = byClass(noteCard, 'hud-setting-row');
  // v0.21.0：两行——便笺条数上限 + 弹窗编辑开关。
  assert.equal(rows.length, 2, '便笺卡片有「便笺条数上限」与「弹窗编辑」两行');
  assert.match(textOf(rows[0]), /settingsNoteMax/);
  assert.match(textOf(rows[1]), /settingsNotePopup/);
  const popupSwitch = nodes(rows[1]).find(node => node.type === 'button' && node.props?.role === 'switch');
  assert.ok(popupSwitch, '弹窗编辑用开关');
  assert.equal(popupSwitch.props['aria-checked'], false, '默认关闭');
  assert.equal(byClass(noteCard, 'hud-number-stepper').length, 1);
  const valueInput = nodes(noteCard).find(node => node.type === 'input' && node.props?.className === 'hud-number-input');
  assert.equal(valueInput.props.value, '5');
  assert.equal(valueInput.props.min, 5);
  assert.equal(valueInput.props.max, 20);
  // 加号到 6；边界按钮禁用。
  const steps = nodes(noteCard).filter(node => node.type === 'button' && node.props?.className === 'hud-number-step');
  assert.equal(steps.length, 2);
  assert.equal(steps[0].props.disabled, true, '已在最小值时减号禁用');
  steps[1].props.onClick();
  const next = runtime.render();
  const card2 = byClass(next, 'hud-settings-section hud-settings-section-card').find(card => textOf(byClass(card, 'hud-settings-section-title')[0]) === 'settingsNoteTitle');
  const input2 = nodes(card2).find(node => node.type === 'input' && node.props?.className === 'hud-number-input');
  assert.equal(input2.props.value, '6', '加号后数值为 6');
  const confirmButton = nodes(next).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  confirmButton.props.onClick();
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][5])), { maxCount: 6, popupEdit: false }, '确认时提交 note.maxCount');
  // 打开弹窗编辑开关后再确认：popupEdit=true 一并提交。
  const opened = runtime.render();
  const openedCard = byClass(opened, 'hud-settings-section hud-settings-section-card').find(card => textOf(byClass(card, 'hud-settings-section-title')[0]) === 'settingsNoteTitle');
  const popupToggle = nodes(openedCard).find(node => node.type === 'button' && node.props?.role === 'switch');
  popupToggle.props.onClick();
  const confirmed = runtime.render();
  nodes(confirmed).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][5])), { maxCount: 6, popupEdit: true }, '确认时提交 note.popupEdit');
});

test('便笺上限降低导致工作区超限：仍然正常保存，不再拦截', () => {
  const toasts = [];
  const calls = [];
  const runtime = createRuntime(null, {
    noteViolations: (maxCount) => (maxCount < 8 ? [{ key: '/ws/alpha', count: 8 }] : []),
    toasts,
  });
  const dialog = runtime.render(baseProps({ note: { maxCount: 5 }, onConfirm: (...args) => calls.push(args) }));
  const noteCard = byClass(dialog, 'hud-settings-section hud-settings-section-card').find(card => textOf(byClass(card, 'hud-settings-section-title')[0]) === 'settingsNoteTitle');
  const steps = nodes(noteCard).filter(node => node.type === 'button' && node.props?.className === 'hud-number-step');
  steps[1].props.onClick();
  const dialog2 = runtime.render();
  const confirmButton = nodes(dialog2).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  assert.equal(confirmButton.props.disabled, false, '改动后可点');
  confirmButton.props.onClick();
  assert.equal(calls.length, 1, 'v0.20.1：上限低于现有条数也照常保存');
  assert.equal(toasts.length, 0, '不再 toast 拦截');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][5])), { maxCount: 6, popupEdit: false });
});

test('「保存设置」未改动时置灰；只改其它设置时便笺上限校验不再拦截保存', () => {
  // 常量式违规：只要执行便笺上限校验就必然失败（复现旧版「点了没反应」）。
  const calls = [];
  const runtime = createRuntime(null, { noteViolations: () => [{ key: '/ws/alpha', count: 8 }] });
  let dialog = runtime.render(baseProps({ note: { maxCount: 5 }, onConfirm: (...args) => calls.push(args) }));
  const confirm = () => nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  assert.equal(confirm().props.disabled, true, '未改动时置灰');
  confirm().props.onClick();
  assert.equal(calls.length, 0);

  // 只关闭「HUD 面板」里的一个开关（不改便笺上限）→ 可保存，且不再被便笺条数拦截。
  const panelCard = byClass(dialog, 'hud-settings-section hud-settings-section-card')[0];
  const toggle = nodes(panelCard).find(node => node.props?.role === 'switch' && node.type === 'button');
  assert.ok(toggle, 'HUD 面板设置应有开关');
  toggle.props.onClick();
  dialog = runtime.render();
  assert.equal(confirm().props.disabled, false, '改动后可点');
  confirm().props.onClick();
  assert.equal(calls.length, 1, '只改其它设置时必须能保存');
  assert.equal(calls[0].length, 7);
});

test('调整便笺上限且工作区超限时同样保存成功', () => {
  const calls = [];
  const toasts = [];
  const runtime = createRuntime(null, {
    noteViolations: (maxCount) => (maxCount < 8 ? [{ key: '/ws/alpha', count: 8 }] : []),
    toasts,
  });
  let dialog = runtime.render(baseProps({ note: { maxCount: 5 }, onConfirm: (...args) => calls.push(args) }));
  const noteCard = () => byClass(dialog, 'hud-settings-section hud-settings-section-card').find(card => textOf(byClass(card, 'hud-settings-section-title')[0]) === 'settingsNoteTitle');
  nodes(noteCard()).filter(node => node.type === 'button' && node.props?.className === 'hud-number-step')[1].props.onClick();
  dialog = runtime.render();
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  assert.equal(confirm.props.disabled, false);
  confirm.props.onClick();
  assert.equal(calls.length, 1, '超限也保存');
  assert.equal(toasts.length, 0);
});

test('上下文与用量设置行都带上简短说明文案', () => {
  const runtime = createRuntime(null);
  const dialog = runtime.render(baseProps());
  const cards = byClass(dialog, 'hud-settings-section hud-settings-section-card');
  const cardOf = title => cards.find(card => textOf(byClass(card, 'hud-settings-section-title')[0]) === title);
  const hintOf = (card, index) => textOf(byClass(byClass(card, 'hud-setting-row')[index], 'hud-setting-hint')[0]);
  const contextCard = cardOf('settingsContextTitle');
  assert.deepEqual([
    hintOf(contextCard, 0), hintOf(contextCard, 1), hintOf(contextCard, 2), hintOf(contextCard, 3),
  ], [
    'settingsContextStatsHint', 'settingsContextUsageHint', 'settingsContextBarStyleHint', 'settingsContextPinHint',
  ]);
  const usageCard = cardOf('settingsUsageTitle');
  assert.deepEqual([hintOf(usageCard, 0), hintOf(usageCard, 1), hintOf(usageCard, 2), hintOf(usageCard, 3)], [
    'settingsUsageDeepseekHint', 'settingsUsageOpencodeHint', 'settingsUsageCodexHint', 'settingsUsageFoldedHint',
  ]);
});

test('git 变更查看方式：切换为文件树并保存，重新打开设置仍选中文件树', () => {
  const calls = [];
  const runtime = createRuntime(null);
  let dialog = runtime.render(baseProps({ onConfirm: (...args) => calls.push(args) }));
  const segItems = () => nodes(dialog).filter(node => node.type === 'button' && node.props?.className === 'hud-seg-item');
  const listItem = segItems().find(node => textOf(node) === 'settingsGitViewList');
  const treeItem = segItems().find(node => textOf(node) === 'settingsGitViewTree');
  assert.ok(listItem && treeItem, 'git 查看方式应有列表/文件树两个选项');
  assert.equal(listItem.props['aria-checked'], true, '默认列表');
  treeItem.props.onClick();
  dialog = runtime.render();
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  assert.equal(confirm.props.disabled, false, '切换后可保存');
  confirm.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(JSON.stringify(calls[0][6])).view, 'tree', '保存时提交 git.view=tree');

  // 重新打开设置（宿主回显文件树）→ 分段控件仍选中文件树。
  dialog = runtime.render(baseProps({ git: { view: 'tree' } }));
  const reopened = nodes(dialog).filter(node => node.type === 'button' && node.props?.className === 'hud-seg-item')
    .find(node => textOf(node) === 'settingsGitViewTree');
  assert.equal(reopened.props['aria-checked'], true);
});
