// dsh-awesome-hud — 会话状态推导（纯函数，host 与 client 双端共享同一份映射语义）
// 需求状态：任务中 / 待审批 / 空闲中 / 待回答 / 等待子任务
// 优先级（Q4 已确认）：待审批 > 待回答 > 等待子任务 > 任务中 > 空闲中
// 输入为最小标量集合（无 live 对象）；client 侧镜像同逻辑，修改必须同步（见 lib/client.js）。

export const STATUS_KEYS = Object.freeze([
	"awaiting-approval",
	"awaiting-answer",
	"waiting-subagents",
	"running",
	"idle",
]);

/**
 * @param {object} input
 * @param {boolean} input.running agent 是否正在运行（SessionListEntry.running / agent.status）
 * @param {string|undefined} input.pendingInteraction 'approval' | 'plan-review' | 'question' | undefined
 * @param {boolean} input.subagentActive 是否存在正在运行的子代理（后代树中 activity==='running'）
 * @returns 上述 STATUS_KEYS 之一
 */
export function deriveSessionStatus({ running = false, pendingInteraction, subagentActive = false }) {
	if (pendingInteraction === "approval") return "awaiting-approval";
	if (pendingInteraction === "question" || pendingInteraction === "plan-review") return "awaiting-answer";
	if (subagentActive) return "waiting-subagents";
	if (running) return "running";
	return "idle";
}

/** 子代理状态映射：activity → 展示键（执行中/已完成）。 */
export function subagentStatusKey(activity) {
	return activity === "running" ? "running" : "done";
}
