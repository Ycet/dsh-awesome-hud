import test from 'node:test';
import assert from 'node:assert/strict';
import { hudClient, moduleOf, nodes, settled } from './helpers/client-harness.mjs';

const older = 'C:\\work\\older', recent = 'C:\\work\\recent';
const fixture = {
  state: { current: 'old', byId: { old: { cwd: older, updatedAt: 1 }, new: { cwd: recent, updatedAt: 9 } } },
  workspaces: [
    { path: older, title: 'Older', updatedAt: 1, sessionIds: ['old'] },
    { path: recent, title: 'Recent', updatedAt: 9, sessionIds: ['new'] },
  ], windows: true,
};

test('Windows 新建页入口使用当前视图，点击开关且不写会话开合记忆', () => {
  const client = hudClient(fixture);
  assert.ok(client.button(), '列表保留旧 current 时，新建页仍须有入口');
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  client.button().props.onClick();
  assert.ok(client.panel());
  client.button().props.onClick();
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  assert.equal(client.persisted.has('dsh-awesome-hud:open'), false);
});

test('新建页便笺、待办、Git 与发送目标使用同一最近工作区，读取原有 Windows 存储', async () => {
  const client = hudClient({ ...fixture, storage: {
    'dsh-awesome-hud:notes': JSON.stringify({ [older]: { text: '旧便笺' }, [recent]: { text: '最近便笺', height: 180 } }),
    'dsh-awesome-hud:todos': JSON.stringify({ [recent]: [{ id: 'task', text: '最近待办', done: false }] }),
  } });
  client.button().props.onClick();
  const panel = client.panel();
  const note = moduleOf(panel, 'NoteModule'), todo = moduleOf(panel, 'TodoModule');
  assert.equal(note.props.workspaceKey, recent);
  assert.equal(todo.props.workspaceKey, recent);
  assert.equal(note.props.sendSessionId, 'new');
  assert.equal(nodes(note.type(note.props)).find(node => node.type === 'textarea').props.value, '最近便笺');
  assert.ok(nodes(todo.type(todo.props)).some(node => node.children?.includes('最近待办')));
  client.runPolls(); await settled();
  const git = client.calls.find(call => call.url.endsWith('/git'));
  assert.equal(git.payload.sessionId, 'new');
});

test('新建页无工作区、无任何会话也须加载全局 MCP，并显示空状态', async () => {
  const client = hudClient({ windows: true });
  client.button().props.onClick(); client.panel();
  client.runPolls(); await settled();
  assert.ok(client.calls.some(call => call.url.endsWith('/mcp')));
  const mcp = moduleOf(client.panel(), 'McpModule');
  assert.ok(mcp);
  assert.equal(mcp.props.total, 0);
  assert.equal(moduleOf(client.panel(), 'SessionModule').props.workspaceTitle, 'workspaceFallback');
  const session = moduleOf(client.panel(), 'SessionModule');
  const rename = moduleOf(session.type(session.props), 'RenameSessionName');
  assert.equal(nodes(rename.type(rename.props)).find(node => node.props.className === 'hud-session-rename-btn').props.disabled, true);
  assert.equal(client.calls.some(call => call.url.endsWith('/git')), false);
});

test('新建页全局 MCP 初次加载、轮询和启停不依赖代理会话', async () => {
  const servers = [{ name: 'server', enabled: true }];
  const client = hudClient({ ...fixture, respond: call => {
    if (call.url.endsWith('/mcp/toggle')) return { ok: true, servers: [{ name: 'server', enabled: false }], total: 1, enabled: 0 };
    return call.url.endsWith('/mcp') ? { ok: true, servers, total: 1, enabled: 1 } : { ok: true, isRepo: true };
  } });
  client.button().props.onClick(); client.panel();
  const cleanups = client.runPolls(); await settled();
  const initial = client.calls.filter(call => call.url.endsWith('/mcp'));
  assert.equal(initial.length, 1);
  assert.equal(initial[0].payload.sessionId, undefined);
  for (const refresh of client.intervals.values()) refresh();
  await settled();
  assert.equal(client.calls.filter(call => call.url.endsWith('/mcp')).length, 2);
  const mcp = moduleOf(client.panel(), 'McpModule');
  assert.equal(mcp.props.servers[0].name, 'server');
  const toggle = nodes(mcp.type(mcp.props)).find(node => node.props.className === 'hud-switch');
  await toggle.props.onClick();
  const request = client.calls.find(call => call.url.endsWith('/mcp/toggle'));
  assert.equal(request.payload.server, 'server');
  assert.equal(request.payload.enabled, false);
  assert.equal(request.payload.sessionId, undefined);
  assert.equal(moduleOf(client.panel(), 'McpModule').props.enabled, 0);
  for (const cleanup of cleanups) cleanup?.();
  assert.equal(client.intervals.size, 0);
});

test('MCP 离线保留全局快照，面板卸载后晚到响应不得更新缓存', async () => {
  let fail = false, release;
  const client = hudClient({ respond: async () => {
    if (fail) throw new Error('offline');
    return { ok: true, servers: [{ name: 'cached', enabled: true }], total: 1, enabled: 1 };
  } });
  client.button().props.onClick(); client.panel();
  const cleanups = client.runPolls(); await settled();
  fail = true;
  for (const refresh of client.intervals.values()) refresh();
  await settled();
  assert.equal(moduleOf(client.panel(), 'McpModule').props.total, 1);
  for (const cleanup of cleanups) cleanup?.();

  const late = hudClient({ respond: () => new Promise(resolve => { release = resolve; }) });
  late.button().props.onClick(); late.panel();
  const stops = late.runPolls();
  for (const stop of stops) stop?.();
  release({ ok: true, servers: [], total: 99 });
  await settled();
  assert.equal(moduleOf(late.panel(), 'McpModule'), undefined);
});

test('绑定的空白会话仍提供新建页入口与工作区数据', () => {
  const state = { current: 'blank', byId: { blank: { blank: true, cwd: recent } } };
  const client = hudClient({ state, current: 'blank', workspaces: fixture.workspaces, windows: true });
  assert.ok(client.button());
  client.button().props.onClick();
  assert.equal(moduleOf(client.panel(), 'NoteModule').props.workspaceKey, recent);
});

test('新建页与右侧栏互斥：收起右侧栏不会绕过该页默认收起的守卫', () => {
  const client = hudClient(fixture);
  let expanded = false;
  client.services.sidebarRight = { isExpanded: () => expanded };
  const dispose = client.startSidebarWatcher();
  client.button().props.onClick();
  assert.ok(moduleOf(client.root(), 'HudPanel'));
  expanded = true; client.notifyDOM();
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  expanded = false; client.notifyDOM();
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  dispose();
});

test('Windows 新建页面板位于原生标题栏及入口按钮下方，全屏不保留标题栏空隙', () => {
  for (const [fullscreen, minimumTop] of [[false, 92], [true, 52]]) {
    const client = hudClient({ ...fixture, fullscreen });
    client.button().props.onClick();
    assert.equal(client.panel().props.style.top, minimumTop);
  }
});

test('Windows 未登记工作区的会话标题仅显示目录名，保留原路径作为数据键', () => {
  const client = hudClient({ state: { byId: { session: { cwd: 'C:\\work\\项目目录\\' } } }, current: 'session', windows: true });
  const panel = client.panel();
  assert.equal(moduleOf(panel, 'SessionModule').props.workspaceTitle, '项目目录');
  assert.equal(moduleOf(panel, 'NoteModule').props.workspaceKey, 'C:\\work\\项目目录\\');
});
