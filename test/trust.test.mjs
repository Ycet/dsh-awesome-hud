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
