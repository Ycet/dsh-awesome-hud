import assert from "node:assert/strict";
import test from "node:test";
import { selectCodexQuotaWindows } from "../lib/codex.js";

test("selectCodexQuotaWindows selects the Codex 5-hour and weekly remaining percentages", () => {
	assert.deepEqual(selectCodexQuotaWindows({
		rateLimits: [
			{ id: "code_review", windows: [{ windowSeconds: 18_000, remainingPercent: 99 }] },
			{ id: "codex", windows: [
				{ windowSeconds: 604_800, remainingPercent: 61.4 },
				{ windowSeconds: 18_000, remainingPercent: 82.2 },
			] },
		],
	}), { fiveHour: 82.2, weekly: 61.4, free: null, mode: "subscription" });
});

test("selectCodexQuotaWindows tolerates the Codex window-label margin", () => {
	assert.deepEqual(selectCodexQuotaWindows({
		rateLimits: [{ id: "codex", windows: [
			{ windowSeconds: 17_200, remainingPercent: 80 },
			{ windowSeconds: 605_000, remainingPercent: 70 },
		] }],
	}), { fiveHour: 80, weekly: 70, free: null, mode: "subscription" });
});

test("selectCodexQuotaWindows returns null for missing or untrusted windows", () => {
	// 没有任何可信的 5h / 周窗口 → 按未订阅（免费）处理：取该额度首个可用窗口
	assert.deepEqual(selectCodexQuotaWindows({
		rateLimits: [{ id: "codex", windows: [
			{ windowSeconds: 3_600, remainingPercent: 10 },
			{ windowSeconds: 18_000, remainingPercent: 101 },
			{ windowSeconds: 604_800, remainingPercent: "70" },
		] }],
	}), { fiveHour: null, weekly: null, free: 10, mode: "free" });
	assert.deepEqual(selectCodexQuotaWindows({ rateLimits: [] }), { fiveHour: null, weekly: null, free: null, mode: "free" });
	assert.deepEqual(selectCodexQuotaWindows(null), { fiveHour: null, weekly: null, free: null, mode: "free" });
});

test("selectCodexQuotaWindows only reads the codex limit for the free window", () => {
	// 其它额度的月度窗口不得被误当作 codex 免费额度
	assert.deepEqual(selectCodexQuotaWindows({
		rateLimits: [
			{ id: "codex", windows: [] },
			{ id: "gpt-reserve", name: "gpt-reserve", windows: [{ windowSeconds: 2_592_000, remainingPercent: 30 }] },
		],
	}), { fiveHour: null, weekly: null, free: null, mode: "free" });
});
