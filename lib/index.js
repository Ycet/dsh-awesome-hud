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
					added: value?.added ?? null,
					deleted: null,
					untrackedCounted: true,
				});
			} else {
				files.push({ status: entry.status, path: entry.path, added: null, deleted: null, untrackedCounted: false });
			}
		} else {
			files.push({
				status: entry.status,
				path: entry.path,
				added: counts?.added ?? 0,
				deleted: counts?.deleted ?? 0,
				untrackedCounted: false,
			});
		}
	}
	return { isRepo: true, branch, changedCount: entries.length, files, at: now() };
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
				} else if (method === "git" || method === "git/graph" || method === "subagents" || method === "mcp" || method === "mcp/toggle" || method === "plans" || method === "compact") {
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
