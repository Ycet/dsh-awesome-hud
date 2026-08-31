// dsh-awesome-hud — host half
//
// 职责：
//   1. /awesome-hud/api/*   JSON API（信任围栏：回环/受信 + 同源）：
//        git         → {isRepo, branch, changedCount, files:[{status,path,added,deleted}]}
//        git/graph   → {commits:[...]}（失败时 {commits:null,error}）
//        subagents   → {entries:[{id,mode,activity,depth,parentId,label?}]}
//        mcp         → {servers:[{name,enabled,entryId}], enabled, total}（dsh 全局启停）
//        mcp/toggle  → 同上（写入 profile cordis.patch.yml 托管块，页面经 HMR 刷新生效）
//        compact     → {ok}（agent 运行中 → 409 busy；服务缺失 → 503）
//        settings    → GET {modules} / POST {modules} → {ok, modules}
//   2. /awesome-hud/assets/*  只读 SVG 图标白名单（GET）
//   3. ctx.settings（可选）：注册 awesome-hud 命名空间（模块勾选可见性）
import { readFile, writeFile } from "node:fs/promises";
import { rename } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { isTrustedRequest } from "./trust.js";
import { parsePorcelainZ, parseNumstat, mergeNumstat, normalizeBranch } from "./git.js";
import { collectMcpServers, readMcpStates, writeMcpStates, sanitizeSessionId, sanitizeServerName } from "./mcp.js";
import { parseGitLogOutput } from "./graph.js";
import { normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, modulesOf, usageDisplayOf } from "./settings.js";
import { scanPlanEvents } from "./plans.js";

export const name = "dsh-awesome-hud";
export const inject = ["webServer"];

const PREFIX = "/awesome-hud/api";
const ASSET_PREFIX = "/awesome-hud/assets";
const ASSET_TYPES = Object.freeze({
	"hud-toggle.svg": "svg",
	"session.svg": "svg",
	"context.svg": "svg",
	"git.svg": "svg",
	"git-graph.svg": "svg",
	"copy.svg": "svg",
	"subagents.svg": "svg",
	"tasks.svg": "svg",
	"tasks-done.svg": "svg",
	"tasks-todo.svg": "svg",
	"mcp.svg": "svg",
	"settings.svg": "svg",
	"balance.svg": "svg",
	"deepseek.svg": "svg",
	"icon-opencode.svg": "svg",
	"plans.svg": "svg",
	"commit.svg": "svg",
	"revert.svg": "svg",
	"ai-generate.svg": "svg",
});
const ASSETS_DIR = fileURLToPath(new URL("../assets/icons/", import.meta.url));

/** 设置命名空间：模块勾选可见性。 */
const AwesomeHudSettingsSchema = z.object({
	version: z.number().default(1),
	modules: z.object({
		context: z.boolean().default(true),
		git: z.boolean().default(true),
		subagents: z.boolean().default(true),
		tasks: z.boolean().default(true),
		mcp: z.boolean().default(true),
		balance: z.boolean().default(true),
		plans: z.boolean().default(true),
	}),
	usage: z.object({
		deepseek: z.boolean().default(true),
		opencode: z.boolean().default(true),
	}),
});

function writeJson(res, status, value) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let bytes = 0;
		req.on("data", (chunk) => {
			bytes += chunk.length;
			if (bytes > 64 * 1024) { reject(new Error("request body too large")); req.destroy(); return; }
			chunks.push(chunk);
		});
		req.on("end", () => {
			try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (error) { reject(error); }
		});
		req.on("error", reject);
	});
}

/** 从 session store 解析会话的工作区 cwd（客户端只允许传 sessionId）。 */
export function resolveSessionCwd(sessions, sessionId) {
	if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("缺少会话 id");
	if (sessions === undefined || sessions === null) throw new Error("会话服务不可用");
	const session = sessions.get(sessionId);
	if (session === undefined) throw new Error(`找不到会话 ${sessionId}`);
	const cwd = session?.header?.cwd;
	if (typeof cwd !== "string" || cwd.length === 0) throw new Error("该会话没有工作区记录");
	if (!isAbsolute(cwd)) throw new Error(`会话工作区路径不是绝对路径：${cwd}`);
	return cwd;
}

/** 允许的资产文件名（天然防路径穿越）。 */
export function assetFileFor(fileName) {
	const kind = ASSET_TYPES[fileName];
	if (!kind) throw new Error(`unknown asset: ${fileName}`);
	return { path: join(ASSETS_DIR, fileName), contentType: "image/svg+xml" };
}

/** 原子写文本：写临时文件后 rename，避免 HMR 读到半写文件。 */
async function atomicWrite(path, content) {
	const tmp = `${path}.dsh-awesome-hud-${process.pid}.tmp`;
	await writeFile(tmp, content, "utf8");
	await rename(tmp, path);
}

/**
 * 从 Loader 解析当前 profile 目录（根 include 的 config.path 指向 profile/cordis.yml）。
 * 拿不到时返回 null（调用方按 503 抛出）。
 */
export function profileDirOf(loader) {
	try {
		const entry = loader.resolve("include");
		const path = entry?.options?.config?.path;
		if (typeof path === "string" && path.startsWith("file:")) {
			return dirname(fileURLToPath(path));
		}
	} catch { /* include 条目不存在 */ }
	return null;
}

/** 执行一次 git 只读命令并回流 stdout 文本。 */
async function runGit(subprocess, cwd, args, timeoutMs = 5000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const handle = subprocess.spawn({
			argv: ["git", ...args],
			cwd,
			stdio: {
				stdin: "null",
				stdout: { maxBytes: 1024 * 1024 },
				stderr: { maxBytes: 64 * 1024 },
			},
			graceMs: 2000,
			signal: controller.signal,
		});
		const outcome = await handle.done;
		const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
		const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
		return { exitCode: outcome.exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

/** 采集 git 工作区快照（只读；解析逻辑见 git.js）。 */
export async function collectGitSnapshot(subprocess, cwd, now = Date.now) {
	const isRepo = await runGit(subprocess, cwd, ["rev-parse", "--is-inside-work-tree", "--git-dir"]);
	if (isRepo.exitCode !== 0) return { isRepo: false, at: now() };
	const branchRaw = await runGit(subprocess, cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
	const branch = normalizeBranch(branchRaw.stdout) ?? null;
	const statusRaw = await runGit(subprocess, cwd, ["status", "--porcelain=v1", "-z", "-uall"]);
	const entries = parsePorcelainZ(statusRaw.stdout);
	const stagedRaw = await runGit(subprocess, cwd, ["diff", "--cached", "--numstat"]);
	const unstagedRaw = await runGit(subprocess, cwd, ["diff", "--numstat"]);
	const numstat = mergeNumstat([parseNumstat(stagedRaw.stdout), parseNumstat(unstagedRaw.stdout)]);

	// 未跟踪文件 → 全新增行数（diff --no-index 每文件一次；数量过多时跳过行数统计）
	const untracked = entries.filter((entry) => entry.status === "?");
	const capLines = untracked.length > 200;
	const files = [];
	for (const entry of entries) {
		const counts = numstat.get(entry.path);
		if (entry.status === "?") {
			if (!capLines) {
				const raw = await runGit(subprocess, cwd, ["diff", "--no-index", "--numstat", "/dev/null", entry.path]);
				const rows = parseNumstat(raw.stdout);
				const value = mergeNumstat([rows]).get(entry.path);
				files.push({
					status: entry.status,
					path: entry.path,
					staged: entry.staged,
					unstaged: entry.unstaged,
					added: value?.added ?? null,
					deleted: null,
					untrackedCounted: true,
				});
			} else {
				files.push({ status: entry.status, path: entry.path, staged: entry.staged, unstaged: entry.unstaged, added: null, deleted: null, untrackedCounted: false });
			}
		} else {
			files.push({
				status: entry.status,
				path: entry.path,
				staged: entry.staged,
				unstaged: entry.unstaged,
				added: counts?.added ?? 0,
				deleted: counts?.deleted ?? 0,
				untrackedCounted: false,
			});
		}
	}
	const counts = {
		staged: files.filter((file) => file.staged === true).length,
		unstaged: files.filter((file) => file.unstaged === true).length,
	};
	// 可被 revert-all 撤销的已跟踪未暂存文件数（未跟踪文件保留，不可 revert）
	const revertable = files.filter((file) => file.unstaged === true && file.status !== "?").length;
	return { isRepo: true, branch, changedCount: entries.length, files, counts, revertable, at: now() };
}

/** 校验路径参数：非空、长度受限、不以 - 开头（配合 -- 分隔符防选项注入）。 */
function sanitizeGitPath(path) {
	if (typeof path !== "string") throw new Error("缺少合法的文件路径");
	const trimmed = path.trim();
	if (trimmed === "" || trimmed.length > 4096) throw new Error("缺少合法的文件路径");
	if (trimmed.startsWith("-")) throw new Error("非法的文件路径");
	return trimmed;
}

/** 从快照校验路径确实存在于当前变更列表（防对任意文件的写操作）。 */
function fileOfSnapshot(snapshot, path) {
	const file = snapshot.files.find((item) => item.path === path);
	if (file === undefined) throw Object.assign(new Error(`未找到变更文件「${path}」`), { status: 404 });
	return file;
}

const MAX_AI_DIFF_BYTES = 16 * 1024;
const AI_TIMEOUT_MS = 60 * 1000;

/**
 * 本地 git 提交规范（内置固定文本，不再读取用户的 AGENTS.md；与
 * Git&Github 提交规范.md 的「本地 git 仓库提交规范」一致）。
 */
const LOCAL_COMMIT_SPEC = [
	"当用户需要将当前版本提交到本地 Git 仓库时，须按以下规则生成提交备注信息：",
	"- 备注格式为 [时间] 修改内容，例如 [260605] 修复了登录页面的样式问题",
	"  - 时间格式：取系统当前时间，固定格式为 YYMMDD（年份取后两位+月份+日期），例如 260101 表示 2026 年 1 月 1 日",
	"  - 修改内容：用简短的一句话总结该版本修改的所有内容",
	"- 若用户明确说明了备注信息，则直接使用用户指定的备注内容",
	"- 若该项目为开发项目，则提交信息必须加上「开发项目名称」和「开发项目版本号」，即 [YYMMDD] 开发项目名称 vx.x.x：修改内容",
	"  - 版本号递增规则（必须严格遵守）：",
	"    - 主版本号（x.y.z）增加：当包含破坏性变更或无法兼容旧版本的重大重构时，将第一位数字 +1。一旦主版本升级，次版本和修订号归零（变为 2.0.0）。",
	"    - 次版本号（x.y.z）增加：当提交中包含向后兼容的新功能时（例如新增了一个模块、增加了一个新接口、新增了一个页面），将第二位数字 +1。次版本升级时，修订号归零（变为 1.1.0）。",
	"    - 修订号（x.y.z）增加：当提交仅包含向后兼容的 Bug 修复、文档修改或性能优化（不涉及新功能，不破坏兼容性）时，将第三位数字 +1（变为 1.0.1）。",
].join("\n");

/** YYMMDD 格式化（固定 Date 输入，纯函数便于单测）。 */
export function formatStyledDate(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** 消息 content 块数组 → 纯文本（text 块拼接，其余类型跳过）。 */
function contentText(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("").trim();
}

/**
 * 从会话日志提取最近对话上下文文本：保留「用户直接消息」（source.kind === 'user'）
 * 与全部 assistant/message（模型最近在做什么），其余插件注入/通知类消息忽略。
 * 返回最近 maxEntries 条拼接文本（总长上限 maxBytes 截断）；无可用消息返回 ""。
 */
export function extractSessionContext(events, maxEntries = 8, maxBytes = 8 * 1024) {
	if (!Array.isArray(events)) return "";
	const messages = [];
	for (const event of events) {
		if (event === null || typeof event !== "object") continue;
		if (event.type === "user/message") {
			const source = event.data?.source;
			if (source?.kind !== "user") continue;
			const text = contentText(event.data?.message?.content ?? event.data?.content);
			if (text !== "") messages.push({ role: "user", text });
		} else if (event.type === "assistant/message") {
			const text = contentText(event.data?.message?.content);
			if (text !== "") messages.push({ role: "assistant", text });
		}
	}
	const recent = messages.slice(-maxEntries);
	let total = 0; // 含各条之间的 \n 分隔符
	const parts = [];
	for (const item of recent) {
		const line = `${item.role === "user" ? "用户" : "助手"}：${item.text}`;
		const sep = parts.length === 0 ? 0 : 1;
		const fit = maxBytes - total - sep;
		if (fit <= 0) break;
		const take = line.length > fit ? line.slice(0, fit) : line;
		parts.push(take);
		total += sep + take.length;
	}
	return parts.join("\n");
}

/** 消息中提取 vX.Y.Z → [major, minor, patch]；未找到或格式异常返回 null。 */
export function parseVersion(text) {
	if (typeof text !== "string") return null;
	const match = text.match(/\bv?(\d+)\.(\d+)\.(\d+)\b/); // v 前缀可选：兼容 package.json 的 "0.6.2" 与消息内的 "v0.6.2"
	if (match === null) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 逐段数值比较：candidate 是否严格大于 current（三个数值段逐位比较）。 */
export function versionIsGreater(candidate, current) {
	if (!Array.isArray(candidate) || !Array.isArray(current) || candidate.length !== 3 || current.length !== 3) return false;
	for (let i = 0; i < 3; i++) {
		if (!Number.isInteger(candidate[i]) || !Number.isInteger(current[i])) return false;
		if (candidate[i] > current[i]) return true;
		if (candidate[i] < current[i]) return false;
	}
	return false;
}

/**
 * 校验生成消息中的版本号是否严格高于当前版本（逐段数值比较）。
 * currentVersion 缺失或无法解析时跳过校验（{ok:true}）。
 * 返回 {ok, reason?}：reason 为 "malformed"（无合法 vX.Y.Z）或 "not-incremented"（未递增/回退）。
 */
export function validateGeneratedVersion(message, currentVersion) {
	const text = typeof message === "string" ? message.trim() : "";
	if (text === "") return { ok: false, reason: "malformed" };
	if (typeof currentVersion !== "string" || currentVersion.trim() === "") return { ok: true };
	const current = parseVersion(currentVersion);
	if (current === null) return { ok: true };
	const generated = parseVersion(text);
	if (generated === null) return { ok: false, reason: "malformed" };
	return versionIsGreater(generated, current) ? { ok: true } : { ok: false, reason: "not-incremented" };
}

/**
 * 会话上下文中用户是否明确指定了该提交备注：生成消息「：」后的正文
 * （去空白/标点规范化后）被任一最近用户直接消息文本包含 → 视为用户指定。
 * 用于跳过版本校验与重试（规范：用户指定优先）。events 不可用时返回 false。
 */
export function isUserSpecifiedNote(message, events) {
	if (typeof message !== "string" || message.trim() === "" || !Array.isArray(events)) return false;
	const body = message.includes("：") ? message.split("：").slice(1).join("：").trim() : message.trim();
	if (body === "") return false;
	const normalize = (value) => value.replace(/\s+/g, "").replace(/[，。！？、,.!?;；:：""''（）()【】\[\]]/g, "");
	const needle = normalize(body);
	if (needle === "") return false;
	for (const event of events) {
		if (event === null || typeof event !== "object" || event.type !== "user/message") continue;
		const source = event.data?.source;
		if (source?.kind !== "user") continue;
		const text = contentText(event.data?.message?.content ?? event.data?.content);
		if (text === "") continue;
		const hay = normalize(text);
		if (hay !== "" && hay.includes(needle)) return true;
	}
	return false;
}

/**
 * 从目录向上逐级查找最近的 package.json，解析 {name, version}；找不到返回 null。
 */
async function packageMetaFromDir(dir) {
	for (;;) {
		const candidate = join(dir, "package.json");
		try {
			const text = await readFile(candidate, "utf8");
			const parsed = JSON.parse(text);
			if (parsed !== null && typeof parsed === "object" && typeof parsed.name === "string" && parsed.name.trim() !== "" && typeof parsed.version === "string" && parsed.version.trim() !== "") {
				return { name: parsed.name.trim(), version: parsed.version.trim() };
			}
		} catch { /* 该级没有可解析的 package.json */ }
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * 查找本次提交所属开发项目的 {name, version}：
 * 1) 会话工作区 cwd 向上逐级查找；
 * 2) cwd 无果时，依次用 extraDirs（暂存文件所在目录）向上查找
 *    —— 覆盖 monorepo 根目录无 package.json、子包内提交的场景。
 * 全部未命中返回 null。
 */
export async function findPackageMeta(cwd, extraDirs = []) {
	const hit = await packageMetaFromDir(cwd);
	if (hit !== null) return hit;
	for (const dir of extraDirs) {
		if (typeof dir !== "string" || dir === "") continue;
		const found = await packageMetaFromDir(dir);
		if (found !== null) return found;
	}
	return null;
}

/**
 * 按生成内容判断变更类型并计算应递增到的目标版本（确定性兜底，供模型不遵循递增规则时使用）。
 * 破坏性/重大重构 → 主版本+1（次修归零）；新增功能 → 次版本+1（修归零）；其余（修复/文档/性能）→ 修订号+1。
 * 当前版本不可解析返回 null。
 */
export function bumpVersion(currentVersion, content) {
	const parts = parseVersion(currentVersion);
	if (parts === null) return null;
	const text = typeof content === "string" ? content : "";
	if (/破坏|不兼容|breaking|重大重构/.test(text)) return `${parts[0] + 1}.0.0`;
	if (/新增|新功能|增加|feat|feature/.test(text)) return `${parts[0]}.${parts[1] + 1}.0`;
	return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * 把消息中的版本号强制改为按变更类型计算的目标版本（版本校验重试仍失败时的确定性兜底）。
 * 消息含 vX.Y.Z → 直接替换为目标版本；不含但已知项目名 → 在日期前缀后补「项目名 vX.Y.Z：」；否则原样返回。
 */
export function fixVersionInMessage(message, pkg, currentVersion) {
	const text = typeof message === "string" ? message : "";
	if (text === "") return text;
	const content = text.includes("：") ? text.split("：").slice(1).join("：") : text;
	const target = bumpVersion(currentVersion, content);
	if (target === null) return text;
	const versionPattern = /\bv(\d+)\.(\d+)\.(\d+)\b/;
	if (versionPattern.test(text)) return text.replace(versionPattern, `v${target}`);
	if (pkg !== null && typeof pkg.name === "string" && pkg.name !== "") {
		return text.replace(/^(\[\d{6}\]\s*)/, `$1${pkg.name} v${target}：`);
	}
	return text;
}

/** 用当前会话模型生成提交信息（按内置本地 git 提交规范，llm.stream 拼接 text-delta）。
 * 返回 {message, warn}：warn 为 "version-not-incremented" 表示重试后版本仍不达标且程序化修正不可用（原样返回交由前端提示）；其余情况 warn 为 null。失败抛错。 */
export async function generateCommitMessage(ctx, subprocess, cwd, provider, model, sessionId) {
	if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") {
		throw new Error("缺少当前会话模型信息");
	}
	const llm = ctx.get("llm");
	if (llm === undefined) throw Object.assign(new Error("模型服务不可用"), { status: 503 });
	const diffRaw = await runGit(subprocess, cwd, ["diff", "--staged"]);
	if (diffRaw.exitCode !== 0) throw Object.assign(new Error(diffRaw.stderr.trim() || "读取暂存区差异失败"), { status: 400 });
	const diffText = diffRaw.stdout;
	if (diffText.trim() === "") throw Object.assign(new Error("暂存区没有可提交的变更"), { status: 400 });
	const body = diffText.length > MAX_AI_DIFF_BYTES ? diffText.slice(0, MAX_AI_DIFF_BYTES) : diffText;
	const today = formatStyledDate(new Date());
	// 项目元信息：cwd 优先；monorepo 根无 package.json 时，按暂存文件所在目录定位所属包
	const nameOnly = await runGit(subprocess, cwd, ["diff", "--staged", "--name-only"]);
	const extraDirs = nameOnly.exitCode === 0
		? nameOnly.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "").map((line) => dirname(join(cwd, line)))
		: [];
	const pkg = await findPackageMeta(cwd, extraDirs);
	// 当前会话最近对话上下文与事件（用户直接消息与助手消息；供理解改动意图、采纳用户指定的备注）
	let sessionContext = "";
	let sessionEvents = null;
	if (typeof sessionId === "string" && sessionId !== "") {
		try {
			const session = ctx.get("sessions")?.get(sessionId);
			if (session !== undefined) {
				sessionEvents = Array.isArray(session.events) ? session.events : null;
				sessionContext = extractSessionContext(sessionEvents ?? []);
			}
		} catch { /* 上下文不可用时忽略 */ }
	}
	const system = [
		"You are a git commit message generator embedded in DeepSeek Harness. You generate a message for a LOCAL git commit run on the user's machine (not a GitHub PR, never Conventional Commits).",
		"Follow this local commit convention EXACTLY:",
		LOCAL_COMMIT_SPEC,
		`Today's date in YYMMDD is ${today}; always use it for the [时间] prefix.`,
		pkg === null
			? "(No package.json with name/version was found in the workspace; generate the message in the plain format [YYMMDD] 修改内容.)"
			: `The project name is ${pkg.name} and its CURRENT version is ${pkg.version}. This is a development project, so the message MUST include the project name and a version number in the exact form [YYMMDD] ${pkg.name} v<new-version>：修改内容 (full-width Chinese colon). <new-version> must STRICTLY follow the versioning rules above: breaking change(s) bump the MAJOR (minor and patch reset to 0), backward-compatible new feature(s) bump the MINOR (patch resets to 0), and bug fixes / documentation / performance changes bump the PATCH. <new-version> must always be GREATER THAN the current version ${pkg.version}; NEVER output the current version unchanged, and never a lower version.`,
		sessionContext === ""
			? ""
			: `Recent conversation context of the current session (user messages and assistant replies; use it to understand what this change is about, and if the user explicitly specified a commit note or message in the conversation, use it verbatim — it takes precedence over the diff):\n${sessionContext}`,
		"If the user has already specified the note text, use it verbatim.",
		"Write the 修改内容 in Chinese unless the primary language of the changed files suggests otherwise.",
		"Reply with ONLY the commit message itself: one line, no markdown fences, no prefixes, no commentary.",
	].filter((part) => part !== "").join("\n\n");
	const prompt = [
		"Generate one commit message according to the local convention above (a one-line message beginning with [YYMMDD], including the project name and version when a package.json was found). Do not wrap it in anything.",
		"",
		`Today's date is ${today}; the [YYMMDD] time prefix MUST be exactly ${today}.`,
		"",
		"Staged changes (git diff --staged):",
		body,
	].join("\n");
	// 单次流式生成：每次调用独立 AbortController 与超时（aborted/error 视为失败，stop/max-tokens 正常消费）
	const attempt = async (feedback) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
		const parts = [];
		let failure = null;
		const messages = [{ role: "user", content: [{ type: "text", text: prompt }] }];
		if (feedback !== null) {
			messages.push(
				{ role: "assistant", source: { kind: "model" }, content: [{ type: "text", text: feedback.output }] },
				{ role: "user", content: [{ type: "text", text: feedback.reason }] });
		}
		try {
			for await (const chunk of llm.stream({
				provider,
				model,
				system,
				messages,
				// maxTokens 需足够大：思考重型路由对提交任务会先输出数千 token 思考，
				// 预算不足时思考被截断 → 正文为空 →「模型返回了空提交信息」。8192 为输出上限（非消耗），模型写完即停。
				maxTokens: 8192,
				temperature: 0.3,
				signal: controller.signal,
			})) {
				if (chunk.type === "text-delta") parts.push(chunk.text);
				// finish 的 reason.kind 只有 stop/tool-calls/max-tokens/aborted/error；
				// 仅 aborted/error 视为失败（stop/max-tokens 为正常产出，继续消费到流结束）
				else if (chunk.type === "finish" && (chunk.reason.kind === "aborted" || chunk.reason.kind === "error")) {
					failure = chunk.reason;
					break;
				}
			}
			if (failure !== null) throw new Error(`模型生成失败：${failure.failure?.message ?? (failure.kind === "error" ? "provider error" : "请求已中止")}`);
		} catch (error) {
			clearTimeout(timer);
			if (controller.signal.aborted && parts.length === 0) throw Object.assign(new Error("提交信息生成超时"), { status: 504 });
			throw error;
		}
		clearTimeout(timer);
		let text = parts.join("").trim();
		// 单行化 + 清理常见围栏/引号包装
		text = text.replace(/\s*\n\s*/g, " ").replace(/^```[a-z]*\n?/i, "").replace(/```$/m, "").trim();
		if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1).trim();
		if (text === "") throw Object.assign(new Error("模型返回了空提交信息"), { status: 502 });
		// 日期强制同步：以宿主真实日期（today）为准覆盖消息开头时间戳——模型常受上下文旧日期/幻觉影响（如 [250408]）
		{
			const head = text.match(/^\[(\d{6})\]/);
			if (head !== null) {
				if (head[1] !== today) text = `[${today}]${text.slice(head[0].length)}`;
			} else {
				text = `[${today}] ${text}`;
			}
		}
		return text;
	};
	// 版本校验：用户明确指定备注时豁免（跳过校验与重试）
	const exempt = (text) => sessionEvents !== null && isUserSpecifiedNote(text, sessionEvents);
	const currentVersion = pkg === null ? null : pkg.version;
	let message = await attempt(null);
	if (!exempt(message)) {
		let validation = validateGeneratedVersion(message, currentVersion);
		if (!validation.ok) {
			// 重试一次：附上次输出与失败原因反馈（每次独立计时）
			const reason = validation.reason === "not-incremented"
				? `Rejected: the version in your previous message is not strictly greater than the CURRENT version (${currentVersion}). Regenerate it: <new-version> must be incremented per the versioning rules; never repeat the current version.`
				: "Rejected: no valid version number (vX.Y.Z) was found in your previous message. Regenerate it with a version number incremented per the versioning rules.";
			message = await attempt({ output: message, reason });
			if (!exempt(message)) {
				validation = validateGeneratedVersion(message, currentVersion);
				if (!validation.ok) {
					// 模型仍不遵循递增规则 → 程序化按变更类型强制递增版本号（确定性兜底，与日期同思路）
					const fixed = fixVersionInMessage(message, pkg, currentVersion);
					if (fixed !== message) return { message: fixed, warn: null };
					return { message, warn: "version-not-incremented" };
				}
			}
		}
	}
	return { message, warn: null };
}

/** git 写操作通用流程：采前快照 → 校验 → 执行命令 → 采后快照返回。 */
async function withGitWrite(ctx, payload, run) {
	const sessionId = sanitizeSessionId(payload?.sessionId);
	if (sessionId === null) throw new Error("缺少合法的会话 id");
	const sessions = ctx.get("sessions");
	const subprocess = ctx.get("subprocess");
	if (subprocess === undefined) throw Object.assign(new Error("命令执行服务不可用"), { status: 503 });
	const cwd = resolveSessionCwd(sessions, sessionId);
	const before = await collectGitSnapshot(subprocess, cwd);
	if (!before.isRepo) throw Object.assign(new Error("当前工作区不是 git 仓库"), { status: 400 });
	await run(subprocess, cwd, before);
	const after = await collectGitSnapshot(subprocess, cwd);
	return after;
}

export function apply(ctx) {
	// —— 设置命名空间（可选服务；缺失时模块勾选为进程内降级）——
	let settingsScope = null;
	ctx.inject(["settings"], (settingsCtx) => {
		settingsScope = settingsCtx.settings.register("awesome-hud", AwesomeHudSettingsSchema);
	});

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ASSET_PREFIX,
		handler: async (req, res) => {
			if (req.method !== "GET") { writeJson(res, 405, { ok: false, error: "method not allowed" }); return; }
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const fileName = pathname.startsWith(`${ASSET_PREFIX}/`) ? pathname.slice(ASSET_PREFIX.length + 1) : "";
			let asset;
			try { asset = assetFileFor(fileName); } catch (error) {
				writeJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) });
				return;
			}
			try {
				const data = await readFile(asset.path);
				res.writeHead(200, { "content-type": asset.contentType, "cache-control": "no-cache" });
				res.end(data);
			} catch (error) {
				writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		},
	}), "dsh-awesome-hud: asset route");

	let memoryModules = null; // settings 服务缺失时模块勾选的进程内降级
	let memoryUsage = null; // settings 服务缺失时「用量模块内容」的进程内降级

	const handlers = {
		async "git"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const sessions = ctx.get("sessions");
			const subprocess = ctx.get("subprocess");
			if (subprocess === undefined) throw Object.assign(new Error("命令执行服务不可用"), { status: 503 });
			const cwd = resolveSessionCwd(sessions, sessionId);
			return collectGitSnapshot(subprocess, cwd);
		},
		async "git/graph"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const sessions = ctx.get("sessions");
			const subprocess = ctx.get("subprocess");
			if (subprocess === undefined) throw Object.assign(new Error("命令执行服务不可用"), { status: 503 });
			const cwd = resolveSessionCwd(sessions, sessionId);
			const result = await runGit(subprocess, cwd, ["-c", "core.quotepath=false", "log", "--topo-order", "--all", "-n", "80", "--name-status", "--pretty=format:%H%x1f%P%x1f%D%x1f%s%x1f%ar"]);
			if (result.exitCode !== 0) return { commits: null, error: result.stderr.trim() || "git log 失败" };
			return { commits: parseGitLogOutput(result.stdout) };
		},
		async "subagents"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const subagents = ctx.get("subagents");
			if (subagents === undefined) throw Object.assign(new Error("子代理服务不可用"), { status: 503 });
			const entries = await subagents.listDescendants(sessionId);
			const children = [];
			for (const entry of entries) {
				if (entry.kind !== "child") continue;
				children.push({
					id: entry.id,
					mode: entry.mode,
					activity: entry.activity,
					depth: entry.depth,
					parentId: entry.parentId,
					label: entry.label ?? null,
				});
			}
			return { entries: children };
		},
		async "mcp"(payload) {
			// dsh 全局启停：从 Loader 条目读取 mcp-client 实例（含被禁用实例）。
			const loader = ctx.get("loader");
			if (loader === undefined) throw Object.assign(new Error("插件加载器服务不可用"), { status: 503 });
			const servers = collectMcpServers(loader.entries());
			return { servers, enabled: servers.filter((item) => item.enabled).length, total: servers.length };
		},
		async "mcp/toggle"(payload) {
			// 全局启停：在 profile cordis.patch.yml 写入/移除 disabled 覆盖块。
			const server = sanitizeServerName(payload?.server);
			if (server === null) throw new Error("缺少合法的 MCP 服务名");
			if (typeof payload?.enabled !== "boolean") throw new Error("缺少合法的启用状态");
			const loader = ctx.get("loader");
			if (loader === undefined) throw Object.assign(new Error("插件加载器服务不可用"), { status: 503 });
			const servers = collectMcpServers(loader.entries());
			const target = servers.find((item) => item.name === server);
			if (target === undefined) throw Object.assign(new Error(`未找到 MCP 服务「${server}」`), { status: 404 });
			const profileDir = profileDirOf(loader);
			if (profileDir === null) throw Object.assign(new Error("无法解析 profile 目录"), { status: 503 });
			const patchPath = join(profileDir, "cordis.patch.yml");
			let text = "";
			try { text = await readFile(patchPath, "utf8"); } catch { text = "[]\n"; }
			const states = readMcpStates(text);
			states.set(target.entryId, !payload.enabled);
			const content = writeMcpStates(text, states);
			await atomicWrite(patchPath, content);
			const next = servers.map((item) => item.entryId === target.entryId ? { ...item, enabled: payload.enabled } : item);
			return { ok: true, servers: next, enabled: next.filter((item) => item.enabled).length, total: next.length, message: payload.enabled ? "已全局启用" : "已全局禁用" };
		},
		async "plans"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const sessions = ctx.get("sessions");
			if (sessions === undefined) throw Object.assign(new Error("会话服务不可用"), { status: 503 });
			const session = sessions.get(sessionId);
			if (session === undefined) throw Object.assign(new Error(`找不到会话 ${sessionId}`), { status: 404 });
			return { plans: scanPlanEvents(session.events) };
		},
		async "git/stage"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				const path = sanitizeGitPath(payload?.path);
				fileOfSnapshot(before, path);
				const result = await runGit(subprocess, cwd, ["add", "--", path]);
				if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "暂存失败"), { status: 400 });
			});
		},
		async "git/unstage"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				const path = sanitizeGitPath(payload?.path);
				const file = fileOfSnapshot(before, path);
				if (file.staged !== true) throw Object.assign(new Error(`文件「${path}」不在暂存区`), { status: 400 });
				const result = await runGit(subprocess, cwd, ["restore", "--staged", "--", path]);
				if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "移除暂存失败"), { status: 400 });
			});
		},
		async "git/stage-all"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				const targets = before.files.filter((file) => file.unstaged === true).map((file) => file.path);
				if (targets.length === 0) throw Object.assign(new Error("当前没有未暂存的变更"), { status: 400 });
				for (let i = 0; i < targets.length; i += 500) {
					const result = await runGit(subprocess, cwd, ["add", "--", ...targets.slice(i, i + 500)]);
					if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "暂存失败"), { status: 400 });
				}
			});
		},
		async "git/unstage-all"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				const targets = before.files.filter((file) => file.staged === true).map((file) => file.path);
				if (targets.length === 0) throw Object.assign(new Error("当前没有已暂存的变更"), { status: 400 });
				for (let i = 0; i < targets.length; i += 500) {
					const result = await runGit(subprocess, cwd, ["restore", "--staged", "--", ...targets.slice(i, i + 500)]);
					if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "移除暂存失败"), { status: 400 });
				}
			});
		},
		async "git/revert-file"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				const path = sanitizeGitPath(payload?.path);
				const file = fileOfSnapshot(before, path);
				// 未跟踪文件无法 restore：明示删除（client 侧已有二次确认）；已跟踪文件还原未暂存部分
				const args = file.status === "?"
					? ["clean", "-f", "--", path]
					: ["restore", "--", path];
				const result = await runGit(subprocess, cwd, args);
				if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "撤销失败"), { status: 400 });
			});
		},
		async "git/revert-all"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				const unstaged = before.files.filter((file) => file.unstaged === true);
				const tracked = unstaged.filter((file) => file.status !== "?").map((file) => file.path);
				const untracked = unstaged.filter((file) => file.status === "?").map((file) => file.path);
				if (tracked.length === 0 && untracked.length === 0) {
					throw Object.assign(new Error("当前没有可撤销的未暂存变更"), { status: 400 });
				}
				// 已跟踪文件 → 还原未暂存内容；未跟踪（新建）文件 → 删除（均分批，避免参数超长）
				const batches = (paths) => { const out = []; for (let i = 0; i < paths.length; i += 500) out.push(paths.slice(i, i + 500)); return out; };
				for (const batch of batches(tracked)) {
					const result = await runGit(subprocess, cwd, ["restore", "--", ...batch]);
					if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "撤销失败"), { status: 400 });
				}
				for (const batch of batches(untracked)) {
					const result = await runGit(subprocess, cwd, ["clean", "-f", "--", ...batch]);
					if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "删除新建文件失败"), { status: 400 });
				}
			});
		},
		async "git/commit"(payload) {
			return withGitWrite(ctx, payload, async (subprocess, cwd, before) => {
				if (before.counts.staged === 0) throw Object.assign(new Error("暂存区没有可提交的变更"), { status: 400 });
				const raw = payload?.message;
				if (typeof raw !== "string") throw new Error("缺少提交信息");
				const message = raw.trim();
				if (message === "") throw new Error("提交信息不能为空");
				if (message.length > 2000) throw new Error("提交信息过长（上限 2000 字符）");
				if (message.includes("\n")) throw new Error("提交信息须为单行");
				const result = await runGit(subprocess, cwd, ["commit", "-m", message]);
				if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr.trim() || "提交失败"), { status: 400 });
			});
		},
		async "git/commit-ai"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const sessions = ctx.get("sessions");
			const subprocess = ctx.get("subprocess");
			if (sessions === undefined) throw Object.assign(new Error("会话服务不可用"), { status: 503 });
			if (subprocess === undefined) throw Object.assign(new Error("命令执行服务不可用"), { status: 503 });
			const cwd = resolveSessionCwd(sessions, sessionId);
			return await generateCommitMessage(ctx, subprocess, cwd, payload?.provider, payload?.model, sessionId);
		},
		async "compact"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const agents = ctx.get("agents");
			const commands = ctx.get("commands");
			if (agents === undefined) throw Object.assign(new Error("代理注册服务不可用"), { status: 503, code: "unavailable" });
			if (commands === undefined) throw Object.assign(new Error("命令服务不可用"), { status: 503, code: "unavailable" });
			const agent = agents.get(sessionId);
			if (agent === undefined) throw Object.assign(new Error("该会话没有运行中的 agent"), { status: 404, code: "missing" });
			const controller = new AbortController();
			let result;
			try {
				// 与用户在输入框手动输入 /compact 走完全相同的命令流（含日志与 UI 卡片）
				result = await commands.execute(agent, "/compact", [], controller.signal);
			} catch (error) {
				throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { status: 500, code: "command-error" });
			}
			if (result === undefined) throw Object.assign(new Error("命令未注册：/compact"), { status: 404, code: "not-found" });
			if (result.kind === "error") throw Object.assign(new Error(result.text ?? "压缩失败"), { status: 409, code: result.text?.includes("active compaction") ? "busy" : "command-error" });
			return { ok: true };
		},
	};

	// settings 路由需要区分 GET/POST，单独处理（确保声明在读取点之前）
	const settingsHandler = async (isGet, payload) => {
		const current = normalizeSettings(settingsScope === null ? null : settingsScope.get());
		if (isGet) {
			return { modules: modulesOf(current), usage: usageDisplayOf(current) };
		}
		const result = sanitizeModulesPatch(payload?.modules);
		const usageResult = sanitizeUsagePatch(payload?.usage);
		if (result === null && usageResult === null) throw new Error("缺少合法的设置内容");
		const merged = { ...current.modules, ...(result?.patch ?? {}) };
		const mergedUsage = { ...current.usage, ...(usageResult?.patch ?? {}) };
		if (settingsScope !== null) {
			await settingsScope.update({ modules: merged, usage: mergedUsage });
		} else {
			// 无 settings 服务：本次进程内生效（临时降级）
			memoryModules = { ...merged };
			memoryUsage = { ...mergedUsage };
		}
		return { ok: true, modules: merged, usage: mergedUsage };
	};

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: PREFIX,
		handler: async (req, res) => {
			if (!isTrustedRequest(req, ctx)) { writeJson(res, 403, { ok: false, error: "forbidden" }); return; }
			const isGet = req.method === "GET";
			if (!isGet && req.method !== "POST") { writeJson(res, 405, { ok: false, error: "method not allowed" }); return; }
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith(`${PREFIX}/`) ? pathname.slice(PREFIX.length + 1) : "";
			try {
				let result;
				if (method === "settings") {
					result = await settingsHandler(isGet, isGet ? null : await readJsonBody(req));
				} else if (method === "git" || method === "git/graph" || method === "git/stage" || method === "git/unstage" || method === "git/stage-all" || method === "git/unstage-all" || method === "git/revert-file" || method === "git/revert-all" || method === "git/commit" || method === "git/commit-ai" || method === "subagents" || method === "mcp" || method === "mcp/toggle" || method === "plans" || method === "compact") {
					result = await handlers[method](await readJsonBody(req));
				} else {
					writeJson(res, 404, { ok: false, error: `unknown method ${method}` }); return;
				}
				writeJson(res, 200, { ok: true, ...result });
			} catch (error) {
				const status = Number(error?.status ?? 400);
				writeJson(res, Number.isInteger(status) && status >= 400 && status < 600 ? status : 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
					code: typeof error?.code === "string" ? error.code : undefined,
				});
			}
		},
	}), "dsh-awesome-hud: api route");
}
