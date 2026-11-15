// dsh-awesome-hud — v0.21.0：Git 文件夹批量操作（paths 数组）
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { createHarness, createRepo, cleanupRepo, gitIn } from "./helpers/host-harness.mjs";

const exists = async (path) => stat(path).then(() => true, () => false);

test("git/stage、git/unstage、git/revert-file 支持 paths 批量（文件夹操作）", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-batch-");
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, "tracked.txt"), "two\n");
    await writeFile(join(root, "docs/a.md"), "a2\n");
    await writeFile(join(root, "new.txt"), "new\n");
    await gitIn(root, ["add", "-N", "new.txt"]); // intent-to-add：revert 时应删除

    const staged = await call("git/stage", { paths: ["tracked.txt", "docs/a.md", "new.txt", "tracked.txt"] });
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(staged.counts.staged, 3, "重复路径去重后三个文件都进入暂存区");

    const unstaged = await call("git/unstage", { paths: ["tracked.txt", "docs/a.md", "new.txt"] });
    assert.equal(unstaged.status, 200, JSON.stringify(unstaged));
    assert.equal(unstaged.counts.staged, 0, "批量移出暂存区");

    const reverted = await call("git/revert-file", { paths: ["tracked.txt", "docs/a.md", "new.txt"] });
    assert.equal(reverted.status, 200, JSON.stringify(reverted));
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\n");
    assert.equal(await readFile(join(root, "docs/a.md"), "utf8"), "a\n");
    assert.equal(await exists(join(root, "new.txt")), false, "intent-to-add 文件应被删除");
    assert.equal(reverted.skippedRevert, undefined);
  } finally { await cleanupRepo(root); }
});

test("git 批量接口：空数组 / 非字符串 / 不在快照中的路径被拒绝", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-batch-invalid-");
  try {
    const { call } = createHarness(root);
    await writeFile(join(root, "tracked.txt"), "two\n");
    const empty = await call("git/stage", { paths: [] });
    assert.equal(empty.status, 400);
    const bad = await call("git/stage", { paths: [42] });
    assert.equal(bad.status, 400);
    const missing = await call("git/stage", { paths: ["missing.txt"] });
    assert.equal(missing.status, 404, "只允许操作当前变更快照中的文件");
    // 单路径旧行为仍可用。
    const single = await call("git/stage", { path: "tracked.txt" });
    assert.equal(single.status, 200, JSON.stringify(single));
    assert.equal(single.counts.staged, 1);
  } finally { await cleanupRepo(root); }
});

test("git/revert-file 批量部分失败：返回 skippedRevert 而不是整体报错", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-batch-skip-");
  try {
    const { call } = createHarness(root);
    // 嵌套仓库目录：git clean -fd 无法删除，revertEntries 会跳过。
    await gitIn(root, ["init", "nested"]);
    await writeFile(join(root, "tracked.txt"), "two\n");
    const before = await call("git");
    assert.equal(before.files.some((file) => file.path === "nested/"), true, "快照应包含嵌套仓库目录条目");
    const reverted = await call("git/revert-file", { paths: ["tracked.txt", "nested/"] });
    assert.equal(reverted.status, 200, JSON.stringify(reverted));
    assert.deepEqual(JSON.parse(JSON.stringify(reverted.skippedRevert)), ["nested/"]);
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\n", "其余文件仍然撤销成功");
  } finally { await cleanupRepo(root); }
});
