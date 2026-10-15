// dsh-awesome-hud — Codex quota projection helpers
//
// The browser bundle mirrors this small contract because lib/client.js is a
// self-contained ModuleLoader artifact. Keep both implementations in sync.

export const CODEX_WINDOW_SECONDS = Object.freeze({
	fiveHour: 5 * 60 * 60,
	weekly: 7 * 24 * 60 * 60,
	// 未订阅（免费）账号的 codex 额度只返回一个约 30 天的月度窗口
	free: 30 * 24 * 60 * 60,
});

const WINDOW_TOLERANCE = 0.05;

function displayablePercent(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function matchesWindow(seconds, expected) {
	return typeof seconds === "number"
		&& Number.isFinite(seconds)
		&& seconds > 0
		&& Math.abs(seconds - expected) <= expected * WINDOW_TOLERANCE;
}

function selectWindow(windows, expected) {
	const candidates = (Array.isArray(windows) ? windows : [])
		.map((window) => ({
			window,
			remainingPercent: displayablePercent(window?.remainingPercent),
			distance: typeof window?.windowSeconds === "number" ? Math.abs(window.windowSeconds - expected) : Number.POSITIVE_INFINITY,
		}))
		.filter((item) => matchesWindow(item.window?.windowSeconds, expected) && item.remainingPercent !== null)
		.sort((left, right) => left.distance - right.distance);
	return candidates[0]?.remainingPercent ?? null;
}

/** 免费额度剩余百分比：优先月度窗口；时长与预期不符时回退首个可用窗口。 */
function selectFreeQuota(windows) {
	const monthly = selectWindow(windows, CODEX_WINDOW_SECONDS.free);
	if (monthly !== null) return monthly;
	const fallback = (Array.isArray(windows) ? windows : [])
		.map((window) => displayablePercent(window?.remainingPercent))
		.find((value) => value !== null);
	return fallback ?? null;
}

/**
 * Select the main Codex quota windows from the browser-safe usage projection
 * returned by dsh-codex-subscription.
 *
 * 订阅与否按窗口形状判定（订阅插件的 RPC 不暴露套餐字段）：出现 5h 或周窗口即
 * 视为订阅（`mode: "subscription"`、`free` 恒为 null）；两者都没有时按未订阅处理
 * （`mode: "free"`），取该额度窗口作为「codex 免费额度」。两者互斥。
 */
export function selectCodexQuotaWindows(usage) {
	const limit = Array.isArray(usage?.rateLimits)
		? usage.rateLimits.find((item) => item !== null && typeof item === "object" && item.id === "codex")
		: null;
	const windows = limit?.windows;
	const fiveHour = selectWindow(windows, CODEX_WINDOW_SECONDS.fiveHour);
	const weekly = selectWindow(windows, CODEX_WINDOW_SECONDS.weekly);
	const subscription = fiveHour !== null || weekly !== null;
	return {
		fiveHour,
		weekly,
		free: subscription ? null : selectFreeQuota(windows),
		mode: subscription ? "subscription" : "free",
	};
}
