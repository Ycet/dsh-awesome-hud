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
  const session = moduleOf(client.panel(), 'SessionModule');
  assert.equal(session.props.workspaceTitle, 'workspaceFallback');
  // v0.18.1：新建会话页不展示会话标题与状态徽标，只保留可点击的工作区标题。
  const tree = nodes(session.type(session.props));
  assert.equal(tree.some(node => node.props.className === 'hud-session-name-row'), false);
  assert.equal(tree.some(node => node.props.className === 'hud-session-name'), false);
  const workspaceTitle = moduleOf(session.type(session.props), 'WorkspaceTitle');
  const workspaceName = nodes(workspaceTitle.type(workspaceTitle.props)).find(node => node.props.className === 'hud-module-title hud-workspace-name');
  assert.equal(workspaceName.type, 'button');
  assert.equal(typeof workspaceName.props.onClick, 'function');
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

test('新建页与右侧栏互斥：展开即隐藏悬浮入口与面板，关闭后恢复该页手动展开的状态', () => {
  const client = hudClient(fixture);
  let expanded = false;
  client.services.sidebarRight = { isExpanded: () => expanded };
  const dispose = client.startSidebarWatcher();
  client.button().props.onClick();
  assert.ok(moduleOf(client.root(), 'HudPanel'));
  assert.equal(client.button().props['data-open'], true);
  expanded = true; client.notifyDOM();
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  // 右侧栏展开期间该页不展示悬浮入口（不再移到侧栏左侧），避免按钮悬在侧栏边缘。
  assert.equal(client.button(), null, '侧栏展开期间不得渲染「HUD面板」悬浮入口');
  expanded = false; client.notifyDOM();
  assert.ok(moduleOf(client.root(), 'HudPanel'), '关闭侧栏后应恢复该页的展开记忆');
  assert.equal(client.button().props['data-open'], true, '关闭侧栏后悬浮入口恢复并与展开状态一致');
  dispose();
});

test('新建页发送首条消息且右侧栏仍展开：HUD 派生隐藏且不推挤正文，关闭侧栏后恢复', () => {
  const state = { byId: { sess: { cwd: recent, updatedAt: 2 } } }; // 新建页：无 current
  const client = hudClient({ state, workspaces: fixture.workspaces, windows: true });
  let expanded = false;
  client.services.sidebarRight = { isExpanded: () => expanded };
  const dispose = client.startSidebarWatcher();
  client.button().props.onClick();               // 新建页手动展开 HUD（仅内存态）
  assert.ok(moduleOf(client.root(), 'HudPanel'));
  expanded = true; client.notifyDOM();            // 打开右侧栏 → HUD 派生隐藏
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  client.setSession('sess');                      // 发送首条消息 → 进入真实会话
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined, '侧栏仍展开时不得露出 HUD');
  assert.equal(client.effects.some(effect => String(effect).includes('margin-right')), false,
    'HUD 不可见时不得给正文写 margin-right 推挤');
  expanded = false; client.notifyDOM();           // 关闭右侧栏 → 按会话展开记忆恢复
  assert.ok(moduleOf(client.root(), 'HudPanel'));
  dispose();
});

test('真实会话右侧栏展开：首帧不渲染 HUD，关闭侧栏后恢复', () => {
  const client = hudClient({ state: { current: 'sess', byId: { sess: { cwd: recent, updatedAt: 2 } } }, current: 'sess', workspaces: fixture.workspaces });
  let expanded = true;
  client.services.sidebarRight = { isExpanded: () => expanded };
  const dispose = client.startSidebarWatcher();
  assert.equal(moduleOf(client.root(), 'HudPanel'), undefined);
  assert.equal(client.effects.some(effect => String(effect).includes('margin-right')), false);
  expanded = false; client.notifyDOM();
  assert.ok(moduleOf(client.root(), 'HudPanel'));
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

test('MCP 启停后，早于点击发出的旧轮询响应不得把开关回滚', async () => {
  let polls = 0, releaseOld;
  const oldPoll = new Promise(resolve => { releaseOld = resolve; });
  const client = hudClient({ windows: true, respond: call => {
    if (call.url.endsWith('/mcp/toggle')) {
      // 启停完成即返回权威快照（host 已等待 profile 热重载）。
      return { ok: true, servers: [{ name: 'server', enabled: false }], total: 1, enabled: 0, message: '已全局禁用' };
    }
    if (call.url.endsWith('/mcp')) {
      polls += 1;
      // 第一次：初始状态；第二次：切换前发出的旧轮询，故意晚于启停响应返回。
      return polls === 1 ? { ok: true, servers: [{ name: 'server', enabled: true }], total: 1, enabled: 1 } : oldPoll;
    }
    return { ok: true, isRepo: true };
  } });
  client.button().props.onClick();
  client.panel(); client.runPolls(); await settled(); // 初始快照：启用
  assert.equal(moduleOf(client.panel(), 'McpModule').props.enabled, 1);

  // 同一次渲染内先启动旧轮询，再点击开关：两者共享同一个启停序号。
  const rendered = client.panel();
  const module = moduleOf(rendered, 'McpModule');
  const toggle = nodes(module.type(module.props)).find(node => node.props.className === 'hud-switch');
  client.runPolls(); // 旧轮询进入在途（响应被挂起）
  await toggle.props.onClick();
  await settled();
  assert.equal(moduleOf(client.panel(), 'McpModule').props.enabled, 0);

  // 旧轮询此时才返回「启用」旧状态：序号已变化，必须丢弃，不能回滚开关。
  releaseOld({ ok: true, servers: [{ name: 'server', enabled: true }], total: 1, enabled: 1 });
  await settled();
  const after = moduleOf(client.panel(), 'McpModule');
  assert.equal(after.props.enabled, 0);
  assert.equal(after.props.servers[0].enabled, false);
});
