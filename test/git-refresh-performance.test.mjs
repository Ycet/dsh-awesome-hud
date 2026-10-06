import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGitSnapshot } from '../lib/index.js';

test('Git 的独立只读检查同时开始，不串行等待分支、状态及两份 diff', async () => {
  const pending = [], started = [];
  const subprocess = { spawn({ argv }) {
    const args = argv.slice(1); started.push(args.join(' '));
    const stdout = args[0] === 'rev-parse' ? 'true\n.git\n' : args[0] === 'symbolic-ref' ? 'main\n' : '';
    return { done: args[0] === 'rev-parse' ? Promise.resolve({ exitCode: 0 }) : new Promise(resolve => pending.push(resolve)),
      collected: { stdout: { readFrom: () => ({ text: stdout }) }, stderr: { readFrom: () => ({ text: '' }) } } };
  } };
  const result = collectGitSnapshot(subprocess, '/workspace');
  await new Promise(resolve => setImmediate(resolve));
  const initialCount = started.length;
  // 无论断言是否成功，都释放夹具，避免未完成查询拖住测试进程。
  while (pending.length) {
    for (const resolve of pending.splice(0)) resolve({ exitCode: 0 });
    await new Promise(resolve => setImmediate(resolve));
  }
  const snapshot = await result;
  assert.equal(snapshot.branch, 'main');
  assert.equal(initialCount, 5, '仓库检查后应同时启动四个独立的只读命令');
});

test('多个未跟踪文件有界并发统计行数，顺序、状态和计数保持正确', async () => {
  let active = 0, peak = 0;
  const paths = Array.from({ length: 12 }, (_, i) => `new-${i}.txt`);
  const subprocess = { spawn({ argv }) {
    const args = argv.slice(1), counting = args.includes('--no-index');
    let stdout = '';
    if (args[0] === 'rev-parse') stdout = 'true\n.git\n';
    else if (args[0] === 'symbolic-ref') stdout = 'main\n';
    else if (args[0] === 'status') stdout = paths.map(path => `?? ${path}\0`).join('');
    else if (counting) stdout = `7\t0\t${args.at(-1)}\n`;
    if (counting) { active++; peak = Math.max(peak, active); }
    return { done: new Promise(resolve => setImmediate(() => { if (counting) active--; resolve({ exitCode: counting ? 1 : 0 }); })),
      collected: { stdout: { readFrom: () => ({ text: stdout }) }, stderr: { readFrom: () => ({ text: '' }) } } };
  } };
  const snapshot = await collectGitSnapshot(subprocess, '/workspace');
  assert.ok(peak > 1 && peak <= 4, `未跟踪文件统计应有界并发，实际峰值 ${peak}`);
  assert.deepEqual(snapshot.files.map(file => file.path), paths);
  assert.ok(snapshot.files.every(file => file.added === 7 && file.untrackedCounted && !file.staged && file.unstaged));
  assert.equal(snapshot.changedCount, paths.length);
  assert.equal(snapshot.counts.unstaged, paths.length);
});
