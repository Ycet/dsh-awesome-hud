// dsh-awesome-hud — v0.21.3：「更新日志」最新版本的日期校验 / 自动对齐
//
// 规则：`CHANGELOG_ENTRIES` 第一条（= 当前 package.json 版本）的 `date`
// 必须等于这个版本最后一次被修改的日期；不一致时改成修改日期。
//
// 「修改日期」的判定：
//   1. 插件仓库里这三个文件有未提交改动 → 取其中最新的一次写入时间（mtime）
//      —— 未提交的改动就是「这次修改」，mtime 是最接近的真实修改时间；
//   2. 工作树干净 → 取这三个文件最后一次提交的日期（%cs），
//      因此 clone / CI 里不会因为文件时间戳不同而误改历史日期；
//   3. 不是 git 仓库 / git 不可用 → 不判定、不改写（避免在没有版本历史的环境里改历史）。
//
// 版本尚未在 CHANGELOG_ENTRIES 里出现（刚改完 package.json、还没补条目）时一律跳过，
// 避免把上一条已发布版本的日期改掉；这种情况由 test/changelog-page.test.mjs 报错提醒。
//
// 用法：
//   node scripts/changelog-date.mjs          # 校验并按需改写
//   node scripts/changelog-date.mjs --check  # 只校验（不一致时退出码 1）
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/** 插件根目录（scripts/ 的上一级）。 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 参与「本版本是否被修改」判定的文件：宿主、客户端与清单。 */
export const TRACKED_FILES = Object.freeze(["lib/client.js", "lib/index.js", "package.json"]);

/** 更新日志数据所在的客户端文件。 */
export const CHANGELOG_FILE = "lib/client.js";

/** 匹配 `CHANGELOG_ENTRIES` 的第一条（版本号 + 日期）。 */
const TOP_ENTRY = /(const CHANGELOG_ENTRIES = \[\s*\{ version: ")(v\d+\.\d+\.\d+)(", date: ")(\d{4}-\d{2}-\d{2})(")/;

/** 把时间格式化成本地时区的 `YYYY-MM-DD`。 */
function localDate(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** 跑一次 git，失败返回 null（不抛错）。 */
function git(args) {
	try {
		return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

/** 文件 mtime 的本地日期；读取失败返回 null。 */
function mtimeDate(file) {
	try { return localDate(statSync(join(ROOT, file)).mtime); } catch { return null; }
}

/**
 * 读取当前更新日志的第一条。
 * @returns `{ version, date, raw }`（找不到时抛错）。
 */
export function changelogTopEntry() {
	const text = readFileSync(join(ROOT, CHANGELOG_FILE), "utf8");
	const match = text.match(TOP_ENTRY);
	if (match === null) throw new Error(`${CHANGELOG_FILE} 里找不到 CHANGELOG_ENTRIES 的第一条`);
	return { version: match[2], date: match[4] };
}

/**
 * 计算最新版本的「修改日期」。
 * @returns `{ date: string | null, source: "dirty" | "commit" | "unavailable", dirty: string[] }`
 *   `date` 为 `null` 表示当前环境无法判定（调用方应跳过，不改历史日期）。
 */
export function expectedChangelogDate() {
	if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") {
		return { date: null, source: "unavailable", dirty: [] };
	}
	const dirty = [];
	for (const file of TRACKED_FILES) {
		const status = git(["status", "--porcelain", "--", file]);
		if (status === null) return { date: null, source: "unavailable", dirty };
		if (status !== "") dirty.push(file);
	}
	// 有未提交改动：mtime 最晚的那个文件就是这次修改的时间。
	if (dirty.length > 0) {
		let newest = null;
		for (const file of dirty) {
			const date = mtimeDate(file);
			if (date !== null && (newest === null || date > newest)) newest = date;
		}
		return { date: newest, source: "dirty", dirty };
	}
	// 工作树干净：用最后一次提交日期，clone / CI 下同样稳定。
	const commit = git(["log", "-1", "--format=%cs", "--", ...TRACKED_FILES]);
	if (commit !== null && /^\d{4}-\d{2}-\d{2}$/.test(commit)) return { date: commit, source: "commit", dirty };
	return { date: null, source: "unavailable", dirty };
}

/**
 * 校验并按需把最新版本的日期改成修改日期。
 * @param options.check 只校验不写盘。
 * @returns `{ status: "ok" | "fixed" | "mismatch" | "skipped", ... }`
 */
export function syncChangelogDate(options = {}) {
	const check = options.check === true;
	const entry = changelogTopEntry();
	const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	// 版本还没写进更新日志时跳过：此时第一条是上一个版本，改它等于篡改历史。
	if (entry.version !== `v${manifest.version}`) {
		return { status: "skipped", reason: "version-missing", entry, expected: null, version: manifest.version };
	}
	const expected = expectedChangelogDate();
	if (expected.date === null) return { status: "skipped", reason: "date-unavailable", entry, expected: expected.date, version: manifest.version };
	if (entry.date === expected.date) return { status: "ok", from: entry.date, to: expected.date, source: expected.source, version: manifest.version };
	if (check) return { status: "mismatch", from: entry.date, to: expected.date, source: expected.source, version: manifest.version };
	const file = join(ROOT, CHANGELOG_FILE);
	const text = readFileSync(file, "utf8");
	// 只替换第一处（`const CHANGELOG_ENTRIES = [` 开头那一条），已发布版本的历史日期保持原样。
	writeFileSync(file, text.replace(TOP_ENTRY, `$1$2$3${expected.date}$5`), "utf8");
	return { status: "fixed", from: entry.date, to: expected.date, source: expected.source, version: manifest.version };
}

/**
 * 判断本模块是否被当作脚本直接运行（被测试 import 时不跑 CLI）。
 * Windows 上路径大小写与前缀都可能不同，因此比较规范化后的绝对路径并忽略大小写。
 */
function invokedDirectly() {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	const self = resolvePath(fileURLToPath(import.meta.url));
	const target = resolvePath(entry);
	return process.platform === "win32" ? self.toLowerCase() === target.toLowerCase() : self === target;
}

// CLI：`node scripts/changelog-date.mjs [--check]`
if (invokedDirectly()) {
	const check = process.argv.includes("--check");
	let result;
	try {
		result = syncChangelogDate({ check });
	} catch (error) {
		console.error(`[changelog-date] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(2);
	}
	switch (result.status) {
		case "ok":
			console.log(`[changelog-date] ${result.version} 的日期 ${result.from} 与修改日期一致`);
			break;
		case "fixed":
			console.log(`[changelog-date] ${result.version} 的日期由 ${result.from} 改为 ${result.to}（依据：${result.source === "dirty" ? "未提交改动的写入时间" : "最后一次提交日期"}）`);
			break;
		case "mismatch":
			console.error(`[changelog-date] ${result.version} 的日期是 ${result.from}，应为 ${result.to}；执行 npm run changelog:date 修正`);
			process.exit(1);
			break;
		case "skipped":
			console.log(result.reason === "version-missing"
				? `[changelog-date] package.json 已是 v${result.version}，但更新日志还没有该版本条目，已跳过`
				: "[changelog-date] 当前环境无法判定修改日期（非 git 仓库），已跳过");
			break;
		default:
			break;
	}
}
