// dsh-awesome-hud — host half
//
// 职责：
//   1. /awesome-hud/api/*   JSON API（信任围栏：回环/受信 + 同源）：
//        git         → {isRepo, branch, changedCount, files:[{status,path,added,deleted}]}
//        git/graph   → {graph}
//        subagents   → {entries:[{id,mode,activity,depth,parentId,label?}]}
//        mcp         → {servers:[{name,enabled}], enabled, total}
//        mcp/toggle  → 同上（写后返回）
//        compact     → {ok}（agent 运行中 → 409 busy；服务缺失 → 503）
//        settings    → GET {modules} / POST {modules} → {ok, modules}
//   2. /awesome-hud/assets/*  只读 SVG 图标白名单（GET）
//   3. ctx.tools.guard：按会话禁用 mcp__<server>__* 工具的执行（Q2：执行时拒绝）
//   4. ctx.settings（可选）：注册 awesome-hud 命名空间（模块勾选 + 按会话 MCP 禁用）
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { isTrustedRequest } from "./trust.js";
import { parsePorcelainZ, parseNumstat, mergeNumstat, normalizeBranch } from "./git.js";
import { collectServers, resolveMcpState, sanitizeSessionId, sanitizeServerName, isMcpTool } from "./mcp.js";
import { parseGitLogOutput } from "./graph.js";
import { normalizeSettings, sanitizeModulesPatch, modulesOf } from "./settings.js";

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
	"subagents.svg": "svg",
	"tasks.svg": "svg",
	"tasks-done.svg": "svg",
	"tasks-todo.svg": "svg",
	"mcp.svg": "svg",
	"settings.svg": "svg",
});
const ASSETS_DIR = fileURLToPath(new URL("../assets/icons/", import.meta.url));

/** 设置命名空间：模块勾选 + 按会话 MCP 禁用列表。 */
const AwesomeHudSettingsSchema = z.object({
	version: z.number().default(1),
	modules: z.object({
		context: z.boolean().default(true),
		git: z.boolean().default(true),
		subagents: z.boolean().default(true),
		tasks: z.boolean().default(true),
		mcp: z.boolean().default(true),
	}),
	mcpDisabled: z.dict(z.array(z.string())).default({}),
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
	// —— 设置命名空间（可选服务；缺失时 MCP 禁用退化为进程内存）——
	let settingsScope = null;
	const memoryDisabled = new Map(); // sessionId → Set<server>
	ctx.inject(["settings"], (settingsCtx) => {
		settingsScope = settingsCtx.settings.register("awesome-hud", AwesomeHudSettingsSchema);
	});

	const resolveSetting = (sessionId) => {
		if (settingsScope !== null) {
			return normalizeSettings(settingsScope.get()).mcpDisabled[sessionId] ?? [];
		}
		return [...(memoryDisabled.get(sessionId) ?? [])];
	};

	const setDisabled = async (sessionId, server, enabled) => {
		if (settingsScope !== null) {
			const current = normalizeSettings(settingsScope.get());
			const list = new Set(current.mcpDisabled[sessionId] ?? []);
			if (enabled) list.delete(server);
			else list.add(server);
			const next = { ...(current.mcpDisabled ?? {}), [sessionId]: [...list] };
			await settingsScope.update({ mcpDisabled: next });
		} else {
			const list = new Set(memoryDisabled.get(sessionId) ?? []);
			if (enabled) list.delete(server);
			else list.add(server);
			memoryDisabled.set(sessionId, list);
		}
	};

	// —— MCP 执行拒绝（Q2）：会话禁用列表命中 mcp__<server>__* → 拒绝 ——
	ctx.inject(["tools"], (toolsCtx) => {
		const disposer = toolsCtx.tools.guard((execution) => {
			const sessionId = execution?.agent?.id;
			if (typeof sessionId !== "string") return undefined;
			const disabled = resolveSetting(sessionId);
			if (disabled.length === 0) return undefined;
			for (const server of disabled) {
				if (isMcpTool(execution.name, server)) {
					return `MCP 服务「${server}」已在当前会话中被禁用（HUD 面板 MCP 模块可重新启用）`;
				}
			}
			return undefined;
		});
		ctx.effect(() => disposer, "dsh-awesome-hud: mcp guard");
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
				res.writeHead(200, { "content-type": asset.contentType, "cache-control": "public, max-age=3600" });
				res.end(data);
			} catch (error) {
				writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		},
	}), "dsh-awesome-hud: asset route");

	let memoryModules = null; // settings 服务缺失时模块勾选的进程内降级

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
			const result = await runGit(subprocess, cwd, ["log", "--topo-order", "--all", "-n", "80", "--pretty=format:%H%x1f%P%x1f%D%x1f%s%x1f%ar"]);
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
			const sessionId = sanitizeSessionId(payload?.sessionId);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			const tools = ctx.get("tools");
			const servers = tools === undefined ? [] : collectServers((tools.schemas() ?? []).map((schema) => schema.name));
			const state = resolveMcpState(servers, resolveSetting(sessionId));
			return { servers: state, enabled: state.filter((item) => item.enabled).length, total: state.length };
		},
		async "mcp/toggle"(payload) {
			const sessionId = sanitizeSessionId(payload?.sessionId);
			const server = sanitizeServerName(payload?.server);
			if (sessionId === null) throw new Error("缺少合法的会话 id");
			if (server === null) throw new Error("缺少合法的 MCP 服务名");
			if (typeof payload?.enabled !== "boolean") throw new Error("缺少合法的启用状态");
			await setDisabled(sessionId, server, payload.enabled);
			const tools = ctx.get("tools");
			const servers = tools === undefined ? [] : collectServers((tools.schemas() ?? []).map((schema) => schema.name));
			const state = resolveMcpState(servers, resolveSetting(sessionId));
			return { ok: true, servers: state, enabled: state.filter((item) => item.enabled).length, total: state.length };
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
			return { modules: modulesOf(current) };
		}
		const result = sanitizeModulesPatch(payload?.modules);
		if (result === null) throw new Error("缺少合法的模块设置");
		const merged = { ...current.modules, ...result.patch };
		if (settingsScope !== null) {
			await settingsScope.update({ modules: merged });
		} else {
			// 无 settings 服务：本次进程内生效（临时降级）
			memoryModules = { ...merged };
		}
		return { ok: true, modules: merged };
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
				} else if (method === "git" || method === "git/graph" || method === "subagents" || method === "mcp" || method === "mcp/toggle" || method === "compact") {
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
