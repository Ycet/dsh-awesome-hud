// dsh-awesome-hud：「更新日志」最新版本的日期校验 / 自动对齐
//
// 规则（v0.21.8 起）：`CHANGELOG_ENTRIES` 第一条（= 当前 package.json 版本）的 `date`
// 必须等于这个版本最后一次被修改的日期；不一致时改成修改日期。
//
// 三层判定，按顺序：
//   1. 该版本已发布到 npm → **日期永久冻结**，一律不再改写（发布日就是历史，不能漂移）；
//   2. 该版本尚未发布 → 按「修改日期」对齐：
//        a. 插件仓库里这三个文件有未提交改动 → 取其中最新的一次写入时间（mtime）
//        b. 工作树干净 → 取这三个文件最后一次提交的日期（%cs），
//           因此 clone / CI 里不会因为文件时间戳不同而误改历史日期；
//        c. 不是 git 仓库 / git 不可用 → 不判定、不改写；
//   3. 无法确认是否已发布（离线、超时、registry 报错）→ **跳过不改，只提示**，
//      宁可不动也不能在离线时把已发布版本的日期刷掉。
//
// 版本尚未在 CHANGELOG_ENTRIES 里出现（刚改完 package.json、还没补条目）时一律跳过，
// 避免把上一条已发布版本的日期改掉；这种情况由 test/changelog-page.test.mjs 报错提醒。
//
// 用法：
//   node scripts/changelog-date.mjs          # 校验并按需改写
//   node scripts/changelog-date.mjs --check  # 只校验（不一致时退出码 1）
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/** 插件根目录（scripts/ 的上一级）。 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 参与「本版本是否被修改」判定的文件：宿主、客户端与清单。 */
export const TRACKED_FILES = Object.freeze(["lib/client.js", "lib/index.js", "package.json"]);

/** 更新日志数据所在的客户端文件。 */
export const CHANGELOG_FILE = "lib/client.js";

/** 已发布版本的本地缓存（只存 positive，发布后新增的版本下次自然能查到）。 */
export const CACHE_FILE = "node_modules/.cache/dsh-awesome-hud/published.json";

/** 默认 npm registry。 */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** 查询 registry 的超时（毫秒）；超时按「无法确认」处理。 */
const QUERY_TIMEOUT_MS = 8000;

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

/** 从 `.npmrc` 文本里取出 registry；没有返回 null。 */
export function parseRegistryFromNpmrc(text) {
	if (typeof text !== "string") return null;
	for (const line of text.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
		const match = /^registry\s*=\s*(\S+)$/u.exec(trimmed);
		if (match !== null) return match[1].replace(/\/+$/u, "");
	}
	return null;
}

/**
 * 解析 registry 地址：环境变量 → 项目 `.npmrc` → 用户 `~/.npmrc` → 官方源。
 * @returns 去掉尾部斜杠的 registry 地址。
 */
export function resolveRegistry() {
	const fromEnv = process.env.npm_config_registry;
	if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv.replace(/\/+$/u, "");
	for (const file of [join(ROOT, ".npmrc"), join(homedir(), ".npmrc")]) {
		try {
			const found = parseRegistryFromNpmrc(readFileSync(file, "utf8"));
			if (found !== null) return found;
		} catch { /* 文件不存在或不可读：继续找下一个 */ }
	}
	return DEFAULT_REGISTRY;
}

/**
 * 解读一次 packument 查询结果。
 * @param status HTTP 状态码（0 表示请求本身失败）。
 * @param json 解析后的 packument；非 200 时为 null。
 * @param version 要去重的版本号（不带 `v`）。
 * @returns `"published"` 已发布 / `"unpublished"` 明确未发布 / `"unknown"` 无法确认。
 */
export function interpretPackument(status, json, version) {
	if (status === 200) {
		const versions = json?.versions;
		if (versions === null || typeof versions !== "object") return "unknown";
		return Object.hasOwn(versions, version) ? "published" : "unpublished";
	}
	if (status === 404) return "unpublished";
	return "unknown";
}

/**
 * 直接向 registry 查一个版本是否已发布（不依赖 npm CLI，跨平台一致）。
 * 任何异常都归为 `"unknown"`，调用方据此跳过改写。
 * @param name 包名。
 * @param version 版本号（不带 `v`）。
 * @param options.registry registry 地址；缺省自动解析。
 * @param options.timeoutMs 超时毫秒。
 * @returns `"published"` / `"unpublished"` / `"unknown"`。
 */
export async function fetchPublishedState(name, version, options = {}) {
	if (typeof fetch !== "function") return "unknown";
	const registry = options.registry ?? resolveRegistry();
	const url = `${registry.replace(/\/+$/u, "")}/${name.startsWith("@") ? name.replace("/", "%2F") : encodeURIComponent(name)}`;
	// 首次冷启动偶发握手超时：网络层失败时重试一次（HTTP 状态码不重试）。
	const attempts = [options.timeoutMs ?? QUERY_TIMEOUT_MS, Math.max(1000, Math.ceil((options.timeoutMs ?? QUERY_TIMEOUT_MS) / 2))];
	for (const [index, timeoutMs] of attempts.entries()) {
		try {
			const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
			const response = await fetch(url, {
				headers: { accept: "application/vnd.npm.install-v1+json" },
				...(signal === undefined ? {} : { signal }),
			});
			if (response.status !== 200) return interpretPackument(response.status, null, version);
			let json;
			try { json = await response.json(); } catch { return "unknown"; }
			return interpretPackument(200, json, version);
		} catch {
			// 最后一次尝试也失败 → 无法确认。
			if (index === attempts.length - 1) return "unknown";
		}
	}
	return "unknown";
}

/** 读某个 registry 的发布缓存；损坏/不存在都当作空集合。 */
function readPublishedCache(registry) {
	try {
		const json = JSON.parse(readFileSync(join(ROOT, CACHE_FILE), "utf8"));
		const versions = json?.registries?.[registry];
		if (versions === null || typeof versions !== "object") return new Map();
		const cache = new Map();
		for (const [version, published] of Object.entries(versions)) if (published === true) cache.set(version, true);
		return cache;
	} catch {
		return new Map();
	}
}

/** 把「已发布」结论写进缓存（按 registry 分组，互不覆盖）；写不进去也不影响主流程。 */
function writePublishedCache(registry, version) {
	try {
		const file = join(ROOT, CACHE_FILE);
		let json = {};
		try { json = JSON.parse(readFileSync(file, "utf8")); } catch { /* 首次或已损坏：重建 */ }
		const registries = json?.registries !== null && typeof json?.registries === "object" ? json.registries : {};
		const versions = registries[registry] !== null && typeof registries[registry] === "object" ? registries[registry] : {};
		versions[version] = true;
		registries[registry] = versions;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify({ registries }, null, "\t")}\n`, "utf8");
	} catch { /* 缓存只是优化，失败忽略 */ }
}

/**
 * 判断某个版本是否已发布到 npm（优先读本地缓存）。
 * @param name 包名。
 * @param version 版本号（不带 `v`）。
 * @param options.registry / options.timeoutMs / options.fetchState（测试注入用）。
 * @returns `"published"` / `"unpublished"` / `"unknown"`。
 */
export async function isPublishedOnNpm(name, version, options = {}) {
	const registry = options.registry ?? resolveRegistry();
	const cached = readPublishedCache(registry);
	if (cached.has(version)) return "published";
	const fetchState = options.fetchState ?? fetchPublishedState;
	const state = await fetchState(name, version, { registry, timeoutMs: options.timeoutMs });
	if (state === "published") writePublishedCache(registry, version);
	return state;
}

/**
 * 读取当前更新日志的第一条。
 * @param root 插件根目录（测试可指向临时目录）。
 * @returns `{ version, date }`（找不到时抛错）。
 */
export function changelogTopEntry(root = ROOT) {
	const text = readFileSync(join(root, CHANGELOG_FILE), "utf8");
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
 * 已发布到 npm 的版本一律冻结；无法确认发布状态时跳过。
 * @param options.check 只校验不写盘。
 * @param options.root 插件根目录（测试注入）。
 * @param options.expected 直接指定期望日期（测试注入；缺省自动计算）。
 * @param options.isPublished 注入的发布判定函数（测试注入；缺省查 npm）。
 * @returns `{ status, ... }`，status 为 `ok` / `fixed` / `mismatch` / `skipped` / `published`。
 */
export async function syncChangelogDate(options = {}) {
	const root = options.root ?? ROOT;
	const check = options.check === true;
	const entry = changelogTopEntry(root);
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	// 版本还没写进更新日志时跳过：此时第一条是上一个版本，改它等于篡改历史。
	if (entry.version !== `v${manifest.version}`) {
		return { status: "skipped", reason: "version-missing", entry, expected: null, version: manifest.version };
	}
	const expected = options.expected ?? expectedChangelogDate();
	if (expected.date === null) return { status: "skipped", reason: "date-unavailable", entry, expected: expected.date, version: manifest.version };
	// 已发布版本冻结：发布日是历史，任何情况下都不再改写。
	const isPublished = options.isPublished ?? isPublishedOnNpm;
	const publish = await isPublished(manifest.name, manifest.version, options);
	if (publish === "published") {
		return { status: "published", frozen: true, from: entry.date, entry, expected: expected.date, version: manifest.version };
	}
	// 查询不到（离线 / 超时 / registry 异常）：跳过，绝不冒险改已发布版本的日期。
	if (publish !== "unpublished") {
		return { status: "skipped", reason: "publish-unknown", entry, expected: expected.date, version: manifest.version };
	}
	if (entry.date === expected.date) return { status: "ok", from: entry.date, to: expected.date, source: expected.source, version: manifest.version };
	if (check) return { status: "mismatch", from: entry.date, to: expected.date, source: expected.source, version: manifest.version };
	const file = join(root, CHANGELOG_FILE);
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

/** CLI 主流程。 */
async function main() {
	const check = process.argv.includes("--check");
	let result;
	try {
		result = await syncChangelogDate({ check });
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
		case "published":
			console.log(`[changelog-date] ${result.version} 已发布到 npm，日期冻结为 ${result.from}`);
			break;
		case "skipped":
			if (result.reason === "version-missing") console.log(`[changelog-date] package.json 已是 v${result.version}，但更新日志还没有该版本条目，已跳过`);
			else if (result.reason === "publish-unknown") console.log(`[changelog-date] 无法确认 v${result.version} 是否已发布（npm 查询失败），本次跳过`);
			else console.log("[changelog-date] 当前环境无法判定修改日期（非 git 仓库），已跳过");
			break;
		default:
			break;
	}
}

if (invokedDirectly()) await main();
