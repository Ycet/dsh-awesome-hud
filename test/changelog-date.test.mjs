// dsh-awesome-hud — 更新日志「最新版本日期」的回归：冻结规则（v0.21.8 起）。
//  1) 第一条版本号必须等于 package.json；
//  2) 该版本已发布到 npm → 日期永久冻结，脚本不改写；
//  3) 尚未发布 → 日期必须等于该版本最后一次修改的日期（有未提交改动取写入时间，干净时取最后一次提交日期）；
//  4) 无法确认发布状态（离线 / 超时）→ 跳过，不误改历史；
//  5) 已发布版本的历史日期（v0.21.7 = 2026-11-23）不能被再次刷新；
//  6) npm test 前置与 changelog:date 脚本接线齐全。
// 新规则的用例全部注入假实现，不联网。
import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CHANGELOG_FILE,
	TRACKED_FILES,
	changelogTopEntry,
	expectedChangelogDate,
	interpretPackument,
	isPublishedOnNpm,
	parseRegistryFromNpmrc,
	syncChangelogDate,
} from "../scripts/changelog-date.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

/** 造一个只含必要文件的临时插件根目录，避免测试写坏真实数据。 */
function makeTempRoot() {
	const dir = mkdtempSync(join(tmpdir(), "hud-changelog-"));
	mkdirSync(join(dir, dirname(CHANGELOG_FILE)), { recursive: true });
	copyFileSync(join(root, CHANGELOG_FILE), join(dir, CHANGELOG_FILE));
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: manifest.name, version: manifest.version }, null, "\t"), "utf8");
	return dir;
}

/** 取出临时目录里第一条的日期。 */
function tempTopDate(dir) {
	return changelogTopEntry(dir).date;
}

test("最新版本日期：已发布则冻结，未发布则等于该版本最后一次修改的日期", async (t) => {
	const entry = changelogTopEntry();
	assert.equal(entry.version, `v${manifest.version}`, "更新日志第一条必须是当前版本");
	assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/u, "日期格式必须是 YYYY-MM-DD");
	const result = await syncChangelogDate({ check: true });
	if (result.status === "published") {
		// 已发布：日期冻结，允许与「最后一次修改日期」不同。
		assert.equal(result.frozen, true, "已发布版本必须标记为冻结");
		return;
	}
	if (result.status === "skipped") {
		t.skip(`当前环境无法判定（${result.reason}）`);
		return;
	}
	const expected = expectedChangelogDate();
	assert.equal(
		entry.date,
		expected.date,
		`v${manifest.version} 的日期是 ${entry.date}，应为 ${expected.date}；执行 npm run changelog:date 修正`,
	);
	assert.equal(result.status, "ok", "只校验模式与自动修正模式必须给出同一个结论");
});

test("已发布版本：日期冻结，且不改写任何字节", async () => {
	const dir = makeTempRoot();
	const before = readFileSync(join(dir, CHANGELOG_FILE), "utf8");
	const result = await syncChangelogDate({ root: dir, isPublished: async () => "published" });
	assert.equal(result.status, "published");
	assert.equal(result.frozen, true);
	assert.equal(readFileSync(join(dir, CHANGELOG_FILE), "utf8"), before, "已发布版本的更新日志不能被改写");
});

test("未发布版本：日期一致时为 ok，不一致时 check 报 mismatch、非 check 写回", async () => {
	const dir = makeTempRoot();
	const entry = changelogTopEntry(dir);
	const same = { date: entry.date, source: "commit", dirty: [] };
	assert.equal((await syncChangelogDate({ root: dir, expected: same, isPublished: async () => "unpublished" })).status, "ok");

	const shifted = { date: "2026-01-02", source: "commit", dirty: [] };
	const mismatch = await syncChangelogDate({ root: dir, expected: shifted, check: true, isPublished: async () => "unpublished" });
	assert.equal(mismatch.status, "mismatch");
	assert.equal(tempTopDate(dir), entry.date, "check 模式不能写盘");

	const fixed = await syncChangelogDate({ root: dir, expected: shifted, isPublished: async () => "unpublished" });
	assert.equal(fixed.status, "fixed");
	assert.equal(tempTopDate(dir), "2026-01-02", "非 check 模式应把首条日期改成修改日期");
});

test("无法确认发布状态：跳过不改，绝不刷新历史日期", async () => {
	const dir = makeTempRoot();
	const before = readFileSync(join(dir, CHANGELOG_FILE), "utf8");
	const result = await syncChangelogDate({ root: dir, expected: { date: "2026-01-02", source: "commit", dirty: [] }, isPublished: async () => "unknown" });
	assert.equal(result.status, "skipped");
	assert.equal(result.reason, "publish-unknown");
	assert.equal(readFileSync(join(dir, CHANGELOG_FILE), "utf8"), before);
});

test("已发布版本的历史日期保持原值（v0.21.7 = 2026-11-23）", () => {
	const text = readFileSync(resolve(root, CHANGELOG_FILE), "utf8");
	const dates = new Map();
	for (const match of text.matchAll(/version: "(v\d+\.\d+\.\d+)", date: "(\d{4}-\d{2}-\d{2})"/gu)) dates.set(match[1], match[2]);
	assert.equal(dates.get("v0.21.7"), "2026-11-23", "v0.21.7 已于 2026-11-23 发布，日期不得再被刷新");
});

test("packument 结果解读：已发布 / 明确未发布 / 无法确认", () => {
	assert.equal(interpretPackument(200, { versions: { "0.21.7": {} } }, "0.21.7"), "published");
	assert.equal(interpretPackument(200, { versions: { "0.21.7": {} } }, "0.21.8"), "unpublished");
	assert.equal(interpretPackument(404, null, "0.21.8"), "unpublished", "包名不存在也按未发布处理");
	assert.equal(interpretPackument(500, null, "0.21.8"), "unknown");
	assert.equal(interpretPackument(200, null, "0.21.8"), "unknown", "响应体丢了也不能判定");
	assert.equal(interpretPackument(0, null, "0.21.8"), "unknown", "请求本身失败");
});

test("registry 解析：.npmrc 取值、去尾斜杠、忽略注释", () => {
	assert.equal(parseRegistryFromNpmrc("registry=https://registry.npmmirror.com/\n"), "https://registry.npmmirror.com");
	assert.equal(parseRegistryFromNpmrc("# registry=https://a.example\n; b\nregistry = https://b.example\n"), "https://b.example");
	assert.equal(parseRegistryFromNpmrc("strict-ssl=true\n"), null);
	assert.equal(parseRegistryFromNpmrc(null), null);
	assert.equal(parseRegistryFromNpmrc("registry=https://c.example\r\n"), "https://c.example", "兼容 Windows 换行");
});

test("已发布判定会读缓存：命中后不再请求 registry", async () => {
	let calls = 0;
	const fake = async () => { calls += 1; return "published"; };
	// 版本号按进程唯一：既有缓存不会命中，避免上一次运行写入的条目干扰用例。
	const registry = "https://registry.invalid";
	const version = `9.9.${process.pid}`;
	assert.equal(await isPublishedOnNpm("dsh-awesome-hud", version, { registry, fetchState: fake }), "published");
	assert.equal(await isPublishedOnNpm("dsh-awesome-hud", version, { registry, fetchState: fake }), "published");
	assert.equal(calls, 1, "第二次应命中本地缓存");
});

test("脚本接线：npm test 前自动对齐，并保留单独修正入口", () => {
	assert.equal(manifest.scripts["changelog:date"], "node scripts/changelog-date.mjs", "提供 changelog:date 脚本");
	assert.equal(manifest.scripts.pretest, "node scripts/changelog-date.mjs", "npm test 前置自动校验并修正日期");
	assert.equal(manifest.files.includes("scripts"), false, "scripts 不随包发布，只用于开发期校验");
	assert.ok(TRACKED_FILES.includes("lib/client.js"), "更新日志数据文件在判定范围内");
	assert.deepEqual([...TRACKED_FILES].sort(), ["lib/client.js", "lib/index.js", "package.json"], "判定范围恰为宿主 / 客户端 / 清单");
});
