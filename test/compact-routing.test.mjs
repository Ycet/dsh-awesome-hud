import { test } from "node:test";
import assert from "node:assert/strict";
import { BILI_MANAGED_CODE, BILI_MANAGED_MESSAGE, BILI_VERDICT_KEY, decideCompactRoute, isBiliCompactionActive } from "../lib/compact.js";

test("常量：错误码与标记名与宿主/前端约定一致", () => {
	assert.equal(BILI_VERDICT_KEY, "__BILI_DSH_COMPACTION_VERDICT__");
	assert.equal(BILI_MANAGED_CODE, "bili-managed");
	assert.equal(typeof BILI_MANAGED_MESSAGE, "string");
	assert.ok(BILI_MANAGED_MESSAGE.length > 0);
});

test("isBiliCompactionActive：只认严格等于 active 的全局标记", () => {
	assert.equal(isBiliCompactionActive({ [BILI_VERDICT_KEY]: "active" }), true);
	assert.equal(isBiliCompactionActive({ [BILI_VERDICT_KEY]: "inactive" }), false);
	assert.equal(isBiliCompactionActive({ [BILI_VERDICT_KEY]: "ACTIVE" }), false);
	assert.equal(isBiliCompactionActive({}), false);
	assert.equal(isBiliCompactionActive(undefined), false);
	assert.equal(isBiliCompactionActive(null), false);
});

test("isBiliCompactionActive：全局对象取属性抛错时按未接管处理，不抛出", () => {
	const hostile = new Proxy({}, {
		get() {
			throw new Error("hostile global");
		},
	});
	assert.equal(isBiliCompactionActive(hostile), false);
});

test("decideCompactRoute：bili 全局标记优先", () => {
	assert.equal(decideCompactRoute({ biliFlag: true, hasCompactionService: true, hasCompactCommand: true, hasAcpCommand: false }), "bili");
	assert.equal(decideCompactRoute({ biliFlag: true, hasCompactionService: false, hasCompactCommand: false, hasAcpCommand: false }), "bili");
});

test("decideCompactRoute：标记缺失时用 acp 命令兜底识别 bili", () => {
	// bili 接管后：compaction 服务被禁用、compact 命令被注销，但 acp 命令仍在
	assert.equal(decideCompactRoute({ biliFlag: false, hasCompactionService: false, hasCompactCommand: false, hasAcpCommand: true }), "bili");
	// 只有 acp 命令、但 compaction 或 compact 命令还在（bili 未接管或未启用）
	assert.equal(decideCompactRoute({ biliFlag: false, hasCompactionService: true, hasCompactCommand: false, hasAcpCommand: true }), "official");
	assert.equal(decideCompactRoute({ biliFlag: false, hasCompactionService: false, hasCompactCommand: true, hasAcpCommand: true }), "official");
});

test("decideCompactRoute：普通环境与用户手动停用压缩都走官方路径", () => {
	assert.equal(decideCompactRoute({ biliFlag: false, hasCompactionService: true, hasCompactCommand: true, hasAcpCommand: false }), "official");
	// 用户手动停用 compaction（无 acp 命令）→ 仍走官方，由通用失败提示说明原因
	assert.equal(decideCompactRoute({ biliFlag: false, hasCompactionService: false, hasCompactCommand: false, hasAcpCommand: false }), "official");
	// 入参缺失时按官方路径处理
	assert.equal(decideCompactRoute(undefined), "official");
	assert.equal(decideCompactRoute({}), "official");
});
