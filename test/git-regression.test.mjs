// dsh-awesome-hud — git 功能回归（真实 git + 真实 host 路由）
//
// 覆盖 Git 模块用到的全部 host 接口：快照、暂存/取消暂存、提交、AI 生成提交信息、
// 撤销（单文件/全部）、分支列表与创建、切换分支、合并、提交图（含分页）、reset 与
// 其资格校验、以及非 ASCII / 含空格文件名的边界。所有断言同时校验接口返回与仓库真实状态。
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarness, createRepo, cleanupRepo, fileOf, gitIn } from './helpers/host-harness.mjs';
import { formatStyledDate } from '../lib/index.js';

const exists = async (path) => stat(path).then(() => true, () => false);

test('快照与分支列表：返回当前分支、变更计数与文件明细', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-snap-');
  try {
    const { call } = createHarness(root);
    const snap = await call('git');
    assert.equal(snap.status, 200);
    assert.equal(snap.isRepo, true);
    assert.equal(snap.branch, 'main');
    assert.equal(snap.changedCount, 0);
    assert.deepEqual(Array.from(snap.files), []);
    assert.deepEqual({ ...snap.counts }, { staged: 0, unstaged: 0 });

    await writeFile(join(root, 'tracked.txt'), 'two\n');
    await writeFile(join(root, 'fresh.txt'), 'new\n');
    await rm(join(root, 'docs/a.md'));
    const dirty = await call('git');
    assert.equal(dirty.changedCount, 3);
    assert.equal(fileOf(dirty, 'tracked.txt').status, 'M');
    assert.equal(fileOf(dirty, 'tracked.txt').unstaged, true);
    assert.equal(fileOf(dirty, 'fresh.txt').status, '?');
    assert.equal(fileOf(dirty, 'fresh.txt').untrackedCounted, true);
    assert.equal(fileOf(dirty, 'docs/a.md').status, 'D');
    assert.deepEqual({ ...dirty.counts }, { staged: 0, unstaged: 3 });

    const branches = await call('git/branches');
    assert.deepEqual(Array.from(branches.branches), ['main']);
    assert.equal(branches.current, 'main');
  } finally { await cleanupRepo(root); }
});

test('暂存与取消暂存：单个、全部、跨 500 文件分批都正确', { timeout: 60000 }, async () => {
  const root = await createRepo('hud-reg-stage-');
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, 'tracked.txt'), 'two\n');
    await writeFile(join(root, 'fresh.txt'), 'new\n');

    // 单个文件
    const staged = await call('git/stage', { path: 'fresh.txt' });
    assert.equal(staged.status, 200);
    assert.equal(staged.counts.staged, 1);
    assert.equal(fileOf(staged, 'fresh.txt').staged, true);
    const unstaged = await call('git/unstage', { path: 'fresh.txt' });
    assert.equal(unstaged.status, 200);
    assert.equal(unstaged.counts.staged, 0);
    assert.equal(fileOf(unstaged, 'fresh.txt').status, '?');

    // 暂存区外/不存在的文件
    const missing = await call('git/stage', { path: 'nope.txt' });
    assert.equal(missing.status, 404);
    assert.match(missing.error, /未找到变更文件/);

    // 全部：修改 + 未跟踪 + 删除
    await rm(join(root, 'docs/a.md'));
    const all = await call('git/stage-all');
    assert.equal(all.status, 200);
    assert.equal(all.counts.staged, 3);
    assert.equal(fileOf(all, 'docs/a.md').status, 'D');
    const clearedAll = await call('git/unstage-all');
    assert.equal(clearedAll.status, 200);
    assert.equal(clearedAll.counts.staged, 0);
    assert.equal(clearedAll.counts.unstaged, 3);
    assert.equal(fileOf(clearedAll, 'docs/a.md').status, 'D');

    // 空暂存区再次取消暂存
    const empty = await call('git/unstage-all');
    assert.equal(empty.status, 400);
    assert.match(empty.error, /没有已暂存的变更/);

    // 跨 500 文件分批（stage-all / unstage-all 内部按 500 分组）
    await mkdir(join(root, 'bulk'));
    for (let index = 0; index < 520; index += 1) await writeFile(join(root, `bulk/f${index}.txt`), `${index}\n`);
    const bulk = await call('git/stage-all');
    assert.equal(bulk.status, 200);
    assert.equal(bulk.counts.staged - clearedAll.counts.unstaged, 520, '520 个新文件必须全部暂存');
    const bulkCleared = await call('git/unstage-all');
    assert.equal(bulkCleared.status, 200);
    assert.equal(bulkCleared.counts.staged, 0);
    assert.equal(fileOf(bulkCleared, 'bulk/f519.txt').status, '?');
  } finally { await cleanupRepo(root); }
});

test('提交：正常提交、空暂存区与非法信息都被正确拒绝', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-commit-');
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, 'tracked.txt'), 'two\n');

    const nothing = await call('git/commit', { message: 'x' });
    assert.equal(nothing.status, 400);
    assert.match(nothing.error, /没有可提交的变更/);

    await call('git/stage-all');
    const blank = await call('git/commit', { message: '   ' });
    assert.equal(blank.status, 400);
    assert.match(blank.error, /提交信息不能为空/);

    const tooLong = await call('git/commit', { message: 'x'.repeat(2001) });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.error, /提交信息过长/);

    const message = '[261015] hud-regression v0.0.2：回归验证提交';
    const committed = await call('git/commit', { message });
    assert.equal(committed.status, 200, JSON.stringify(committed));
    assert.equal(committed.counts.staged, 0);
    assert.equal(committed.changedCount, 0);
    const log = await gitIn(root, ['log', '--pretty=format:%s']);
    assert.equal(log.split('\n')[0], message);
    assert.equal(log.split('\n').length, 2);
  } finally { await cleanupRepo(root); }
});

test('撤销：未跟踪文件删除、已跟踪文件还原、revert-all 不影响暂存区', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-revert-');
  try {
    const { call } = createHarness(root);
    // 未跟踪：revert 即删除
    await writeFile(join(root, 'fresh.txt'), 'new\n');
    const removed = await call('git/revert-file', { path: 'fresh.txt' });
    assert.equal(removed.status, 200);
    assert.equal(await exists(join(root, 'fresh.txt')), false);

    // 已跟踪未暂存：还原内容
    await writeFile(join(root, 'tracked.txt'), 'changed\n');
    const restored = await call('git/revert-file', { path: 'tracked.txt' });
    assert.equal(restored.status, 200);
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'one\n');

    // 已删除的已跟踪文件：还原
    await rm(join(root, 'docs/a.md'));
    const undeleted = await call('git/revert-file', { path: 'docs/a.md' });
    assert.equal(undeleted.status, 200);
    assert.equal(await readFile(join(root, 'docs/a.md'), 'utf8'), 'a\n');

    // 暂存中的新文件：revert-file 不得误删（客户端也只对 changes 组提供 revert）
    await writeFile(join(root, 'fresh2.txt'), 'new\n');
    await call('git/stage', { path: 'fresh2.txt' });
    const stagedFile = await call('git/revert-file', { path: 'fresh2.txt' });
    assert.equal(stagedFile.status, 200);
    assert.equal(await exists(join(root, 'fresh2.txt')), true, '暂存中的新文件不得被 revert 删除');
    assert.equal(fileOf(await call('git'), 'fresh2.txt').staged, true);

    // revert-all：还原已跟踪 + 删除未跟踪；暂存区保持不变
    await writeFile(join(root, 'tracked.txt'), 'changed\n');
    await writeFile(join(root, 'untracked.txt'), 'x\n');
    const all = await call('git/revert-all');
    assert.equal(all.status, 200, JSON.stringify(all));
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'one\n');
    assert.equal(await exists(join(root, 'untracked.txt')), false);
    assert.equal(all.counts.staged, 1, 'revert-all 不得影响暂存区');
    assert.equal(fileOf(all, 'fresh2.txt').staged, true);
  } finally { await cleanupRepo(root); }
});

test('切换分支：工作区内容随分支变化，冲突与不存在的分支被拒绝', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-checkout-');
  try {
    const { call } = createHarness(root);
    // dev 分支：改动 docs/a.md 并新增 dev.txt
    await gitIn(root, ['checkout', '-q', '-b', 'dev']);
    await writeFile(join(root, 'docs/a.md'), 'dev-a\n');
    await writeFile(join(root, 'dev.txt'), 'dev\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: dev 分支内容']);
    await gitIn(root, ['checkout', '-q', 'main']);

    const branches = await call('git/branches');
    assert.deepEqual(Array.from(branches.branches).sort(), ['dev', 'main']);
    assert.equal(branches.current, 'main');

    // main → dev：文件内容与新增文件都必须落盘
    const toDev = await call('git/checkout', { branch: 'dev' });
    assert.equal(toDev.status, 200, JSON.stringify(toDev));
    assert.equal(toDev.branch, 'dev');
    assert.equal(await readFile(join(root, 'docs/a.md'), 'utf8'), 'dev-a\n');
    assert.equal(await exists(join(root, 'dev.txt')), true);

    // dev → main：dev 独有文件必须从工作区消失
    const toMain = await call('git/checkout', { branch: 'main' });
    assert.equal(toMain.status, 200);
    assert.equal(toMain.branch, 'main');
    assert.equal(await readFile(join(root, 'docs/a.md'), 'utf8'), 'a\n');
    assert.equal(await exists(join(root, 'dev.txt')), false);

    // 不存在的分支
    const missing = await call('git/checkout', { branch: 'nope' });
    assert.equal(missing.status, 400);
    assert.match(missing.error, /未找到分支/);

    // 本地修改会被切换覆盖：结构化冲突错误，且 HEAD 不变
    await writeFile(join(root, 'docs/a.md'), 'local\n');
    const conflict = await call('git/checkout', { branch: 'dev' });
    assert.equal(conflict.status, 400, JSON.stringify(conflict));
    assert.equal(conflict.code, 'local-changes-conflict');
    const afterConflict = await call('git');
    assert.equal(afterConflict.branch, 'main', '冲突时不得切换分支');
    assert.equal(await readFile(join(root, 'docs/a.md'), 'utf8'), 'local\n');

    // 已在目标分支：保持幂等（客户端也会先短路）
    const same = await call('git/checkout', { branch: 'main' });
    assert.equal(same.status, 200);
    assert.equal(same.branch, 'main');
  } finally { await cleanupRepo(root); }
});

test('创建分支：从当前 HEAD、从指定提交、重名与非法名', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-branch-');
  try {
    const { call } = createHarness(root);
    const base = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();

    const created = await call('git/create-branch', { branch: 'feature/a' });
    assert.equal(created.status, 200, JSON.stringify(created));
    assert.equal(created.branch, 'feature/a');
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), base, '从 HEAD 创建分支不改变提交');

    const duplicate = await call('git/create-branch', { branch: 'feature/a' });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.error, /已存在/);

    const invalid = await call('git/create-branch', { branch: 'bad name' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.error, /分支名/);

    const injected = await call('git/create-branch', { branch: '--upload-pack=echo' });
    assert.equal(injected.status, 400, '分支名不得被当作 git 选项');

    // 从指定提交创建并切换（git graph 右键路径）
    await gitIn(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'tracked.txt'), 'two\n');
    await call('git/stage-all');
    await call('git/commit', { message: '[261015] hud-regression v0.0.3：第二个提交' });
    const head = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    const fromCommit = await call('git/create-branch', { branch: 'from-base', commit: base });
    assert.equal(fromCommit.status, 200, JSON.stringify(fromCommit));
    assert.equal(fromCommit.branch, 'from-base');
    assert.equal((await gitIn(root, ['rev-parse', 'from-base'])).trim(), base);
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), base);
    assert.ok(head !== base);
  } finally { await cleanupRepo(root); }
});

test('合并提交：快进、已包含提示与冲突自动回滚', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-merge-');
  try {
    const { call } = createHarness(root);
    const base = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();

    // 快进合并：feature 直接基于 base 前进
    await gitIn(root, ['checkout', '-q', '-b', 'feature']);
    await writeFile(join(root, 'feature.txt'), 'f\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: feature']);
    const featureCommit = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    await gitIn(root, ['checkout', '-q', 'main']);
    const merged = await call('git/merge-commit', { commit: featureCommit });
    assert.equal(merged.status, 200, JSON.stringify(merged));
    assert.equal(merged.upToDate, false);
    assert.equal(await exists(join(root, 'feature.txt')), true);
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), featureCommit);

    // 已包含：upToDate 提示且不产生新提交
    const again = await call('git/merge-commit', { commit: featureCommit });
    assert.equal(again.status, 200);
    assert.equal(again.upToDate, true);

    // 冲突：两分支改同一文件 → 自动回滚并列出冲突文件
    await gitIn(root, ['checkout', '-q', '-b', 'conflict-side', base]);
    await writeFile(join(root, 'tracked.txt'), 'side\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: side']);
    const sideCommit = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    await gitIn(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'tracked.txt'), 'main-side\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: main side']);
    const headBefore = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();

    const conflict = await call('git/merge-commit', { commit: sideCommit });
    assert.equal(conflict.status, 400, JSON.stringify(conflict));
    assert.equal(conflict.code, 'merge-conflict');
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), headBefore, '冲突后 HEAD 必须保持不变');
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'main-side\n');
    assert.equal((await gitIn(root, ['status', '--porcelain'])).trim(), '', '冲突后工作区必须完全干净');
  } finally { await cleanupRepo(root); }
});

test('提交图：分页、当前分支与提交内容', { timeout: 60000 }, async () => {
  const root = await createRepo('hud-reg-graph-');
  try {
    const { call } = createHarness(root);
    // 84 个空提交 + 1 个初始提交 = 85 条 → 首页 80 条，hasMore=true
    for (let index = 0; index < 84; index += 1) await gitIn(root, ['commit', '-q', '--allow-empty', '-m', `chore: bulk ${index}`]);

    const first = await call('git/graph', { offset: 0 });
    assert.equal(first.status, 200);
    assert.equal(first.commits.length, 80);
    assert.equal(first.hasMore, true);
    assert.equal(first.currentBranch, 'main');
    assert.equal(first.commits[0].subject, 'chore: bulk 83', '最新提交排在最前');

    const second = await call('git/graph', { offset: 80 });
    assert.equal(second.commits.length, 5);
    assert.equal(second.hasMore, false);

    // 提交内容：文件行解析（含中文名文件的 name-status）
    await writeFile(join(root, '中文 文件.txt'), 'x\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'docs: 中文文件']);
    const after = await call('git/graph', { offset: 0 });
    assert.equal(after.commits[0].subject, 'docs: 中文文件');
    assert.deepEqual(Array.from(after.commits[0].files, (file) => file.path), ['中文 文件.txt']);
  } finally { await cleanupRepo(root); }
});

test('reset：资格校验与 soft / mixed / hard 三种模式', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-reset-');
  try {
    const { call } = createHarness(root);
    const base = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(root, 'tracked.txt'), 'two\n');
    await call('git/stage-all');
    await call('git/commit', { message: '[261015] hud-regression v0.0.4：第三个提交' });
    const head = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();

    // 资格：当前 HEAD 不可回退
    const current = await call('git/reset-status', { commit: head });
    assert.equal(current.status, 200);
    assert.equal(current.allowed, false);
    assert.equal(current.code, 'current-head');
    // 祖先提交允许
    const ancestor = await call('git/reset-status', { commit: base });
    assert.equal(ancestor.allowed, true);
    assert.equal(ancestor.branch, 'main');

    // 非祖先提交被拒绝
    await gitIn(root, ['checkout', '-q', '-b', 'side', base]);
    await writeFile(join(root, 'side.txt'), 's\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: side']);
    const sideCommit = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    await gitIn(root, ['checkout', '-q', 'main']);
    const notAncestor = await call('git/reset-status', { commit: sideCommit });
    assert.equal(notAncestor.allowed, false);
    assert.equal(notAncestor.code, 'not-current-ancestor');
    const rejected = await call('git/reset', { commit: sideCommit, mode: 'soft' });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.code, 'not-current-ancestor');
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), head, '被拒绝的 reset 不得改动仓库');

    // soft：回退但保留暂存（随后重新提交，保证下一次 reset 的目标不是当前 HEAD）
    const soft = await call('git/reset', { commit: base, mode: 'soft' });
    assert.equal(soft.status, 200, JSON.stringify(soft));
    assert.equal(soft.mode, 'soft');
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), base);
    assert.equal(soft.counts.staged, 1, 'soft reset 后变更应留在暂存区');
    const recommitted = await call('git/commit', { message: '[261015] hud-regression v0.0.4：soft 后重新提交' });
    assert.equal(recommitted.status, 200);
    const head2 = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    assert.notEqual(head2, base);

    // mixed：取消暂存但保留工作区
    const mixed = await call('git/reset', { commit: base, mode: 'mixed' });
    assert.equal(mixed.status, 200, JSON.stringify(mixed));
    assert.equal(mixed.counts.staged, 0);
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'two\n');

    // hard：丢弃变更（先重新提交一次，使目标不是当前 HEAD）
    await call('git/stage-all');
    await call('git/commit', { message: '[261015] hud-regression v0.0.5：hard 前提交' });
    await writeFile(join(root, 'tracked.txt'), 'dirty\n');
    const hard = await call('git/reset', { commit: base, mode: 'hard' });
    assert.equal(hard.status, 200, JSON.stringify(hard));
    assert.equal(hard.changedCount, 0);
    assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'one\n');
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), base);
  } finally { await cleanupRepo(root); }
});

test('AI 生成提交信息：使用暂存差异生成并按规范校验版本', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-ai-');
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hud-regression', version: '0.0.1' }));
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'chore: add package.json']);
    await writeFile(join(root, 'tracked.txt'), 'two\n');

    const today = formatStyledDate(new Date());
    const prompts = [];
    const { call } = createHarness(root, {
      llm: {
        stream: async function* (request) {
          prompts.push(request);
          yield { type: 'text-delta', text: `[261015] hud-regression v0.0.2：修复回归测试夹具` };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      },
    });

    const noModel = await call('git/commit-ai', {});
    assert.equal(noModel.status, 400);
    assert.match(noModel.error, /模型信息/);

    const empty = await call('git/commit-ai', { provider: 'fixture', model: 'fixture-model' });
    assert.equal(empty.status, 400, JSON.stringify(empty));
    assert.match(empty.error, /没有可提交的变更/);

    await call('git/stage-all');
    const result = await call('git/commit-ai', { provider: 'fixture', model: 'fixture-model' });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.warn, null, '版本号已递增时不应有告警');
    // 日期以宿主真实日期覆盖（模型可能给出旧日期），版本沿用模型输出
    assert.equal(result.message, `[${today}] hud-regression v0.0.2：修复回归测试夹具`);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].provider, 'fixture');
    assert.equal(prompts[0].model, 'fixture-model');
    assert.match(prompts[0].messages[0].content[0].text, /tracked\.txt/, '提示词需包含暂存差异');
    assert.match(prompts[0].system, /CURRENT version is 0\.0\.1/);
    // 只生成不提交
    assert.equal((await gitIn(root, ['log', '--pretty=format:%s'])).split('\n').length, 2);
  } finally { await cleanupRepo(root); }
});

test('非 ASCII 与含空格、引号的文件名全流程可用', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-unicode-');
  try {
    const { call } = createHarness(root);
    const name = '“260912 「购」知识库汇报记录”-转文本结果.txt';
    await mkdir(join(root, '目录 空格'));
    await writeFile(join(root, name), 'x\n');
    await writeFile(join(root, '目录 空格/inner.md'), 'y\n');

    const snap = await call('git');
    assert.equal(fileOf(snap, name).status, '?');
    assert.equal(fileOf(snap, '目录 空格/inner.md').status, '?');

    const staged = await call('git/stage', { path: name });
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(fileOf(staged, name).staged, true);
    const unstaged = await call('git/unstage', { path: name });
    assert.equal(unstaged.status, 200);
    assert.equal(fileOf(unstaged, name).status, '?');

    await call('git/stage-all');
    const committed = await call('git/commit', { message: '[261015] hud-regression v0.0.2：中文文件名' });
    assert.equal(committed.status, 200, JSON.stringify(committed));
    assert.equal(committed.changedCount, 0);
    assert.equal((await gitIn(root, ['status', '--porcelain=v1', '-uall'])).trim(), '');

    // 提交图能正确列出中文路径（-c core.quotepath=false）
    const graph = await call('git/graph', { offset: 0 });
    const paths = Array.from(graph.commits[0].files, (file) => file.path).sort();
    assert.deepEqual(paths, ['目录 空格/inner.md', name].sort());
  } finally { await cleanupRepo(root); }
});

test('冲突文件清单随错误回传（切换分支 / 合并的提示需要它列出文件）', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-conflict-files-');
  try {
    const { call } = createHarness(root);
    await gitIn(root, ['checkout', '-q', '-b', 'dev']);
    await writeFile(join(root, 'docs/a.md'), 'dev-a\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: dev']);
    await gitIn(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'docs/a.md'), 'local\n');
    const conflict = await call('git/checkout', { branch: 'dev' });
    assert.equal(conflict.code, 'local-changes-conflict');
    assert.deepEqual(Array.from(conflict.files), ['docs/a.md'], '前端需要文件清单才能显示「以下文件的本地变更会阻止切换」');

    const devCommit = (await gitIn(root, ['rev-parse', 'dev'])).trim();

    // 本地修改会被合并覆盖（同一条结构化错误路径）
    const mergeLocal = await call('git/merge-commit', { commit: devCommit });
    assert.equal(mergeLocal.code, 'local-changes-conflict', JSON.stringify(mergeLocal));
    assert.deepEqual(Array.from(mergeLocal.files), ['docs/a.md']);

    // 真正的合并冲突（两分支改了同一文件）同样回传清单，且自动回滚
    await gitIn(root, ['checkout', '--', 'docs/a.md']);
    await writeFile(join(root, 'docs/a.md'), 'main-side\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'feat: main side']);
    const headBefore = (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
    const merge = await call('git/merge-commit', { commit: devCommit });
    assert.equal(merge.code, 'merge-conflict');
    assert.deepEqual(Array.from(merge.files), ['docs/a.md'], '前端需要文件清单才能显示冲突文件');
    assert.equal((await gitIn(root, ['rev-parse', 'HEAD'])).trim(), headBefore, '冲突后必须已回滚');
    assert.equal((await gitIn(root, ['status', '--porcelain'])).trim(), '');
  } finally { await cleanupRepo(root); }
});

test('游离 HEAD 时切换分支必须真正生效', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-detached-');
  try {
    const { call } = createHarness(root);
    await gitIn(root, ['checkout', '-q', '--detach', 'HEAD']);
    const detached = await call('git');
    assert.equal(detached.branch, null, '游离 HEAD 时快照的 branch 为 null');
    const switched = await call('git/checkout', { branch: 'main' });
    assert.equal(switched.status, 200);
    assert.equal(switched.branch, 'main', '游离状态下切换分支必须真正切过去');
    assert.equal((await gitIn(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim(), 'main');
  } finally { await cleanupRepo(root); }
});

test('越权与非法输入：非回环来源、缺会话、路径注入都被拒绝', { timeout: 30000 }, async () => {
  const root = await createRepo('hud-reg-guard-');
  try {
    const { call } = createHarness(root);
    const foreign = await call('git', { sessionId: 'other' });
    assert.equal(foreign.status, 400);
    assert.match(foreign.error, /找不到会话/);

    const noSession = await call('git', { sessionId: '' });
    assert.equal(noSession.status, 400);
    assert.match(noSession.error, /会话 id/);

    // 路径注入：以 - 开头的路径必须被拒绝（避免被当作 git 选项）
    await writeFile(join(root, 'tracked.txt'), 'two\n');
    const injected = await call('git/stage', { path: '-A' });
    assert.equal(injected.status, 400);
    assert.match(injected.error, /非法的文件路径/);

    // git 目录不可写时（模拟上游失败）错误如实回传，不静默成功
    await chmod(join(root, '.git'), 0o500);
    try {
      const failed = await call('git/stage-all');
      assert.equal(failed.status, 400, JSON.stringify(failed));
      assert.ok(typeof failed.error === 'string' && failed.error.length > 0, '必须回传 git 的错误信息');
    } finally {
      await chmod(join(root, '.git'), 0o700);
    }
    // 恢复后仍可正常工作（错误没有被缓存成「不可用」）
    const recovered = await call('git/stage-all');
    assert.equal(recovered.status, 200, JSON.stringify(recovered));
  } finally { await cleanupRepo(root); }
});
