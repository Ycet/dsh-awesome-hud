// dsh-awesome-hud — v0.20.0：「HUD 面板样式」（卡片样式 / 边栏样式，默认卡片样式）
// 覆盖：host schema 默认值与收敛、客户端镜像与旧宿主兼容、两种样式的几何与滚动条补偿、
//      纯函数（顶部 / 左锚点）、CSS 变体、设置行顺序与说明页文案。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  PANEL_STYLES, defaultPanelSettings, normalizePanelSettings, sanitizePanelPatch, panelSettingsOf,
  defaultSettings, isDefaultSettings,
} from '../lib/settings.js';
import { Config } from '../lib/index.js';
import { hudClient, nodes, extractFunction, clientSource } from './helpers/client-harness.mjs';

const PANEL_KEY = 'dsh-awesome-hud:panel';
const cardPrefs = JSON.stringify({ style: 'card', side: 'right', newSessionOpen: true, chatOpen: true });
const sidebarPrefs = JSON.stringify({ style: 'sidebar', side: 'right', newSessionOpen: true, chatOpen: true });
const sidebarLeftPrefs = JSON.stringify({ style: 'sidebar', side: 'left', newSessionOpen: true, chatOpen: true });

/** 构造几何 effect 需要的最小 DOM（与会话页/新建页共用的那一套）。 */
function makeDom({ anchorLeft = 256, headerBottom = 60 } = {}) {
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
    getBoundingClientRect: () => ({ left: anchorLeft, right: 1200, bottom: headerBottom, top: 0 }),
  };
  const sessionHost = { closest: selector => (selector === '[data-phase]' ? root : null) };
  return { seat, body, scroll, root, header, sessionHost };
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
  const rendered = () => nodes(client.root()).some(node => node?.type?.name === 'HudPanel');
  if (!rendered()) client.button().props.onClick();
  assert.ok(rendered(), '面板应处于展开态');
  const panel = client.panel();
  const geometry = client.effects.find(fn => String(fn).includes('data-conversation-header-corner'));
  assert.ok(geometry, '几何让位 effect 必须注册');
  return { panel, geometry };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('host：schema 默认卡片样式，收敛/白名单同规则', () => {
  assert.deepEqual([...PANEL_STYLES], ['card', 'sidebar']);
  // schema 字段存在且默认 card（默认值由 settings.js 收敛保证合法）。
  assert.equal(Config.dict.panel.dict.style.meta.default, 'card');
  assert.equal(defaultPanelSettings().style, 'card');
  assert.equal(normalizePanelSettings({ style: 'sidebar' }).style, 'sidebar');
  assert.equal(normalizePanelSettings({ style: 'wide' }).style, 'card', '未知样式回落 card');
  assert.deepEqual(sanitizePanelPatch({ style: 'sidebar', side: 'left' }), { patch: { style: 'sidebar', side: 'left' }, changed: false });
  assert.equal(sanitizePanelPatch({ style: 'wide' }), null);
  assert.equal(sanitizePanelPatch({ style: 1 }), null);
  assert.equal(panelSettingsOf({ panel: { style: 'sidebar' } }).style, 'sidebar');
  // 换样式同样算「已改动」，参与「恢复默认」激活判定。
  assert.equal(isDefaultSettings({ ...defaultSettings(), panel: { ...defaultPanelSettings(), style: 'sidebar' } }), false);
  assert.equal(isDefaultSettings(defaultSettings()), true);
});

test('客户端纯函数：顶部与左锚点按样式区分（卡片留 8px，边栏贴边）', () => {
  const context = vm.createContext({ HUD_PANEL_GAP: 8, HUD_FLOAT_INSET: 12, HUD_FLOAT_SLOT_SIZE: 28 });
  vm.runInContext(`${extractFunction('hudChromeRowBottom')}\n${extractFunction('hudPanelTop')}\n${extractFunction('hudPanelLeft')}`, context);

  // 页眉下沿 60、最小顶部 52：卡片 = 68（60 + 8），边栏 = 60（贴页眉下沿）。
  assert.equal(context.hudPanelTop(52, 60, 'card'), 68);
  assert.equal(context.hudPanelTop(52, 60, 'sidebar'), 60);
  // 没有页眉（新建会话页）：卡片样式仍用 52 基线；边栏样式从顶部 chrome 行下沿起（12 + 28 = 40），
  // 不再沿用 52 —— 否则会在面板上方留下 12px 空隙（v0.20.0 修复）。
  assert.equal(context.hudPanelTop(52, undefined, 'card'), 52);
  assert.equal(context.hudChromeRowBottom(0), 40);
  assert.equal(context.hudChromeRowBottom(40), 80, 'Windows 标题栏下移同样的高度');
  assert.equal(context.hudPanelTop(52, undefined, 'sidebar', context.hudChromeRowBottom(0)), 40);
  assert.equal(context.hudPanelTop(92, undefined, 'sidebar', context.hudChromeRowBottom(40)), 80);
  // 页眉存在时边栏样式只跟页眉下沿（不再受 52 基线影响）。
  assert.equal(context.hudPanelTop(52, 60, 'sidebar', 40), 60);

  // 左锚点：卡片 +8，边栏贴会话区左缘，且不为负。
  assert.equal(context.hudPanelLeft(256, 'card'), 264);
  assert.equal(context.hudPanelLeft(256, 'sidebar'), 256);
  assert.equal(context.hudPanelLeft(0, 'sidebar'), 0);
});

test('新建会话页：边栏样式首帧顶部贴顶部 chrome 行下沿（卡片样式仍是 52 基线）', () => {
  // 没有 DOM：该页既无会话页眉，也测不到会话根节点，只能靠首帧起算值。
  const sidebar = hudClient({ storage: { [PANEL_KEY]: sidebarPrefs } });
  assert.equal(openPanel(sidebar).panel.props.style.top, 40, '边栏样式：12px 内边距 + 28px 按钮高');
  const sidebarWindows = hudClient({ storage: { [PANEL_KEY]: sidebarPrefs }, windows: true });
  assert.equal(openPanel(sidebarWindows).panel.props.style.top, 80, 'Windows 标题栏下移 40px');

  const card = hudClient({ storage: { [PANEL_KEY]: cardPrefs } });
  assert.equal(openPanel(card).panel.props.style.top, 52, '卡片样式保持既有 52px 基线');
  // 几何 effect 也按同一 chrome 行下沿计算（有 DOM 时以实际测量为准）。
  assert.match(clientSource, /hudPanelTop\(minimumTop, headRect\?\.bottom, pushStyle, hudChromeRowBottom\(hudChromeTop\(\)\)\)/);
});

test('默认卡片样式：右侧 8px、限高仍在、滚动容器补回窗口右缘', () => {
  const dom = makeDom();
  const client = hudClient({ storage: { [PANEL_KEY]: cardPrefs }, querySelector: selectorMap(dom) });
  const { panel, geometry } = openPanel(client);

  assert.equal(panel.props['data-style'], 'card');
  assert.equal(panel.props.style.right, '8px');
  assert.equal(panel.props.style.bottom, undefined, '卡片样式不设 bottom');
  geometry();
  // v0.18.2 既定行为：正文让位 + 滚动容器补回窗口右缘 + 浮层座位收窄。
  assert.equal(dom.body.style.peek('margin-right'), '300px');
  assert.equal(dom.scroll.style.peek('margin-right'), '-300px');
  assert.equal(dom.scroll.style.peek('padding-right'), '300px');
  assert.equal(dom.seat.style.peek('margin-right'), '300px');
});

test('边栏样式：通高贴边（bottom:0、无 maxHeight、右侧 0px）', () => {
  const dom = makeDom();
  const client = hudClient({ storage: { [PANEL_KEY]: sidebarPrefs }, querySelector: selectorMap(dom) });
  const { panel, geometry } = openPanel(client);

  assert.equal(panel.props['data-style'], 'sidebar');
  assert.equal(panel.props.style.right, '0px', '贴窗口右缘');
  assert.equal(panel.props.style.left, 'auto');
  assert.equal(panel.props.style.bottom, 0, '底部通到视口底部');
  assert.equal(panel.props.style.maxHeight, 'none', '边栏不受输入框底部限高');
  geometry();
  // 正文照常让位，但滚动容器不再向窗口右缘补回：滚动条停在内容区右缘、紧贴分隔线。
  assert.equal(dom.body.style.peek('margin-right'), '300px');
  assert.equal(dom.scroll.style.peek('margin-right'), '');
  assert.equal(dom.scroll.style.peek('padding-right'), '');
  // 轨迹/统计浮层座位的收窄与样式无关（绝对定位元素仍需单独让位）。
  assert.equal(dom.seat.style.peek('margin-right'), '300px');
});

test('边栏样式左侧镜像：贴会话区左缘（不含 8px），正文收左', () => {
  const dom = makeDom({ anchorLeft: 256 });
  const client = hudClient({ storage: { [PANEL_KEY]: sidebarLeftPrefs }, querySelector: selectorMap(dom) });
  const { geometry } = openPanel(client);
  geometry();
  // 左锚点写入模块级缓存，重渲染即可见（首次渲染用兜底值）。
  const anchored = client.panel();
  assert.equal(anchored.props['data-side'], 'left');
  assert.equal(anchored.props['data-style'], 'sidebar');
  assert.equal(anchored.props.style.left, '256px', '边栏样式贴会话区左缘，不再留 8px');
  assert.equal(anchored.props.style.right, 'auto');
  assert.equal(dom.body.style.peek('margin-left'), '300px');
  assert.equal(dom.body.style.peek('margin-right'), '');
  assert.equal(dom.scroll.style.peek('margin-left'), '', '滚动条补偿在边栏样式下一并取消');
  assert.equal(dom.seat.style.peek('margin-left'), '300px');
});

test('边栏样式卸载时还原写入；切回卡片样式会重新补回滚动容器', () => {
  const dom = makeDom();
  const client = hudClient({ storage: { [PANEL_KEY]: sidebarPrefs }, querySelector: selectorMap(dom) });
  const { geometry } = openPanel(client);
  const cleanup = geometry();
  assert.equal(dom.body.style.peek('margin-right'), '300px');
  cleanup();
  assert.equal(dom.body.style.peek('margin-right'), '', '卸载后正文恢复全宽');
  assert.equal(dom.scroll.style.peek('margin-right'), '', '边栏样式从未写过滚动容器补偿');

  // 切回卡片样式（新挂载）：滚动容器补偿重新写入。
  const cardDom = makeDom();
  const cardClient = hudClient({ storage: { [PANEL_KEY]: cardPrefs }, querySelector: selectorMap(cardDom) });
  const cardGeometry = openPanel(cardClient).geometry;
  cardGeometry();
  assert.equal(cardDom.scroll.style.peek('margin-right'), '-300px');
});

test('旧宿主（响应无 style）不会把边栏样式打回卡片', async () => {
  const dom = makeDom();
  const client = hudClient({
    storage: { [PANEL_KEY]: sidebarPrefs },
    querySelector: selectorMap(dom),
    respond: call => (call.url.endsWith('/settings')
      // 旧宿主的 panel 段没有 style 字段。
      ? { ok: true, modules: {}, usage: {}, context: {}, order: [], panel: { side: 'right', newSessionOpen: true, chatOpen: true } }
      : { ok: true, servers: [], total: 0, enabled: 0, isRepo: true }),
  });
  const { panel } = openPanel(client);
  assert.equal(panel.props['data-style'], 'sidebar');
  for (const effect of client.effects) effect();
  await settle();
  await settle();
  assert.equal(client.panel().props['data-style'], 'sidebar', '旧宿主缺 style 时沿用当前样式');
  assert.equal(client.persisted.get(PANEL_KEY).includes('"sidebar"'), true, '镜像仍保留边栏样式');

  // 宿主明确给出 style 时以宿主为权威值。
  const hostDom = makeDom();
  const hostClient = hudClient({
    storage: { [PANEL_KEY]: sidebarPrefs },
    querySelector: selectorMap(hostDom),
    respond: call => (call.url.endsWith('/settings')
      ? { ok: true, modules: {}, usage: {}, context: {}, order: [], panel: { style: 'card', side: 'right', newSessionOpen: true, chatOpen: true } }
      : { ok: true, servers: [], total: 0, enabled: 0, isRepo: true }),
  });
  openPanel(hostClient);
  for (const effect of hostClient.effects) effect();
  await settle();
  await settle();
  assert.equal(hostClient.panel().props['data-style'], 'card', '宿主明确的样式覆盖本地镜像');
});

test('镜像容错：旧镜像无 style 用默认卡片，非法样式回落到卡片', () => {
  // v0.18.2 写下的旧镜像没有 style 字段：升级后默认卡片样式，外观不变。
  const legacy = hudClient({ storage: { [PANEL_KEY]: JSON.stringify({ side: 'right', newSessionOpen: true, chatOpen: true }) } });
  assert.equal(openPanel(legacy).panel.props['data-style'], 'card', '旧镜像（无 style）默认卡片样式');

  const broken = hudClient({ storage: { [PANEL_KEY]: JSON.stringify({ style: 'wide', side: 'right', newSessionOpen: true, chatOpen: true }) } });
  assert.equal(openPanel(broken).panel.props['data-style'], 'card', '未知样式回落卡片');

  // 镜像损坏时回落到默认设置（新建会话页默认收起），点开入口后仍按卡片样式渲染。
  const brokenJson = hudClient({ storage: { [PANEL_KEY]: '{not json' } });
  assert.equal(openPanel(brokenJson).panel.props['data-style'], 'card', '镜像损坏也不影响渲染');
});

test('CSS：边栏样式透明无圆角、朝向内容一侧 1px 官方边框色、模块间分隔线左右内缩 14px', () => {
  // 面板本体：去掉圆角卡片外观，只保留一条分隔线。
  assert.match(clientSource, /\.hud-panel\[data-style=sidebar\]\{border:0;border-radius:0;background:transparent;max-height:none\}/);
  assert.match(clientSource, /\.hud-panel\[data-style=sidebar\]\[data-side=right\]\{border-left:1px solid var\(--dsw-alias-border-l2\)\}/);
  assert.match(clientSource, /\.hud-panel\[data-style=sidebar\]\[data-side=left\]\{border-right:1px solid var\(--dsw-alias-border-l2\)\}/);
  // 内部模块分隔线：左右各缩进 14px 的浅色细线（颜色沿用 label-primary 9%）。
  assert.match(clientSource, /\.hud-panel\[data-style=sidebar\] \.hud-panel-body,\.hud-panel\[data-style=sidebar\] \.hud-panel-pin,\.hud-panel\[data-style=sidebar\] \.hud-panel-body>\.hud-section\{border-top:0;background-image:linear-gradient\(to right,transparent 14px,color-mix\(in srgb,var\(--dsw-alias-label-primary\) 9%,transparent\) 14px,/);
  assert.match(clientSource, /transparent calc\(100% - 14px\)\);background-repeat:no-repeat;background-size:100% 1px;background-position:left top\}/);
  assert.match(clientSource, /\.hud-panel\[data-style=sidebar\] \.hud-panel-body>\.hud-section:first-child\{background-image:none\}/);
  // 卡片样式的既有规则保持不动（圆角 14px + 主题描边）。
  assert.match(clientSource, /\.hud-panel\{position:fixed;width:300px;max-height:calc\(100vh - 24px\);display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;background:var\(--hud-surface-bg,var\(--dsw-static-neutral-bluish-00\)\);border:0\.5px solid var\(--dsw-alias-border-l2\);border-radius:14px;/);
});

test('设置行：HUD 面板样式位于 HUD 面板展开位置上方', () => {
  const styleIndex = clientSource.indexOf('id: "hud-settings-panel-style"');
  const sideIndex = clientSource.indexOf('id: "hud-settings-panel-side"');
  assert.ok(styleIndex > 0 && sideIndex > 0, '两个设置项必须存在');
  assert.ok(styleIndex < sideIndex, '样式行必须在侧位行之前渲染');
  assert.match(clientSource, /settingsPanelStyle: "HUD 面板样式",/);
  assert.match(clientSource, /settingsPanelStyleSidebar: "边栏样式",/);
  // 说明页：面板一节新增「面板样式」要点，中英成对。
  assert.match(clientSource, /guidePanelStyle: "在「HUD面板通用设置」里选择卡片样式或边栏样式。/);
  assert.match(clientSource, /guidePanelStyle: "Choose Card or Sidebar in “HUD panel general settings”\./);
  assert.match(clientSource, /items: \["guidePanelEntry", "guidePanelSide", "guidePanelStyle",/);
});
