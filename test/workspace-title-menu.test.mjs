// v0.18.1：工作区标题（hover 态、菜单、原位改名）
//
// 覆盖点：
//   1. 标题从纯文本 span 升级为可聚焦按钮（hover 灰底、点击/右键开菜单）；
//   2. 菜单三项顺序固定，文案随宿主文件管理器变化，能力缺失时置灰并带原因；
//   3. 菜单坐标按视口夹取，菜单宽度/层级沿用既有 .hud-git-menu 体系；
//   4. 文本控件接入 IME 生命周期，编辑态不渲染取消/确认按钮。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { hudClient, moduleOf, nodes } from './helpers/client-harness.mjs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function slice(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `slice ${from}`);
  return source.slice(start, end);
}

/** 在独立 vm 上下文里执行「菜单项构建 + 坐标夹取」相关的真实源码。 */
function menuContext() {
  const context = vm.createContext({});
  vm.runInContext(slice('// —— 标题菜单项（v0.18.1）——', 'function panelVisibleModules'), context);
  vm.runInContext(slice('const HUD_MENU_WIDTH = 200;', '// —— HUD 开合状态'), context);
  return {
    context,
    workspaceMenuItems: vm.runInContext('workspaceMenuItems', context),
    sessionMenuItems: vm.runInContext('sessionMenuItems', context),
    clampMenuPosition: vm.runInContext('clampMenuPosition', context),
    menuAnchorFrom: vm.runInContext('menuAnchorFrom', context),
    constants: vm.runInContext('({ width: HUD_MENU_WIDTH, margin: HUD_MENU_MARGIN, item: HUD_MENU_ITEM_HEIGHT, divider: HUD_MENU_DIVIDER_HEIGHT, padding: HUD_MENU_PADDING })', context),
  };
}

const t = (key) => key;

const workingWorkspace = () => ({
  workspaceId: 'w1',
  path: '/work/session',
  title: 'Session',
  updatedAt: 2,
  sessionIds: ['sess'],
});

function workspaceClient(extra = {}) {
  return hudClient({
    state: { current: 'sess', byId: { sess: { cwd: '/work/session', updatedAt: 2, displayTitle: 'Session A' } } },
    current: 'sess',
    workspaces: [workingWorkspace()],
    ...extra,
  });
}

test('工作区标题是按钮：hover 灰底、点击与右键都能打开菜单', () => {
  const client = workspaceClient();
  const session = moduleOf(client.panel(), 'SessionModule');
  assert.equal(session.props.workspacePath, '/work/session');
  assert.equal(session.props.canRenameWorkspace, true);
  const title = moduleOf(session.type(session.props), 'WorkspaceTitle');
  assert.equal(typeof title.props.onRename, 'function');
  assert.equal(typeof title.props.onReveal, 'function');
  assert.equal(typeof title.props.onCopyPath, 'function');
  const tree = nodes(title.type(title.props));
  const button = tree.find((node) => node.props.className === 'hud-module-title hud-workspace-name');
  assert.equal(button.type, 'button');
  assert.equal(typeof button.props.onClick, 'function');
  assert.equal(typeof button.props.onContextMenu, 'function');
  assert.equal(button.props['aria-haspopup'], 'menu');
  // 标题仍带完整文本，省略号由 CSS 负责
  assert.equal(button.props.title, 'Session');
});

test('工作区标题不再渲染铅笔/确认类按钮，编辑态只有输入框', () => {
  const start = source.indexOf('function WorkspaceTitle(props)');
  const end = source.indexOf('function SessionTitleRow(props)', start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.equal(body.includes('hud-ic-btn'), false, '编辑态不得再出现取消/确认按钮');
  assert.equal(body.includes('react.createElement(Icon, { name: "close"'), false);
  assert.equal(body.includes('react.createElement(Icon, { name: "check"'), false);
  assert.match(body, /\.\.\.IME_INPUT_PROPS/);
  assert.match(body, /className: "hud-workspace-edit"/);
  // 失焦提交：文档级 pointerdown 监听，命中输入框内部则忽略
  assert.match(body, /addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(body, /removeEventListener\("pointerdown", onPointerDown, true\)/);
});

test('工作区菜单三项顺序固定，文案跟随宿主文件管理器', () => {
  const { workspaceMenuItems } = menuContext();
  const base = { t, workspacePath: '/work/session', canRename: true, desktopAvailable: true };
  for (const [fileManager, label] of [['finder', 'workspaceMenuRevealFinder'], ['explorer', 'workspaceMenuRevealExplorer'], ['directory', 'workspaceMenuRevealFolder'], [null, 'workspaceMenuRevealFolder']]) {
    const items = workspaceMenuItems({ ...base, fileManager });
    // vm 内构造的数组原型不同，先展开成本地数组再比较
    assert.deepEqual([...items.map((item) => item.key)], ['rename', 'reveal', 'copy-path']);
    assert.equal(items[1].label, label);
    assert.equal(items[1].icon.official, 'IconFolderOpenOutlineRegular');
    assert.equal(items[0].disabled, false);
    assert.equal(items[1].disabled, false);
    assert.equal(items[2].disabled, false);
  }
});

test('工作区菜单能力缺失时置灰并带原因，其余项照常可用', () => {
  const { workspaceMenuItems } = menuContext();
  const unregistered = workspaceMenuItems({ t, workspacePath: '/work/session', canRename: false, renameReason: 'workspaceRenameUnregistered', desktopAvailable: true, fileManager: 'finder' });
  assert.equal(unregistered[0].disabled, true);
  assert.equal(unregistered[0].reason, 'workspaceRenameUnregistered');
  assert.equal(unregistered[1].disabled, false);

  const noDesktop = workspaceMenuItems({ t, workspacePath: '/work/session', canRename: true, desktopAvailable: false, fileManager: null });
  assert.equal(noDesktop[1].disabled, true);
  assert.equal(noDesktop[1].reason, 'revealUnavailable');

  const noPath = workspaceMenuItems({ t, workspacePath: null, canRename: true, desktopAvailable: true });
  assert.equal(noPath[1].disabled, true);
  assert.equal(noPath[1].reason, 'workspacePathMissing');
  assert.equal(noPath[2].disabled, true);
  assert.equal(noPath[2].reason, 'workspacePathMissing');
});

test('工作区菜单项回调分别触发重命名、定位与复制', () => {
  const { workspaceMenuItems } = menuContext();
  const fired = [];
  const items = workspaceMenuItems({
    t,
    workspacePath: '/work/session',
    canRename: true,
    desktopAvailable: true,
    fileManager: 'finder',
    onRename: () => fired.push('rename'),
    onReveal: () => fired.push('reveal'),
    onCopyPath: () => fired.push('copy'),
  });
  items.forEach((item) => item.run());
  assert.deepEqual([...fired], ['rename', 'reveal', 'copy']);
});

test('菜单坐标夹取到视口内，未知视口保持原始坐标', () => {
  const { clampMenuPosition, constants } = menuContext();
  const viewportContext = menuContext();
  viewportContext.context.innerWidth = 800;
  viewportContext.context.innerHeight = 600;
  const clamped = viewportContext.clampMenuPosition(790, 590, 5, 1);
  const maxLeft = 800 - constants.width - constants.margin;
  const maxTop = 600 - (constants.padding + 5 * constants.item + constants.divider) - constants.margin;
  assert.equal(clamped.left, maxLeft);
  assert.equal(clamped.top, maxTop);

  const corner = viewportContext.clampMenuPosition(2, 3, 3, 0);
  assert.equal(corner.left, constants.margin);
  assert.equal(corner.top, constants.margin);

  const raw = clampMenuPosition(30, 40, 3, 0);
  assert.deepEqual({ left: raw.left, top: raw.top }, { left: 30, top: 40 });
});

test('菜单锚点优先鼠标位置，键盘触发退回元素左下角', () => {
  const { menuAnchorFrom } = menuContext();
  const point = (event) => { const anchor = menuAnchorFrom(event); return { x: anchor.x, y: anchor.y }; };
  assert.deepEqual(point({ clientX: 120, clientY: 240 }), { x: 120, y: 240 });
  const rect = { left: 40, bottom: 60 };
  assert.deepEqual(point({ clientX: 0, clientY: 0, currentTarget: { getBoundingClientRect: () => rect } }), { x: 40, y: 64 });
  assert.deepEqual(point(undefined), { x: 8, y: 8 });
});

test('工作区标题样式：hover 灰底、编辑输入框与置顶图钉都在样式表里', () => {
  const client = workspaceClient();
  const css = client.styles.join('');
  assert.match(css, /\.hud-workspace-name:hover:not\(:disabled\)\{background:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 8%,transparent\)\}/);
  assert.match(css, /\.hud-workspace-edit\{/);
  assert.match(css, /\.hud-pin-mark\{/);
  // 旧的「会话行里的确认按钮」样式必须移除
  assert.equal(css.includes('.hud-session-name-row .hud-ic-btn'), false);
});

/** 在最小 react 桩里执行真实的 HudMenu：验证菜单结构、置灰原因与点击顺序。 */
function renderMenu(items, options = {}) {
  const closed = [];
  const ran = [];
  const context = vm.createContext({
    react: {
      Fragment: 'fragment',
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useEffect: () => undefined,
    },
    react_dom: { createPortal: (node) => node },
    document: { body: {} },
    MenuIcon: () => null,
    Icon: () => null,
    isImeComposing: () => false,
  });
  vm.runInContext(slice('const HUD_MENU_WIDTH = 200;', '// —— HUD 开合状态'), context);
  const tree = vm.runInContext('HudMenu', context)({
    items,
    x: 20,
    y: 30,
    label: 'menu-label',
    onClose: () => closed.push(true),
  });
  const nodesOf = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return [];
    return [node, ...(node.children ?? []).flat(Infinity).flatMap(nodesOf)];
  };
  const all = nodesOf(tree);
  const menu = all.find((node) => node.props.role === 'menu');
  const buttons = all.filter((node) => node.props.role === 'menuitem');
  const backdrop = all.find((node) => node.props.style?.position === 'fixed' && node.props.style?.zIndex === 2147483004);
  return { menu, buttons, backdrop, closed, ran, all };
}

test('菜单渲染：portal 遮罩 + role=menu + 置灰项带原因，点击项先关闭再执行', async () => {
  const item = { key: 'k', label: 'label', icon: undefined, run: () => undefined };
  const built = menuContext().workspaceMenuItems({ t, workspacePath: '/work/session', canRename: false, renameReason: 'workspaceRenameUnregistered', desktopAvailable: true, fileManager: 'finder' });
  const rendered = renderMenu(built);
  assert.ok(rendered.backdrop, '需要有透明遮罩用于点击关闭');
  assert.ok(rendered.menu, 'role=menu 容器必须存在');
  assert.equal(rendered.menu.props['aria-label'], 'menu-label');
  assert.equal(rendered.menu.props.style.width, 200);
  assert.equal(rendered.buttons.length, 3);
  assert.equal(rendered.buttons[0].props.disabled, true);
  assert.equal(rendered.buttons[0].props.title, 'workspaceRenameUnregistered');
  assert.equal(rendered.buttons[1].props.disabled, false);

  const fired = [];
  const live = renderMenu([{ ...item, run: () => fired.push('run') }]);
  live.buttons[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(fired, ['run']);
  assert.equal(live.closed.length, 1);

  // 置灰项点击：不执行、不关闭
  const disabled = renderMenu([{ ...item, disabled: true, reason: 'why', run: () => fired.push('bad') }]);
  disabled.buttons[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(fired, ['run']);
  assert.equal(disabled.closed.length, 0);
});

test('v0.18.7：复制路径项前有分割线，与改名/显示分组', () => {
  const { workspaceMenuItems } = menuContext();
  const items = workspaceMenuItems({ t, workspacePath: '/work/session', canRename: true, desktopAvailable: true, fileManager: 'finder' });
  // 三项顺序不变，只有复制项前插入分割线（HudMenu 已支持 separatorBefore）
  assert.deepEqual([...items.map((item) => item.key)], ['rename', 'reveal', 'copy-path']);
  assert.deepEqual([...items.map((item) => item.separatorBefore === true)], [false, false, true]);
  // 分割线复用现有样式，不新增类名
  assert.equal(source.includes('.hud-menu-divider'), false);
  assert.match(source, /\.hud-git-menu-divider\{flex:none;height:1px;/);
});
