// dsh-awesome-hud — host 信任围栏
//
// 浏览器侧只可能拿到「回环服务 + 同源页面」或「受信主机」的响应，其余一律拒绝。
//
// 判定分两层：
//   1) 首选官方 Host `connection` 服务的 `requestRejection(request)`：它一次判完
//      回环 / 绑定地址 / trustedHosts / sec-fetch-site / Origin，并要求请求携带
//      已认证的浏览器 Peer，返回 403、401 或 undefined。该服务自 DSH 0.2.1 起就存在
//      （`@deepseek-ai/dsh-client-connection`），是官方给「非内建 Web 路由」准备的口子。
//   2) 服务缺失（更老的 dsh、或未挂载 Web 载体的进程）时退回本地判定，放行集合与
//      旧实现一致：回环一律放行，非回环必须命中受信主机列表。

/** Host 是否为回环地址（127/8 与 IPv6 回环）。 */
export function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * 浏览器信任围栏：优先交给官方 Connection 服务判定，服务缺失时退回本地判定。
 * @param {{ headers: Record<string, unknown> }} req 原始 HTTP 请求（只需要 headers）
 * @param {*} ctx 宿主上下文
 * @returns {boolean} 该请求是否可信
 */
export function isTrustedRequest(req, ctx) {
	const connection = ctx?.get?.("connection");
	if (connection !== null && connection !== undefined && typeof connection.requestRejection === "function") {
		try {
			// 官方语义：undefined 表示放行；403/401 表示拒绝。
			return connection.requestRejection({ headers: req.headers }) === undefined;
		} catch {
			/* 服务异常时退回本地判定 */
		}
	}
	return isTrustedRequestLocally(req, ctx, connection);
}

/**
 * 本地信任判定（回退路径）：回环 / 受信主机列表 + 非跨站 + 同源。
 * 受信主机来源取官方 `connection.trustedHosts`，其次 `webStartup.trustedHosts`；
 * 旧实现读的 `webRuntime` 服务在任何 dsh 版本中都不存在，已移除。
 * @param {{ headers: Record<string, unknown> }} req 原始 HTTP 请求
 * @param {*} ctx 宿主上下文
 * @param {*} connection 已取到的 connection 服务（可能为 undefined）
 * @returns {boolean} 该请求是否可信
 */
export function isTrustedRequestLocally(req, ctx, connection) {
	const host = req.headers.host;
	if (typeof host !== "string") return false;
	const hostname = host.replace(/^\[/, "").split(":")[0];
	if (!isLoopbackHostname(hostname)) {
		const trusted = connection?.trustedHosts ?? ctx?.get?.("webStartup")?.trustedHosts;
		if (!Array.isArray(trusted)) return false;
		const accepted = trusted.some(
			(value) => typeof value === "string" && (value.split(":")[0] === hostname || value === host)
		);
		if (!accepted) return false;
	}
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try { return new URL(origin).host === host; } catch { return false; }
}
