// dsh-awesome-hud — v0.18.2：面板展开侧位（左侧镜像让位 / 左锚点）与左侧抽屉互斥
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hudClient, nodes, extractFunction } from './helpers/client-harness.mjs';

const PANEL_KEY = 'dsh-awesome-hud:panel';
const leftPrefs = JSON.stringify({ side: 'left', newSessionOpen: true, chatOpen: true });
const rightPrefs = JSON.stringify({ side: 'right', newSessionOpen: false, chatOpen: true });

/** 构造几何 effect 需要的最小 DOM：会话根 / 页眉 / 正文容器 / 滚动容器 / 输入框浮层座位。 */
function makeDom({ anchorLeft = 256 } = {}) {
  const makeStyle = () => {
    const values = new Map();
    return {
      getPropertyValue: property => values.get(property) ?? '',
      getPropertyPriority: () => '',
      setProperty: (property, value) => { values.set(property, String(value)); },
      removeProperty: property => { values.delete(property); },
      peek: property => values.get(property) ?? '',
    };
  };
  const seat = { style: makeStyle() };
  const body = { style: makeStyle(), getBoundingClientRect: () => ({ left: anchorLeft + 300, right: 1200, width: 1200 - anchorLeft - 300 }) };
  const scroll = {
    style: makeStyle(),
    closest: selector => (selector === '[data-conversation-content]' ? body : null),
    querySelector: selector => {
      if (selector === '[data-conversation-composer-overlay]') return {};
      if (selector === '[data-composer-seat]') return seat;
      return null;
    },
  };
  const root = {
    getBoundingClientRect: () => ({ left: anchorLeft, right: 1200, width: 1200 - anchorLeft }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const header = {
    closest: selector => (selector === 'header' ? header : null),
    getBoundingClientRect: () => ({ left: anchorLeft, right: 1200, bottom: 44, top: 0 }),
  };
  const sessionHost = { closest: selector => (selector === '[data-phase]' ? root : null) };
  return { seat, body, scroll, root, header, sessionHost, makeStyle };
}

/** 按选择器把假 DOM 交给 harness 的 document.querySelector。 */
function selectorMap(dom) {
  const corner = { closest: selector => (selector === 'header' ? dom.header : null) };
  return selector => {
    if (selector === '[data-conversation-header-corner]') return corner;
    if (selector === '[data-slot="conversation.composer.bar"]') return { getBoundingClientRect: () => ({ bottom: 760 }) };
    if (selector === '[data-slot="conversation.session"]') return dom.sessionHost;
    if (selector === '[data-phase]') return dom.root;
    if (selector === '[data-conversation-scroll]') return dom.scroll;
    return null;
  };
}

/** 打开面板并返回几何 effect（含 data-conversation-header-corner 的那个）。 */
function openPanel(client) {
  // 新建会话页默认展示时面板已自动渲染，此时再点入口反而会收起。
  const rendered = () => nodes(client.root()).some(node => node?.type?.name === 'HudPanel');
  if (!rendered()) client.button().props.onClick();
  assert.ok(rendered(), '面板应处于展开态');
  const panel = client.panel();
  const geometry = client.effects.find(fn => String(fn).includes('data-conversation-header-corner'));
  assert.ok(geometry, '几何让位 effect 必须注册');
  return { panel, geometry };
}

test('默认侧位为右侧：面板 data-side=right，正文收右、滚动容器补右缘', () => {
  const dom = makeDom();
  const client = hudClient({ storage: { [PANEL_KEY]: rightPrefs }, querySelector: selectorMap(dom) });
  const { panel, geometry } = openPanel(client);

  assert.equal(panel.props['data-side'], 'right');
  assert.equal(panel.props.style.right, '8px');
  assert.equal(panel.props.style.left, 'auto');

  geometry();
  assert.equal(dom.body.style.peek('margin-right'), '300px');
  assert.equal(dom.body.style.peek('margin-left'), '', '右侧面板不动左边距');
  assert.equal(dom.scroll.style.peek('margin-right'), '-300px');
  assert.equal(dom.scroll.style.peek('padding-right'), '300px');
  assert.equal(dom.scroll.style.peek('margin-left'), '');
  // 轨迹/统计等输入框浮层视图：座位只收右缘。
  assert.equal(dom.seat.style.peek('margin-right'), '300px');
  assert.equal(dom.seat.style.peek('margin-left'), '');
});

test('侧位=左侧：面板贴会话区左缘 +8px，正文收左、滚动容器补左缘（镜像让位）', () => {
  const dom = makeDom({ anchorLeft: 256 });
  const client = hudClient({ storage: { [PANEL_KEY]: leftPrefs }, querySelector: selectorMap(dom) });
  const { panel, geometry } = openPanel(client);

  assert.equal(panel.props['data-side'], 'left');
  geometry();
  // 左锚点取未被让位改写的会话根节点左缘（避开左侧会话列表）；
  // 测量结果写入模块级缓存，重渲染（含重新打开面板）时即时可用。
  const anchored = client.panel();
  assert.equal(anchored.props.style.left, '264px');
  assert.equal(anchored.props.style.right, 'auto');
  assert.equal(dom.body.style.peek('margin-left'), '300px');
  assert.equal(dom.body.style.peek('margin-right'), '', '左侧面板不动右边距');
  assert.equal(dom.scroll.style.peek('margin-left'), '-300px');
  assert.equal(dom.scroll.style.peek('padding-left'), '300px');
  assert.equal(dom.scroll.style.peek('padding-right'), '');
  assert.equal(dom.seat.style.peek('margin-left'), '300px');
  assert.equal(dom.seat.style.peek('margin-right'), '');
});

test('左侧锚点跟随会话区左缘：会话列表更宽时面板一起右移', () => {
  const narrow = makeDom({ anchorLeft: 48 });
  const wide = makeDom({ anchorLeft: 320 });
  const a = hudClient({ storage: { [PANEL_KEY]: leftPrefs }, querySelector: selectorMap(narrow) });
  const b = hudClient({ storage: { [PANEL_KEY]: leftPrefs }, querySelector: selectorMap(wide) });
  const panelA = openPanel(a).panel;
  const panelB = openPanel(b).panel;
  a.effects.find(fn => String(fn).includes('data-conversation-header-corner'))();
  b.effects.find(fn => String(fn).includes('data-conversation-header-corner'))();
  assert.equal(panelA.props.style.left, '8px', '首次渲染用兜底边距，测量后更新');
  assert.equal(a.panel().props.style.left, '56px');
  assert.equal(b.panel().props.style.left, '328px');
});

test('宿主设置优先于本地镜像：GET 返回 panel 后按宿主侧位渲染', async () => {
  const dom = makeDom();
  const client = hudClient({
    // 镜像写的是左侧，宿主设置是右侧：加载后必须回到右侧（两处都要求新建页默认展示，
    // 否则宿主会按自己的默认值把面板收起，测不到侧位变化）。
    storage: { [PANEL_KEY]: leftPrefs },
    querySelector: selectorMap(dom),
    respond: call => (call.url.endsWith('/settings')
      ? { ok: true, modules: {}, usage: {}, context: {}, order: [], panel: { side: 'right', newSessionOpen: true, chatOpen: true } }
      : { ok: true, servers: [], total: 0, enabled: 0, isRepo: true }),
  });
  const { panel } = openPanel(client);
  // 首次渲染仍是镜像值（异步请求未回），执行初始化 effect 后跟上宿主设置。
  for (const effect of client.effects) effect();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.props['data-side'], 'left');
  const rerendered = client.panel();
  assert.equal(rerendered.props['data-side'], 'right', '宿主设置为权威值');
  assert.equal(client.persisted.get(PANEL_KEY).includes('"right"'), true, '镜像随宿主设置同步更新');
});

test('新建会话页默认开合来自设置：默认隐藏时不渲染面板，默认展示时直接渲染', () => {
  const hidden = hudClient({ storage: { [PANEL_KEY]: JSON.stringify({ side: 'right', newSessionOpen: false, chatOpen: true }) } });
  const hiddenRoot = nodes(hidden.root()).find(node => node?.type?.name === 'HudPanel');
  assert.equal(hiddenRoot, undefined, '默认隐藏时新建页不应渲染面板');

  const shown = hudClient({ storage: { [PANEL_KEY]: JSON.stringify({ side: 'right', newSessionOpen: true, chatOpen: true }) } });
  const shownRoot = nodes(shown.root()).find(node => node?.type?.name === 'HudPanel');
  assert.ok(shownRoot, '默认展示时新建页应直接渲染面板');
});

test('左侧抽屉（窄窗口遮罩）只在面板位于左侧时驱逐面板', () => {
  const context = vm.createContext({});
  vm.runInContext(`
    let sidebarExpanded = false;
    let leftDrawerOpen = false;
    let open = true;
    let side = 'right';
    function getHudOpen() { return open; }
    function getPanelSide() { return side; }
    ${extractFunction('isHudVisible')}
    this.api = {
      setSide(value) { side = value; },
      setDrawer(value) { leftDrawerOpen = value; },
      setSidebar(value) { sidebarExpanded = value; },
      setOpen(value) { open = value; },
      visible() { return isHudVisible(); },
    };
  `, context);
  const api = context.api;

  assert.equal(api.visible(), true);

  // 右侧面板：左侧抽屉覆盖的是会话列表，不影响右缘面板。
  api.setDrawer(true);
  assert.equal(api.visible(), true, '右侧面板不受左侧抽屉影响');

  // 左侧面板：抽屉是覆盖式遮罩，展开期间面板临时隐藏，关闭后恢复。
  api.setSide('left');
  assert.equal(api.visible(), false, '左侧抽屉展开时左侧面板应临时隐藏');
  api.setDrawer(false);
  assert.equal(api.visible(), true, '抽屉关闭后自动恢复');

  // 官方右侧栏仍然无条件互斥（与侧位无关）。
  api.setSidebar(true);
  assert.equal(api.visible(), false);
  api.setSidebar(false);
  api.setOpen(false);
  assert.equal(api.visible(), false);
});

test('抽屉状态由宿主 frame 属性派生（[data-sidebar-drawer] 且未 collapsed）', () => {
  const context = vm.createContext({});
  const run = selectorResult => {
    context.document = { querySelector: () => selectorResult };
    vm.runInContext(extractFunction('readLeftDrawerOpen'), context);
    return context.readLeftDrawerOpen();
  };
  assert.equal(run(null), false);
  assert.equal(run({}), true, '抽屉模式且未收起 → 展开中');
  // 选择器本身必须排除 collapsed，避免把折叠成图标条的窄栏误判成遮罩。
  assert.match(extractFunction('readLeftDrawerOpen'), /\[data-sidebar-drawer\]:not\(\[data-sidebar-collapsed\]\)/);
});
