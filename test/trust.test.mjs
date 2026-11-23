// dsh-awesome-hud — 信任围栏单测
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopbackHostname, isTrustedRequest } from "../lib/trust.js";

test("回环主机判定", () => {
	assert.ok(isLoopbackHostname("127.0.0.1"));
	assert.ok(isLoopbackHostname("127.255.9.1"));
	assert.ok(isLoopbackHostname("localhost"));
	assert.ok(isLoopbackHostname("[::1]"));
	assert.ok(!isLoopbackHostname("192.168.1.4"));
	assert.ok(!isLoopbackHostname("example.com"));
});

test("信任围栏：回环 + 同源放行", () => {
	const req = (headers) => ({ headers });
	const ctx = { get: () => undefined };
	assert.ok(isTrustedRequest(req({ host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" }), ctx));
	// 无 Origin（同站导航）视为可接受
	assert.ok(isTrustedRequest(req({ host: "127.0.0.1:3080" }), ctx));
	// 跨站拒绝
	assert.ok(!isTrustedRequest(req({ host: "127.0.0.1:3080", "sec-fetch-site": "cross-site" }), ctx));
	// 异源拒绝
	assert.ok(!isTrustedRequest(req({ host: "127.0.0.1:3080", origin: "https://evil.example" }), ctx));
	// 非回环且不在可信列表 → 拒绝
	assert.ok(!isTrustedRequest(req({ host: "192.168.1.4:3080", origin: "http://192.168.1.4:3080" }), ctx));
});

test("信任围栏：受信主机列表放行", () => {
	const req = { headers: { host: "dsh.example.com:3080", origin: "http://dsh.example.com:3080" } };
	const ctx = { get: () => ({ trustedHosts: ["dsh.example.com"] }) };
	assert.ok(isTrustedRequest(req, ctx));
	// 列表带端口也匹配主机名
	const ctx2 = { get: () => ({ trustedHosts: ["dsh.example.com:3080"] }) };
	assert.ok(isTrustedRequest(req, ctx2));
});

// DSH 0.2.1+ 提供 Host `connection` 服务：requestRejection 一次判完 Host/Origin/凭据。
test("信任围栏：有 connection 服务时交给官方 requestRejection 判定", () => {
	const req = (headers) => ({ headers });
	const calls = [];
	const ctx = {
		get: (name) => (name === "connection" ? {
			requestRejection: (request) => {
				calls.push(request.headers.host);
				return request.headers.host === "dsh.example.com:3080" ? undefined : 403;
			}
		} : undefined)
	};
	// 官方放行 → 放行，即便该主机不是回环地址（旧实现读不到 webRuntime 会拒绝）
	assert.ok(isTrustedRequest(req({ host: "dsh.example.com:3080" }), ctx));
	// 官方拒绝 → 拒绝
	assert.ok(!isTrustedRequest(req({ host: "evil.example:3080" }), ctx));
	assert.deepEqual(calls, ["dsh.example.com:3080", "evil.example:3080"]);
});

test("信任围栏：没有 connection 判定能力时退回本地判定并读官方受信来源", () => {
	const req = (headers) => ({ headers });
	// 只有 webStartup 暴露 trustedHosts 的旧进程
	const oldCtx = { get: (name) => (name === "webStartup" ? { trustedHosts: ["dsh.example.com"] } : undefined) };
	assert.ok(isTrustedRequest(req({ host: "dsh.example.com:3080", origin: "http://dsh.example.com:3080" }), oldCtx));
	assert.ok(!isTrustedRequest(req({ host: "other.example.com:3080" }), oldCtx));
	// connection 存在但没有 requestRejection 时，读它自己的 trustedHosts
	const legacy = { get: (name) => (name === "connection" ? { trustedHosts: ["dsh.example.com:3080"] } : undefined) };
	assert.ok(isTrustedRequest(req({ host: "dsh.example.com:3080" }), legacy));
});

// v0.21.7（issue #3）：0.2.3-alpha.1 起官方移除 requestRejection，admit 是唯一入口。
test("信任围栏：优先 admit 判定（0.2.3+）", () => {
	const req = (headers) => ({ headers });
	const calls = [];
	const ctx = {
		get: (name) => (name === "connection" ? {
			// 官方 admit 语义：{ peer } 放行；{ rejection: 403 | 401 } 拒绝。
			admit: (request) => {
				calls.push(request.headers.host);
				return request.headers.host === "dsh.example.com:3080" ? { peer: "p1" } : { rejection: 403 };
			}
		} : undefined)
	};
	// admit 放行 → 放行（LAN 受信主机场景）
	assert.ok(isTrustedRequest(req({ host: "dsh.example.com:3080" }), ctx));
	// admit 拒绝 → 拒绝
	assert.ok(!isTrustedRequest(req({ host: "evil.example:3080" }), ctx));
	assert.deepEqual(calls, ["dsh.example.com:3080", "evil.example:3080"]);
});

// admit 抛异常（服务异常）时退回下一层判定，而不是放行或崩掉请求。
test("信任围栏：admit 异常时退回 requestRejection / 本地判定", () => {
	const req = (headers) => ({ headers });
	const ctx = {
		get: (name) => (name === "connection" ? {
			admit: () => { throw new Error("service broken"); },
			requestRejection: (request) => (request.headers.host === "dsh.example.com:3080" ? undefined : 403),
		} : undefined)
	};
	assert.ok(isTrustedRequest(req({ host: "dsh.example.com:3080" }), ctx));
	assert.ok(!isTrustedRequest(req({ host: "evil.example:3080" }), ctx));
	// 两层都异常 → 本地判定（回环同源放行）
	const broken = { get: (name) => (name === "connection" ? { admit: () => { throw new Error("x"); }, requestRejection: () => { throw new Error("y"); } } : undefined) };
	assert.ok(isTrustedRequest(req({ host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" }), broken));
});

// v0.21.7（issue #3）：本地回退补「监听绑定 IP 放行」，对齐官方 isBindAddressAuthority。
test("信任围栏：本地判定接受监听绑定地址（LAN 自绑定部署）", () => {
	const req = (headers) => ({ headers });
	// webServer 报告绑定在 192.168.1.4 —— 该 IP 的同源请求应放行
	const ctx = { get: (name) => {
		if (name === "webServer") return { host: "192.168.1.4", protocol: "http:" };
		return undefined;
	} };
	assert.ok(isTrustedRequest(req({ host: "192.168.1.4:3080", origin: "http://192.168.1.4:3080" }), ctx));
	// 无 Origin（同站导航）也放行
	assert.ok(isTrustedRequest(req({ host: "192.168.1.4:3080" }), ctx));
	// 绑定地址上跨站 / 异源仍然拒绝
	assert.ok(!isTrustedRequest(req({ host: "192.168.1.4:3080", origin: "https://evil.example" }), ctx));
	// 非绑定 IP 的 LAN 地址仍拒绝（trustedHosts 为空）
	assert.ok(!isTrustedRequest(req({ host: "192.168.1.5:3080", origin: "http://192.168.1.5:3080" }), ctx));
	// 绑定地址比较忽略端口（Host 是绑定 IP 的任意端口都算本机字面量；端口 80 会被 URL 规范化，
	// origin.host 与 host 头比较仍需同值，这里用非默认端口验证绑定判断本身不看端口）
	const ctx80 = { get: (name) => (name === "webServer" ? { host: "192.168.1.4" } : undefined) };
	assert.ok(isTrustedRequest(req({ host: "192.168.1.4:8080", origin: "http://192.168.1.4:8080" }), ctx80));
});

// IPv6 回环兼容不带方括号的 URL 解析形式（parseHostHeader 产出小写无括号主机名）。
test("信任围栏：IPv6 回环与绑定地址形式", () => {
	const req = (headers) => ({ headers });
	const ctx = { get: (name) => (name === "webServer" ? { host: "::1" } : undefined) };
	assert.ok(isTrustedRequest(req({ host: "[::1]:3080", origin: "http://[::1]:3080" }), ctx));
});
