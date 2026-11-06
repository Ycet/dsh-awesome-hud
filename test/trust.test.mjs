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
