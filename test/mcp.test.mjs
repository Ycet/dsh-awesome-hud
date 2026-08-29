// dsh-awesome-hud — MCP 解析单测
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	serverNameOf,
	collectServers,
	isMcpTool,
	collectMcpServers,
	readMcpStates,
	writeMcpStates,
	MCP_PATCH_BEGIN,
	MCP_PATCH_END,
	sanitizeSessionId,
	sanitizeServerName,
} from "../lib/mcp.js";

test("serverNameOf 正常", () => {
	assert.equal(serverNameOf("mcp__github__list_repos"), "github");
	assert.equal(serverNameOf("mcp__GPT_Image_2_MCP__generate"), "GPT_Image_2_MCP");
	assert.equal(serverNameOf("mcp__lark-sheets__read"), "lark-sheets");
});

test("serverNameOf 非法", () => {
	assert.equal(serverNameOf("read"), undefined);
	assert.equal(serverNameOf("mcp__"), undefined);
	assert.equal(serverNameOf("mcp__x"), undefined); // 无双层下划线分隔 raw
	assert.equal(serverNameOf("mcp_____y"), undefined); // serverName 为空
	assert.equal(serverNameOf("mcp__bad name__y"), undefined); // 空格非法
	assert.equal(serverNameOf("mcp__aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa__y"), undefined); // 超长
	assert.equal(serverNameOf(null), undefined);
});

test("collectServers 去重保序", () => {
	const names = ["mcp__b__1", "mcp__a__2", "mcp__b__3", "read", "mcp__c__4"];
	assert.deepEqual(collectServers(names), ["b", "a", "c"]);
	assert.deepEqual(collectServers([]), []);
});

test("isMcpTool", () => {
	assert.equal(isMcpTool("mcp__github__list", "github"), true);
	assert.equal(isMcpTool("mcp__github__list", "githu"), false);
	assert.equal(isMcpTool("read", "github"), false);
});

test("collectMcpServers：仅 mcp-client 条目，enabled 取全局 disabled 取反", () => {
	const entries = [
		{ id: "mcp-gpt-image", options: { name: "@deepseek-ai/dsh-mcp-client", id: "mcp-gpt-image", config: { serverName: "GPT_Image_2_MCP" } }, disabled: false },
		{ id: "mcp-docs", options: { name: "@deepseek-ai/dsh-mcp-client", id: "mcp-docs", config: { serverName: "docs" } }, disabled: true },
		{ id: "mcp-lark", options: { name: "@deepseek-ai/dsh-mcp-client", config: { serverName: "lark" } }, disabled: false },
		{ id: "other", options: { name: "@deepseek-ai/dsh-other", id: "other", config: {} }, disabled: false },
		{ id: "badname", options: { name: "@deepseek-ai/dsh-mcp-client", id: "badname", config: { serverName: "bad name" } }, disabled: false },
	];
	assert.deepEqual(collectMcpServers(entries), [
		{ name: "GPT_Image_2_MCP", enabled: true, entryId: "mcp-gpt-image" },
		{ name: "docs", enabled: false, entryId: "mcp-docs" },
		{ name: "lark", enabled: true, entryId: "mcp-lark" },
	]);
	assert.deepEqual(collectMcpServers([]), []);
	assert.deepEqual(collectMcpServers(undefined), []);
});

test("readMcpStates / writeMcpStates：块内读写与原文保留", () => {
	const text = [
		"# my patch",
		"- insert:",
		"    - id: mcp-gpt-image",
		"      name: '@deepseek-ai/dsh-mcp-client'",
		"",
	].join("\n");
	const states = readMcpStates(text);
	assert.equal(states.size, 0);
	const written = writeMcpStates(text, new Map([["mcp-gpt-image", true]]));
	assert.ok(written.includes(MCP_PATCH_BEGIN));
	assert.ok(written.includes(MCP_PATCH_END));
	assert.ok(written.includes("- id: mcp-gpt-image"));
	assert.ok(written.includes("disabled: true"));
	assert.ok(written.includes("# my patch"));
	assert.ok(written.includes("name: '@deepseek-ai/dsh-mcp-client'"));
	// 再读回
	const back = readMcpStates(written);
	assert.equal(back.get("mcp-gpt-image"), true);
	// 清空 → 块整体移除
	const cleared = writeMcpStates(written, new Map());
	assert.ok(!cleared.includes(MCP_PATCH_BEGIN));
	assert.ok(!cleared.includes(MCP_PATCH_END));
});

test("sanitize 输入卫生", () => {
	assert.equal(sanitizeSessionId("abc:123_456-ok"), "abc:123_456-ok");
	assert.equal(sanitizeSessionId("../../etc/passwd"), null);
	assert.equal(sanitizeSessionId(""), null);
	assert.equal(sanitizeSessionId(123), null);
	assert.equal(sanitizeServerName("github"), "github");
	assert.equal(sanitizeServerName("bad name"), null);
	assert.equal(sanitizeServerName(""), null);
});
