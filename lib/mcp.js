// dsh-awesome-hud — MCP 服务器发现/状态纯解析（host）
// MCP 工具由 @deepseek-ai/dsh-mcp-client 以 `mcp__<serverName>__<rawName>` 注册；
// serverName 约束为 [A-Za-z0-9_-]{1,32}。本模块只做字符串/数组解析，便于单测。
//
// 启停状态的写入已交给 DSH 官方插件管理器（pluginManager.setPluginEnabled）：
// 它按行读写 profile cordis.patch.yml 并触发热重载。本模块不再生成托管块，
// 只保留对旧版本托管块标记的识别与清理（v0.15.8 之前写入的 `# >>>`/`# <<<` 两行注释）。

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

/** v0.15.7 及更早版本在 profile patch 文件中写入的托管块标记（仅用于清理，不再生成）。 */
export const MCP_PATCH_BEGIN = "# >>> dsh-awesome-hud mcp states >>>";
export const MCP_PATCH_END = "# <<< dsh-awesome-hud mcp states <<<";

/** dsh-mcp-client 的插件模块名（官方全名与简写两种写法）。 */
export const MCP_CLIENT_MODULE_NAMES = Object.freeze(["@deepseek-ai/dsh-mcp-client", "mcp-client"]);

/** 该 Loader 条目是否为一个 MCP 服务实例（dsh-mcp-client）。 */
export function isMcpClientEntry(entry) {
	const name = entry?.options?.name;
	return typeof name === "string" && MCP_CLIENT_MODULE_NAMES.includes(name);
}

/**
 * 从 Loader 条目收集全局 MCP 服务（dsh 全局启停）。
 * 仅匹配 dsh-mcp-client 插件实例；enabled = 条目未被全局禁用。
 * 返回 [{name, enabled, entryId}]，entryId 为 patch 文件中的行 id。
 */
export function collectMcpServers(entries) {
	const out = [];
	for (const entry of entries ?? []) {
		const options = entry?.options;
		if (!isMcpClientEntry(entry)) continue;
		const serverName = options.config?.serverName;
		if (typeof serverName !== "string" || !SERVER_NAME_RE.test(serverName)) continue;
		const optionsId = typeof options.id === "string" && options.id.length > 0 ? options.id : "";
		const entryId = optionsId !== "" ? optionsId : String(entry.id ?? "").split(":").at(-1) ?? "";
		if (entryId === "") continue;
		out.push({ name: serverName, enabled: !entry.disabled, entryId });
	}
	return out;
}

/**
 * 清理旧版本（≤ v0.15.7）写入的托管块标记：只删除紧跟托管块的 BEGIN/END 两行注释，
 * 块内的每一行（YAML 条目、注释、空行）都逐字保留。
 *
 * 背景：旧实现把状态行夹在两条注释之间，而 DSH 设置持久化用 yaml 文档在文件末尾追加新行、
 * 且把 EOF 注释保留在最后，导致其它插件的新行被插进托管块内部，旧写入逻辑整段重建时会把它们删掉。
 * 修复后不再生成托管块，这里只做一次性的标记清理。
 *
 * @param text profile cordis.patch.yml 原文。
 * @returns { text, changed } —— changed 为是否真的删除了标记行。
 */
export function stripManagedBlockMarkers(text) {
	if (typeof text !== "string") return { text: "", changed: false };
	const lines = text.split("\n");
	const kept = lines.filter((line) => {
		const trimmed = line.trim();
		return trimmed !== MCP_PATCH_BEGIN && trimmed !== MCP_PATCH_END;
	});
	if (kept.length === lines.length) return { text, changed: false };
	return { text: kept.join("\n"), changed: true };
}

/** 会话 id/服务器名校验（API 输入卫生）：仅接受受限形状，防止意外内容入库。 */
export function sanitizeSessionId(value) {
	return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
}

export function sanitizeServerName(value) {
	return typeof value === "string" && SERVER_NAME_RE.test(value) ? value : null;
}
