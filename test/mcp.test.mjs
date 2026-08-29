// dsh-awesome-hud — MCP 解析单测
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	serverNameOf,
	collectServers,
	isMcpTool,
	resolveMcpState,
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

test("resolveMcpState", () => {
	const state = resolveMcpState(["github", "filesystem", "agent-mail"], ["agent-mail"]);
	assert.deepEqual(state, [
		{ name: "github", enabled: true },
		{ name: "filesystem", enabled: true },
		{ name: "agent-mail", enabled: false },
	]);
	assert.deepEqual(resolveMcpState([], undefined), []);
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
