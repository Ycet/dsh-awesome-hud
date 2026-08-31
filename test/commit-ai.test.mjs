// dsh-awesome-hud — AI 提交信息规范辅助单测（formatStyledDate / findPackageMeta / extractSessionContext / 版本校验）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatStyledDate, findPackageMeta, extractSessionContext, parseVersion, versionIsGreater, validateGeneratedVersion, isUserSpecifiedNote, bumpVersion, fixVersionInMessage } from "../lib/index.js";

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
test("extractSessionContext：提取用户直接消息与助手消息，忽略插件注入", () => {
	const events = [
		{ type: "user/message", seq: 1, data: { role: "user", content: [{ type: "text", text: "修复一下 git 模块的 bug" }], source: { kind: "user" } } },
		{ type: "user/message", seq: 2, data: { role: "user", content: [{ type: "text", text: "工作区文件变更通知" }], source: { kind: "plugin" } } },
		{ type: "assistant/message", seq: 3, data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "好的，我来修复" }] } } },
	];
	const out = extractSessionContext(events);
	assert.ok(out.includes("用户：修复一下 git 模块的 bug"));
	assert.ok(out.includes("助手：好的，我来修复"));
	assert.ok(!out.includes("工作区文件变更通知"), "插件注入消息应被忽略");
});

test("extractSessionContext：多块文本拼接、取最近 N 条、超长截断", () => {
	const events = [];
	for (let i = 1; i <= 12; i++) {
		events.push({ type: "user/message", seq: i, data: { role: "user", content: [{ type: "text", text: `消息${i}` }], source: { kind: "user" } } });
	}
	const out = extractSessionContext(events, 8);
	// 注意：消息10/11/12 是「消息1」的子串，需按整行条目断言
	assert.ok(!/(^|\n)用户：消息[1-4]$/m.test(out), "只保留最近 8 条");
	assert.ok(out.includes("用户：消息12"));
	const count = (out.match(/消息/g) ?? []).length;
	assert.equal(count, 8);
	// 截断
	const tiny = extractSessionContext(events, 8, 20);
	assert.ok(tiny.length <= 20);
});

test("extractSessionContext：非文本块忽略、空输入", () => {
	const events = [
		{ type: "user/message", seq: 1, data: { role: "user", content: [{ type: "image", image: "x" }], source: { kind: "user" } } },
		{ type: "turn/start", seq: 2, data: { turn: 1 } },
	];
	assert.equal(extractSessionContext(events), "");
	assert.equal(extractSessionContext(null), "");
	assert.equal(extractSessionContext([]), "");
});

test("parseVersion / versionIsGreater：提取与逐段数值比较边界", () => {
	assert.deepEqual(parseVersion("v0.6.2"), [0, 6, 2]);
	assert.deepEqual(parseVersion("0.6.2"), [0, 6, 2]); // package.json 无 v 前缀
	assert.deepEqual(parseVersion("version 0.6.2"), [0, 6, 2]); // 宽松接受人类措辞
	assert.deepEqual(parseVersion("[260830] dsh-awesome-hud v1.2.3：修复"), [1, 2, 3]);
	assert.equal(parseVersion("v0.6"), null); // 不足三段
	assert.equal(parseVersion("修复了页面样式"), null);
	assert.equal(parseVersion(""), null);
	assert.equal(parseVersion(null), null);
	// 逐段数值比较（非字符串比较）
	assert.equal(versionIsGreater([0, 6, 10], [0, 6, 2]), true);
	assert.equal(versionIsGreater([0, 7, 0], [0, 6, 99]), true);
	assert.equal(versionIsGreater([1, 0, 0], [0, 99, 99]), true);
	assert.equal(versionIsGreater([0, 6, 2], [0, 6, 2]), false);
	assert.equal(versionIsGreater([0, 6, 1], [0, 6, 2]), false);
	assert.equal(versionIsGreater([1, 5, 0], [2, 0, 0]), false);
	assert.equal(versionIsGreater("bad", [0, 6, 2]), false);
});

test("validateGeneratedVersion：递增通过 / 相等与回退拦截 / 格式异常", () => {
	const current = "0.6.2";
	// 递增通过（修复→修订、新功能→次、破坏性→主）
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.6.3：修复了登录页面的样式问题", current), { ok: true });
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.7.0：新增 git 模块", current), { ok: true });
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v1.0.0：破坏性重构", current), { ok: true });
	// 相等/回退拦截
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.6.2：修复了登录页面的样式问题", current), { ok: false, reason: "not-incremented" });
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.6.0：修复了登录页面的样式问题", current), { ok: false, reason: "not-incremented" });
	// 格式异常（无 vX.Y.Z / 空消息）
	const malformed = validateGeneratedVersion("[260830] dsh-awesome-hud 修复了登录页面的样式问题", current);
	assert.equal(malformed.ok, false);
	assert.equal(malformed.reason, "malformed");
	assert.equal(validateGeneratedVersion("", current).ok, false);
});

test("validateGeneratedVersion：无当前版本/当前版本不可解析时跳过校验", () => {
	// 无 package.json（current 为 null/空）
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.6.2：修复", null), { ok: true });
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.6.2：修复", ""), { ok: true });
	assert.deepEqual(validateGeneratedVersion("随便写点内容", null), { ok: true });
	// 当前版本格式异常 → 跳过校验
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v0.6.2：修复", "not-semver"), { ok: true });
	assert.deepEqual(validateGeneratedVersion("[260830] dsh-awesome-hud v99.99.99：修复", "not-semver"), { ok: true });
});

test("isUserSpecifiedNote：用户明确指定备注时命中，否则不命中", () => {
	const events = [
		{ type: "user/message", seq: 1, data: { role: "user", content: [{ type: "text", text: "请把提交备注写成：修复了登录页面的样式问题" }], source: { kind: "user" } } },
		{ type: "user/message", seq: 2, data: { role: "user", content: [{ type: "text", text: "稍等" }], source: { kind: "user" } } },
		{ type: "user/message", seq: 3, data: { role: "user", content: [{ type: "text", text: "工作区通知" }], source: { kind: "plugin" } } },
		{ type: "assistant/message", seq: 4, data: { role: "assistant", message: { role: "assistant", content: [{ type: "text", text: "好的" }] } } },
	];
	// 命中：生成正文被用户直接消息包含（标点/空白差异不影响）
	assert.equal(isUserSpecifiedNote("[260830] dsh-awesome-hud v0.6.2：修复了登录页面的样式问题", events), true);
	// 未命中：正文不在任何用户直接消息中
	assert.equal(isUserSpecifiedNote("[260830] dsh-awesome-hud v0.7.1：新增批量暂存功能", events), false);
	// events 不可用 → false
	assert.equal(isUserSpecifiedNote("[260830] dsh-awesome-hud v0.7.1：新增批量暂存功能", null), false);
	assert.equal(isUserSpecifiedNote("[260830] dsh-awesome-hud v0.7.1：新增批量暂存功能", [null, undefined]), false);
});

test("bumpVersion：按变更类型计算目标版本（修复→修订、新增→次、破坏→主、缺省→修订）", () => {
	// 修复/文档/性能 → 修订号 +1
	assert.equal(bumpVersion("0.6.4", "修复了登录页面的样式问题"), "0.6.5");
	assert.equal(bumpVersion("0.6.4", "更新 README 文档"), "0.6.5");
	assert.equal(bumpVersion("0.6.4", ""), "0.6.5");
	assert.equal(bumpVersion("0.6.4", "性能优化"), "0.6.5");
	// 新增功能 → 次版本 +1，修订归零
	assert.equal(bumpVersion("0.6.4", "新增 git 模块"), "0.7.0");
	assert.equal(bumpVersion("0.6.4", "新增了一个新接口"), "0.7.0");
	assert.equal(bumpVersion("0.6.4", "feat: add feature"), "0.7.0");
	// 破坏/重大重构 → 主版本 +1，次修归零
	assert.equal(bumpVersion("0.6.4", "破坏性变更，无法兼容旧版本"), "1.0.0");
	assert.equal(bumpVersion("0.6.4", "breaking change"), "1.0.0");
	// 当前版本不可解析 → null
	assert.equal(bumpVersion("not-semver", "修复"), null);
	assert.equal(bumpVersion(null, "修复"), null);
});

test("fixVersionInMessage：强制替换/补充版本号", () => {
	const pkg = { name: "dsh-awesome-hud", version: "0.6.4" };
	// 模型未递增（仍为当前版本）→ 按修复类内容强制 0.6.5
	assert.equal(
		fixVersionInMessage("[260831] dsh-awesome-hud v0.6.4：修复了登录页面的样式问题", pkg, "0.6.4"),
		"[260831] dsh-awesome-hud v0.6.5：修复了登录页面的样式问题");
	// 新增功能内容 → 次版本
	assert.equal(
		fixVersionInMessage("[260831] dsh-awesome-hud v0.6.4：新增 git 模块", pkg, "0.6.4"),
		"[260831] dsh-awesome-hud v0.7.0：新增 git 模块");
	// 无版本号但已知项目名 → 在日期后补「项目名 v目标：」
	assert.equal(
		fixVersionInMessage("[260831] 修复了登录页面的样式问题", pkg, "0.6.4"),
		"[260831] dsh-awesome-hud v0.6.5：修复了登录页面的样式问题");
	// 无版本号且项目名未知 → 原样返回
	assert.equal(fixVersionInMessage("[260831] 修复了登录页面的样式问题", null, "0.6.4"), "[260831] 修复了登录页面的样式问题");
	// 当前版本不可解析 → 原样返回
	assert.equal(fixVersionInMessage("[260831] dsh-awesome-hud v0.6.4：修复", pkg, "bad"), "[260831] dsh-awesome-hud v0.6.4：修复");
});
