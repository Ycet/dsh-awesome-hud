// dsh-awesome-hud — Codex quota projection helpers
//
// The browser bundle mirrors this small contract because lib/client.js is a
// self-contained ModuleLoader artifact. Keep both implementations in sync.

export const CODEX_WINDOW_SECONDS = Object.freeze({
	fiveHour: 5 * 60 * 60,
	weekly: 7 * 24 * 60 * 60,
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

/**
 * Select only the main Codex 5-hour and weekly windows from the browser-safe
 * usage projection returned by dsh-codex-subscription.
 */
export function selectCodexQuotaWindows(usage) {
	const limit = Array.isArray(usage?.rateLimits)
		? usage.rateLimits.find((item) => item !== null && typeof item === "object" && item.id === "codex")
		: null;
	const windows = limit?.windows;
	return {
		fiveHour: selectWindow(windows, CODEX_WINDOW_SECONDS.fiveHour),
		weekly: selectWindow(windows, CODEX_WINDOW_SECONDS.weekly),
	};
}
