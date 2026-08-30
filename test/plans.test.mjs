// dsh-awesome-hud — 计划清单推导单测
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_STATUS, scanPlanEvents, planTitleOf, planExcerptOf } from "../lib/plans.js";

/** 构造一条工具调用事件。 */
function toolCall(seq, time, callId, plan) {
	return {
		type: "tool/call",
		seq,
		time,
		data: { name: "exit_plan_mode", callId, arguments: JSON.stringify({ plan }) },
	};
}

/** 构造一条工具结果事件（真实结构：配对键在 message.content[0].toolCallId；失败时 data.error 与块 isError 同时出现）。 */
function toolResult(seq, time, callId, error = false) {
	return {
		type: "tool/result",
		seq,
		time,
		data: {
			turn: 1,
			step: 1,
			message: {
				role: "user",
				content: [{
					type: "tool-result",
					toolCallId: callId,
					content: [{ type: "text", text: error ? "rejected" : "Plan approved" }],
					...(error ? { isError: true } : {}),
				}],
			},
			...(error ? { error: { name: "Error", code: "tool-error" } } : {}),
		},
	};
}

function planMode(seq, time, active) {
	return { type: "plan/mode", seq, time, data: { active } };
}

const PLAN_A = "# 计划A\n\n步骤1\n步骤2";
const PLAN_B = "## 计划B\n\n- 事项1\n- 事项2";

test("空日志 → 无计划", () => {
	assert.deepEqual(scanPlanEvents([]), []);
	assert.deepEqual(scanPlanEvents(null), []);
	assert.deepEqual(scanPlanEvents("not-array"), []);
});

test("产出后无审批结论 → 待审批", () => {
	const plans = scanPlanEvents([toolCall(1, 1000, "c1", PLAN_A)]);
	assert.equal(plans.length, 1);
	assert.equal(plans[0].status, PLAN_STATUS.PENDING);
	assert.equal(plans[0].id, "c1");
	assert.equal(plans[0].title, "计划A");
	assert.equal(plans[0].plan, PLAN_A);
	assert.equal(plans[0].time, 1000);
});

test("审批通过（result 无 error）→ 已执行", () => {
	const plans = scanPlanEvents([toolCall(1, 1000, "c1", PLAN_A), toolResult(2, 2000, "c1", false)]);
	assert.equal(plans.length, 1);
	assert.equal(plans[0].status, PLAN_STATUS.APPROVED);
});

test("拒审（result 带 error）→ 已废弃", () => {
	const plans = scanPlanEvents([toolCall(1, 1000, "c1", PLAN_A), toolResult(2, 2000, "c1", true)]);
	assert.equal(plans[0].status, PLAN_STATUS.DISCARDED);
});

test("无审批结论且 plan 模式随后退出 → 自动废弃", () => {
	const events = [toolCall(1, 1000, "c1", PLAN_A), planMode(2, 2000, false)];
	const plans = scanPlanEvents(events);
	assert.equal(plans[0].status, PLAN_STATUS.DISCARDED);
});

test("plan 模式退出在产出的多次审查之后不影响已批准计划", () => {
	// 批准 → 已执行，随后的 plan/mode false 不改变状态
	const events = [toolCall(1, 1000, "c1", PLAN_A), toolResult(2, 2000, "c1", false), planMode(3, 3000, false)];
	const plans = scanPlanEvents(events);
	assert.equal(plans[0].status, PLAN_STATUS.APPROVED);
});

test("短暂重新进入 plan 模式不算退出", () => {
	// call 之后只有 plan/mode true（重新进入），无 false → 保持待审批
	const events = [toolCall(1, 1000, "c1", PLAN_A), planMode(2, 2000, true)];
	assert.equal(scanPlanEvents(events)[0].status, PLAN_STATUS.PENDING);
});

test("plan 模式退出后重新进入再产出 → 旧计划废弃、新计划待审批", () => {
	const events = [
		toolCall(1, 1000, "c1", PLAN_A),
		planMode(2, 2000, false),          // 用户 /plan off 离开（c1 无结论 → 废弃）
		planMode(3, 3000, true),           // 重新进入 plan 模式
		toolCall(4, 4000, "c2", PLAN_B),   // 新计划待审批
	];
	const plans = scanPlanEvents(events);
	assert.equal(plans.length, 2);
	assert.equal(plans[0].status, PLAN_STATUS.DISCARDED);
	assert.equal(plans[1].status, PLAN_STATUS.PENDING);
	assert.equal(plans[0].id, "c1");
	assert.equal(plans[1].id, "c2");
});

test("连续提交：拒审后修改再提交 → 旧废弃、新待审批", () => {
	const events = [
		toolCall(1, 1000, "c1", PLAN_A),
		toolResult(2, 2000, "c1", true),   // 拒审 → c1 废弃
		toolCall(3, 3000, "c2", PLAN_B),
		toolResult(4, 4000, "c2", false),  // 批准 → c2 已执行
	];
	const plans = scanPlanEvents(events);
	assert.equal(plans.length, 2);
	assert.equal(plans[0].status, PLAN_STATUS.DISCARDED);
	assert.equal(plans[1].status, PLAN_STATUS.APPROVED);
});

test("返回顺序为产出顺序（旧 → 新）", () => {
	const events = [toolCall(1, 1000, "c1", PLAN_A), toolCall(2, 2000, "c2", PLAN_B)];
	const plans = scanPlanEvents(events);
	assert.deepEqual(plans.map((item) => item.id), ["c1", "c2"]);
});

test("非法 arguments / 非 plan 字段 / 空白 plan → 跳过", () => {
	const bad = [
		{ type: "tool/call", seq: 1, time: 1, data: { name: "exit_plan_mode", callId: "x1", arguments: "not-json" } },
		{ type: "tool/call", seq: 2, time: 2, data: { name: "exit_plan_mode", callId: "x2", arguments: "{}" } },
		{ type: "tool/call", seq: 3, time: 3, data: { name: "exit_plan_mode", callId: "x3", arguments: JSON.stringify({ plan: "" }) } },
		{ type: "tool/call", seq: 4, time: 4, data: { name: "exit_plan_mode", callId: "x4", arguments: JSON.stringify({ plan: "   " }) } },
	];
	assert.deepEqual(scanPlanEvents(bad), []);
});

test("非本工具调用 / 无关事件 → 忽略", () => {
	const events = [
		{ type: "tool/call", seq: 1, time: 1, data: { name: "bash", callId: "b1", arguments: "{}" } },
		{ type: "user/message", seq: 2, time: 2, data: { content: "hello" } },
		{ type: "turn/start", seq: 3, time: 3, data: { turn: 1 } },
	];
	assert.deepEqual(scanPlanEvents(events), []);
});

test("损坏的事件对象 → 容错跳过", () => {
	const events = [null, undefined, 42, "str", { type: "tool/call" }, { type: "tool/result", data: {} }];
	assert.deepEqual(scanPlanEvents(events), []);
});

test("plan 标题提取", () => {
	assert.equal(planTitleOf("# 标题一\n正文"), "标题一");
	assert.equal(planTitleOf("## 二级\n正文"), "二级");
	assert.equal(planTitleOf("###### 六级"), "六级");
	assert.equal(planTitleOf("#   带空格标题  "), "带空格标题");
	assert.equal(planTitleOf("无标题\n正文"), null);
	assert.equal(planTitleOf(""), null);
	assert.equal(planTitleOf("   "), null);
	assert.equal(planTitleOf(null), null);
	// 标题前有说明文字 → 取首个标题
	assert.equal(planTitleOf("说明\n# 正式标题\n正文"), "正式标题");
});

test("无标题时正文摘要截取 40 字符", () => {
	const long = "abcdefghij".repeat(8); // 80 字符
	const excerpt = planExcerptOf(long);
	assert.equal(excerpt.length, 41); // 40 + …
	assert.ok(excerpt.endsWith("…"));
	assert.equal(planExcerptOf("短正文"), "短正文");
	assert.equal(planExcerptOf(""), "");
	assert.equal(planExcerptOf(null), "");
	// 空白折叠
	assert.equal(planExcerptOf("a\n\nb\t c"), "a b c");
});

test("result 先于 call 出现时仍能配对（防御）", () => {
	const events = [toolResult(1, 1000, "c1", false), toolCall(2, 2000, "c1", PLAN_A)];
	const plans = scanPlanEvents(events);
	assert.equal(plans.length, 1);
	assert.equal(plans[0].status, PLAN_STATUS.APPROVED);
});

test("callId 缺失时用 seq 兜底生成 id", () => {
	const events = [{ type: "tool/call", seq: 7, time: 1, data: { name: "exit_plan_mode", arguments: JSON.stringify({ plan: PLAN_A }) } }];
	const plans = scanPlanEvents(events);
	assert.equal(plans.length, 1);
	assert.equal(plans[0].id, "plan-7");
});

test("结果块 isError=true 单独出现时也判为拒审", () => {
	// 兼容：旧结构 data.callId 仍可配对；仅块级 isError 无 data.error 也废弃
	const call = { type: "tool/call", seq: 1, time: 1000, data: { name: "exit_plan_mode", callId: "c1", arguments: JSON.stringify({ plan: PLAN_A }) } };
	const bad = {
		type: "tool/result",
		seq: 2,
		time: 2000,
		data: {
			callId: "c1", // 旧结构直接配对键
			message: { role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "rejected" }], isError: true }] },
		},
	};
	assert.equal(scanPlanEvents([call, bad])[0].status, PLAN_STATUS.DISCARDED);
});

test("仅 data.error（无块 isError）也判为拒审", () => {
	const call = toolCall(1, 1000, "c1", PLAN_A);
	const result = {
		type: "tool/result",
		seq: 2,
		time: 2000,
		data: {
			turn: 1,
			step: 1,
			message: { role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "kept planning" }] }] },
			error: { name: "Error", code: "tool-error" },
		},
	};
	assert.equal(scanPlanEvents([call, result])[0].status, PLAN_STATUS.DISCARDED);
});