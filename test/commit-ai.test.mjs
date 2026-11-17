// dsh-awesome-hud — AI 提交信息规范辅助单测（formatStyledDate / findPackageMeta / 版本校验）
//  v0.21.2：生成不再读取会话上下文，extractSessionContext 及其用例已移除。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatStyledDate, findPackageMeta, pinVersionInMessage } from "../lib/index.js";

test("formatStyledDate：YYMMDD 固定格式", () => {
	assert.equal(formatStyledDate(new Date(2026, 7, 30)), "260830");
	assert.equal(formatStyledDate(new Date(2026, 0, 5)), "260105");
	assert.equal(formatStyledDate(new Date(2030, 11, 1)), "301201");
	assert.equal(formatStyledDate(new Date(2026, 2, 9)), "260309");
});

test("findPackageMeta：自 cwd 向上找到 package.json 的 name/version", async () => {
	const root = await mkdtemp(join(tmpdir(), "hud-meta-"));
	try {
		// 根级别直接存在
		await writeFile(join(root, "package.json"), JSON.stringify({ name: "my-app", version: "1.2.3" }));
		assert.deepEqual(await findPackageMeta(root), { name: "my-app", version: "1.2.3" });
		// 子目录向上查找
		await mkdir(join(root, "sub", "deep"), { recursive: true });
		await writeFile(join(root, "sub", "deep", ".keep"), "");
		const deep = join(root, "sub", "deep");
		assert.deepEqual(await findPackageMeta(deep), { name: "my-app", version: "1.2.3" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("findPackageMeta：字段缺失/坏 JSON/无文件 → null", async () => {
	const root = await mkdtemp(join(tmpdir(), "hud-meta2-"));
	try {
		// 空目录 → null
		assert.equal(await findPackageMeta(root), null);
		// 缺字段
		await writeFile(join(root, "package.json"), JSON.stringify({ name: "x" }));
		assert.equal(await findPackageMeta(root), null);
		// 坏 JSON
		await writeFile(join(root, "package.json"), "{ not json");
		assert.equal(await findPackageMeta(root), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("findPackageMeta：monorepo 根无 package.json 时按 extraDirs 定位子包", async () => {
	const root = await mkdtemp(join(tmpdir(), "hud-meta3-"));
	try {
		// 根目录无 package.json；子包 dsh-awesome-hud 有
		await mkdir(join(root, "dsh-awesome-hud"), { recursive: true });
		await writeFile(join(root, "dsh-awesome-hud", "package.json"), JSON.stringify({ name: "dsh-awesome-hud", version: "0.5.5" }));
		// cwd（根）未命中 → extraDirs（子包目录）命中
		assert.equal(await findPackageMeta(root), null);
		const extraDirs = [join(root, "dsh-awesome-hud")];
		assert.deepEqual(await findPackageMeta(root, extraDirs), { name: "dsh-awesome-hud", version: "0.5.5" });
		// 子目录文件所在目录 → 子包
		assert.deepEqual(await findPackageMeta(root, [join(root, "dsh-awesome-hud", "lib")]), { name: "dsh-awesome-hud", version: "0.5.5" });
		// cwd 命中优先于 extraDirs
		await writeFile(join(root, "package.json"), JSON.stringify({ name: "monorepo-root", version: "1.0.0" }));
		assert.deepEqual(await findPackageMeta(root, extraDirs), { name: "monorepo-root", version: "1.0.0" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("pinVersionInMessage：把版本号校正为项目当前版本（不递增）", () => {
	const pkg = { name: "dsh-awesome-hud", version: "0.21.1" };
	// 模型自作主张升版 → 拉回当前版本
	assert.equal(
		pinVersionInMessage("[261116] dsh-awesome-hud v0.22.0：新增 git 模块", pkg),
		"[261116] dsh-awesome-hud v0.21.1：新增 git 模块");
	// 模型回退版本同样拉回
	assert.equal(
		pinVersionInMessage("[261116] dsh-awesome-hud v0.20.0：修复了登录页面的样式问题", pkg),
		"[261116] dsh-awesome-hud v0.21.1：修复了登录页面的样式问题");
	// 已经是当前版本 → 原样（只替换第一处）
	assert.equal(
		pinVersionInMessage("[261116] dsh-awesome-hud v0.21.1：修复", pkg),
		"[261116] dsh-awesome-hud v0.21.1：修复");
	// 无版本号但已知项目名 → 在日期前缀后补「项目名 v当前版本：」
	assert.equal(
		pinVersionInMessage("[261116] 修复了登录页面的样式问题", pkg),
		"[261116] dsh-awesome-hud v0.21.1：修复了登录页面的样式问题");
	// 无 package.json → 原样返回（不猜版本）
	assert.equal(pinVersionInMessage("[261116] 修复了登录页面的样式问题", null), "[261116] 修复了登录页面的样式问题");
	// 版本号不可用/为空 → 原样返回
	assert.equal(pinVersionInMessage("[261116] dsh-awesome-hud v1.0.0：修复", { name: "x", version: "" }), "[261116] dsh-awesome-hud v1.0.0：修复");
	assert.equal(pinVersionInMessage("", pkg), "");
	assert.equal(pinVersionInMessage(null, pkg), "");
});

test("内置规范：版本号沿用当前版本，不再要求递增", async () => {
	const { LOCAL_COMMIT_SPEC } = await import("../lib/index.js");
	assert.match(LOCAL_COMMIT_SPEC, /当前.*版本号/);
	assert.match(LOCAL_COMMIT_SPEC, /不要递增/);
	assert.doesNotMatch(LOCAL_COMMIT_SPEC, /递增规则|主版本号（x\.y\.z）增加|次版本号（x\.y\.z）增加|修订号（x\.y\.z）增加/);
});
