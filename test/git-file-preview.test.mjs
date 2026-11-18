// dsh-awesome-hud — v0.21.4：git 变更行没有官方 diff 时的官方文件预览地址。
//
// 官方 DSH 只有「第 N 轮改动」一种 diff 页面；本会话任何一轮都没改过的文件
// （别的会话改的、用户手改的）没有官方 diff，此时把 git 快照里的仓库根相对路径
// 换算成会话工作区相对路径，交给官方 file 资源打开。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarness, createRepo, cleanupRepo } from './helpers/host-harness.mjs';

test('git/file-preview：仓库根会话直接给出官方文件地址', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-git-preview-root-');
  try {
    const { call } = createHarness(root);
    const body = await call('git/file-preview', { path: 'docs/a.md' });
    assert.equal(body.status, 200, JSON.stringify(body));
    assert.equal(body.address, 'dsh-resource://file/session/fixture/docs/a.md');
  } finally { await cleanupRepo(root); }
});

test('git/file-preview：会话 cwd 在仓库子目录时换算成工作区相对路径', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-git-preview-sub-');
  try {
    const sub = join(root, 'sub');
    await mkdir(join(sub, 'docs'), { recursive: true });
    await writeFile(join(sub, 'docs/x.md'), 'x\n');
    const { call } = createHarness(sub);
    // git 快照里的路径相对仓库根（porcelain 语义），官方 file 资源相对会话工作区。
    const body = await call('git/file-preview', { path: 'sub/docs/x.md' });
    assert.equal(body.status, 200, JSON.stringify(body));
    assert.equal(body.address, 'dsh-resource://file/session/fixture/docs/x.md');
  } finally { await cleanupRepo(root); }
});

test('git/file-preview：工作区外路径、未知会话与非法参数被拒绝', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-git-preview-bad-');
  try {
    const { call } = createHarness(root);
    const outside = await call('git/file-preview', { path: '../outside.md' });
    assert.equal(outside.status, 400, '仓库外的路径不能打开');

    const unknown = await call('git/file-preview', { sessionId: 'missing', path: 'docs/a.md' });
    assert.ok(unknown.status >= 400, '未知会话应报错');

    const empty = await call('git/file-preview', { path: '   ' });
    assert.ok(empty.status >= 400, '空路径应报错');
  } finally { await cleanupRepo(root); }
});
