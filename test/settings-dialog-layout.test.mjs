// dsh-awesome-hud — v0.18.2：HUD 设置弹窗左右分栏、右栏卡片分区与官方控件
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  MODULE_KEYS, defaultModules, defaultUsageDisplay, defaultContextSettings, normalizeContextSettings,
  normalizeModuleOrder, defaultPanelSettings, normalizePanelSettings,
} from '../lib/settings.js';
import { extractFunction, extractConst, nodes, clientSource as clientSource } from './helpers/client-harness.mjs';

const USAGE_SETTING_KEYS = ['deepseek', 'opencode', 'codex', 'showJump'];
const MODULE_LABELS = Object.fromEntries(MODULE_KEYS.map(key => [key, () => `label:${key}`]));

/**
 * 极简 hooks 运行时：state 按调用顺序保存在同一批槽位里，setState 后由测试重新渲染，
 * 这样「点开关 → 再确认」这类交互可以真实验证，而不是只看初始渲染。
 */
function createRuntime(primitives) {
  const slots = [];
  const refs = [];
  let cursor = 0;
  const context = vm.createContext({
    // primitives 缺失时 officialControl 返回 null → 走本地回退控件
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
    `${extractFunction('officialControl')}
     ${extractFunction('HudSwitch')}
     ${extractFunction('HudSegmented')}
     ${extractFunction('SettingRow')}
     ${extractFunction('guideActiveKey')}
     ${extractConst('GUIDE_SECTIONS')}
     ${extractFunction('SettingsGuide')}
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

test('左右分栏：左栏模块清单，右栏三个卡片式设置分区', () => {
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

  // 右栏：面板 / 上下文 / 用量 三张卡片，顺序固定。
  const right = byClass(dialog, 'hud-settings-pane hud-settings-pane-detail')[0];
  const cards = byClass(right, 'hud-settings-section hud-settings-section-card');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(card => textOf(byClass(card, 'hud-settings-section-title')[0])), [
    'settingsPanelTitle', 'settingsContextTitle', 'settingsUsageTitle',
  ]);
});

test('HUD 面板设置：侧位分段控件 + 两处默认开合开关', () => {
  const runtime = createRuntime(null);
  const card = byClass(runtime.render(baseProps()), 'hud-settings-section hud-settings-section-card')[0];
  const rows = byClass(card, 'hud-setting-row');
  // 侧位 + 两处默认开合 = 3 行（悬停展示的「展示方式」行已随功能移除）
  assert.equal(rows.length, 3);

  // 侧位：本地回退的分段控件（官方 SegmentedControl 缺失时）。
  const seg = byClass(card, 'hud-seg')[0];
  assert.ok(seg, '侧位行应渲染分段控件');
  const options = seg.children.filter(node => node?.props?.role === 'radio');
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

  // 切到左侧并打开「新建会话页默认展示」。
  let card = byClass(runtime.element, 'hud-settings-section hud-settings-section-card')[0];
  byClass(card, 'hud-seg')[0].children[0].props.onClick();
  card = byClass(runtime.render(), 'hud-settings-section hud-settings-section-card')[0];
  const switches = nodes(card).filter(node => node.type === 'button' && node.props?.role === 'switch');
  switches[0].props.onClick();

  // 再渲染一次读取最新草稿，然后确认。
  const dialog = runtime.render();
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  confirm.props.onClick();
  assert.equal(confirmations.length, 1);
  const panelDraft = confirmations[0][4];
  assert.deepEqual(JSON.parse(JSON.stringify(panelDraft)), { side: 'left', newSessionOpen: true, chatOpen: true });
});

test('「恢复默认」把面板设置与「跳转」开关一并复位', () => {
  const confirmations = [];
  const runtime = createRuntime(null);
  const changed = {
    panel: { side: 'left', newSessionOpen: true, chatOpen: false },
    usage: { ...defaultUsageDisplay(), showJump: false },
  };
  runtime.render(baseProps({ ...changed, onConfirm: (...args) => confirmations.push(args) }));

  // 与默认值不同 → 「恢复默认」可用。
  let dialog = runtime.render();
  let reset = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'reset');
  assert.equal(reset.props.disabled, false);
  reset.props.onClick();

  dialog = runtime.render();
  reset = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'reset');
  assert.equal(reset.props.disabled, true, '复位后按钮应回到禁用态');
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  confirm.props.onClick();
  const [draft, usageDraft, orderDraft, contextDraft, panelDraft] = confirmations[0];
  assert.deepEqual(JSON.parse(JSON.stringify(panelDraft)), defaultPanelSettings());
  assert.equal(usageDraft.showJump, true);
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), defaultModules());
  assert.deepEqual(JSON.parse(JSON.stringify(orderDraft)), normalizeModuleOrder(null));
  assert.deepEqual(JSON.parse(JSON.stringify(contextDraft)), defaultContextSettings());
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
  // 面板 2 + 上下文 4（三项展示 + v0.18.7 位置固定）+ 用量 4（三行 + 跳转）= 10
  assert.equal(official.length, 10, '所有启停项都应走官方 Switch');
  // 侧位 = 1 个分段控件（展示方式已移除）
  assert.equal(nodes(dialog).filter(node => node.type === OfficialSegmented).length, 1);
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
  assert.equal(rows.length, 4, '三行用量数据 + 「跳转」按钮');

  // 名称用图标区分数据源；置灰行带 data-disabled 与原因文案。
  assert.deepEqual(rows.map(row => textOf(byClass(row, 'hud-setting-name')[0])), [
    'settingsUsageDeepseek', 'settingsUsageOpencode', 'settingsUsageCodex', 'settingsUsageJump',
  ]);
  assert.equal(rows[0].props['data-disabled'], false, 'DeepSeek 走内置官方余额源，恒可切换');
  assert.equal(rows[1].props['data-disabled'], true);
  assert.equal(rows[2].props['data-disabled'], true);
  assert.equal(rows[3].props['data-disabled'], false, '「跳转」按钮开关不受数据源影响');
  assert.equal(textOf(byClass(rows[1], 'hud-setting-hint')[0]), 'settingsUsageOpencodeMissing');
  assert.equal(textOf(byClass(rows[2], 'hud-setting-hint')[0]), 'settingsUsageCodexMissing');

  // 置灰开关必须是 disabled，且点击不会改草稿。
  const switches = rows.map(row => nodes(row).find(node => node.type === 'button' && node.props?.role === 'switch'));
  assert.equal(switches[0].props.disabled, false);
  assert.equal(switches[1].props.disabled, true);
  assert.equal(switches[2].props.disabled, true);
  assert.equal(switches[3].props.disabled, false);
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

  const dialog = runtime.render();
  const confirm = nodes(dialog).find(node => node.type === 'button' && node.props?.['data-kind'] === 'confirm');
  confirm.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(confirmations[0][0])), defaultModules(), '确认时不得把本页不展示的模块写成关闭');
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
