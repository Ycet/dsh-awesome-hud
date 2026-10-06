import test from 'node:test';
import assert from 'node:assert/strict';
import { browserAvailable, browserHarness } from './helpers/browser-harness.mjs';

const git = branch => ({ ok: true, isRepo: true, branch, changedCount: 1, files: [], counts: { staged: 0, unstaged: 1 } });
const plans = id => ({ ok: true, plans: [{ id: `${id}-plan`, title: `${id} plan`, status: 'pending' }] });
const subagents = id => ({ ok: true, entries: [{ id: `${id}-child`, activity: 'idle', depth: 1 }] });
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));

test('切走期间完成的查询仍缓存；返回目标会话首帧同时恢复 Git、计划和子代理', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    await fixture.page.evaluate(() => window.fixture.switchTo('B'));
    for (const [method, body] of [['git', git('a')], ['plans', plans('A')], ['subagents', subagents('A')]]) {
      await fixture.page.evaluate(({ method, body }) => window.fixture.resolve(method, 'A', body), { method, body });
    }
    await settle(fixture.page);
    // B 未返回时绝不能出现 A 的数据。
    const before = new Map(await fixture.page.evaluate(() => window.fixture.modules()));
    assert.equal(before.has('GitModule'), false);
    assert.equal(before.has('PlansModule'), false);
    assert.equal(before.has('SubagentsModule'), false);
    const modules = new Map(await fixture.page.evaluate(() => { window.fixture.switchTo('A'); return window.fixture.modules(); }));
    assert.equal(modules.get('GitModule')?.git.branch, 'a');
    assert.equal(modules.get('PlansModule')?.plans[0].title, 'A plan');
    assert.equal(modules.get('SubagentsModule')?.entries[0].id, 'A-child');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('第一次查询尚未完成时立即显示加载入口，不把未加载模块误当成不可用', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    const modules = new Map(await fixture.page.evaluate(() => window.fixture.modules()));
    for (const module of ['git', 'subagents', 'plans', 'mcp', 'balance']) {
      assert.ok(modules.has(`loading:${module}`), `${module} 查询未完成时应有加载状态`);
    }
    assert.ok(modules.has('ContextModule'));
    assert.ok(modules.has('TasksModule'));
    assert.ok(modules.has('NoteModule'));
    assert.ok(modules.has('TodoModule'));
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('面板重新挂载时首帧沿用已确认的模块设置，网络失败也不恢复默认开关', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    await fixture.page.evaluate(() => window.fixture.resolve('settings', undefined, { ok: true, modules: { mcp: false, git: false }, usage: { codex: false } }));
    await settle(fixture.page);
    const first = await fixture.page.evaluate(() => {
      window.fixture.render(false); window.fixture.traces.length = 0; window.fixture.render(true);
      return window.fixture.first('SessionModule');
    });
    assert.equal(first.modules.git, false);
    assert.equal(first.modules.mcp, false);
    assert.equal(first.usage.codex, false);
    await fixture.page.evaluate(() => window.fixture.reject('settings', undefined));
    await settle(fixture.page);
    const after = new Map(await fixture.page.evaluate(() => window.fixture.modules()));
    assert.equal(after.get('SessionModule').modules.git, false);
    assert.equal(after.get('SessionModule').modules.mcp, false);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('切换会话后模型目录首帧属于新会话，不显示前一会话的模型', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    const first = await fixture.page.evaluate(() => { window.fixture.switchTo('B'); return window.fixture.first('SessionModule'); });
    assert.equal(first.sessionTitle, 'B');
    assert.equal(first.modelId, 'B-model');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('从收起 HUD 的会话切入记忆为展开的会话，首帧就显示面板', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness({ storage: { 'dsh-awesome-hud:open': JSON.stringify({ A: '0', B: '1' }) } });
  try {
    const commits = await fixture.page.evaluate(() => { window.fixture.switchTo('B'); return window.fixture.commits; });
    assert.ok(commits[0].includes('SessionModule'), '不能等作用域 effect 执行后才挂载目标面板');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('同一工作区切换会话首帧保留 Git 和全局模块，计划、子代理及任务归属于新会话', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    for (const [method, id, body] of [
      ['git', 'A', git('a')], ['plans', 'A', plans('A')], ['subagents', 'A', subagents('A')],
      ['mcp', undefined, { ok: true, servers: [{ name: 'mcp-a' }], total: 1, enabled: 1 }],
      ['deepseek-summary', undefined, { ok: true, balance: { total: 12 } }],
    ]) await fixture.page.evaluate(({ method, id, body }) => window.fixture.resolve(method, id, body), { method, id, body });
    await settle(fixture.page);
    const modules = new Map(await fixture.page.evaluate(() => { window.fixture.switchTo('A2'); return window.fixture.modules(); }));
    assert.equal(modules.get('GitModule')?.git.branch, 'a');
    assert.equal(modules.get('McpModule')?.servers[0].name, 'mcp-a');
    assert.equal(modules.get('BalanceModule')?.balance.data.total, 12);
    assert.equal(modules.get('TasksModule')?.todos[0].content, 'A2 task');
    assert.equal(modules.has('PlansModule'), false);
    assert.equal(modules.has('SubagentsModule'), false);
    assert.ok(modules.has('loading:plans'));
    assert.ok(modules.has('loading:subagents'));
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('快速往返切换只共享一个工作区查询，慢响应不能覆盖 Git 操作后的快照', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    await fixture.page.evaluate(() => { window.fixture.switchTo('B'); window.fixture.switchTo('A'); });
    await settle(fixture.page);
    assert.equal(await fixture.page.evaluate(() => window.fixture.requests.filter(r => r.method === 'git' && r.payload.sessionId === 'A').length), 1);
    await fixture.page.evaluate(body => window.fixture.resolve('git', 'A', body), git('initial'));
    await settle(fixture.page);
    await fixture.page.evaluate(() => window.fixture.poll());
    await settle(fixture.page);
    await fixture.page.evaluate(body => { window.fixture.mutateGit(body); window.fixture.switchTo('A2'); }, git('after-write'));
    await fixture.page.evaluate(body => window.fixture.resolve('git', 'A', body), git('stale'));
    await settle(fixture.page);
    const modules = new Map(await fixture.page.evaluate(() => window.fixture.modules()));
    assert.equal(modules.get('GitModule').git.branch, 'after-write');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('查询确认无数据后移除对应加载状态，空 MCP 保持可用且遵守模块隐藏设置', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    for (const [method, id, body] of [
      ['git', 'A', { ok: true, isRepo: false }], ['plans', 'A', { ok: true, plans: [] }], ['subagents', 'A', { ok: true, entries: [] }],
      ['mcp', undefined, { ok: true, servers: [], total: 0, enabled: 0 }],
      ['deepseek-summary', undefined, { ok: false, code: 'no-token' }], ['opencode', undefined, { ok: false, code: 'no-key' }],
      ['settings', undefined, { ok: true, modules: { note: false, todo: false }, usage: {} }],
    ]) await fixture.page.evaluate(({ method, id, body }) => window.fixture.resolve(method, id, body), { method, id, body });
    await settle(fixture.page);
    const modules = new Map(await fixture.page.evaluate(() => window.fixture.modules()));
    assert.equal([...modules.keys()].some(name => name.startsWith('loading:')), false);
    assert.equal(modules.has('GitModule'), false);
    assert.equal(modules.has('PlansModule'), false);
    assert.equal(modules.has('SubagentsModule'), false);
    assert.equal(modules.has('BalanceModule'), false);
    assert.equal(modules.has('NoteModule'), false);
    assert.equal(modules.has('TodoModule'), false);
    assert.equal(modules.get('McpModule').total, 0);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('主视图先切换而会话摘要尚未到达时，不借用其他工作区的 Git 与便笺数据', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness();
  try {
    await fixture.page.evaluate(body => window.fixture.resolve('git', 'A', body), git('a'));
    await settle(fixture.page);
    const modules = new Map(await fixture.page.evaluate(() => { window.fixture.switchTo('missing'); return window.fixture.modules(); }));
    assert.equal(modules.has('GitModule'), false);
    assert.equal(modules.get('NoteModule').workspaceKey, null);
    assert.equal(modules.get('TodoModule').workspaceKey, null);
    assert.equal(modules.get('NoteModule').sessionId, 'missing');
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('真实模块 DOM 的加载状态可立即呈现，成功后原位切换为 Git、MCP、计划和子代理', { skip: !browserAvailable }, async () => {
  const fixture = await browserHarness({ realModules: true });
  try {
    assert.equal(await fixture.page.locator('.hud-section[aria-busy="true"]').count(), 5);
    for (const [method, id, body] of [
      ['git', 'A', git('real-branch')], ['plans', 'A', plans('A')], ['subagents', 'A', subagents('A')],
      ['mcp', undefined, { ok: true, servers: [{ name: 'real-mcp', enabled: true }], total: 1, enabled: 1 }],
    ]) await fixture.page.evaluate(({ method, id, body }) => window.fixture.resolve(method, id, body), { method, id, body });
    await settle(fixture.page);
    assert.equal(await fixture.page.locator('.hud-section[aria-busy="true"]').count(), 1);
    assert.equal(await fixture.page.getByText('real-branch', { exact: true }).count(), 1);
    assert.equal(await fixture.page.getByText('A plan', { exact: true }).count(), 1);
    assert.equal(await fixture.page.getByText('A-child', { exact: true }).count(), 1);
    assert.equal(await fixture.page.getByText('real-mcp', { exact: true }).count(), 1);
    await fixture.page.evaluate(() => window.fixture.switchTo('A2'));
    assert.equal(await fixture.page.getByText('real-branch', { exact: true }).count(), 1);
    assert.equal(await fixture.page.getByText('A plan', { exact: true }).count(), 0);
    assert.equal(await fixture.page.getByText('A-child', { exact: true }).count(), 0);
    assert.equal(await fixture.page.getByText('real-mcp', { exact: true }).count(), 1);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
