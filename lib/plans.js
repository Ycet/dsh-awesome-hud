// dsh-awesome-hud — 计划清单推导（纯函数）
//
// 数据源：会话日志（Session.events）中的 exit_plan_mode 工具调用记录。
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

	for (const event of events) {
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
					seq: typeof event.seq === "number" ? event.seq : -1,
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
			const callId = event.data.callId;
			if (typeof callId !== "string") continue;
			const call = calls.get(callId);
			if (call === undefined) {
				results.set(callId, { resultError: event.data.error !== undefined && event.data.error !== null });
				continue;
			}
			call.hasResult = true;
			call.resultError = event.data.error !== undefined && event.data.error !== null;
			continue;
		}
	}

	// 无配对 result 的计划：检查其后是否存在 plan/mode active=false（自动废弃）。
	for (const callId of order) {
		const call = calls.get(callId);
		if (!call.hasResult) {
			call.status = hasLaterPlanExit(events, call.seq) ? PLAN_STATUS.DISCARDED : PLAN_STATUS.PENDING;
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

/** 事件序列中，seq 大于 givenSeq 的位置之后是否出现 plan/mode active=false。 */
function hasLaterPlanExit(events, givenSeq) {
	let after = false;
	for (const event of events) {
		if (!isRecord(event)) continue;
		if (after && event.type === "plan/mode" && isRecord(event.data) && event.data.active === false) return true;
		if (typeof event.seq === "number" && givenSeq >= 0 && event.seq === givenSeq) after = true;
	}
	return false;
}