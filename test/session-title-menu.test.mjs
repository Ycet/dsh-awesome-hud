// v0.18.1：会话名称行（菜单、置顶图钉、原位改名）
//
// 覆盖点：
//   1. 会话名称是按钮（hover 灰底、点击开菜单），编辑态不再渲染取消/确认按钮；
//   2. 菜单五项顺序与分隔线固定，置顶项文案/图标随状态切换，不显示快捷键提示；
//   3. 置顶后名称右侧出现图钉；能力缺失项置灰并带原因；
//   4. 面板把置顶/分支/复制回调接到官方客户端服务上（uiWorkspace / clipboard）。
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

function sessionMenuBuilder() {
  const context = vm.createContext({});
  vm.runInContext(slice('// —— 标题菜单项（v0.18.1）——', 'function panelVisibleModules'), context);
  return vm.runInContext('sessionMenuItems', context);
}

const t = (key) => key;

/** 官方客户端服务的桩：记录调用，验证面板确实走官方接口。 */
function officialStubs() {
  const calls = [];
  return {
    calls,
    uiWorkspace: {
      pinSession: async (id) => { calls.push(['pin', id]); },
      unpinSession: async (id) => { calls.push(['unpin', id]); },
      forkSession: async (id, onCreated, options) => { calls.push(['fork', id, options?.allowMigration]); return 'child'; },
      archiveSession: async (id) => { calls.push(['archive', id]); },
    },
    workspaces: {
      rename: async (id, title) => { calls.push(['rename', id, title]); return {}; },
    },
  };
}

function sessionClient(options = {}) {
  const stubs = officialStubs();
  const client = hudClient({
    state: { current: 'sess', byId: { sess: { cwd: '/work/session', updatedAt: 2, displayTitle: 'Session A' } } },
    current: 'sess',
    workspaces: [{ workspaceId: 'w1', path: '/work/session', title: 'Session', updatedAt: 2, sessionIds: ['sess'] }],
    workspaceApi: stubs.workspaces,
    extraServices: { uiWorkspace: stubs.uiWorkspace },
    ...options,
  });
  return { client, stubs };
}

test('会话名称是按钮：hover 灰底、点击与右键都能打开菜单', () => {
  const { client } = sessionClient();
  const session = moduleOf(client.panel(), 'SessionModule');
  assert.equal(session.props.hasSession, true);
  assert.equal(session.props.sessionTitle, 'Session A');
  assert.equal(session.props.canPin, true);
  assert.equal(session.props.canFork, true);
  assert.equal(typeof session.props.onTogglePin, 'function');
  assert.equal(typeof session.props.onFork, 'function');
  assert.equal(typeof session.props.onCopySessionId, 'function');
  assert.equal(typeof session.props.onCopySessionName, 'function');
  const row = moduleOf(session.type(session.props), 'SessionTitleRow');
  const tree = nodes(row.type(row.props));
  const button = tree.find((node) => node.props.className === 'hud-session-name');
  assert.equal(button.type, 'button');
  assert.equal(typeof button.props.onClick, 'function');
  assert.equal(typeof button.props.onContextMenu, 'function');
  assert.equal(button.props['aria-haspopup'], 'menu');
  assert.equal(button.props.title, 'Session A');
  // 未置顶时不渲染图钉
  assert.equal(tree.some((node) => node.props.className === 'hud-pin-mark'), false);
});

test('会话名称编辑态只有输入框：不再有取消/确认按钮', () => {
  const start = source.indexOf('function SessionTitleRow(props)');
  const end = source.indexOf('/** 当前会话累计输入 token 中', start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.equal(body.includes('hud-ic-btn'), false, '编辑态不得再出现取消/确认按钮');
  assert.equal(body.includes('Icon, { name: "close"'), false);
  assert.equal(body.includes('Icon, { name: "check"'), false);
  assert.match(body, /\.\.\.IME_INPUT_PROPS/);
  assert.match(body, /className: "hud-session-edit"/);
  assert.match(body, /addEventListener\("pointerdown", onPointerDown, true\)/);
});

test('会话菜单六项顺序固定：置顶、重命名、分支、复制 ID、复制名称、归档', () => {
  const sessionMenuItems = sessionMenuBuilder();
  const items = sessionMenuItems({ t, pinned: false, canPin: true, canRename: true, canFork: true, canCopy: true, canArchive: true });
  assert.deepEqual([...items.map((item) => item.key)], ['pin', 'rename', 'fork', 'copy-id', 'copy-name', 'archive']);
  // v0.19.2：复制类操作之前一处、归档之前一处，共两条分割线。
  assert.deepEqual([...items.map((item) => item.separatorBefore === true)], [false, false, false, true, false, true]);
  assert.equal(items[0].label, 'sessionMenuPin');
  assert.equal(items[0].icon.official, 'IconPinOutlineRegular');
  assert.equal(items[1].label, 'sessionMenuRename');
  assert.equal(items[2].label, 'sessionMenuFork');
  assert.equal(items[3].label, 'sessionMenuCopyId');
  assert.equal(items[4].label, 'sessionMenuCopyName');
  assert.equal(items[5].label, 'sessionMenuArchive');
  assert.equal(items[5].icon.official, 'IconArchiveOutlineRegular');
  // 不提供 ⌘G/⌘F 提示：菜单项里不得出现快捷键字段
  for (const item of items) assert.equal('shortcut' in item || 'hint' in item, false);
});

test('置顶项按状态切换文案与图标，已置顶时回调请求取消置顶', () => {
  const sessionMenuItems = sessionMenuBuilder();
  const pinned = sessionMenuItems({ t, pinned: true, canPin: true, canRename: true, canFork: true, canCopy: true });
  assert.equal(pinned[0].label, 'sessionMenuUnpin');
  assert.equal(pinned[0].icon.official, 'IconPinFillRegular');
  const fired = [];
  sessionMenuItems({ t, pinned: true, canPin: true, onTogglePin: (next) => fired.push(next) })[0].run();
  sessionMenuItems({ t, pinned: false, canPin: true, onTogglePin: (next) => fired.push(next) })[0].run();
  assert.deepEqual([...fired], [false, true]);
});

test('会话菜单能力缺失时置灰并带原因', () => {
  const sessionMenuItems = sessionMenuBuilder();
  const archived = sessionMenuItems({ t, pinned: false, canPin: false, pinReason: 'sessionPinArchived', canRename: false, canFork: false, canCopy: false });
  assert.equal(archived[0].disabled, true);
  assert.equal(archived[0].reason, 'sessionPinArchived');
  assert.equal(archived[1].disabled, true);
  assert.equal(archived[1].reason, 'sessionRenameUnavailable');
  assert.equal(archived[2].disabled, true);
  assert.equal(archived[2].reason, 'sessionForkUnavailable');
  assert.equal(archived[3].disabled, true);
  assert.equal(archived[4].disabled, true);
  assert.equal(archived[5].disabled, true, '归档项在能力缺失时置灰');
  assert.equal(archived[5].reason, 'sessionArchiveUnavailable');
  // 已归档的会话给更准确的原因。
  const archivedSession = sessionMenuItems({ t, canArchive: false, archived: true });
  assert.equal(archivedSession[5].reason, 'sessionArchiveArchived');
  // 默认原因：未给出 pinReason 时使用「服务不可用」
  const offline = sessionMenuItems({ t, canPin: false });
  assert.equal(offline[0].reason, 'sessionPinUnavailable');
});

test('置顶后名称右侧渲染图钉，未置顶不渲染', () => {
  const pinnedClient = sessionClient({ pinnedSessions: ['sess'] });
  const session = moduleOf(pinnedClient.client.panel(), 'SessionModule');
  assert.equal(session.props.pinned, true);
  const row = moduleOf(session.type(session.props), 'SessionTitleRow');
  const tree = nodes(row.type(row.props));
  assert.equal(tree.some((node) => node.props.className === 'hud-pin-mark'), true);

  const plain = sessionClient();
  const plainSession = moduleOf(plain.client.panel(), 'SessionModule');
  assert.equal(plainSession.props.pinned, false);
  const plainRow = moduleOf(plainSession.type(plainSession.props), 'SessionTitleRow');
  assert.equal(nodes(plainRow.type(plainRow.props)).some((node) => node.props.className === 'hud-pin-mark'), false);
});

test('面板把置顶/分支/改名/复制接到官方客户端服务上', async () => {
  const { client, stubs } = sessionClient();
  const session = moduleOf(client.panel(), 'SessionModule');
  await session.props.onTogglePin(true);
  await session.props.onTogglePin(false);
  await session.props.onFork();
  await session.props.onArchive();
  await session.props.onRenameWorkspace('Renamed workspace');
  assert.deepEqual(stubs.calls[0], ['pin', 'sess']);
  assert.deepEqual(stubs.calls[1], ['unpin', 'sess']);
  assert.deepEqual(stubs.calls[2], ['fork', 'sess', false]);
  // v0.19.2：归档走官方 uiWorkspace.archiveSession(sessionId)
  assert.deepEqual(stubs.calls[3], ['archive', 'sess']);
  // 工作区改名走官方 workspaces.rename(workspaceId, title)
  assert.deepEqual(stubs.calls[4], ['rename', 'w1', 'Renamed workspace']);
});

test('会话改名走 ISession.rename，成功后列表标题自动刷新', async () => {
  const renames = [];
  const client = hudClient({
    state: { current: 'sess', byId: { sess: { cwd: '/work/session', updatedAt: 2, displayTitle: 'Session A' } } },
    current: 'sess',
    workspaces: [{ workspaceId: 'w1', path: '/work/session', title: 'Session', updatedAt: 2, sessionIds: ['sess'] }],
    extraServices: {
      sessions: {
        list: { getSnapshot: () => ({ current: 'sess', byId: { sess: { cwd: '/work/session', updatedAt: 2, displayTitle: 'Session A' } } }), subscribe: () => () => {} },
        binding: () => ({ session: { rename: async (title) => { renames.push(title); return { ok: true }; } } }),
      },
    },
  });
  const session = moduleOf(client.panel(), 'SessionModule');
  await session.props.onRename('Renamed');
  assert.deepEqual([...renames], ['Renamed']);
});

test('v0.18.7：会话名称的悬浮/点击热区覆盖整行（右侧状态区与图钉仍占位）', () => {
  // 名称按钮从「按文字收缩」改为撑满整行剩余宽度；长度仍由 ellipsis 处理，高度不变。
  assert.match(source, /\.hud-session-name\{flex:1 1 auto\}/);
  assert.match(source, /\.hud-session-name\{box-sizing:border-box;display:block;font:inherit;font-weight:500;font-size:13px;line-height:20px;min-width:0;max-width:100%;flex:0 1 auto;/);
  // 工作区名称本来就是整行（flex:1 1 auto），一并写明防止回归
  assert.match(source, /\.hud-workspace-name\{flex:1 1 auto\}/);
  // 右侧状态胶囊靠 margin-left:auto 仍在最右，不会被名称按钮挤走
  assert.match(source, /\.hud-session-name-row \.hud-chip\{margin-left:auto\}/);
});

test('v0.18.7：会话菜单「复制名称」文案与上一项同一大小写规则', () => {
  const client = hudClient();
  const [dicts] = client.dictionaries;
  assert.equal(dicts.en.sessionMenuCopyName, 'Copy Session Name');
  assert.equal(dicts.en.sessionMenuCopyId, 'Copy Session ID');
  // 中文没有大小写问题，保持原文案
  assert.equal(dicts.zh.sessionMenuCopyName, '复制会话名称');
});
