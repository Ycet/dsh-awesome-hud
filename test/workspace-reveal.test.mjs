// v0.18.1：宿主 workspace/desktop 与 workspace/reveal 路由
//
// 覆盖点：
//   1. desktop 探测走官方 sessionController.workspaceDesktop，服务缺失时按平台推断；
//   2. reveal 只接受**已注册工作区**的绝对路径，并交给官方 openWorkspacePath(action: reveal)；
//   3. 服务缺失时回退平台命令（用假 subprocess 记录 argv，绝不真的拉起 Finder）；
//   4. 非法路径、未注册路径、目录不存在、服务缺失分别给出 400/403/404/503。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHarness } from './helpers/host-harness.mjs';

async function makeDir(prefix) {
  return await mkdtemp(join(tmpdir(), prefix));
}

/** 记录 spawn 参数的假 subprocess（不执行任何真实命令）。 */
function recordingSubprocess() {
  const spawns = [];
  return {
    spawns,
    spawn(spec) {
      spawns.push(spec.argv);
      return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } } };
    },
  };
}

test('workspace/desktop 使用官方探测结果（可用性与文件管理器类型）', async () => {
  const dir = await makeDir('hud-desktop-');
  try {
    const { call } = createHarness(dir, {
      sessionController: { workspaceDesktop: () => ({ name: 'host', available: true, fileManager: 'finder' }) },
    });
    const result = await call('workspace/desktop');
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.available, true);
    assert.equal(result.fileManager, 'finder');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace/desktop 在官方服务缺失时按平台推断并保留 subprocess 可用性', async () => {
  const dir = await makeDir('hud-desktop-fallback-');
  try {
    const { call } = createHarness(dir);
    const result = await call('workspace/desktop');
    assert.equal(result.ok, true);
    assert.equal(result.available, true, '夹具带 subprocess，应判定为可用');
    const expected = process.platform === 'darwin' ? 'finder' : process.platform === 'win32' ? 'explorer' : process.platform === 'linux' ? 'directory' : null;
    assert.equal(result.fileManager, expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace/reveal 把已注册工作区路径交给官方原生打开（action=reveal）', async () => {
  const dir = await makeDir('hud-reveal-');
  try {
    const calls = [];
    const { call } = createHarness(dir, {
      workspaceRegistry: { list: () => [{ id: 'w1', path: dir, title: 'Workspace' }] },
      sessionController: {
        openWorkspacePath: async (request, signal) => { calls.push({ request, aborted: signal?.aborted === true }); return { opened: true }; },
      },
    });
    const result = await call('workspace/reveal', { path: dir });
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.opened, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].aborted, false);
    assert.equal(calls[0].request.action, 'reveal');
    assert.equal(calls[0].request.path, await realpath(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace/reveal 拒绝未注册路径、相对路径与不存在的目录', async () => {
  const dir = await makeDir('hud-reveal-deny-');
  const other = await makeDir('hud-reveal-other-');
  try {
    const { call } = createHarness(dir, {
      workspaceRegistry: { list: () => [{ id: 'w1', path: dir, title: 'Workspace' }] },
      sessionController: { openWorkspacePath: async () => ({ opened: true }) },
    });
    const unregistered = await call('workspace/reveal', { path: other });
    assert.equal(unregistered.status, 403);
    assert.equal(unregistered.code, 'unregistered-path');

    const relative = await call('workspace/reveal', { path: 'relative/dir' });
    assert.equal(relative.status, 400);
    assert.equal(relative.code, 'invalid-path');

    const missing = await call('workspace/reveal', { path: join(dir, 'nope') });
    assert.equal(missing.status, 404);
    assert.equal(missing.code, 'missing-path');

    const empty = await call('workspace/reveal', {});
    assert.equal(empty.status, 400);
    assert.equal(empty.code, 'invalid-path');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test('workspace/reveal 在缺少官方会话服务时回退平台命令（argv 数组，不经 shell）', async () => {
  const dir = await makeDir('hud-reveal-subprocess-');
  try {
    const fake = recordingSubprocess();
    const { call } = createHarness(dir, {
      subprocess: fake,
      workspaceRegistry: { list: () => [{ id: 'w1', path: dir, title: 'Workspace' }] },
    });
    const result = await call('workspace/reveal', { path: dir });
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);
    assert.equal(fake.spawns.length, 1);
    const argv = fake.spawns[0];
    const expectedFirst = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    assert.equal(argv[0], expectedFirst);
    const resolvedDir = await realpath(dir);
    // macOS/Windows 传目录本身，Linux 的 xdg-open 传父目录；三者都必须作为独立 argv 元素出现。
    const accepted = new Set([dir, resolvedDir, dirname(dir), dirname(resolvedDir)]);
    assert.ok(argv.some((value) => accepted.has(value)), '路径必须以独立 argv 传入');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace/reveal 在工作区服务缺失时返回 503', async () => {
  const dir = await makeDir('hud-reveal-noregistry-');
  try {
    const { call } = createHarness(dir, { sessionController: { openWorkspacePath: async () => ({ opened: true }) } });
    const result = await call('workspace/reveal', { path: dir });
    assert.equal(result.status, 503);
    assert.equal(result.code, 'unavailable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
