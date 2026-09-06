// dsh-awesome-hud — git 解析单测
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	statusLetter,
	parsePorcelainZ,
	parseNumstat,
	mergeNumstat,
	normalizeBranch,
	parseBranchList,
	sanitizeGitBranch,
	parseCheckoutConflict,
	parseStatusShort,
	sanitizeGitCommit,
	parseMergeLocalChanges,
	parseMergeConflictFiles,
	anyChange,
} from "../lib/git.js";

test("statusLetter 映射", () => {
	assert.equal(statusLetter("M "), "M");
	assert.equal(statusLetter(" M"), "M");
	assert.equal(statusLetter("A "), "A");
	assert.equal(statusLetter("D "), "D");
	assert.equal(statusLetter("??"), "?");
	assert.equal(statusLetter("!!"), "!");
	assert.equal(statusLetter("R "), "R");
	assert.equal(statusLetter("C "), "C");
	assert.equal(statusLetter(""), "?");
	assert.equal(statusLetter("X"), "?");
});

test("parsePorcelainZ 基本条目", () => {
	const input = " M lib/a.js\0?? docs/b.md\0M  src/x.ts\0";
	const rows = parsePorcelainZ(input);
	assert.equal(rows.length, 3);
	assert.deepEqual(rows[0], { status: "M", path: "lib/a.js", staged: false, unstaged: true });
	assert.deepEqual(rows[1], { status: "?", path: "docs/b.md", staged: false, unstaged: true });
	assert.deepEqual(rows[2], { status: "M", path: "src/x.ts", staged: true, unstaged: false });
});

test("parsePorcelainZ 重命名(新路径在前)与忽略条目", () => {
	// -z 下 R/C 条目：XY new\0old\0
	const input = "R  new.js\0old.js\0!! node_modules\0";
	const rows = parsePorcelainZ(input);
	assert.equal(rows.length, 1);
	assert.deepEqual(rows[0], { status: "R", path: "new.js", oldPath: "old.js", staged: true, unstaged: false });
});

test("parsePorcelainZ staged/unstaged 双列分组", () => {
	// MM：暂存与未暂存均有变更； AM：添加已暂存+内容修改未暂存；D ：删除已暂存； D：删除未暂存
	const input = "MM both.js\0AM staged-plus-modified.txt\0D  deleted-staged.txt\0 D deleted-unstaged.txt\0A  added-staged.txt\0 M modified-unstaged.txt\0?? new-file.txt\0";
	const rows = parsePorcelainZ(input);
	assert.equal(rows.length, 7);
	assert.deepEqual(rows[0], { status: "M", path: "both.js", staged: true, unstaged: true });
	assert.deepEqual(rows[1], { status: "A", path: "staged-plus-modified.txt", staged: true, unstaged: true });
	assert.deepEqual(rows[2], { status: "D", path: "deleted-staged.txt", staged: true, unstaged: false });
	assert.deepEqual(rows[3], { status: "D", path: "deleted-unstaged.txt", staged: false, unstaged: true });
	assert.deepEqual(rows[4], { status: "A", path: "added-staged.txt", staged: true, unstaged: false });
	assert.deepEqual(rows[5], { status: "M", path: "modified-unstaged.txt", staged: false, unstaged: true });
	assert.deepEqual(rows[6], { status: "?", path: "new-file.txt", staged: false, unstaged: true });
});

test("parsePorcelainZ 空输入与多余分隔", () => {
	assert.deepEqual(parsePorcelainZ(""), []);
	assert.deepEqual(parsePorcelainZ("\0\0"), []);
});

test("anyChange", () => {
	assert.equal(anyChange([]), false);
	assert.equal(anyChange([{ status: "?", path: "x" }]), true);
});

test("parseNumstat 常规", () => {
	const output = "32\t0\tprototype/docs/EditLog.md\n0\t2\tother.txt\n";
	const rows = parseNumstat(output);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0], { added: 32, deleted: 0, path: "prototype/docs/EditLog.md" });
	assert.deepEqual(rows[1], { added: 0, deleted: 2, path: "other.txt" });
});

test("parseNumstat 忽略坏行", () => {
	const output = "-\t-\tbinary.png\n12\t3\ta.txt\nbad line\n";
	const rows = parseNumstat(output);
	assert.equal(rows.length, 1);
	assert.deepEqual(rows[0], { added: 12, deleted: 3, path: "a.txt" });
});

test("mergeNumstat 同路径相加", () => {
	const staged = [{ added: 2, deleted: 0, path: "x.js" }];
	const unstaged = [{ added: 1, deleted: 4, path: "x.js" }, { added: 5, deleted: 0, path: "y.md" }];
	const merged = mergeNumstat([staged, unstaged]);
	assert.deepEqual(merged.get("x.js"), { added: 3, deleted: 4 });
	assert.deepEqual(merged.get("y.md"), { added: 5, deleted: 0 });
});

test("normalizeBranch", () => {
	assert.equal(normalizeBranch("main\n"), "main");
	assert.equal(normalizeBranch("feature/x\n"), "feature/x");
	assert.equal(normalizeBranch(""), null);
	assert.equal(normalizeBranch(" \n"), null);
});

test("parseBranchList", () => {
	assert.deepEqual(parseBranchList("main\nfeature/x\ndev\r\n"), ["main", "feature/x", "dev"]);
	assert.deepEqual(parseBranchList(""), []);
	assert.deepEqual(parseBranchList("  \n\nmain\n"), ["main"]);
	assert.deepEqual(parseBranchList(null), []);
});

test("sanitizeGitBranch 合法分支", () => {
	assert.equal(sanitizeGitBranch("main"), "main");
	assert.equal(sanitizeGitBranch("feature/x-1"), "feature/x-1");
	assert.equal(sanitizeGitBranch("release_0.9"), "release_0.9");
	assert.equal(sanitizeGitBranch("主题/分支名"), "主题/分支名");
});

test("sanitizeGitBranch 非法分支", () => {
	assert.equal(sanitizeGitBranch(""), null);
	assert.equal(sanitizeGitBranch("  main"), null);
	assert.equal(sanitizeGitBranch("main "), null);
	assert.equal(sanitizeGitBranch("-x"), null);
	assert.equal(sanitizeGitBranch(".x"), null);
	assert.equal(sanitizeGitBranch("x."), null);
	assert.equal(sanitizeGitBranch("a..b"), null);
	assert.equal(sanitizeGitBranch("a@{b"), null);
	assert.equal(sanitizeGitBranch("a b"), null);
	assert.equal(sanitizeGitBranch("a~b"), null);
	assert.equal(sanitizeGitBranch("a:b"), null);
	assert.equal(sanitizeGitBranch("a*b"), null);
	assert.equal(sanitizeGitBranch("a?b"), null);
	assert.equal(sanitizeGitBranch("a[b"), null);
	assert.equal(sanitizeGitBranch("a\\b"), null);
	assert.equal(sanitizeGitBranch(123), null);
	assert.equal(sanitizeGitBranch("x.lock"), null);
});

test("parseStatusShort（非 -z 兼容路径）", () => {
	const input = " M lib/a.js\nR  old.js -> new.js\n?? untracked.md\n";
	const rows = parseStatusShort(input);
	assert.equal(rows.length, 3);
	assert.deepEqual(rows[1], { status: "R", path: "new.js", oldPath: "old.js" });
	assert.deepEqual(rows[2], { status: "?", path: "untracked.md" });
});

test("parseCheckoutConflict 提取被覆盖文件", () => {
	const stderr = [
		"error: Your local changes to the following files would be overwritten by checkout:",
		"\tdsh-awesome-hud/README.md",
		"\tdsh-awesome-hud/README_en.md",
		"Please commit your changes or stash them before you switch branches.",
		"Aborting",
	].join("\n");
	assert.deepEqual(parseCheckoutConflict(stderr), {
		code: "local-changes-conflict",
		files: ["dsh-awesome-hud/README.md", "dsh-awesome-hud/README_en.md"],
	});
});

test("parseCheckoutConflict 未跟踪文件覆盖也识别", () => {
	assert.deepEqual(parseCheckoutConflict("error: The following untracked working tree files would be overwritten by checkout:\n\tx.txt\nPlease move or remove them before you switch branches.\nAborting"), {
		code: "local-changes-conflict",
		files: ["x.txt"],
	});
});

test("parseCheckoutConflict 非冲突错误返回 null", () => {
	assert.equal(parseCheckoutConflict("fatal: branch not found"), null);
	assert.equal(parseCheckoutConflict(""), null);
	assert.equal(parseCheckoutConflict(null), null);
});

test("sanitizeGitCommit 校验", () => {
	const ok = "a".repeat(40);
	assert.equal(sanitizeGitCommit(ok), ok);
	assert.equal(sanitizeGitCommit(ok.toUpperCase()), ok);
	assert.equal(sanitizeGitCommit(`${ok}0`), null); // 41 位
	assert.equal(sanitizeGitCommit(ok.slice(0, 7)), null); // 短哈希不放行（graph 传全量）
	assert.equal(sanitizeGitCommit(""), null);
	assert.equal(sanitizeGitCommit("  " + ok + "  "), null); // 含空白
	assert.equal(sanitizeGitCommit(null), null);
	assert.equal(sanitizeGitCommit(undefined), null);
	assert.equal(sanitizeGitCommit(ok.replace(/./, "g")), null); // 非 hex
});

test("parseMergeLocalChanges 提取被合并覆盖的文件", () => {
	const stderr = [
		"error: Your local changes to the following files would be overwritten by merge:",
		"\tdsh-awesome-hud/lib/client.js",
		"\tdsh-awesome-hud/package.json",
		"Please commit your changes or stash them before you merge.",
		"Aborting",
	].join("\n");
	assert.deepEqual(parseMergeLocalChanges(stderr), {
		code: "local-changes-conflict",
		files: ["dsh-awesome-hud/lib/client.js", "dsh-awesome-hud/package.json"],
	});
});

test("parseMergeLocalChanges 非覆盖错误返回 null", () => {
	assert.equal(parseMergeLocalChanges("fatal: not a git repository"), null);
	assert.equal(parseMergeLocalChanges(""), null);
	assert.equal(parseMergeLocalChanges(null), null);
});

test("parseMergeConflictFiles 提取 content 冲突路径", () => {
	const stderr = [
		"Auto-merging app.js",
		"CONFLICT (content): Merge conflict in app.js",
		"Auto-merging lib/util.js",
		"CONFLICT (content): Merge conflict in lib/util.js",
		"Automatic merge failed; fix conflicts and then commit the result.",
	].join("\n");
	assert.deepEqual(parseMergeConflictFiles(stderr), ["app.js", "lib/util.js"]);
});

test("parseMergeConflictFiles 提取 modify/delete 冲突路径", () => {
	const stderr = [
		"CONFLICT (modify/delete): docs/old.md deleted in HEAD and modified in 8a2f4c1",
		"CONFLICT (add/add): shared.js added in HEAD and in 8a2f4c1",
		"Automatic merge failed; fix conflicts and then commit the result.",
	].join("\n");
	assert.deepEqual(parseMergeConflictFiles(stderr), ["docs/old.md", "shared.js"]);
});

test("parseMergeConflictFiles 去重且无冲突返回空数组", () => {
	const stderr = [
		"CONFLICT (content): Merge conflict in dup.txt",
		"CONFLICT (content): Merge conflict in dup.txt",
	].join("\n");
	assert.deepEqual(parseMergeConflictFiles(stderr), ["dup.txt"]);
	assert.deepEqual(parseMergeConflictFiles("Auto-merging ok.txt"), []);
	assert.deepEqual(parseMergeConflictFiles(""), []);
	assert.deepEqual(parseMergeConflictFiles(null), []);
});

test("parseMergeLocalChanges 未跟踪文件覆盖也识别（move/remove 收尾）", () => {
	const stderr = [
		"error: The following untracked working tree files would be overwritten by merge:",
		"\tnotes/tmp.md",
		"Please move or remove them before you merge.",
		"Aborting",
	].join("\n");
	assert.deepEqual(parseMergeLocalChanges(stderr), {
		code: "local-changes-conflict",
		files: ["notes/tmp.md"],
	});
});
