// dsh-awesome-hud — MCP 解析单测
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	serverNameOf,
	collectServers,
	isMcpTool,
	isMcpClientEntry,
	collectMcpServers,
	stripManagedBlockMarkers,
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

test("isMcpClientEntry：官方全名与简写都算 mcp-client，其它模块不算", () => {
	assert.equal(isMcpClientEntry({ options: { name: "@deepseek-ai/dsh-mcp-client" } }), true);
	assert.equal(isMcpClientEntry({ options: { name: "mcp-client" } }), true);
	assert.equal(isMcpClientEntry({ options: { name: "@deepseek-ai/dsh-other" } }), false);
	assert.equal(isMcpClientEntry({ options: {} }), false);
	assert.equal(isMcpClientEntry(null), false);
});

test("stripManagedBlockMarkers：只删旧托管块的两行注释，块内每一行原样保留", () => {
	const text = [
		"# my patch",
		"- id: ui-chat",
		"  config:",
		"    transcriptView: standard",
		"",
		MCP_PATCH_BEGIN,
		"- id: mcp-exa",
		"  disabled: true",
		"- id: dsh-connect-workbuddy",
		"  name: dsh-connect-workbuddy",
		"  config:",
		"    regions: {}",
		MCP_PATCH_END,
		"",
	].join("\n");
	const cleaned = stripManagedBlockMarkers(text);
	assert.equal(cleaned.changed, true);
	assert.ok(!cleaned.text.includes(MCP_PATCH_BEGIN));
	assert.ok(!cleaned.text.includes(MCP_PATCH_END));
	// 关键回归：被 DSH 设置持久化夹进托管块内部的其它插件条目不得丢失。
	assert.ok(cleaned.text.includes("- id: mcp-exa\n  disabled: true"));
	assert.ok(cleaned.text.includes("- id: dsh-connect-workbuddy\n  name: dsh-connect-workbuddy"));
	assert.ok(cleaned.text.includes("    regions: {}"));
	assert.ok(cleaned.text.includes("# my patch"));
	// 除两行注释外逐字一致。
	assert.equal(cleaned.text, text.split("\n").filter(line => line !== MCP_PATCH_BEGIN && line !== MCP_PATCH_END).join("\n"));
});

test("stripManagedBlockMarkers：无标记原样返回，CRLF 也能识别标记", () => {
	const plain = "# my patch\n- id: ui-chat\n";
	assert.deepEqual(stripManagedBlockMarkers(plain), { text: plain, changed: false });
	const crlf = `a\r\n${MCP_PATCH_BEGIN}\r\n- id: mcp-exa\r\n  disabled: false\r\n${MCP_PATCH_END}\r\n`;
	const cleaned = stripManagedBlockMarkers(crlf);
	assert.equal(cleaned.changed, true);
	assert.ok(!cleaned.text.includes(MCP_PATCH_BEGIN));
	assert.ok(cleaned.text.includes("- id: mcp-exa\r\n  disabled: false"));
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
