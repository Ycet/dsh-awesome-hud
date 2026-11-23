// dsh-awesome-hud — v0.21.7：gpt_imagegen 生成的图片纳入产物模块
import test from "node:test";
import assert from "node:assert/strict";
import { collectOutputs } from "../lib/index.js";

/** 构造一条 tool/call（含 callId，供 result 关联工具名）。 */
const callEvent = (seq, turn, name, args, callId) => ({
	type: "tool/call",
	seq,
	time: seq * 1000,
	data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) },
});

/**
 * 构造一条 tool/result：真实事件里消息体在 `data.message`，
 * 工具名靠 `message.source.callId` 关联 tool/call。
 */
const resultEvent = (seq, turn, callId, text) => ({
	type: "tool/result",
	seq,
	time: seq * 1000,
	data: { turn, step: 1, message: { role: "tool", source: { kind: "tool", callId }, content: [{ type: "text", text }] } },
});

/** gpt_imagegen get_image_task 完成时的结果文本（## result JSON 块内含图片绝对路径）。 */
const completedText = (absolutePath) => [
	"- **taskId**: 06715ac4-2c9a-4d68-854e-4a2c71b48b43",
	"",
	"- **status**: completed",
	"",
	"## request",
	"```json",
	JSON.stringify({ providerId: "right-code", model: "gpt-image-2", prompt: "猫" }),
	"```",
	"",
	"## result",
	"```json",
	JSON.stringify({ status: "completed", filePath: absolutePath, filePaths: [absolutePath] }),
	"```",
].join("\n");

const GEN_CALL_ID = "call_gen_1";
const POLL_CALL_ID = "call_poll_1";

test("gpt_imagegen：get_image_task 完成文本里的图片路径进入产物列表", async () => {
	const events = [
		callEvent(10, 1, "mcp__gpt_imagegen__generate_image", { prompt: "猫", outputFileName: "cat" }, GEN_CALL_ID),
		resultEvent(11, 1, GEN_CALL_ID, "- **status**: running"),
		callEvent(20, 1, "mcp__gpt_imagegen__get_image_task", { taskId: "t1" }, POLL_CALL_ID),
		resultEvent(21, 1, POLL_CALL_ID, completedText("/repo/outputs/images/cat.png")),
	];
	const output = await collectOutputs({ sessionId: "s1", cwd: "/repo", events, exists: async () => true });
	assert.deepEqual(output.files.map((file) => file.path), ["outputs/images/cat.png"]);
	assert.equal(output.files[0].source, "session");
	assert.equal(output.total, 1);
});

test("gpt_imagegen：绝对路径按会话工作区归一，工作区外被丢弃", async () => {
	const cwd = "/repo/sub";
	const events = [
		callEvent(20, 1, "mcp__gpt_imagegen__get_image_task", { taskId: "t1" }, POLL_CALL_ID),
		resultEvent(21, 1, POLL_CALL_ID, completedText("/repo/sub/docs/pic.png")),
	];
	const inside = await collectOutputs({ sessionId: "s1", cwd, events, exists: async () => true });
	assert.deepEqual(inside.files.map((file) => file.path), ["docs/pic.png"]);
	const outside = await collectOutputs({
		sessionId: "s1",
		cwd,
		events: [events[0], resultEvent(21, 1, POLL_CALL_ID, completedText("/elsewhere/pic.png"))],
		exists: async () => true,
	});
	assert.equal(outside.total, 0);
});

test("gpt_imagegen：filePaths 多图、路径带空格与未传 workspaceRoot 的绝对路径", async () => {
	const cwd = "/repo";
	const multiText = [
		"## result",
		"```json",
		JSON.stringify({ filePaths: ["/repo/outputs/images/a b.png", "/repo/outputs/images/c.png"] }),
		"```",
	].join("\n");
	const events = [
		callEvent(20, 1, "mcp__gpt_imagegen__get_image_task", {}, POLL_CALL_ID),
		resultEvent(21, 1, POLL_CALL_ID, multiText),
	];
	const output = await collectOutputs({ sessionId: "s1", cwd, events, exists: async () => true });
	assert.deepEqual(output.files.map((file) => file.path), ["outputs/images/a b.png", "outputs/images/c.png"]);
});

test("gpt_imagegen：运行中、失败或无 callId 关联的结果不产生候选", async () => {
	const cwd = "/repo";
	const events = [
		callEvent(10, 1, "mcp__gpt_imagegen__get_image_task", {}, "call_a"),
		resultEvent(11, 1, "call_a", "- **status**: running"),
		resultEvent(12, 1, "call_a", "- **status**: failed"),
		resultEvent(13, 1, "call_unknown", completedText("/repo/outputs/images/x.png")),
		resultEvent(14, 1, undefined, completedText("/repo/outputs/images/y.png")),
	];
	const output = await collectOutputs({ sessionId: "s1", cwd, events, exists: async () => true });
	assert.equal(output.total, 0);
	assert.equal(output.files.length, 0);
});

test("gpt_imagegen：非 gpt_imagegen 的 tool/result 不解析（普通工具结果零影响）", async () => {
	const cwd = "/repo";
	const events = [
		callEvent(10, 1, "bash", { command: "ls" }, "call_bash"),
		resultEvent(11, 1, "call_bash", "## result\n```json\n{\"filePath\": \"/repo/outputs/images/z.png\"}\n```"),
		callEvent(20, 1, "mcp__other__get", {}, "call_other"),
		resultEvent(21, 1, "call_other", completedText("/repo/outputs/images/w.png")),
	];
	const output = await collectOutputs({ sessionId: "s1", cwd, events, exists: async () => true });
	assert.equal(output.total, 0);
});

test("gpt_imagegen：坏 JSON 或无路径字段时静默忽略", async () => {
	const cwd = "/repo";
	const events = [
		callEvent(10, 1, "mcp__gpt_imagegen__get_image_task", {}, "call_c"),
		resultEvent(11, 1, "call_c", "## result\n```json\n{\"filePath\": 42}\n```"),
		resultEvent(12, 1, "call_c", "## result\n```json\n{ broken"),
		resultEvent(13, 1, "call_c", "## result\n```json\n{\"status\": \"completed\"}\n```"),
	];
	const output = await collectOutputs({ sessionId: "s1", cwd, events, exists: async () => true });
	assert.equal(output.total, 0);
});

test("gpt_imagegen：与 write/present 证据共用去重与排序", async () => {
	const cwd = "/repo";
	const events = [
		{ type: "tool/call", seq: 5, time: 500, data: { turn: 1, name: "write", arguments: JSON.stringify({ file_path: "docs/report.md" }) } },
		callEvent(10, 1, "mcp__gpt_imagegen__generate_image", {}, GEN_CALL_ID),
		callEvent(20, 2, "mcp__gpt_imagegen__get_image_task", {}, POLL_CALL_ID),
		resultEvent(21, 2, POLL_CALL_ID, completedText("/repo/outputs/images/cat.png")),
	];
	const output = await collectOutputs({ sessionId: "s1", cwd, events, exists: async () => true });
	// 图片事件时间更晚，应排在 write 之前
	assert.deepEqual(output.files.map((file) => file.path), ["outputs/images/cat.png", "docs/report.md"]);
});
