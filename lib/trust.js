// dsh-awesome-hud — host 信任围栏
//
// 浏览器侧只可能拿到「回环服务 + 同源页面」或「受信主机」的响应，其余一律拒绝。
//
// 判定分三层：
//   1) 首选官方 Host `connection` 服务的 `admit(request)`：一次判完回环 / 绑定地址 /
//      trustedHosts / sec-fetch-site / Origin，并要求请求携带已认证的浏览器 Peer，
//      返回 { peer }、403 或 401。该入口自 DSH 0.2.1-rc.2 起贯穿全部受支持版本
//      （`@deepseek-ai/dsh-client-connection`）；旧的 `requestRejection(request)`
//      已在 0.2.3-alpha.1 被官方移除，仅作旧版兜底保留。
//   2) `requestRejection` 兜底（0.2.2 及更早）：官方语义 undefined 表示放行，
//      403/401 表示拒绝。
//   3) 官方服务缺失（更老的 dsh、或未挂载 Web 载体的进程）时退回本地判定：放行集合
//      对齐官方围栏——回环一律放行；监听绑定 IP 字面量放行（与官方
//      `isBindAddressAuthority` 一致，DNS rebinding 无法伪造 Host 为绑定 IP 的请求，
//      且 Origin/跨站检查仍然生效）；其余非回环主机必须命中受信主机列表。
//
// 历史背景（issue #3）：0.2.3-alpha.1 移除 `requestRejection` 后，第 1 步探测落空、
// 旧本地回退不认绑定 IP，LAN 地址访问时插件对 `/awesome-hud/api/*` 一律 403，
// Git 模块因此永远停在加载态。改为优先 `admit` 后恢复官方放行集合。

/** Host 是否为回环地址（127/8 与 IPv6 回环；IPv6 兼容带/不带方括号两种形式）。 */
export function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * 解析 host 头为 URL host 形式（小写、IPv6 去方括号），无法解析时返回 null。
 * 对齐官方 api-request-trust.ts 的 parseAuthority：仅接受 IP 字面量或合法主机名。
 */
function parseHostHeader(host) {
	const value = `http://${host}`;
	try {
		const url = new URL(value);
		// URL 解析会把缺端口的 host 视为主机名；要求头里必须带端口或为合法 IP/主机名。
		if (url.hostname === "") return null;
		return url.hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * 请求 Host 是否命中监听绑定地址。与官方 isBindAddressAuthority 一致：
 * 只比较主机名（IP 字面量），忽略端口；绑定地址来自 `webServer.host` 配置。
 * @param {string} hostname 已小写的请求主机名
 * @param {*} webServer 宿主 webServer 服务
 * @returns {boolean}
 */
function isBindAddressHostname(hostname, webServer) {
	const bindHost = typeof webServer?.host === "string" ? webServer.host : undefined;
	if (bindHost === undefined) return false;
	// 绑定地址去掉 IPv6 zone 后缀（fe80::1%en0 → fe80::1），再统一成 URL host 形式比较。
	const zoneAt = bindHost.indexOf("%");
	const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt);
	let bindHostname;
	try {
		bindHostname = new URL(`http://${address.includes(":") ? `[${address}]` : address}`).hostname.toLowerCase();
	} catch {
		return false;
	}
	return bindHostname !== "" && bindHostname === hostname;
}

/**
 * 浏览器信任围栏：优先官方 `connection.admit`，旧版退 `requestRejection`，
 * 服务缺失时退回本地判定。
 * @param {{ headers: Record<string, unknown> }} req 原始 HTTP 请求（只需要 headers）
 * @param {*} ctx 宿主上下文
 * @returns {boolean} 该请求是否可信
 */
export function isTrustedRequest(req, ctx) {
	const connection = ctx?.get?.("connection");
	if (connection !== null && connection !== undefined) {
		// 0.2.3+：官方已移除 requestRejection，admit 是唯一入口。
		// 语义：{ peer } 放行；{ rejection: 403 | 401 } 拒绝。
		if (typeof connection.admit === "function") {
			try {
				const admission = connection.admit({ headers: req.headers });
				return admission !== null && admission !== undefined && !("rejection" in admission);
			} catch {
				/* 服务异常时退回下一层判定 */
			}
		}
		// 0.2.2 及更早：requestRejection 返回 undefined 表示放行，403/401 表示拒绝。
		if (typeof connection.requestRejection === "function") {
			try {
				return connection.requestRejection({ headers: req.headers }) === undefined;
			} catch {
				/* 服务异常时退回本地判定 */
			}
		}
	}
	return isTrustedRequestLocally(req, ctx, connection);
}

/**
 * 本地信任判定（回退路径）：回环 / 绑定地址 / 受信主机列表 + 非跨站 + 同源。
 * 受信主机来源取官方 `connection.trustedHosts`，其次 `webStartup.trustedHosts`；
 * 旧实现读的 `webRuntime` 服务在任何 dsh 版本中都不存在，已移除。
 * v0.21.7 修复（issue #3）：补上「监听绑定 IP 放行」，对齐官方围栏
 * （api-request-trust.ts 的 isBindAddressAuthority），LAN 自绑定部署不再被误拒。
 * @param {{ headers: Record<string, unknown> }} req 原始 HTTP 请求
 * @param {*} ctx 宿主上下文
 * @param {*} connection 已取到的 connection 服务（可能为 undefined）
 * @returns {boolean} 该请求是否可信
 */
export function isTrustedRequestLocally(req, ctx, connection) {
	const host = req.headers.host;
	if (typeof host !== "string") return false;
	const parsed = parseHostHeader(host);
	if (parsed === null) return false;
	const hostname = parsed;
	if (!isLoopbackHostname(hostname) && !isBindAddressHostname(hostname, ctx?.get?.("webServer"))) {
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
