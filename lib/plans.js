// dsh-awesome-hud — 计划清单推导（纯函数）
//
// 数据源：会话日志（Session.snapshotEvents / 旧 Session.events）中的 exit_plan_mode 记录。
//   - 计划产出   = tool/call 事件（name === "exit_plan_mode"，arguments 为 JSON，
//                 含 markdown 全文的 plan 字段）
//   - 审批结论   = 以 callId 配对的 tool/result 事件：
//                   无 error → 用户审批通过（approved）
//                   带 error → 拒审/要求修改/打断审查（discarded）
//   - 自动废弃   = 无配对 result 时，若该 call 之后会话日志出现 plan/mode
//                 { active: false }（用户以 /plan off 或切模式离开而无审批结论），
//                 则该计划自动标记为已废弃；否则保持待审批（pending）。
// 优先级：有配对 result 时以 result 为准；计划行的 title 取首个 # 标题，
// 无标题时行标签回退 planExcerptOf 截取正文。

export const PLAN_CALL_NAME = "exit_plan_mode";
export const PLAN_STATUS = Object.freeze({
	PENDING: "pending",
	APPROVED: "approved",
	DISCARDED: "discarded",
});

/** 提取计划 markdown 的首个 # 标题（1-6 级）；无标题返回 null。 */
export function planTitleOf(plan) {
	if (typeof plan !== "string" || plan.trim() === "") return null;
	for (const line of plan.split("\n")) {
		const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (match !== null && match[1].trim() !== "") return match[1].trim();
	}
	return null;
}

/** 无标题时行标签使用的正文摘要（空白折叠后前 40 字符）。 */
export function planExcerptOf(plan, max = 40) {
	const text = String(plan ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (text === "") return "";
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 解析 tool/call 的 arguments，返回 plan 字符串；无效输入返回 null。 */
function planOfArguments(argumentsRaw) {
	if (typeof argumentsRaw !== "string") return null;
	let parsed;
	try {
		parsed = JSON.parse(argumentsRaw);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || typeof parsed.plan !== "string") return null;
	return parsed.plan.trim() === "" ? null : parsed.plan;
}

/** 先识别新版工具消息，再兼容旧 source、嵌套结果块和直接 callId。 */
function callIdOfResult(event) {
	const message = event.data?.message;
	for (const id of [message?.toolCallId, message?.source?.callId]) {
		if (typeof id === "string" && id !== "") return id;
	}
	if (isRecord(message) && Array.isArray(message.content)) {
		for (const block of message.content) {
			if (isRecord(block) && block.type === "tool-result" && typeof block.toolCallId === "string" && block.toolCallId !== "") return block.toolCallId;
		}
	}
	const direct = event.data?.callId;
	if (typeof direct === "string" && direct !== "") return direct;
	return null;
}

/** 新版错误标记在消息上；旧结果块只检查对应调用，避免其它结果污染该计划。 */
function isResultError(event, callId) {
	if (event.data?.error !== undefined && event.data?.error !== null) return true;
	const message = event.data?.message;
	if (message?.isError === true) return true;
	if (isRecord(message) && Array.isArray(message.content)) {
		for (const block of message.content) {
			if (isRecord(block) && block.type === "tool-result" && block.toolCallId === callId && block.isError === true) return true;
		}
	}
	return false;
}

/**
 * 扫描会话日志，推导全部计划清单及其状态。
 * 返回按产出顺序（日志顺序，即旧 → 新）排列的计划数组；
 * 每条为 { id, status, title, excerpt, time, plan }。
 * 非法/不可解析的调用记录被跳过（不产生计划行）。
 */
export function scanPlanEvents(events) {
	const calls = new Map(); // callId → 计划状态收集
	const results = new Map(); // callId → { resultError }（result 可能先于 call 出现，需跨序配对）
	const order = [];        // callId 产出顺序
	if (!Array.isArray(events)) return [];

	for (const [eventIndex, event] of events.entries()) {
		if (!isRecord(event)) continue;
		if (event.type === "tool/call" && isRecord(event.data) && event.data.name === PLAN_CALL_NAME) {
			const plan = planOfArguments(event.data.arguments);
			if (plan === null) continue; // 非有效计划产出（如其它同名工具或参数损坏）
			const callId = typeof event.data.callId === "string" && event.data.callId !== ""
				? event.data.callId
				: `plan-${event.seq ?? order.length}`;
			if (!calls.has(callId)) {
				calls.set(callId, {
					id: callId,
					status: null, // result 决定：见下方推断
					title: planTitleOf(plan),
					excerpt: planExcerptOf(plan),
					time: typeof event.time === "number" ? event.time : null,
					plan,
					hasResult: false,
					resultError: false,
					eventIndex,
				});
				order.push(callId);
				const pendingResult = results.get(callId);
				if (pendingResult !== undefined) {
					calls.get(callId).hasResult = true;
					calls.get(callId).resultError = pendingResult.resultError;
				}
			}
			continue;
		}
		if (event.type === "tool/result" && isRecord(event.data)) {
			const callId = callIdOfResult(event);
			if (callId === null) continue;
			const call = calls.get(callId);
			if (call === undefined) {
				results.set(callId, { resultError: isResultError(event, callId) });
				continue;
			}
			call.hasResult = true;
			call.resultError = isResultError(event, callId);
			continue;
		}
	}

	// 无配对 result 的计划：检查其后是否存在 plan/mode active=false（自动废弃）。
	for (const callId of order) {
		const call = calls.get(callId);
		if (!call.hasResult) {
			call.status = hasLaterPlanExit(events, call.eventIndex) ? PLAN_STATUS.DISCARDED : PLAN_STATUS.PENDING;
			continue;
		}
		call.status = call.resultError ? PLAN_STATUS.DISCARDED : PLAN_STATUS.APPROVED;
	}

	const out = [];
	for (const callId of order) {
		const call = calls.get(callId);
		out.push({
			id: call.id,
			status: call.status,
			title: call.title,
			excerpt: call.excerpt,
			time: call.time,
			plan: call.plan,
		});
	}
	return out;
}

/** 以日志位置判断后续退出；旧日志缺少 seq 时也能识别，前面的退出不影响新计划。 */
function hasLaterPlanExit(events, callIndex) {
	for (let index = callIndex + 1; index < events.length; index += 1) {
		const event = events[index];
		if (!isRecord(event)) continue;
		if (event.type === "plan/mode" && isRecord(event.data) && event.data.active === false) return true;
	}
	return false;
}
