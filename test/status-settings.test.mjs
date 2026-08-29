// dsh-awesome-hud — 会话状态推导与 settings 收敛单测
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSessionStatus, subagentStatusKey } from "../lib/status.js";
import { MODULE_KEYS, defaultModules, defaultUsageDisplay, normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch } from "../lib/settings.js";

test("状态优先级：待审批 > 待回答 > 等待子任务 > 任务中 > 空闲中", () => {
	assert.equal(deriveSessionStatus({ running: true, pendingInteraction: "approval", subagentActive: true }), "awaiting-approval");
	assert.equal(deriveSessionStatus({ running: true, pendingInteraction: "question", subagentActive: true }), "awaiting-answer");
	assert.equal(deriveSessionStatus({ running: true, pendingInteraction: "plan-review" }), "awaiting-answer");
	assert.equal(deriveSessionStatus({ running: false, subagentActive: true }), "waiting-subagents");
	assert.equal(deriveSessionStatus({ running: true, subagentActive: true }), "waiting-subagents");
	assert.equal(deriveSessionStatus({ running: true }), "running");
	assert.equal(deriveSessionStatus({}), "idle");
});

test("子代理状态映射", () => {
	assert.equal(subagentStatusKey("running"), "running");
	assert.equal(subagentStatusKey("inactive"), "done");
});

test("defaultModules 全键", () => {
	const modules = defaultModules();
	assert.deepEqual(Object.keys(modules).sort(), [...MODULE_KEYS].sort());
	assert.ok(Object.values(modules).every(Boolean));
});

test("normalizeSettings 收敛损坏数据", () => {
	const out = normalizeSettings({ version: 3, modules: { git: false } });
	assert.equal(out.version, 3);
	assert.equal(out.modules.git, false);
	assert.equal(out.modules.context, true); // 缺失字段回默认
	// 旧版 mcpDisabled 字段不再收敛（会话级禁用已移除）
	assert.equal("mcpDisabled" in out, false);
});

test("normalizeSettings 非对象输入", () => {
	const out = normalizeSettings(null);
	assert.deepEqual(out.modules, defaultModules());
});

test("sanitizeModulesPatch", () => {
	assert.deepEqual(sanitizeModulesPatch({ git: false, mcp: true }), { patch: { git: false, mcp: true }, changed: false });
	assert.equal(sanitizeModulesPatch({}), null);
	assert.equal(sanitizeModulesPatch({ git: "yes" }), null); // 无合法布尔
	assert.equal(sanitizeModulesPatch({ git: false, other: 1 }).patch.git, false);
	assert.equal(sanitizeModulesPatch(null), null);
});

test("defaultUsageDisplay 全键且默认展示", () => {
	const usage = defaultUsageDisplay();
	assert.deepEqual(Object.keys(usage).sort(), ["deepseek", "opencode"]);
	assert.ok(Object.values(usage).every(Boolean));
});

test("sanitizeUsagePatch：只接受 deepseek/opencode 布尔", () => {
	assert.deepEqual(sanitizeUsagePatch({ deepseek: false }), { patch: { deepseek: false }, changed: false });
	assert.deepEqual(sanitizeUsagePatch({ opencode: true }), { patch: { opencode: true }, changed: false });
	assert.equal(sanitizeUsagePatch({ deepseek: "yes" }), null);
	assert.equal(sanitizeUsagePatch({ other: true }), null); // 白名单外键
	assert.equal(sanitizeUsagePatch({}), null);
	assert.equal(sanitizeUsagePatch(null), null);
});

test("normalizeSettings：usage 缺失/损坏收敛为默认", () => {
	assert.deepEqual(normalizeSettings(null).usage, defaultUsageDisplay());
	assert.deepEqual(normalizeSettings({ usage: { deepseek: false } }).usage, { deepseek: false, opencode: true });
	assert.deepEqual(normalizeSettings({ modules: {} }).usage, defaultUsageDisplay());
	assert.deepEqual(normalizeSettings({ usage: { deepseek: "x" } }).usage, defaultUsageDisplay());
	// 历史设置（无 usage 字段）仍可完整收敛
	assert.deepEqual(normalizeSettings({ modules: { git: false } }).usage, defaultUsageDisplay());
});
