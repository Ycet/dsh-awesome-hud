import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRefs, parseNameStatusLine, parseGitLogOutput, layoutGraph, slicePage } from "../lib/graph.js";

test("parseRefs：HEAD -> 分支 / 标签 / 远程分支", () => {
	assert.deepEqual(parseRefs("HEAD -> dev"), [
		{ text: "HEAD", kind: "head" },
		{ text: "dev", kind: "branch" },
	]);
	assert.deepEqual(parseRefs("tag: v1.2.3"), [{ text: "v1.2.3", kind: "tag" }]);
	assert.deepEqual(parseRefs("origin/dev"), [{ text: "origin/dev", kind: "branch" }]);
	assert.deepEqual(parseRefs("HEAD -> main, tag: v0.1.4, origin/main"), [
		{ text: "HEAD", kind: "head" },
		{ text: "main", kind: "branch" },
		{ text: "v0.1.4", kind: "tag" },
		{ text: "origin/main", kind: "branch" },
	]);
	assert.deepEqual(parseRefs(""), []);
});

test("parseNameStatusLine：普通/重命名/非法行", () => {
	assert.deepEqual(parseNameStatusLine("M\tpath/to/file.js"), { status: "M", path: "path/to/file.js", oldPath: null });
	assert.deepEqual(parseNameStatusLine("A\tnew.txt"), { status: "A", path: "new.txt", oldPath: null });
	assert.deepEqual(parseNameStatusLine("R100\told.ts\tnew.ts"), { status: "R", path: "new.ts", oldPath: "old.ts" });
	assert.deepEqual(parseNameStatusLine("D\tgone.js"), { status: "D", path: "gone.js", oldPath: null });
	assert.equal(parseNameStatusLine("not-a-status"), null);
	assert.equal(parseNameStatusLine(""), null);
	assert.equal(parseNameStatusLine("M"), null);
	assert.equal(parseNameStatusLine("  M\tpath"), null);
});

test("parseGitLogOutput：保留全部字段并在头行后追加文件清单", () => {
	const text = [
		"a".repeat(40) + "\u001f" + "b".repeat(40) + " " + "d".repeat(40) + "\u001fHEAD -> dev\u001f修复弹窗\u001f2 hours ago",
		"M\tlib/client.js",
		"A\tassets/copy.svg",
		"R100\told.ts\tlib/graph.ts",
		"",
		"b".repeat(40) + "\u001f\u001f\u001f首个提交\u001f3 days ago",
		"D\tgone.js",
		"",
		"not-a-hash\u001f\u001f\u001f非法\u001fnow",
		"A\tafter-illegal.js",
		"",
		"",
	].join("\n");
	const commits = parseGitLogOutput(text);
	assert.equal(commits.length, 2);
	assert.equal(commits[0].hash, "a".repeat(40));
	assert.deepEqual(commits[0].parents, ["b".repeat(40), "d".repeat(40)]);
	assert.deepEqual(commits[0].refs, [{ text: "HEAD", kind: "head" }, { text: "dev", kind: "branch" }]);
	assert.equal(commits[0].subject, "修复弹窗");
	assert.equal(commits[0].date, "2 hours ago");
	assert.deepEqual(commits[0].files, [
		{ status: "M", path: "lib/client.js", oldPath: null },
		{ status: "A", path: "assets/copy.svg", oldPath: null },
		{ status: "R", path: "lib/graph.ts", oldPath: "old.ts" },
	]);
	// 非法提交头行终止文件归属：after-illegal.js 不得挂到任意提交
	assert.deepEqual(commits[1].files, [{ status: "D", path: "gone.js", oldPath: null }]);
});

test("layoutGraph：线性链单泳道", () => {
	const commits = [
		{ hash: "c1", parents: ["c2"] },
		{ hash: "c2", parents: ["c3"] },
		{ hash: "c3", parents: [] },
	];
	const { cols, rows } = layoutGraph(commits);
	assert.equal(cols, 1);
	assert.equal(rows.length, 3);
	assert.deepEqual(rows.map((row) => row.col), [0, 0, 0]);
	assert.deepEqual(rows.map((row) => row.continued), [false, true, true]);
	assert.deepEqual(rows.map((row) => row.edges), [[], [], []]);
});

test("layoutGraph：合并与汇聚（分叉后合流）", () => {
	const commits = [
		{ hash: "a", parents: ["b", "d"] },      // 合并：a 的父 b(main) 与 d(分支汇入)
		{ hash: "d", parents: ["e"] },
		{ hash: "b", parents: ["b1"] },
		{ hash: "b1", parents: ["b2"] },
		{ hash: "e", parents: ["e1"] },
		{ hash: "b2", parents: ["b3"] },
		{ hash: "e1", parents: ["b3"] },          // 汇聚：两泳道合流
		{ hash: "b3", parents: [] },
	];
	const { cols, rows } = layoutGraph(commits);
	assert.equal(cols, 2);
	assert.equal(rows[0].col, 0);
	assert.deepEqual(rows[0].edges, [{ to: 1 }]);
	assert.equal(rows[1].col, 1);                  // d 沿泳道 1
	assert.deepEqual(rows[1].passThrough, [0]);
	assert.equal(rows[6].col, 1);                  // e1 合流回泳道 0
	assert.deepEqual(rows[6].edges, [{ to: 0 }]);
	assert.equal(rows[7].col, 0);
	assert.equal(rows[7].continued, true);
});

test("layoutGraph：多分支追加泳道", () => {
	const commits = [
		{ hash: "m1", parents: ["m2", "f1", "g1"] }, // 三父合并 → 泳道 1、2
		{ hash: "f1", parents: ["f2"] },
		{ hash: "g1", parents: ["g2"] },
		{ hash: "g2", parents: ["m2"] },
		{ hash: "f2", parents: ["m2"] },
		{ hash: "m2", parents: [] },
	];
	const { cols, rows } = layoutGraph(commits);
	assert.equal(cols, 3);
	assert.equal(rows[0].col, 0);
	assert.equal(rows[0].edges.length, 2);
	assert.deepEqual(rows[0].edges.map((edge) => edge.to).sort(), [1, 2]);
	assert.equal(rows[2].col, 2);
});

test("layoutGraph：空输入安全", () => {
	const { cols, rows } = layoutGraph([]);
	assert.equal(cols, 1);
	assert.deepEqual(rows, []);
});

test("slicePage：80 条内无下一页，超出后截断并标记 hasMore", () => {
	const mk = (n) => Array.from({ length: n }, (_, i) => ({ hash: `c${i}`, parents: [] }));
	assert.deepEqual(slicePage(mk(0)), { commits: [], hasMore: false });
	assert.deepEqual(slicePage(mk(80)), { commits: mk(80), hasMore: false });
	const r81 = slicePage(mk(81));
	assert.equal(r81.commits.length, 80);
	assert.equal(r81.hasMore, true);
	assert.equal(r81.commits[79].hash, "c79");
	const r100 = slicePage(mk(100), 80);
	assert.equal(r100.commits.length, 80);
	assert.equal(r100.hasMore, true);
	// 非数组输入安全
	assert.deepEqual(slicePage(null), { commits: [], hasMore: false });
	assert.deepEqual(slicePage(undefined), { commits: [], hasMore: false });
});

test("layoutGraph：分页累计追加后首页各行布局完全不变（跨页泳道连续前提）", () => {
	const mk = (hash, parents) => ({ hash, parents, refs: [], subject: "s", date: "1 hour ago", files: [] });
	const rowOf = (row) => ({ col: row.col, continued: row.continued, edges: row.edges, passThrough: row.passThrough, lane: row.lane, straight: row.straight });
	// 90 提交主链（子前父后）+ 3 提交侧分支（含并入主链的合并提交）
	const commits = [];
	for (let i = 89; i >= 0; i -= 1) commits.push(mk(`m${i}`, i === 0 ? [] : [`m${i - 1}`]));
	commits.push(mk("b2", ["b1", "m85"]));
	commits.push(mk("b1", ["b0"]));
	commits.push(mk("b0", ["m40"]));
	const page1 = commits.slice(0, 80);

	const onlyPage1 = layoutGraph(page1).rows.map(rowOf);
	const cumulative = layoutGraph(commits).rows.slice(0, 80).map(rowOf);
	assert.deepEqual(cumulative, onlyPage1);
	// 夹具有效性：剩余页非空、累计行数与提交总数一致
	assert.equal(commits.length - 80, 13);
	assert.equal(layoutGraph(commits).rows.length, 93);
});
