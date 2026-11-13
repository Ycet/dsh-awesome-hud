// dsh-awesome-hud — v0.18.2 回归：面板重挂后必须读取最新设置，不能回退到页面加载时的旧快照
// （用户报告：关掉「跳转」/把面板放到左侧后，切页面、关开面板、开合右侧栏都会回退）
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  MODULE_KEYS, PANEL_SIDES, defaultModules, defaultUsageDisplay, defaultContextSettings,
  normalizeContextSettings, defaultModuleOrder, normalizeModuleOrder, defaultPanelSettings, normalizePanelSettings,
} from '../lib/settings.js';
import { clientSource } from './helpers/client-harness.mjs';

const start = clientSource.indexOf('function useHudModules()');
const end = clientSource.indexOf('// —— 会话模块', start);
assert.ok(start > 0 && end > start, '定位不到 useHudModules');

/** 页面加载时的旧设置：面板右侧、跳转按钮展示。 */
const pageLoadBody = () => ({
  ok: true,
  modules: defaultModules(),
  usage: defaultUsageDisplay(),
  context: defaultContextSettings(),
  order: normalizeModuleOrder(null),
  panel: defaultPanelSettings(),
});

/** 用户确认后的设置：面板左侧、跳转按钮关闭（宿主回显）。 */
const writtenBody = () => ({
  ok: true,
  modules: defaultModules(),
  usage: { ...defaultUsageDisplay(), showJump: false },
  context: defaultContextSettings(),
  order: normalizeModuleOrder(null),
  panel: { side: 'left', newSessionOpen: false, chatOpen: true },
});

/**
 * 建一个 hook 运行环境：每次 mount() 都换一批新的 state/ref 槽位（等价 React 组件重新挂载），
 * effect 在渲染后由测试手动执行。
 */
function createHarness(options = {}) {
  const calls = [];
  const toasts = [];
  const panelPrefs = { ...defaultPanelSettings() };
  const appliedPanels = [];
  const bodies = options.bodies ?? [pageLoadBody()];
  let getSettingsCalls = 0;
  let slots = [];
  let refs = [];
  let cursor = 0;
  let pendingEffects = [];

  const react = {
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
    useEffect(effect) { pendingEffects.push(effect); },
    useCallback(fn) { return fn; },
  };

  const context = vm.createContext({
    react,
    getSettings: () => {
      const body = bodies[Math.min(getSettingsCalls, bodies.length - 1)];
      getSettingsCalls += 1;
      return Promise.resolve(typeof body === 'function' ? body() : body);
    },
    call: async (method, payload) => {
      calls.push({ method, payload });
      if (options.failSave === true) throw new Error('boom');
      // 宿主把合并后的完整设置回显给客户端（与真实 /awesome-api/settings 一致）
      return { ok: true, ...payload, persistent: true };
    },
    panelPrefs,
    defaultPanelSettings,
    normalizePanelSettings,
    PANEL_SIDES: [...PANEL_SIDES],
    defaultModules,
    defaultUsageDisplay,
    defaultContextSettings,
    normalizeContextSettings,
    defaultModuleOrder,
    normalizeModuleOrder,
    MODULE_KEYS: [...MODULE_KEYS],
    // 首次加载的面板对账（本用例只关心缓存/镜像更新）
    ensurePanelPrefs: () => Promise.resolve(panelPrefs),
    applyPanelPrefs: next => { appliedPanels.push({ ...next }); Object.assign(panelPrefs, next); },
    toast: (message, kind) => toasts.push({ message, kind }),
    interpolate: value => value,
    t: key => key,
  });

  context.USAGE_SETTING_KEYS = ['deepseek', 'opencode', 'codex', 'showJump'];
  vm.runInContext(`
    let lastSettingsBody = null;
    function rememberSettingsBody(body) {
      if (body === null || body === undefined || body.ok !== true) return;
      lastSettingsBody = body;
    }
    let lastUsageDisplay = null;
    function acceptUsageDisplay(raw) {
      if (raw === null || raw === undefined) return null;
      const out = { ...raw };
      for (const key of USAGE_SETTING_KEYS) {
        if (typeof out[key] !== 'boolean') out[key] = (lastUsageDisplay !== null && lastUsageDisplay !== undefined ? lastUsageDisplay[key] : true) === true;
      }
      lastUsageDisplay = out;
      return out;
    }
    ${clientSource.slice(start, end)}
    this.hook = useHudModules;
    this.peekBody = () => lastSettingsBody;
  `, context);

  const settle = () => new Promise(resolve => setImmediate(resolve));

  return {
    panels: panelPrefs,
    appliedPanels,
    calls,
    toasts,
    get settingsCalls() { return getSettingsCalls; },
    /** 模拟一次组件挂载：全新槽位 + 执行挂载 effect。 */
    async mount() {
      slots = [];
      refs = [];
      cursor = 0;
      pendingEffects = [];
      const result = context.hook();
      for (const effect of pendingEffects) effect();
      await settle();
      await settle();
      return {
        result,
        modules: () => slots[0],
        usage: () => slots[1],
        panel: () => slots[4],
        seed: () => vm.runInContext('this.peekBody()', context),
      };
    },
  };
}

test('写入后重挂面板：首帧即为新设置，且会重新读取宿主设置（不再复用页面加载快照）', async () => {
  const harness = createHarness({ bodies: [pageLoadBody(), writtenBody()] });

  const first = await harness.mount();
  assert.equal(first.panel().side, 'right', '首次挂载来自页面加载设置');
  assert.equal(first.usage().showJump, true);
  assert.equal(harness.settingsCalls, 1);

  // 用户在设置里确认：面板放左侧 + 关掉跳转按钮
  const update = first.result[2];
  const operation = update({}, { showJump: false }, undefined, undefined, { side: 'left', newSessionOpen: false, chatOpen: true });
  await operation;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].payload.panel.side, 'left');
  assert.equal(harness.calls[0].payload.usage.showJump, false);
  assert.equal(first.seed().panel.side, 'left', '写入成功即刷新「最近一次成功快照」');
  assert.deepEqual(harness.panels, { side: 'left', newSessionOpen: false, chatOpen: true }, '面板缓存随写入更新');

  // 关开面板 / 切页面 / 开合右侧栏 → 组件重新挂载
  const second = await harness.mount();
  assert.equal(harness.settingsCalls, 2, '重挂时必须再次 GET，而不是复用页面加载时的快照');
  // 首帧就来自最近一次成功快照：不会先闪回「右侧 / 有跳转按钮」
  assert.equal(second.seed().panel.side, 'left');
  assert.equal(second.panel().side, 'left', '首帧即为左侧，不再回退右侧');
  assert.equal(second.usage().showJump, false, '首帧即隐藏跳转按钮');
  // 紧随其后的 GET 也确认宿主已是新值
  assert.equal(second.panel().side, 'left');
  assert.equal(second.usage().showJump, false);
});

test('未写入时重挂也重新读取：宿主侧被其它窗口改回的值能覆盖本地首帧', async () => {
  const harness = createHarness({
    bodies: [
      pageLoadBody,
      () => ({ ...pageLoadBody(), panel: { side: 'left', newSessionOpen: true, chatOpen: true } }),
    ],
  });

  const first = await harness.mount();
  assert.equal(first.panel().side, 'right');

  const second = await harness.mount();
  assert.equal(harness.settingsCalls, 2);
  assert.equal(second.panel().side, 'left', '宿主设置为权威值');
  assert.deepEqual(harness.appliedPanels.at(-1), { side: 'left', newSessionOpen: true, chatOpen: true }, '宿主侧位同步回模块级缓存');
});

test('旧宿主（响应无 panel 段）不会把面板侧位冲回默认值', async () => {
  const legacyBody = () => {
    const body = pageLoadBody();
    delete body.panel;
    return body;
  };
  const harness = createHarness({ bodies: [legacyBody, legacyBody] });
  // 本地镜像/缓存已是左侧（用户此前确认过）
  Object.assign(harness.panels, { side: 'left', newSessionOpen: true, chatOpen: true });

  const first = await harness.mount();
  assert.equal(first.panel().side, 'left', '旧宿主不提供 panel 时沿用本地缓存');
  assert.equal(first.usage().showJump, true, '旧宿主也不返回 showJump，按默认展示');
});

test('写入请求失败时不会污染「最近一次成功快照」', async () => {
  const harness = createHarness({ bodies: [pageLoadBody], failSave: true });
  const first = await harness.mount();
  assert.equal(first.seed().panel.side, 'right');

  const update = first.result[2];
  await assert.rejects(
    update({}, { showJump: false }, undefined, undefined, { side: 'left', newSessionOpen: false, chatOpen: true }),
    /boom/,
  );
  assert.equal(first.seed().panel.side, 'right', '失败响应不得进入快照');
  assert.equal(first.seed().usage.showJump, true);
  assert.ok(harness.toasts.some(row => row.message === 'settingsSaveFailed'), '保存失败仍按原逻辑提示');
});

test('旧宿主不返回 showJump：重挂后仍保留本次运行内关闭「跳转」按钮的选择', async () => {
  const legacyBody = () => {
    const body = pageLoadBody();
    delete body.panel;
    // 旧宿主的 usage 只有三行数据，没有 v0.18.2 新增的 showJump
    const usage = { ...body.usage };
    delete usage.showJump;
    return { ...body, usage };
  };
  const harness = createHarness({ bodies: [legacyBody, legacyBody] });
  const first = await harness.mount();
  assert.equal(first.usage().showJump, true, '缺键按默认展示');

  const update = first.result[2];
  await update({}, { showJump: false }, undefined, undefined, { side: 'right', newSessionOpen: false, chatOpen: true });
  await new Promise(resolve => setImmediate(resolve));

  // 关开面板 → 重挂：旧宿主响应仍没有 showJump，但本次运行内的选择要保留
  const second = await harness.mount();
  assert.equal(second.usage().showJump, false, '旧宿主下也不会把跳转按钮「复活」');
  assert.equal(harness.settingsCalls, 2, '仍然重新读取宿主设置');
});

test('新建会话页：设置弹窗读真实模块开关（不是本页过滤后的状态），并标明哪些模块只读', async () => {
  const { hudClient, moduleOf } = await import('./helpers/client-harness.mjs');
  const openPanel = client => { client.button().props.onClick(); return client.panel(); };

  // 新建会话页（无会话）：9 个模块卡片全部为启用，其中 4 个只读
  const blank = hudClient({});
  const blankSession = moduleOf(openPanel(blank), 'SessionModule');
  assert.deepEqual(JSON.parse(JSON.stringify(blankSession.props.modules)), defaultModules(), '新建会话页也必须拿到真实模块开关，不能是过滤后的 false');
  assert.deepEqual([...blankSession.props.lockedModules].sort(), ['context', 'plans', 'subagents', 'tasks']);

  // 会话页：没有只读项（会话页没有悬浮入口，直接用该会话的展开记忆打开面板）
  const chat = hudClient({
    current: 's1',
    state: { current: 's1', byId: { s1: { cwd: '/tmp/ws' } } },
    storage: { 'dsh-awesome-hud:open': JSON.stringify({ s1: '1' }) },
  });
  const chatSession = moduleOf(chat.panel(), 'SessionModule');
  assert.deepEqual(JSON.parse(JSON.stringify(chatSession.props.lockedModules)), []);
});
