// dsh-awesome-hud — MCP 服务器发现/状态纯解析（host）
// MCP 工具由 @deepseek-ai/dsh-mcp-client 以 `mcp__<serverName>__<rawName>` 注册；
// serverName 约束为 [A-Za-z0-9_-]{1,32}。本模块只做字符串/数组解析，便于单测。

/** 合法的 serverName（与 dsh-mcp-client 的 Config 校验一致）。 */
export const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** 从工具名提取 serverName；非 MCP 工具或形状非法返回 undefined。 */
export function serverNameOf(toolName) {
	if (typeof toolName !== "string") return undefined;
	if (!toolName.startsWith("mcp__")) return undefined;
	const rest = toolName.slice(5);
	const firstSep = rest.indexOf("__");
	if (firstSep <= 0) return undefined;
	const server = rest.slice(0, firstSep);
	const raw = rest.slice(firstSep + 2);
	if (!SERVER_NAME_RE.test(server) || raw === "") return undefined;
	return server;
}

/** 收集工具名列表中的全部服务器名（按首次出现顺序去重）。 */
export function collectServers(toolNames) {
	const seen = new Set();
	const servers = [];
	for (const name of toolNames ?? []) {
		const server = serverNameOf(name);
		if (server !== undefined && !seen.has(server)) {
			seen.add(server);
			servers.push(server);
		}
	}
	return servers;
}

/** 判断某工具名是否属于指定服务器。 */
export function isMcpTool(toolName, server) {
	return typeof toolName === "string" && toolName.startsWith(`mcp__${server}__`);
}

/** 本插件在 profile patch 文件中维护的 MCP disabled 覆盖块标记。 */
export const MCP_PATCH_BEGIN = "# >>> dsh-awesome-hud mcp states >>>";
export const MCP_PATCH_END = "# <<< dsh-awesome-hud mcp states <<<";

/**
 * 从 Loader 条目收集全局 MCP 服务（dsh 全局启停）。
 * 仅匹配 dsh-mcp-client 插件实例；enabled = 条目未被全局禁用。
 * 返回 [{name, enabled, entryId}]，entryId 为 patch 文件中的行 id。
 */
export function collectMcpServers(entries) {
	const out = [];
	for (const entry of entries ?? []) {
		const options = entry?.options;
		if (typeof options?.name !== "string") continue;
		if (options.name !== "@deepseek-ai/dsh-mcp-client" && options.name !== "mcp-client") continue;
		const serverName = options.config?.serverName;
		if (typeof serverName !== "string" || !SERVER_NAME_RE.test(serverName)) continue;
		const optionsId = typeof options.id === "string" && options.id.length > 0 ? options.id : "";
		const entryId = optionsId !== "" ? optionsId : String(entry.id ?? "").split(":").at(-1) ?? "";
		if (entryId === "") continue;
		out.push({ name: serverName, enabled: !entry.disabled, entryId });
	}
	return out;
}

/** 解析本插件维护的 mcp disabled 覆盖块：Map<entryId, disabled>。 */
export function readMcpStates(text) {
	const states = new Map();
	const begin = text.indexOf(MCP_PATCH_BEGIN);
	const end = begin < 0 ? -1 : text.indexOf(MCP_PATCH_END, begin + MCP_PATCH_BEGIN.length);
	if (begin < 0 || end < 0) return states;
	const block = text.slice(begin + MCP_PATCH_BEGIN.length, end);
	const lines = block.split(/\r?\n/);
	let id = null;
	for (const line of lines) {
		const idMatch = line.match(/^\s*-\s+id:\s*(.+)$/);
		if (idMatch) { id = idMatch[1].trim().replace(/^['"]|['"]$/g, ""); continue; }
		const disabledMatch = line.match(/^\s+disabled:\s*(true|false)\s*$/);
		if (id && disabledMatch) states.set(id, disabledMatch[1] === "true");
	}
	return states;
}

/** 仅替换本插件专属 managed block，保留用户其余 patch 原文。 */
export function writeMcpStates(text, states) {
	const rows = [...states.entries()].sort(([left], [right]) => left.localeCompare(right));
	const block = rows.length === 0 ? "" : `${MCP_PATCH_BEGIN}\n${rows.map(([id, disabled]) => `- id: ${id}\n  disabled: ${disabled ? "true" : "false"}`).join("\n")}\n${MCP_PATCH_END}\n`;
	const begin = text.indexOf(MCP_PATCH_BEGIN);
	const end = begin < 0 ? -1 : text.indexOf(MCP_PATCH_END, begin + MCP_PATCH_BEGIN.length);
	let base = text;
	if (begin >= 0 && end >= 0) base = text.slice(0, begin) + text.slice(end + MCP_PATCH_END.length).replace(/^\r?\n/, "");
	base = base.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
	if (!block) return base.replace(/\n{2,}$/g, "\n").endsWith("\n") ? base.replace(/\n{2,}$/g, "\n") : `${base.replace(/\n{2,}$/g, "\n")}\n`;
	if (!base.endsWith("\n")) base += "\n";
	if (base.trim().length > 0 && !base.endsWith("\n\n")) base += "\n";
	return base + block;
}

/** 会话 id/服务器名校验（API 输入卫生）：仅接受受限形状，防止意外内容入库。 */
export function sanitizeSessionId(value) {
	return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
}

export function sanitizeServerName(value) {
	return typeof value === "string" && SERVER_NAME_RE.test(value) ? value : null;
}
