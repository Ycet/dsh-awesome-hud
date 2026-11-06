import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const clip = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

test('点击子代理任务通过官方资源在右侧栏打开，保持主会话不变', async () => {
  const calls = [];
  const services = {
    sidebarRight: { openResource: (...args) => calls.push(args) },
    uiWorkspace: { openSession: () => assert.fail('不应替换主会话') },
    sessions: { openSubagent: () => assert.fail('不应使用主会话导航兜底') },
  };
  const scope = vm.createContext({ ctx: { get: name => services[name] }, t: key => key, URLSearchParams });
  vm.runInContext(clip('async function navigateSubagent', 'const NOTE_MAX_LEN'), scope);
  await scope.navigateSubagent({ parentId: 'direct parent/?', id: 'child/?', mode: 'continuable' });
  const [[address, options]] = calls;
  const url = new URL(address);
  assert.equal(url.protocol, 'dsh-resource:');
  assert.equal(url.hostname, 'subagentchat');
  assert.equal(decodeURIComponent(url.pathname.slice('/session/'.length)), 'child/?');
  assert.equal(url.searchParams.get('parent'), 'direct parent/?');
  assert.equal(url.searchParams.get('mode'), 'continuable');
  assert.deepEqual(JSON.parse(JSON.stringify(options)), { kind: 'subagentchat', preferNewPane: true });
});

test('子代理保留各模式和直接父会话，缺失侧栏及打开失败均显式报错', async () => {
  const calls = [];
  const services = { sidebarRight: { openResource: address => calls.push(address) } };
  const scope = vm.createContext({ ctx: { get: name => services[name] }, t: key => key, URLSearchParams });
  vm.runInContext(clip('async function navigateSubagent', 'const NOTE_MAX_LEN'), scope);
  const entry = { parentId: 'nested-parent', id: 'child', mode: 'continuable' };
  for (const mode of ['continuable', 'one-shot', 'unknown']) {
    await scope.navigateSubagent({ ...entry, mode });
    assert.equal(new URL(calls.at(-1)).searchParams.get('mode'), mode);
    assert.equal(new URL(calls.at(-1)).searchParams.get('parent'), 'nested-parent');
  }
  delete services.sidebarRight;
  services.uiWorkspace = { openSession: () => assert.fail('缺少侧栏时不应替换主会话') };
  services.sessions = { openSubagent: () => assert.fail('缺少侧栏时不应替换主会话') };
  await assert.rejects(scope.navigateSubagent(entry), /subagentOpenFailed/);
  services.sidebarRight = { openResource: async () => { throw new Error('open failed'); } };
  await assert.rejects(scope.navigateSubagent(entry), /open failed/);
});

// 模拟桌面真实的菜单、nav 和延迟挂载，验证按钮选择而非只匹配源码字符串。
function navigationFixture({ existing = false, legacy = false, target = 'opencode', accountLabel = '账号与余额', customFallback = false } = {}) {
  let menuOpen = false, dialogOpen = existing, ticks = 0, selected = false;
  const clicks = [], errors = [];
  const button = (text, action) => ({ textContent: text, getAttribute: () => 'Account menu', click: () => { clicks.push(text); action?.(); } });
  // 官方「账号与余额」分区（dsh-account-usage 把 deepseek / opencode go 页签嵌在其内容底部）。
  const official = button(accountLabel, () => { selected = true; });
  const custom = button('账户', () => { selected = true; });
  const codex = button('Codex 订阅', () => { selected = true; });
  const navButtons = [button('通用设置'), official, codex];
  if (customFallback) navButtons.push(custom);
  const nav = { querySelectorAll: () => navButtons };
  const tab = button(target === 'deepseek' ? 'deepseek' : 'opencode go');
  const dialog = { querySelector: () => nav, querySelectorAll: () => selected && ticks >= 8 ? [tab] : [] };
  const menuItem = button('设置⌘,', () => { dialogOpen = true; });
  menuItem.cloneNode = () => ({ textContent: '设置⌘,', querySelectorAll: function () { return [{ remove: () => { this.textContent = '设置'; } }]; } });
  const menu = { querySelectorAll: () => ticks >= 4 ? [menuItem] : [] };
  const trigger = button('账号菜单', () => { menuOpen = true; });
  const document = {
    querySelector: selector => selector.includes('data-shortcut-modal') ? (dialogOpen ? dialog : null)
      : selector === '[role="menu"]' ? (menuOpen ? menu : null)
      : selector.includes('aria-haspopup="dialog"') && legacy ? button('旧设置入口', () => { dialogOpen = true; }) : null,
    querySelectorAll: selector => selector === '[role="dialog"]' ? [] : legacy ? [] : [trigger],
  };
  const context = vm.createContext({ document, toast: key => errors.push(key), t: key => key,
    setTimeout: fn => { ticks++; queueMicrotask(fn); } });
  vm.runInContext(clip('let settingsNavigation = null;', 'function BalanceModule'), context);
  return { context, clicks, errors };
}

test('桌面账户菜单 → 官方「账号与余额」分区 → 延迟出现的 OpenCode 页签；重复点击不重复开关', async () => {
  const f = navigationFixture();
  const one = f.context.openSettingsAccount('opencode');
  const two = f.context.openSettingsAccount('opencode');
  assert.equal(one, two);
  await one;
  assert.deepEqual(f.clicks, ['账号菜单', '设置⌘,', '账号与余额', 'opencode go']);
  assert.deepEqual(f.errors, []);
});

test('DeepSeek 余额数字进入「账号与余额」并切到 deepseek 页签', async () => {
  const f = navigationFixture({ target: 'deepseek' });
  await f.context.openSettingsAccount('deepseek');
  assert.deepEqual(f.clicks, ['账号菜单', '设置⌘,', '账号与余额', 'deepseek']);
  assert.deepEqual(f.errors, []);
});

test('英文 Account 分区与旧版回退「账户」分区都能命中，且官方分区优先', async () => {
  const english = navigationFixture({ target: 'deepseek', accountLabel: 'Account' });
  await english.context.openSettingsAccount('deepseek');
  assert.deepEqual(english.clicks, ['账号菜单', '设置⌘,', 'Account', 'deepseek']);

  // 未登录/旧版 DSH 时官方账户页不存在，dsh-account-usage 注册兜底「账户」分区。
  const fallback = navigationFixture({ target: 'opencode', accountLabel: '账户' });
  await fallback.context.openSettingsAccount('opencode');
  assert.deepEqual(fallback.clicks, ['账号菜单', '设置⌘,', '账户', 'opencode go']);

  // 两种分区同时存在时优先官方「账号与余额」，页面顺序靠前即可命中。
  const both = navigationFixture({ target: 'opencode', accountLabel: '账号与余额', customFallback: true });
  await both.context.openSettingsAccount('opencode');
  assert.deepEqual(both.clicks, ['账号菜单', '设置⌘,', '账号与余额', 'opencode go']);
});

test('已打开设置时不关闭，Codex 选择自身分区；旧 Web 入口仍能跳转', async () => {
  const existing = navigationFixture({ existing: true });
  await existing.context.openSettingsAccount('codex');
  assert.deepEqual(existing.clicks, ['Codex 订阅']);
  const legacy = navigationFixture({ legacy: true, target: 'deepseek' });
  await legacy.context.openSettingsAccount('deepseek');
  assert.deepEqual(legacy.clicks, ['旧设置入口', '账号与余额', 'deepseek']);
  assert.deepEqual(legacy.errors, []);
});

test('无法找到设置时有明确失败反馈', async () => {
  const context = vm.createContext({ document: { querySelector: () => null, querySelectorAll: () => [] },
    toast: value => context.error = value, t: value => value, setTimeout: fn => queueMicrotask(fn) });
  vm.runInContext(clip('let settingsNavigation = null;', 'function BalanceModule'), context);
  await context.openSettingsAccount('deepseek');
  assert.equal(context.error, 'settingsOpenFailed');
});

test('桌面 composer 服务追加草稿且保留原文，缺少绑定时不伪报成功', async () => {
  let draft = '原草稿';
  const services = { sessions: { scope: id => ({ id }) }, conversation: { input: { for: ctx => ctx.id === 'current' ? {
    state: { getSnapshot: () => ({ draft }) }, setDraft: text => { draft = text; },
  } : undefined } } };
  const context = vm.createContext({ ctx: { get: key => services[key] } });
  vm.runInContext(clip('async function appendToComposer', '/** 通过官方右侧栏'), context);
  assert.equal(await context.appendToComposer('current', '便笺内容'), true);
  assert.equal(draft, '原草稿 便笺内容');
  assert.equal(await context.appendToComposer('unbound', '便笺内容'), false);
  assert.equal(await context.appendToComposer('current', ''), false);
});

test('切换 SnapshotStore 时同步新快照，并退订旧会话', () => {
  let value, cleanup;
  const react = { useState: fn => [value ??= fn(), next => { value = next; }], useEffect: fn => { cleanup?.(); cleanup = fn(); } };
  const context = vm.createContext({ react });
  vm.runInContext(clip('function useSnapshot', '/** 镜像 lib/graph.js'), context);
  const listeners = new Set();
  const first = { getSnapshot: () => 'old', subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  context.useSnapshot(first, x => x, null);
  assert.equal(value, 'old');
  const second = { getSnapshot: () => 'new', subscribe: () => () => {} };
  context.useSnapshot(second, x => x, null);
  assert.equal(value, 'new');
  assert.equal(listeners.size, 0);
});

test('新建页便笺先打开未绑定的目标会话，提交中的草稿不覆盖', async () => {
  let bound = false, draft = '', phase = 'idle';
  const services = {
    sessions: { scope: id => bound ? { id } : undefined },
    uiWorkspace: { openSession: async id => { assert.equal(id, 'recent'); bound = true; } },
    conversation: { input: { for: () => ({ state: { getSnapshot: () => ({ draft, phase }) }, setDraft: value => { draft = value; } }) } },
  };
  const context = vm.createContext({ ctx: { get: key => services[key] }, setTimeout });
  vm.runInContext(clip('async function appendToComposer', '/** 通过官方右侧栏'), context);
  assert.equal(await context.appendToComposer('recent', '新建页便笺'), true);
  assert.equal(draft, '新建页便笺');
  phase = 'submitting';
  assert.equal(await context.appendToComposer('recent', '不可追加'), false);
  assert.equal(draft, '新建页便笺');
});
