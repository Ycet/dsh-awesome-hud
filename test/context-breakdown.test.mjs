// v0.21.6：上下文分段条的宿主侧估算（七类明细）。
import assert from "node:assert/strict";
import test from "node:test";
import { contextCategoryOf, contextTokensOf, estimateContextMessage } from "../lib/index.js";

test("estimateContextMessage：文本块按 字符/4+4，再加消息开销 4", () => {
	// "abcd" 4 字符 → ceil(4/4)=1，加块开销 4，再加消息开销 4。
	assert.equal(estimateContextMessage({ content: [{ type: "text", text: "abcd" }] }), 9);
	assert.equal(estimateContextMessage({ content: [] }), 0);
	assert.equal(estimateContextMessage({}), 0);
	// 工具调用块：名字与参数各算一次，再加块开销。
	const call = estimateContextMessage({ content: [{ type: "tool-call", name: "bash", arguments: { command: "ls" } }] });
	assert.equal(call > 8, true);
});

test("contextCategoryOf：按事件类型与 source 归类", () => {
	assert.equal(contextCategoryOf("system/message"), "system");
	assert.equal(contextCategoryOf("developer/message"), "inject");
	assert.equal(contextCategoryOf("assistant/message"), "assistant");
	assert.equal(contextCategoryOf("tool/result"), "tool");
	assert.equal(contextCategoryOf("user/message", { kind: "user" }), "user");
	assert.equal(contextCategoryOf("user/message", { kind: "skill-invocation" }), "skill");
	assert.equal(contextCategoryOf("user/message", { kind: "skill-catalog" }), "skill");
	// 非用户来源（压缩摘要等）算注入内容。
	assert.equal(contextCategoryOf("user/message", { kind: "compaction" }), "inject");
	assert.equal(contextCategoryOf("user/message", { form: "queued" }), "inject");
	assert.equal(contextCategoryOf(undefined, undefined), "user");
});

test("contextTokensOf：空消息不计入，按七类求和", () => {
	const tokens = contextTokensOf([
		{ type: "system/message", message: { content: [{ type: "text", text: "abcd" }] } },
		{ type: "user/message", source: { kind: "user" }, message: { content: [{ type: "text", text: "abcd" }] } },
		{ type: "user/message", message: null },
		null,
	]);
	assert.equal(tokens.system, 9);
	assert.equal(tokens.user, 9);
	assert.equal(tokens.inject, 0);
	// 六类键齐全（tools 取官方值，不在事件估算里）。
	assert.deepEqual(Object.keys(tokens).sort(), ["assistant", "inject", "skill", "system", "tool", "user"].sort());
});

// v0.21.6：宿主 context/breakdown 路由（真实 host 分发 + 信任围栏）。
import { createHarness } from "./helpers/host-harness.mjs";

function fakeSessions(events) {
	const session = {
		header: { cwd: process.cwd() },
		// surface.nodes 是事件序号数组（DSH 的 SessionSurface）。
		surface: { nodes: events.map((event) => event.seq), contentGeneration: 1 },
		eventAt: (seq) => events.find((event) => event.seq === seq),
		snapshotEvents: () => events,
		deriveEventMessage: (event) => event.message,
	};
	return { get: (id) => (id === "fixture" ? session : undefined) };
}

test("context/breakdown：扫描 surface 后按七类汇总并带缓存", { timeout: 30000 }, async () => {
	const events = [
		{ seq: 1, type: "system/message", data: {}, message: { content: [{ type: "text", text: "abcd" }] } },
		{ seq: 2, type: "user/message", data: { source: { kind: "user" } }, message: { content: [{ type: "text", text: "abcd" }] } },
		{ seq: 3, type: "user/message", data: {}, message: null },
	];
	const { call } = createHarness(process.cwd(), { sessions: fakeSessions(events) });
	const body = await call("context/breakdown", {});
	assert.equal(body.status, 200, JSON.stringify(body));
	assert.equal(body.available, true);
	assert.equal(body.count, 2, "空消息不计入");
	assert.equal(body.tokens.system, 9);
	assert.equal(body.tokens.user, 9);
	// 第二次命中缓存，结果不变。
	const again = await call("context/breakdown", {});
	assert.deepEqual(again.tokens, body.tokens);
});

test("context/breakdown：未知会话与不支持 surface 的会话被拒绝", { timeout: 30000 }, async () => {
	const { call } = createHarness(process.cwd(), { sessions: { get: (id) => (id === "fixture" ? { header: { cwd: process.cwd() } } : undefined) } });
	const noSurface = await call("context/breakdown", {});
	assert.equal(noSurface.status, 503, JSON.stringify(noSurface));
	const unknown = await call("context/breakdown", { sessionId: "missing" });
	assert.equal(unknown.status, 404, JSON.stringify(unknown));
});
