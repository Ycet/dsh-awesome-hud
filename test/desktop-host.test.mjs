import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { apply, formatStyledDate } from '../lib/index.js';
import { readMcpStates } from '../lib/mcp.js';

// 仅运行在临时 Git 仓库和临时 profile；真实桌面 subprocess provider 验证参数和输出协议。
test('桌面真实 subprocess：Git 全部操作与 host 路由、设置、MCP、计划、子代理、压缩', {
  skip: !process.env.DSH_TEST_INSTALL_ROOT, timeout: 30000,
}, async () => {
  const base = process.env.DSH_TEST_INSTALL_ROOT + '/node_modules/@deepseek-ai/';
  const { Context } = await import(pathToFileURL(base + 'cordis/lib/index.js'));
  const { LocalSubprocessRuntime } = await import(pathToFileURL(base + 'dsh-subprocess-local/lib/index.js'));
  const runtime = new Context();
  const fiber = runtime.plugin(LocalSubprocessRuntime);
  await fiber;
  const subprocess = runtime.get('subprocess');
  const root = await mkdtemp(join(tmpdir(), 'hud-desktop-test-'));
  const git = async (...args) => {
    const handle = subprocess.spawn({ argv: ['git', ...args], cwd: root,
      stdio: { stdin: 'null', stdout: { maxBytes: 1048576 }, stderr: { maxBytes: 65536 } }, graceMs: 2000 });
    const outcome = await handle.done;
    const stdout = handle.collected.stdout.readFrom(0).text;
    assert.equal(outcome.exitCode, 0, handle.collected.stderr.readFrom(0).text);
    return stdout.trim();
  };
  try {
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'HUD Compatibility Fixture');
    await git('config', 'user.email', 'hud-fixture@example.invalid');
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(root, 'empty-hooks'));
    await git('config', 'core.hooksPath', join(root, 'empty-hooks'));
    await writeFile(join(root, '.git/info/exclude'), 'profile/\nempty-hooks/\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hud-fixture', version: '1.0.0' }));
    await writeFile(join(root, 'tracked.txt'), 'initial\n');
    await git('add', 'tracked.txt', 'package.json');
    const message = `[${formatStyledDate(new Date())}] hud-fixture v1.0.1：修复兼容性测试夹具`;
    await git('commit', '-m', message);
    const first = await git('rev-parse', 'HEAD');
    const profile = join(root, 'profile');
    await mkdir(profile);
    const originalPatch = '[]\n# 用户原有配置\n';
    await writeFile(join(profile, 'cordis.patch.yml'), originalPatch);
    const entries = [{ options: { id: 'test-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'fixture' } }, disabled: false }];
    let settingsValue = { modules: {}, usage: {} }, revision = 1, compactCall, aiCall;
    const agent = {};
    const events = [{ type: 'tool/call', seq: 1, time: 1, data: { name: 'exit_plan_mode', callId: 'plan1', arguments: JSON.stringify({ plan: '# 兼容性验证\n- 验证接口' }) } }];
    const services = {
      subprocess,
      sessions: { get: id => id === 'fixture' ? { header: { cwd: root }, snapshotEvents: () => events } : undefined },
      loader: { resolve: () => ({ options: { config: { path: pathToFileURL(join(profile, 'cordis.yml')).href } } }), entries: () => entries },
      subagents: { listDescendants: async () => [{ kind: 'child', id: 'child', parentId: 'fixture', mode: 'continuable', depth: 1, activity: 'idle' }, { kind: 'other' }] },
      settings: { writable: true, describe: () => [{ ns: 'awesome-hud', revision }], update: async (ns, patch, expected) => {
        assert.equal(ns, 'awesome-hud'); assert.equal(expected, revision); settingsValue = patch; revision++;
      } },
      agents: { get: () => agent }, commands: { execute: async (...args) => { compactCall = args; return { kind: 'text', text: 'done' }; } },
      llm: { stream: async function* (request) { aiCall = request; yield { type: 'text-delta', text: message }; yield { type: 'finish', reason: 'stop' }; } },
    };
    const routes = [];
    const ctx = { get: name => services[name], effect: fn => fn(), webServer: { register: route => { routes.push(route); return () => {}; } } };
    apply(ctx, { modules: { get: () => settingsValue.modules }, usage: { get: () => settingsValue.usage } });
    const api = routes.find(route => route.path === '/awesome-hud/api').handler;
    const call = async (endpoint, body = { sessionId: 'fixture' }, method = 'POST', extraHeaders = {}) => {
      const req = Readable.from(method === 'GET' ? [] : [Buffer.from(JSON.stringify(body))]);
      Object.assign(req, { method, url: '/awesome-hud/api/' + endpoint, headers: { host: '127.0.0.1:1234', ...extraHeaders } });
      let status, result;
      await api(req, { writeHead: code => { status = code; }, end: data => { result = JSON.parse(data); } });
      return { status, ...result };
    };
    const ok = async (endpoint, payload) => { const value = await call(endpoint, { sessionId: 'fixture', ...payload }); assert.equal(value.status, 200, JSON.stringify(value)); return value; };
    await writeFile(join(root, 'tracked.txt'), 'changed\n');
    await writeFile(join(root, 'new.txt'), 'new\n');
    const snap = await ok('git');
    assert.equal(snap.isRepo, true); assert.equal(snap.branch, 'main');
    await ok('git/stage', { path: 'tracked.txt' });
    assert.equal((await ok('git')).counts.staged, 1);
    await ok('git/unstage', { path: 'tracked.txt' });
    await ok('git/stage-all');
    assert.ok((await ok('git')).counts.staged >= 2);
    const ai = await ok('git/commit-ai', { provider: 'fixture-provider', model: 'fixture-model' });
    assert.equal(ai.message, message); assert.equal(aiCall.provider, 'fixture-provider');
    await ok('git/unstage-all');
    await ok('git/revert-file', { path: 'new.txt' });
    await ok('git/revert-all');
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'initial\n');
    await writeFile(join(root, 'tracked.txt'), 'second\n');
    await ok('git/stage', { path: 'tracked.txt' });
    await ok('git/commit', { message });
    const second = await git('rev-parse', 'HEAD');
    assert.notEqual(second, first);
    assert.equal((await ok('git/graph', { offset: 0 })).commits.length, 2);
    assert.equal((await ok('git/reset-status', { commit: second })).allowed, false);
    assert.equal((await ok('git/reset-status', { commit: first })).allowed, true);
    await ok('git/create-branch', { branch: 'fixture-history', commit: first });
    assert.equal((await ok('git/branches')).current, 'fixture-history');
    await ok('git/checkout', { branch: 'main' });
    await ok('git/reset', { mode: 'soft', commit: first });
    assert.equal((await ok('git')).counts.staged, 1);
    await git('reset', '--hard', second);
    await ok('git/reset', { mode: 'mixed', commit: first });
    assert.equal((await ok('git')).counts.staged, 0);
    assert.equal((await ok('git')).counts.unstaged, 1);
    await git('reset', '--hard', second);
    await ok('git/reset', { mode: 'hard', commit: first });
    await ok('git/merge-commit', { commit: second });
    assert.equal(await git('rev-parse', 'HEAD'), second);
    // 冲突合并必须自动回滚，保留执行前分支和文件内容。
    await ok('git/checkout', { branch: 'fixture-history' });
    await writeFile(join(root, 'tracked.txt'), 'conflicting\n');
    await ok('git/stage', { path: 'tracked.txt' });
    await ok('git/commit', { message });
    const conflicting = await git('rev-parse', 'HEAD');
    await ok('git/checkout', { branch: 'main' });
    const conflict = await call('git/merge-commit', { sessionId: 'fixture', commit: conflicting });
    assert.equal(conflict.code, 'merge-conflict', JSON.stringify(conflict));
    assert.equal(await git('rev-parse', 'HEAD'), second);
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'second\n');
    assert.equal((await ok('subagents')).entries.length, 1);
    assert.equal((await ok('plans')).plans[0].title, '兼容性验证');
    assert.equal((await ok('compact')).ok, true);
    assert.equal(compactCall[0], agent); assert.equal(compactCall[1], '/compact');
    assert.equal((await ok('mcp')).enabled, 1);
    await ok('mcp/toggle', { server: 'fixture', enabled: false });
    const disabled = await readFile(join(profile, 'cordis.patch.yml'), 'utf8');
    assert.ok(disabled.includes('# 用户原有配置')); assert.equal(readMcpStates(disabled).get('test-mcp'), true);
    entries[0].disabled = true;
    await ok('mcp/toggle', { server: 'fixture', enabled: true });
    assert.equal(readMcpStates(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).get('test-mcp'), false);
    assert.equal((await ok('settings', { modules: { git: false }, usage: { codex: false } })).persistent, true);
    assert.equal((await call('settings', null, 'GET')).modules.git, false);
    assert.equal((await call('settings', null, 'GET')).usage.codex, false);
    assert.equal((await call('git', { sessionId: 'fixture' }, 'POST', { origin: 'https://external.invalid' })).status, 403);
  } finally { await fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
