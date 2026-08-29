// dsh-awesome-hud — host 信任围栏
// 与 dsh-session-plus/lib/trust 相同策略（已验证的实现模式）：
//   仅回环/受信 host + sec-fetch-site 非跨站 + 同源校验。
// 浏览器侧只可能拿到「回环服务 + 同源页面」的响应，拒绝外部站点的跨站请求。
/** Host 是否为回环地址（127/8 与 IPv6 回环）。 */
export function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** 浏览器信任围栏：Host 回环或受信 + 同源；拒绝跨站请求。 */
export function isTrustedRequest(req, ctx) {
	const host = req.headers.host;
	if (typeof host !== "string") return false;
	const hostname = host.replace(/^\[/, "").split(":")[0];
	if (!isLoopbackHostname(hostname)) {
		const trusted = ctx.get("webRuntime")?.trustedHosts;
		if (!Array.isArray(trusted) || !trusted.some((value) => value.split(":")[0] === hostname || value === host)) return false;
	}
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try { return new URL(origin).host === host; } catch { return false; }
}
