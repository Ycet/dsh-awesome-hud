// dsh-awesome-hud — 手动压缩路由判定（host 与单测共用纯函数）
//
// 背景：billion-context（下称 bili）在启用时会通过 Cordis 配置瀑布把
// `@deepseek-ai/dsh-compaction-basic` 与 `@deepseek-ai/dsh-command-compact`
// 一并置为 disabled，因此官方 `/compact` 命令在 commands 服务里根本不存在，
// 直接调用只会得到「命令未注册」。bili 自身又没有暴露任何“立即压缩”的接口
// （/__bili/plugin/compact 只登记外部压缩边界），所以本插件在 bili 接管时
// 无法手动压缩，必须给出明确说明而不是假装尝试。
//
// 本模块只做判定，不发请求、不读配置、不产生副作用。

/** bili 在宿主进程写入的接管标记（dsh-native 激活时置为 "active"）。 */
export const BILI_VERDICT_KEY = "__BILI_DSH_COMPACTION_VERDICT__";
/** 宿主回给前端的错误码：bili 已接管压缩，本插件不做手动压缩。 */
export const BILI_MANAGED_CODE = "bili-managed";
/** 宿主错误体/日志里使用的说明（用户可见文案由客户端 i18n 按界面语言给出）。 */
export const BILI_MANAGED_MESSAGE = "billion-context manages compaction; manual compaction is unavailable";

/**
 * 读取 bili 接管标记。
 * 全局对象被代理拦截或已冻结时按“未接管”处理，绝不抛错打断按钮点击。
 */
export function isBiliCompactionActive(globalObj = globalThis) {
	try {
		return globalObj?.[BILI_VERDICT_KEY] === "active";
	} catch {
		return false;
	}
}

/**
 * 判定本次手动压缩该走哪条路。
 *
 * - `"bili"`：bili 已接管 → 直接给说明，不调用官方命令；
 * - `"official"`：交给官方 /compact（其可用性由 commands.execute 的结果决定）。
 *
 * 判据优先级：bili 全局标记 > 环境探测兜底（compaction 服务缺失 + compact 命令缺失
 * 且 bili 自己的 acp 命令存在）。只缺失 compaction/compact 而没有 acp 命令，说明更可能
 * 是用户手动停用了压缩，仍按官方路径走，让通用失败提示说明原因。
 */
export function decideCompactRoute(input) {
	const hasCompactionService = input?.hasCompactionService === true;
	const hasCompactCommand = input?.hasCompactCommand === true;
	const hasAcpCommand = input?.hasAcpCommand === true;
	if (input?.biliFlag === true) return "bili";
	if (hasCompactionService === false && hasCompactCommand === false && hasAcpCommand) return "bili";
	return "official";
}
