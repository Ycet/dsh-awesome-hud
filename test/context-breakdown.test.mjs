// v0.21.6：上下文分段条的宿主侧估算（七类明细）。
import assert from "node:assert/strict";
import test from "node:test";
import { contextCategoryOf, contextTokensOf, estimateContextMessage } from "../lib/index.js";

test("estimateContextMessage：对齐官方 estimateMessage 的文本与角色开销", () => {
	// "abcd" 4 字符 → ceil(4/4)=1，加块开销 4，再加角色开销 4。
	assert.equal(estimateContextMessage({ content: [{ type: "text", text: "abcd" }] }), 9);
	// 官方口径：非 system 消息一律加角色开销，内容为空也加 4。
	// 空内容消息在 surface 侧已被 deriveEventMessage 返回 null，不会记进分类。
	assert.equal(estimateContextMessage({ content: [] }), 4);
	assert.equal(estimateContextMessage({}), 4);
	assert.equal(estimateContextMessage(null), 0);
	// system 消息走纯文本口径：不加块开销，只加角色开销。
	// 10 字符 → ceil(10/4)=3，加 4 = 7（若按块口径会是 3+4+4=11）。
	assert.equal(estimateContextMessage({ role: "system", content: [{ type: "text", text: "0123456789" }] }), 7);
	// 推理块与文本块同价（官方 estimateContent 把两者放在同一个 case）。
	assert.equal(
		estimateContextMessage({ content: [{ type: "reasoning", text: "abcd" }] }),
		estimateContextMessage({ content: [{ type: "text", text: "abcd" }] }),
	);
	// 工具调用块：参数在事件里是字符串，按字符串长度计（不是 JSON.stringify 后的长度）。
	const args = "{\"command\":\"ls\"}";
	const call = estimateContextMessage({ content: [{ type: "tool-call", name: "bash", arguments: args }] });
	assert.equal(call, Math.ceil(4 / 4) + Math.ceil(args.length / 4) + 4 + 4);
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
		{ type: "system/message", message: { role: "system", content: [{ type: "text", text: "abcd" }] } },
		{ type: "user/message", source: { kind: "user" }, message: { content: [{ type: "text", text: "abcd" }] } },
		{ type: "user/message", message: null },
		null,
	]);
	assert.equal(tokens.system, 5);
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
		{ seq: 1, type: "system/message", data: {}, message: { role: "system", content: [{ type: "text", text: "abcd" }] } },
		{ seq: 2, type: "user/message", data: { source: { kind: "user" } }, message: { content: [{ type: "text", text: "abcd" }] } },
		{ seq: 3, type: "user/message", data: {}, message: null },
	];
	const { call } = createHarness(process.cwd(), { sessions: fakeSessions(events) });
	const body = await call("context/breakdown", {});
	assert.equal(body.status, 200, JSON.stringify(body));
	assert.equal(body.available, true);
	assert.equal(body.count, 2, "空消息不计入");
	assert.equal(body.tokens.system, 5);
	assert.equal(body.tokens.user, 9);
	// 第二次命中缓存，结果不变。
	const again = await call("context/breakdown", {});
	assert.deepEqual(again.tokens, body.tokens);
});

test("context/breakdown：追加节点后缓存必须失效（v0.21.7 回归）", { timeout: 30000 }, async () => {
	// contentGeneration 只在 surface 被替换/投影时递增，普通追加不动它。
	// 旧实现的缓存键只看 contentGeneration，导致明细冻结在首次快照上。
	const events = [
		{ seq: 1, type: "system/message", data: {}, message: { role: "system", content: [{ type: "text", text: "abcd" }] } },
		{ seq: 2, type: "user/message", data: { source: { kind: "user" } }, message: { content: [{ type: "text", text: "abcd" }] } },
	];
	const sessions = fakeSessions(events);
	const { call } = createHarness(process.cwd(), { sessions });
	const first = await call("context/breakdown", {});
	assert.equal(first.status, 200, JSON.stringify(first));
	assert.equal(first.tokens.assistant, 0);
	// 追加一条助手消息：节点变多，但 contentGeneration 仍然是 1。
	events.push({ seq: 3, type: "assistant/message", data: {}, message: { content: [{ type: "text", text: "abcd" }] } });
	sessions.get("fixture").surface.nodes = events.map((event) => event.seq);
	const second = await call("context/breakdown", {});
	assert.equal(second.tokens.assistant, 9, "追加后必须重新计算");
	assert.equal(second.count, 3);
});

test("context/breakdown：未知会话与不支持 surface 的会话被拒绝", { timeout: 30000 }, async () => {
	const { call } = createHarness(process.cwd(), { sessions: { get: (id) => (id === "fixture" ? { header: { cwd: process.cwd() } } : undefined) } });
	const noSurface = await call("context/breakdown", {});
	assert.equal(noSurface.status, 503, JSON.stringify(noSurface));
	const unknown = await call("context/breakdown", { sessionId: "missing" });
	assert.equal(unknown.status, 404, JSON.stringify(unknown));
});
