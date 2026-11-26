import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";
import { BILI_VERDICT_KEY } from "../lib/compact.js";

// 每个用例后清掉 bili 接管标记，避免用例之间互相影响。
afterEach(() => {
	delete globalThis[BILI_VERDICT_KEY];
});

/**
 * 挂载 host 路由：用最小 ctx 跑真实请求处理函数（与 desktop-host.test.mjs 同一套手法）。
 * @param {Record<string, unknown>} services 按服务名提供的假服务
 * @returns {{ call: (endpoint: string, body?: object, method?: string) => Promise<object> }}
 */
function mount(services) {
	const routes = [];
	const ctx = {
		get: (name) => services[name],
		effect: (fn) => fn(),
		webServer: { register: (route) => { routes.push(route); return () => {}; } },
	};
	apply(ctx);
	const route = routes.find((item) => item.path === "/awesome-hud/api");
	assert.ok(route !== undefined, "未注册 /awesome-hud/api 路由");
	const call = async (endpoint, body = {}, method = "POST") => {
		const req = Readable.from(method === "GET" ? [] : [Buffer.from(JSON.stringify(body))]);
		Object.assign(req, { method, url: `/awesome-hud/api/${endpoint}`, headers: { host: "127.0.0.1:1234" } });
		let status;
		let payload;
		await route.handler(req, {
			writeHead: (code) => { status = code; },
			end: (data) => { payload = JSON.parse(data); },
		});
		return { status, ...payload };
	};
	return { call };
}

/** 造一个完整的官方命令服务：find 恒命中、execute 按给定结果返回。 */
function officialCommands({ result, onExecute } = {}) {
	return {
		find: () => ({ name: "compact" }),
		execute: async (...args) => {
			onExecute?.(args);
			return result;
		},
	};
}

test("bili 接管（全局标记 active）→ 409 bili-managed，且完全不调用官方命令", async () => {
	globalThis[BILI_VERDICT_KEY] = "active";
	let executed = 0;
	const { call } = mount({
		agents: { get: () => ({}) },
		compaction: undefined,
		commands: {
			find: (agent, name) => (name === "acp" ? { name: "acp" } : undefined),
			execute: async () => { executed += 1; return undefined; },
		},
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 409);
	assert.equal(body.ok, false);
	assert.equal(body.code, "bili-managed");
	assert.equal(executed, 0);
});

test("标记缺失时按环境兜底识别 bili（有 acp、无 compaction、无 compact）", async () => {
	let executed = 0;
	const { call } = mount({
		agents: { get: () => ({}) },
		commands: {
			find: (agent, name) => (name === "acp" ? { name: "acp" } : undefined),
			execute: async () => { executed += 1; return undefined; },
		},
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 409);
	assert.equal(body.code, "bili-managed");
	assert.equal(executed, 0);
});

test("官方路径：命令成功 → 200 ok", async () => {
	let compactArgs;
	const { call } = mount({
		agents: { get: () => ({}) },
		compaction: {},
		commands: officialCommands({
			result: { commandId: "x", result: { kind: "success", text: "Compacted 3 history items." } },
			onExecute: (args) => { compactArgs = args; },
		}),
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 200);
	assert.equal(body.ok, true);
	assert.equal(compactArgs[1], "/compact");
});

test("官方路径：返回值是 { commandId, result:{kind:'error'} } 时如实报错（busy）", async () => {
	const { call } = mount({
		agents: { get: () => ({}) },
		compaction: {},
		commands: officialCommands({
			result: { commandId: "x", result: { kind: "error", text: "Compaction is unavailable because this process has an active compaction, or the agent is not idle." } },
		}),
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 409);
	assert.equal(body.ok, false);
	assert.equal(body.code, "busy");
});

test("官方路径：其它错误文本 → 409 command-error，不再误报成功", async () => {
	const { call } = mount({
		agents: { get: () => ({}) },
		compaction: {},
		commands: officialCommands({
			result: { commandId: "x", result: { kind: "error", text: "summary failed" } },
		}),
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 409);
	assert.equal(body.code, "command-error");
});

test("官方路径：命令不存在（execute 返回 undefined）→ 404 not-found", async () => {
	const { call } = mount({
		agents: { get: () => ({}) },
		compaction: {},
		commands: officialCommands({ result: undefined }),
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 404);
	assert.equal(body.code, "not-found");
});

test("官方路径：命令服务缺失 → 503 unavailable", async () => {
	const { call } = mount({
		agents: { get: () => ({}) },
		compaction: {},
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 503);
	assert.equal(body.code, "unavailable");
});

test("会话没有运行中的 agent → 404 missing", async () => {
	const { call } = mount({
		agents: { get: () => undefined },
		compaction: {},
		commands: officialCommands({ result: { commandId: "x", result: { kind: "success" } } }),
	});
	const body = await call("compact", { sessionId: "fixture" });
	assert.equal(body.status, 404);
	assert.equal(body.code, "missing");
});

test("缺少合法 sessionId → 400", async () => {
	const { call } = mount({ agents: { get: () => ({}) } });
	const body = await call("compact", {});
	assert.equal(body.status, 400);
	assert.equal(body.ok, false);
});
