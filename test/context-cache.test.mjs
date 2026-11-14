import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { hudClient, moduleOf, nodes } from "./helpers/client-harness.mjs";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadContextHelpers() {
	const start = source.indexOf("// —— 上下文模块");
	const end = source.indexOf("// —— git 模块", start);
	assert.ok(start > 0 && end > start, "context module slice");
	const context = vm.createContext({
		t: (key) => ({
			contextDurationSeconds: "{seconds}s",
			contextDurationMinutes: "{minutes}m{seconds}s",
			contextStatsLlmTime: "Model time",
			contextStatsToolTime: "Tool time",
			contextStatsTtft: "TTFT average",
			contextStatsTps: "Output speed (TPS)",
			contextUsageCacheHit: "Cache hit",
			contextUsageUncached: "Uncached input",
			contextUsageCacheRead: "Cache read",
			contextUsageCacheWrite: "Cache write",
			contextUsageOutput: "Output",
			contextUsageLine: "{total} tok · cache hit {percent}%",
			contextUsageLineNoCache: "{total} tok",
		}[key] ?? key),
		interpolate: (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? ""),
	});
	vm.runInContext(
		`${source.slice(start, end)}\nthis.helpers = { formatCompactTokens, formatExactTokens, contextBreakdownParts, contextStatsSpeed, contextStatsRows, contextUsageRows, contextUsageLine, formatDurationMs };`,
		context,
	);
	return context.helpers;
}

test("上下文紧凑数字：K/M 与官方格式一致", () => {
	const { formatCompactTokens } = loadContextHelpers();
	assert.equal(formatCompactTokens(999), "999");
	assert.equal(formatCompactTokens(2500), "2.5K");
	assert.equal(formatCompactTokens(27600), "27.6K");
	assert.equal(formatCompactTokens(199000), "199K");
	assert.equal(formatCompactTokens(500000), "500K");
	assert.equal(formatCompactTokens(1048576), "1M");
	assert.equal(formatCompactTokens(226327021), "226M");
});

test("contextBreakdown 三段：System prompt 石青 / Tool definitions 紫 / Messages 蓝", () => {
	const { contextBreakdownParts } = loadContextHelpers();
	const parts = JSON.parse(JSON.stringify(contextBreakdownParts({ systemTokens: 2500, toolsTokens: 27600, messageTokens: 397000 })));
	assert.deepEqual(parts.map((part) => part.label), ["System prompt", "Tool definitions", "Messages"]);
	assert.ok(parts[0].color.includes("chart-system"));
	assert.ok(parts[1].color.includes("chart-tools"));
	assert.ok(parts[2].color.includes("chart-messages"));
	assert.equal(Math.round(parts.reduce((sum, part) => sum + part.percent, 0)), 100);
	assert.equal(contextBreakdownParts(null).length, 0);
	assert.equal(contextBreakdownParts({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 }).length, 0);
});

test("会话统计与 Token 用量：格式化时长、TTFT、TPS、精确 token 数与缓存命中", () => {
	const helpers = loadContextHelpers();
	const stats = { turns: 19, steps: 781, llmMs: 6435000, toolMs: 587000, ttftMs: 4400, ttftSteps: 1, decodeMs: 10000, decodeTokens: 1750 };
	const speed = helpers.contextStatsSpeed(stats);
	assert.equal(speed, 175);
	const statsRows = JSON.parse(JSON.stringify(helpers.contextStatsRows(stats, speed)));
	assert.deepEqual(statsRows.map((row) => row.label), ["Model time", "Tool time", "TTFT average", "Output speed (TPS)"]);
	assert.deepEqual(statsRows.map((row) => row.value), ["107m15s", "9m47s", "4.4s", "175 tok/s"]);

	const usage = { uncachedInputTokens: 2223544, cacheReadTokens: 223577472, cacheWriteTokens: 0, outputTokens: 526005 };
	const usageRows = JSON.parse(JSON.stringify(helpers.contextUsageRows(usage, "99.0")));
	assert.deepEqual(usageRows.map((row) => row.label), ["Cache hit", "Uncached input", "Cache read", "Output"]);
	assert.deepEqual(usageRows.map((row) => row.value), ["99%", "2,223,544 tok", "223,577,472 tok", "526,005 tok"]);
	assert.equal(helpers.contextUsageLine(usage, "99.0"), "226M tok · cache hit 99%");
	assert.equal(helpers.contextUsageLine(usage, null), "226M tok");
});

test("上下文模块接线：标题、占用格式、分段进度条、统计行与设置", () => {
	assert.match(source, /contextModule: "上下文"/);
	assert.match(source, /contextModule: "Context"/);
	assert.match(source, /contextOccupancy: "\{used\} \/ \{limit\}（\{percent\}%）"/);
	assert.match(source, /className: "hud-module-count hud-context-count"/);
	assert.match(source, /className: "hud-context-segments"/);
	assert.match(source, /className: "hud-context-segment"/);
	assert.match(source, /className: "hud-context-stat"/);
	assert.match(source, /className: "hud-context-tip"/);
	assert.match(source, /name: "gauge"/);
	assert.match(source, /name: "database"/);
	// 官方图标内联：不依赖旧 host 的新资产路由，regular 线宽为 1。
	assert.match(source, /const INLINE_ICONS = Object\.freeze/);
	assert.match(source, /gauge: `<svg/);
	assert.match(source, /database: `<svg/);
	assert.match(source, /stroke-width="1"/);
	assert.match(source, /if \(INLINE_ICONS\[name\] !== undefined\)/);
	// 进度条视觉仍为 8px，但外层 18px 作为悬浮判定区域。
	assert.match(source, /className: "hud-bar-track"/);
	assert.match(source, /\.hud-bar\{[^}]*height:18px/);
	assert.match(source, /\.hud-bar-track\{[^}]*height:8px/);
	assert.match(source, /breakdown,/);
	assert.match(source, /stats,/);
	assert.match(source, /settings: contextSettings/);
	assert.doesNotMatch(source, /contextUsed:/);
	assert.doesNotMatch(source, /contextCacheHit:/);
});

test("HudPanel 将完整投影传给上下文模块，并渲染会话统计/Token 用量两行", () => {
	const projectionValues = {
		contextPressure: { projectedTokens: 199000, contextWindow: 1000000 },
		contextBreakdown: { systemTokens: 2500, toolsTokens: 27600, messageTokens: 397000 },
		sessionStats: { turns: 19, steps: 781, llmMs: 6435000, toolMs: 587000, ttftMs: 4400, ttftSteps: 1, decodeMs: 10000, decodeTokens: 1750 },
		tokenUsage: { uncachedInputTokens: 2223544, cacheReadTokens: 223577472, cacheWriteTokens: 0, outputTokens: 526005 },
	};
	const client = hudClient({
		state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, projectionValues } } },
		current: "sess",
		workspaces: [{ path: "/work/session", title: "session", updatedAt: 2, sessionIds: ["sess"] }],
	});
	const context = moduleOf(client.panel(), "ContextModule");
	assert.equal(context.props.breakdown.systemTokens, 2500);
	assert.equal(context.props.stats.turns, 19);
	assert.equal(context.props.usage.cacheReadTokens, 223577472);
	const tree = context.type(context.props);
	assert.equal(nodes(tree).filter((node) => node.props.className === "hud-context-stat").length, 2);
	assert.equal(nodes(tree).some((node) => node.props.className === "hud-module-count hud-context-count"), true);
});

test("上下文模块三行垂直节奏：进度条行与统计/用量两行视觉等距", () => {
	// 进度条轨道在 18px 行盒内居中（上下各 5px），统计行自带 2px 上下内边距：
	// 条形底 → 首行文字 = 5 + 2（行盒底距）+ 2（首行上内边距）≈ 9px 盒间距；
	// 两行文字之间 = 2 + 3（行距）+ 2 ≈ 7px 盒间距，加上行高留白后视觉上同为约 11px。
	assert.match(source, /\.hud-context-row\{display:flex;align-items:center;gap:10px;padding:2px 14px 2px\}/);
	assert.match(source, /\.hud-context-stats\{display:flex;flex-direction:column;gap:3px;padding:0 14px 10px\}/);
	assert.match(source, /\.hud-context-stat\{display:flex;align-items:center;gap:6px;min-width:0;padding:2px 6px;/);
});

test("v0.19.2：上下文模块支持折叠，折叠后只保留标题行（占用率仍在）", () => {
	const projectionValues = {
		contextPressure: { projectedTokens: 199000, contextWindow: 1000000 },
		contextBreakdown: { systemTokens: 2500, toolsTokens: 27600, messageTokens: 397000 },
		sessionStats: { turns: 19, steps: 781, llmMs: 6435000, toolMs: 587000, ttftMs: 4400, ttftSteps: 1, decodeMs: 10000, decodeTokens: 1750 },
		tokenUsage: { uncachedInputTokens: 2223544, cacheReadTokens: 223577472, cacheWriteTokens: 0, outputTokens: 526005 },
	};
	const client = hudClient({
		state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, projectionValues } } },
		current: "sess",
		workspaces: [{ path: "/work/session", title: "session", updatedAt: 2, sessionIds: ["sess"] }],
	});
	const context = moduleOf(client.panel(), "ContextModule");
	// 面板把折叠状态与回调接进来（默认展开，与其它模块共用同一份 localStorage 状态）。
	assert.equal(context.props.fold, false);
	assert.equal(typeof context.props.onFoldChange, "function");

	// 展开态：进度条行、压缩按钮与两行统计都在，标题行右侧有折叠按钮。
	const openTree = context.type(context.props);
	const openNodes = nodes(openTree);
	assert.equal(openNodes.some((node) => node.props.className === "hud-context-row"), true);
	assert.equal(openNodes.filter((node) => node.props.className === "hud-context-stat").length, 2);
	const foldButton = openNodes.find((node) => node.props.className === "hud-module-fold");
	assert.ok(foldButton, "标题行要有折叠按钮");
	assert.equal(foldButton.props["data-fold"], false);
	assert.equal(foldButton.props["aria-label"], "collapseModule");

	// 折叠态：只保留标题行（含占用率），进度条与统计行都不渲染。
	const foldedNodes = nodes(context.type({ ...context.props, fold: true }));
	assert.equal(foldedNodes.some((node) => node.props.className === "hud-context-row"), false);
	assert.equal(foldedNodes.some((node) => node.props.className === "hud-context-stats"), false);
	assert.equal(foldedNodes.some((node) => node.props.className === "hud-module-head"), true);
	assert.equal(foldedNodes.some((node) => node.props.className === "hud-module-count hud-context-count"), true);
	const expandButton = foldedNodes.find((node) => node.props.className === "hud-module-fold");
	assert.equal(expandButton.props["data-fold"], true);
	assert.equal(expandButton.props["aria-label"], "expandModule");

	// 折叠状态持久化：loadStoredFolds 默认值与会话读取都包含 context。
	assert.match(source, /const fallback = \{ context: false, git: false/);
	assert.match(source, /context: typeof parsed\.context === "boolean" \? parsed\.context : fallback\.context/);
	assert.match(source, /fold: folds\.context/);
});
