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

/** 由服务器名列表 + 禁用集合，构造 [{name, enabled}] 展示数组。 */
export function resolveMcpState(servers, disabledServers) {
	const disabled = new Set(disabledServers ?? []);
	return servers.map((name) => ({ name, enabled: !disabled.has(name) }));
}

/** 会话 id/服务器名校验（API 输入卫生）：仅接受受限形状，防止意外内容入库。 */
export function sanitizeSessionId(value) {
	return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
}

export function sanitizeServerName(value) {
	return typeof value === "string" && SERVER_NAME_RE.test(value) ? value : null;
}
