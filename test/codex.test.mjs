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
	}), { fiveHour: 82.2, weekly: 61.4 });
});

test("selectCodexQuotaWindows tolerates the Codex window-label margin", () => {
	assert.deepEqual(selectCodexQuotaWindows({
		rateLimits: [{ id: "codex", windows: [
			{ windowSeconds: 17_200, remainingPercent: 80 },
			{ windowSeconds: 605_000, remainingPercent: 70 },
		] }],
	}), { fiveHour: 80, weekly: 70 });
});

test("selectCodexQuotaWindows returns null for missing or untrusted windows", () => {
	assert.deepEqual(selectCodexQuotaWindows({
		rateLimits: [{ id: "codex", windows: [
			{ windowSeconds: 3_600, remainingPercent: 10 },
			{ windowSeconds: 18_000, remainingPercent: 101 },
			{ windowSeconds: 604_800, remainingPercent: "70" },
		] }],
	}), { fiveHour: null, weekly: null });
	assert.deepEqual(selectCodexQuotaWindows({ rateLimits: [] }), { fiveHour: null, weekly: null });
	assert.deepEqual(selectCodexQuotaWindows(null), { fiveHour: null, weekly: null });
});
