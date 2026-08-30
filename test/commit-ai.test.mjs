// dsh-awesome-hud — AI 提交信息规范辅助单测（formatStyledDate / findPackageMeta / extractSessionContext）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatStyledDate, findPackageMeta, extractSessionContext } from "../lib/index.js";

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
