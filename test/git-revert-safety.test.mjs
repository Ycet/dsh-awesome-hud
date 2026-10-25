// dsh-awesome-hud — Git 撤销安全回归（真实 git + 真实 host 路由）
//
// 覆盖用户反馈的两类静默失败：
//   1. intent-to-add（git add -N 预登记）文件曾被 git restore 清空内容，必须按未跟踪文件删除；
//   2. 未跟踪目录条目（嵌套仓库/子模块，porcelain 形如 `?? dir/`）git clean -f 删不掉却返回成功，
//      必须显式跳过并上报，而不是提示「已撤销」。
// 同时锁定既有边界：已暂存（A/AM）文件不在 revert 范围内，内容还原但文件保留。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHarness, createRepo, cleanupRepo, fileOf, gitIn } from "./helpers/host-harness.mjs";

const exists = async (path) => stat(path).then(() => true, () => false);

test("intent-to-add：单文件撤销删除文件并清掉索引预登记，不再清空内容", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-revert-ita-");
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, "ita.txt"), "hello\n");
    await gitIn(root, ["add", "-N", "ita.txt"]);

    const before = await call("git");
    const entry = fileOf(before, "ita.txt");
    assert.equal(entry.status, "A");
    assert.equal(entry.intentToAdd, true, "快照必须标记 intent-to-add，客户端才能给出正确确认文案");
    assert.equal(before.counts.unstaged, 1);

    const reverted = await call("git/revert-file", { path: "ita.txt" });
    assert.equal(reverted.status, 200, JSON.stringify(reverted));
    assert.equal(await exists(join(root, "ita.txt")), false, "intent-to-add 文件应被删除，而不是清空后保留");
    assert.equal(reverted.changedCount, 0);
    assert.deepEqual(Array.from(reverted.files), []);
  } finally { await cleanupRepo(root); }
});

test("intent-to-add：revert-all 与已跟踪修改混合时两者都正确处理", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-revert-ita-all-");
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, "ita.txt"), "hello\n");
    await gitIn(root, ["add", "-N", "ita.txt"]);
    await writeFile(join(root, "tracked.txt"), "changed\n");

    const reverted = await call("git/revert-all");
    assert.equal(reverted.status, 200, JSON.stringify(reverted));
    assert.equal(await exists(join(root, "ita.txt")), false);
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\n");
    assert.equal(reverted.changedCount, 0);
    assert.equal(reverted.skippedRevert, undefined, "无跳过条目时不应携带 skippedRevert");
  } finally { await cleanupRepo(root); }
});

test("嵌套仓库目录：单文件撤销明确失败而不是假成功，且不破坏子仓库", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-revert-nested-");
  try {
    const { call } = createHarness(root);
    await mkdir(join(root, "nested"));
    await gitIn(join(root, "nested"), ["init", "-q", "-b", "main"]);
    await writeFile(join(root, "nested/inner.txt"), "x\n");

    const before = await call("git");
    assert.equal(fileOf(before, "nested/").status, "?");
    assert.equal(fileOf(before, "nested/").unstaged, true);

    const reverted = await call("git/revert-file", { path: "nested/" });
    assert.equal(reverted.status, 409, JSON.stringify(reverted));
    assert.match(reverted.error, /嵌套仓库/);
    assert.equal(await exists(join(root, "nested/inner.txt")), true, "不允许删除嵌套仓库内容");
  } finally { await cleanupRepo(root); }
});

test("嵌套仓库目录：revert-all 全部不可撤销时返回 409 并列出条目", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-revert-nested-all-");
  try {
    const { call } = createHarness(root);
    await mkdir(join(root, "nested"));
    await gitIn(join(root, "nested"), ["init", "-q", "-b", "main"]);
    await writeFile(join(root, "nested/inner.txt"), "x\n");

    const reverted = await call("git/revert-all");
    assert.equal(reverted.status, 409, JSON.stringify(reverted));
    assert.match(reverted.error, /nested\//);
    assert.equal(await exists(join(root, "nested/inner.txt")), true);
    const after = await call("git");
    assert.equal(fileOf(after, "nested/").status, "?", "失败后快照应保持原样，界面不会误以为已撤销");
  } finally { await cleanupRepo(root); }
});

test("嵌套仓库目录：revert-all 部分成功时删除可删文件并透传 skippedRevert", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-revert-nested-mixed-");
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, "fresh.txt"), "new\n");
    await mkdir(join(root, "nested"));
    await gitIn(join(root, "nested"), ["init", "-q", "-b", "main"]);
    await writeFile(join(root, "nested/inner.txt"), "x\n");

    const reverted = await call("git/revert-all");
    assert.equal(reverted.status, 200, JSON.stringify(reverted));
    assert.equal(await exists(join(root, "fresh.txt")), false);
    assert.deepEqual(Array.from(reverted.skippedRevert ?? []), ["nested/"], "被跳过的条目必须回传给客户端提示");
    assert.equal(fileOf(reverted, "nested/").status, "?");
  } finally { await cleanupRepo(root); }
});

test("既有边界：已暂存新文件（A/AM）不在 revert 范围，内容还原但文件保留", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-revert-staged-");
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, "staged.txt"), "v1\n");
    await gitIn(root, ["add", "staged.txt"]);
    await writeFile(join(root, "staged.txt"), "v2\n");

    const reverted = await call("git/revert-all");
    assert.equal(reverted.status, 200, JSON.stringify(reverted));
    assert.equal(await readFile(join(root, "staged.txt"), "utf8"), "v1\n", "只还原未暂存部分");
    assert.equal(await exists(join(root, "staged.txt")), true, "已暂存文件不得被 revert 删除");
    assert.equal(reverted.counts.staged, 1);
    assert.equal(reverted.counts.unstaged, 0);
    assert.equal(reverted.skippedRevert, undefined);
  } finally { await cleanupRepo(root); }
});
