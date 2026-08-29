// dsh-awesome-hud — git 解析单测
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	statusLetter,
	parsePorcelainZ,
	parseNumstat,
	mergeNumstat,
	normalizeBranch,
	parseStatusShort,
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
	assert.deepEqual(rows[0], { status: "M", path: "lib/a.js" });
	assert.deepEqual(rows[1], { status: "?", path: "docs/b.md" });
	assert.deepEqual(rows[2], { status: "M", path: "src/x.ts" });
});

test("parsePorcelainZ 重命名(新路径在前)与忽略条目", () => {
	// -z 下 R/C 条目：XY new\0old\0
	const input = "R  new.js\0old.js\0!! node_modules\0";
	const rows = parsePorcelainZ(input);
	assert.equal(rows.length, 1);
	assert.deepEqual(rows[0], { status: "R", path: "new.js", oldPath: "old.js" });
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

test("parseStatusShort（非 -z 兼容路径）", () => {
	const input = " M lib/a.js\nR  old.js -> new.js\n?? untracked.md\n";
	const rows = parseStatusShort(input);
	assert.equal(rows.length, 3);
	assert.deepEqual(rows[1], { status: "R", path: "new.js", oldPath: "old.js" });
	assert.deepEqual(rows[2], { status: "?", path: "untracked.md" });
});
