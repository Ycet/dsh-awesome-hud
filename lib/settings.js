// dsh-awesome-hud — host settings 命名空间的默认值/校验（纯函数）
// 实际 z(schemastery) schema 定义在 lib/index.js；此处的纯函数保证:
//  - 读侧：任何历史/手工改坏的 section 都能收敛为安全值
//  - 写侧：浏览器传入的 patch 只接受白名单字段

export const MODULE_KEYS = Object.freeze(["context", "git", "outputs", "subagents", "tasks", "mcp", "balance", "plans", "note", "todo"]);
/**
 * 「用量」模块三行数据的展示开关（默认全展示；false = 隐藏对应行）。
 * v0.20.1：移除「跳转」按钮与 showJump 字段。
 */
export const USAGE_DISPLAY_KEYS = Object.freeze(["deepseek", "opencode", "codex"]);
/**
 * v0.20.1：「用量模块折叠后展示信息」的可选值。
 * none = 不展示；deepseek = 余额；oc-5h / oc-1w / oc-1m = OpenCode Go 三个窗口；
 * codex-5h / codex-1w = Codex 5 小时 / 周额度（未订阅时降级展示免费额度）。
 */
export const USAGE_FOLDED_VALUES = Object.freeze(["none", "deepseek", "oc-5h", "oc-1w", "oc-1m", "codex-5h", "codex-1w"]);
export const USAGE_FOLDED_DEFAULT = "none";

/** 收敛「折叠后展示信息」：未知值回落 none（兼容旧设置与坏数据）。 */
export function normalizeUsageFolded(value) {
	return USAGE_FOLDED_VALUES.includes(value) ? value : USAGE_FOLDED_DEFAULT;
}
/** 「上下文」模块的进度条样式：默认（仅悬浮分段）/ 始终分段。 */
export const CONTEXT_BAR_STYLES = Object.freeze(["default", "segmented"]);
/** 「上下文」模块的展示项。v0.18.7：追加 pinned（上下文模块固定在会话模块下方）。 */
export const CONTEXT_SETTING_KEYS = Object.freeze(["barStyle", "showStats", "showUsage", "pinned"]);
/** v0.18.2：HUD 面板可展开的侧位（默认右侧，与历史行为一致）。 */
export const PANEL_SIDES = Object.freeze(["left", "right"]);
/**
 * v0.20.0：HUD 面板样式。
 * card = 圆角矩形悬浮卡片（v0.19.2 及更早的视觉，默认值）；sidebar = 通高贴边边栏，靠分隔线与内容区区分。
 */
export const PANEL_STYLES = Object.freeze(["card", "sidebar"]);
/** v0.18.2：「HUD 面板设置」的字段。v0.20.0：追加 style（面板样式）。 */
export const PANEL_SETTING_KEYS = Object.freeze(["style", "side", "newSessionOpen", "chatOpen"]);
/**
 * v0.16.0：HUD 面板内模块的**默认展示顺序**（自 v0.9 起的既有顺序，保持向后兼容）。
 * 排序只影响面板内各模块的先后，不影响可见性；缺失的键由 normalizeModuleOrder 补齐。
 */
export const DEFAULT_MODULE_ORDER = Object.freeze(["context", "balance", "outputs", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"]);

export function defaultModules() {
	return Object.fromEntries(MODULE_KEYS.map((key) => [key, true]));
}

export function defaultUsageDisplay() {
	return { ...Object.fromEntries(USAGE_DISPLAY_KEYS.map((key) => [key, true])), folded: USAGE_FOLDED_DEFAULT };
}

/** 收敛「用量」展示设置：三行开关 + 折叠后展示信息。 */
export function normalizeUsageDisplay(raw) {
	const base = defaultUsageDisplay();
	if (!isPlainObject(raw)) return base;
	const out = {};
	for (const key of USAGE_DISPLAY_KEYS) out[key] = typeof raw[key] === "boolean" ? raw[key] : base[key];
	out.folded = normalizeUsageFolded(raw.folded);
	return out;
}

export function defaultModuleOrder() {
	return [...DEFAULT_MODULE_ORDER];
}

export function defaultContextSettings() {
	// v0.18.7：pinned 默认关闭——升级后面板观感与 0.18.6 完全一致。
	return { barStyle: "default", showStats: true, showUsage: true, pinned: false };
}

/** 收敛上下文设置：未知样式/非布尔值回到默认，保证旧设置可直接升级。 */
export function normalizeContextSettings(raw) {
	const base = defaultContextSettings();
	if (!isPlainObject(raw)) return base;
	return {
		barStyle: CONTEXT_BAR_STYLES.includes(raw.barStyle) ? raw.barStyle : base.barStyle,
		showStats: typeof raw.showStats === "boolean" ? raw.showStats : base.showStats,
		showUsage: typeof raw.showUsage === "boolean" ? raw.showUsage : base.showUsage,
		pinned: typeof raw.pinned === "boolean" ? raw.pinned : base.pinned,
	};
}

/** 收敛上下文设置 patch：只接受白名单字段和合法取值。 */
export function sanitizeContextPatch(patch) {
	if (!isPlainObject(patch)) return null;
	const result = {};
	for (const key of CONTEXT_SETTING_KEYS) {
		const value = patch[key];
		if (value === undefined) continue;
		if (key === "barStyle") {
			if (typeof value !== "string" || !CONTEXT_BAR_STYLES.includes(value)) return null;
		} else if (typeof value !== "boolean") {
			return null;
		}
		result[key] = value;
	}
	return Object.keys(result).length > 0 ? { patch: result, changed: false } : null;
}

/**
 * v0.18.2：「HUD 面板设置」默认值。
 * 侧位默认右侧（与历史行为一致）；新建会话页默认隐藏（该页从来只写内存），
 * 聊天会话页默认展示（无开合记忆的会话历史行为就是展开）。
 * v0.20.0：样式默认 card —— 新装与升级都不改变既有外观，边栏样式由用户手动切换。
 */
export function defaultPanelSettings() {
	return { style: "card", side: "right", newSessionOpen: false, chatOpen: true };
}

/** 收敛面板设置：未知样式/侧位、非布尔值回到默认，旧 profile（无该段/含已移除字段）可直接升级。 */
export function normalizePanelSettings(raw) {
	const base = defaultPanelSettings();
	if (!isPlainObject(raw)) return base;
	return {
		style: PANEL_STYLES.includes(raw.style) ? raw.style : base.style,
		side: PANEL_SIDES.includes(raw.side) ? raw.side : base.side,
		newSessionOpen: typeof raw.newSessionOpen === "boolean" ? raw.newSessionOpen : base.newSessionOpen,
		chatOpen: typeof raw.chatOpen === "boolean" ? raw.chatOpen : base.chatOpen,
	};
}

/** 收敛面板设置 patch：只接受白名单字段与合法取值，坏输入整包拒绝。 */
export function sanitizePanelPatch(patch) {
	if (!isPlainObject(patch)) return null;
	const result = {};
	for (const key of PANEL_SETTING_KEYS) {
		const value = patch[key];
		if (value === undefined) continue;
		if (key === "style") {
			if (typeof value !== "string" || !PANEL_STYLES.includes(value)) return null;
		} else if (key === "side") {
			if (typeof value !== "string" || !PANEL_SIDES.includes(value)) return null;
		} else if (typeof value !== "boolean") {
			return null;
		}
		result[key] = value;
	}
	return Object.keys(result).length > 0 ? { patch: result, changed: false } : null;
}

/**
 * v0.20.0：「AI 生成提示词」的最大字符数（避免 profile 设置被整段 diff 撑爆）。
 */
export const COMMIT_PROMPT_MAX_LENGTH = 20000;

/**
 * v0.20.0：收敛「AI 生成提示词」。
 * 空字符串表示使用内置默认提示词；换行统一为 \n、去掉首尾空白，超长直接截断（不抛错）。
 * @param value 浏览器 / profile 里保存的提示词。
 * @returns 规范化后的提示词（可能是空字符串）。
 */
export function normalizeCommitPrompt(value) {
	if (typeof value !== "string") return "";
	const text = value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
	return text.length > COMMIT_PROMPT_MAX_LENGTH ? text.slice(0, COMMIT_PROMPT_MAX_LENGTH) : text;
}

/**
 * v0.20.0：「便笺」模块设置——同时保存的便笺条数上限。
 * 允许区间 5–20，默认 5；非法值一律回默认，避免坏数据把设置卡死。
 * v0.21.0：新增 popupEdit（在弹窗中编辑便笺内容，默认关闭）。
 */
export const NOTE_COUNT_MIN = 5;
export const NOTE_COUNT_MAX = 20;
export const NOTE_COUNT_DEFAULT = 5;
/** v0.21.0：「在弹窗页面中进行便笺内容编辑」的默认值（关闭）。 */
export const NOTE_POPUP_EDIT_DEFAULT = false;
/** 「便笺」模块设置字段（v0.20.0：maxCount；v0.21.0：追加 popupEdit）。 */
export const NOTE_SETTING_KEYS = Object.freeze(["maxCount", "popupEdit"]);

/**
 * 收敛便笺条数上限：取整并夹到 5–20；非数字回默认。
 * @param value 浏览器 / profile 里的原始值。
 * @returns 5–20 的整数。
 */
export function normalizeNoteMaxCount(value) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return NOTE_COUNT_DEFAULT;
	return Math.min(NOTE_COUNT_MAX, Math.max(NOTE_COUNT_MIN, Math.round(number)));
}

/** 收敛「便笺」模块设置：未知/非法字段回默认。v0.21.0：追加 popupEdit（非布尔回 false）。 */
export function normalizeNoteSettings(raw) {
	const base = { maxCount: NOTE_COUNT_DEFAULT, popupEdit: NOTE_POPUP_EDIT_DEFAULT };
	if (!isPlainObject(raw)) return base;
	return {
		maxCount: normalizeNoteMaxCount(raw.maxCount),
		popupEdit: raw.popupEdit === true,
	};
}

/**
 * 收敛「便笺」设置 patch：接受 maxCount（5–20 的整数）与/或 popupEdit（布尔）。
 * 未提供的字段保持现状；提供了但非法则整包拒绝，避免半截写入。
 * @returns {{ patch: { maxCount?: number, popupEdit?: boolean }, changed: boolean } | null}
 */
export function sanitizeNotePatch(patch) {
	if (!isPlainObject(patch)) return null;
	const result = {};
	if (patch.maxCount !== undefined) {
		const number = typeof patch.maxCount === "number" ? patch.maxCount : NaN;
		if (!Number.isInteger(number) || number < NOTE_COUNT_MIN || number > NOTE_COUNT_MAX) return null;
		result.maxCount = number;
	}
	if (patch.popupEdit !== undefined) {
		if (typeof patch.popupEdit !== "boolean") return null;
		result.popupEdit = patch.popupEdit;
	}
	return Object.keys(result).length > 0 ? { patch: result, changed: false } : null;
}

/** v0.20.0：只取「便笺」模块设置，供 API 响应。 */
export function noteSettingsOf(settings) {
	return normalizeNoteSettings(settings?.note);
}


/**
 * v0.21.0：「git变更」模块设置——``view`` 控制变更文件的展示方式。
 * list（列表，默认）/ tree（文件树）；非法值一律回默认。
 */
export const GIT_VIEWS = Object.freeze(["list", "tree"]);
export const GIT_VIEW_DEFAULT = "list";
/** 「git变更」模块设置字段。 */
export const GIT_SETTING_KEYS = Object.freeze(["view"]);

/** 收敛 Git 变更文件查看方式：仅接受 list / tree，其余回 list。 */
export function normalizeGitView(value) {
	return value === "tree" ? "tree" : GIT_VIEW_DEFAULT;
}

/** 收敛「git变更」模块设置：未知/非法字段回默认。 */
export function normalizeGitSettings(raw) {
	if (!isPlainObject(raw)) return { view: GIT_VIEW_DEFAULT };
	return { view: normalizeGitView(raw.view) };
}

/**
 * 收敛「git变更」设置 patch：只接受 view（list / tree）；未提供或非法整体拒绝。
 * @returns {{ patch: { view: string }, changed: boolean } | null}
 */
export function sanitizeGitPatch(patch) {
	if (!isPlainObject(patch)) return null;
	if (typeof patch.view !== "string" || !GIT_VIEWS.includes(patch.view)) return null;
	return { patch: { view: patch.view }, changed: false };
}

/** v0.21.0：只取「git变更」模块设置，供 API 响应。 */
export function gitSettingsOf(settings) {
	return normalizeGitSettings(settings?.git);
}

export function defaultSettings() {
	return {
		version: 1,
		modules: defaultModules(),
		usage: defaultUsageDisplay(),
		context: defaultContextSettings(),
		order: defaultModuleOrder(),
		panel: defaultPanelSettings(),
		// v0.20.0：自定义「AI 生成提示词」；空字符串 = 使用内置默认提示词。
		commitPrompt: "",
		// v0.20.0：「便笺」模块设置（便笺条数上限，5–20，默认 5）。
		// v0.21.0：追加 popupEdit（弹窗编辑便笺内容，默认关闭）。
		note: { maxCount: NOTE_COUNT_DEFAULT, popupEdit: NOTE_POPUP_EDIT_DEFAULT },
		// v0.21.0：「git变更」模块设置——变更文件查看方式（默认列表）。
		git: { view: GIT_VIEW_DEFAULT },
	};
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 收敛模块勾选 patch：只保留合法键与布尔值。 */
export function sanitizeModulesPatch(patch) {
	if (!isPlainObject(patch)) return null;
	const result = {};
	let changed = false;
	for (const key of MODULE_KEYS) {
		const value = patch[key];
		if (value === undefined) continue; // 未提供 → 保持现状
		if (typeof value === "boolean") {
			result[key] = value;
		} else {
			changed = true; // 提供了但非法 → 作为坏输入标记（调用方整体拒绝更安全）
			return null;
		}
	}
	// 至少一个合法布尔才视为有效 patch
	const has = Object.keys(result).length > 0;
	return has ? { patch: result, changed } : null;
}

/** 收敛「用量模块内容」勾选 patch：只保留合法键与布尔值。 */
export function sanitizeUsagePatch(patch) {
	if (!isPlainObject(patch)) return null;
	const result = {};
	for (const key of USAGE_DISPLAY_KEYS) {
		const value = patch[key];
		if (value === undefined) continue; // 未提供 → 保持现状
		if (typeof value === "boolean") {
			result[key] = value;
		} else {
			return null; // 提供了但非法 → 整体拒绝更安全
		}
	}
	// v0.20.1：折叠后展示信息；非法值整体拒绝。
	if (patch.folded !== undefined) {
		if (typeof patch.folded !== "string" || !USAGE_FOLDED_VALUES.includes(patch.folded)) return null;
		result.folded = patch.folded;
	}
	return Object.keys(result).length > 0 ? { patch: result, changed: false } : null;
}

/**
 * v0.16.0：收敛模块顺序，保证是 MODULE_KEYS 的一个完整排列。
 * 规则（都对坏输入保持安全，不抛错）：
 *   1. 只接受字符串数组；非数组 → 返回默认顺序。
 *   2. 丢弃未知键与重复键（重复只保留首次出现）。
 *   3. 按默认顺序补齐缺失键，保证每个模块都有位置。
 *   4. 补齐的键按 ORDER_ANCHORS 落位（outputs 排在 git 之前）；但**已保存的键保持原位**——
 *      锚点只服务于旧配置迁移，不能覆盖用户拖动后的排序（v0.19.2 修复）。
 * @param value 浏览器传来的顺序（可能残缺、含未知键或重复）。
 * @returns 完整且无重复的模块顺序。
 */
export function normalizeModuleOrder(value) {
	const fallback = defaultModuleOrder();
	if (!Array.isArray(value)) return fallback;
	const seen = new Set();
	const out = [];
	for (const key of value) {
		if (typeof key !== "string" || !MODULE_KEYS.includes(key) || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	for (const key of DEFAULT_MODULE_ORDER) {
		if (seen.has(key)) continue;
		seen.add(key);
		insertAtAnchor(out, key);
	}
	return out;
}

/**
 * v0.19.1：新增模块在**已有顺序**里的落位锚点（`outputs` 排在 `git` 之前）。
 * 只在「保存的顺序里根本没有这个键」时使用；用户手动排过的位置不再被改写。
 */
const ORDER_ANCHORS = Object.freeze({ outputs: "git" });

/**
 * 把缺失的模块键插到它的锚点之前；没有锚点（或锚点也不在列表里）时追加到末尾。
 * @param list 就地修改的完整顺序数组。
 * @param key 需要补齐的模块键。
 */
function insertAtAnchor(list, key) {
	const anchor = ORDER_ANCHORS[key];
	const anchorIndex = anchor === undefined ? -1 : list.indexOf(anchor);
	if (anchorIndex >= 0) list.splice(anchorIndex, 0, key);
	else list.push(key);
}

/** 收敛排序 patch：非数组或空数组视为无效（避免把面板顺序清空）。 */
export function sanitizeOrderPatch(patch) {
	if (!Array.isArray(patch) || patch.length === 0) return null;
	return { patch: normalizeModuleOrder(patch), changed: false };
}

/** 判断当前设置是否与默认设置完全一致（用于「恢复默认」按钮的激活态）。 */
export function isDefaultSettings(settings) {
	const current = normalizeSettings(settings);
	const defaultContext = defaultContextSettings();
	const defaultPanel = defaultPanelSettings();
	return MODULE_KEYS.every((key) => current.modules[key] === true)
		&& USAGE_DISPLAY_KEYS.every((key) => current.usage[key] === true)
		&& current.usage.folded === USAGE_FOLDED_DEFAULT
		&& CONTEXT_SETTING_KEYS.every((key) => current.context[key] === defaultContext[key])
		&& PANEL_SETTING_KEYS.every((key) => current.panel[key] === defaultPanel[key])
		&& current.note.maxCount === NOTE_COUNT_DEFAULT
		&& current.note.popupEdit === NOTE_POPUP_EDIT_DEFAULT
		&& current.git.view === GIT_VIEW_DEFAULT
		&& current.order.length === DEFAULT_MODULE_ORDER.length
		&& current.order.every((key, index) => key === DEFAULT_MODULE_ORDER[index]);
}

/**
 * 读侧收敛：把任意可能损坏的 section 收敛为完整 settings。
 * 不改变合法的历史结构（如未来新增字段）。
 */
export function normalizeSettings(raw) {
	const base = defaultSettings();
	if (!isPlainObject(raw)) return base;
	const modules = isPlainObject(raw.modules) ? raw.modules : {};
	const usage = normalizeUsageDisplay(raw.usage);
	const out = {
		version: typeof raw.version === "number" ? raw.version : base.version,
		modules: {},
		usage: {},
		context: normalizeContextSettings(raw.context),
		order: normalizeModuleOrder(raw.order),
		panel: normalizePanelSettings(raw.panel),
		commitPrompt: normalizeCommitPrompt(raw.commitPrompt),
		note: normalizeNoteSettings(raw.note),
		git: normalizeGitSettings(raw.git),
	};
	for (const key of MODULE_KEYS) {
		out.modules[key] = typeof modules[key] === "boolean" ? modules[key] : base.modules[key];
	}
	for (const key of USAGE_DISPLAY_KEYS) {
		out.usage[key] = typeof usage[key] === "boolean" ? usage[key] : base.usage[key];
	}
	out.usage.folded = normalizeUsageFolded(usage.folded);
	return out;
}

/** 只取本插件关心的模块键（与 schema 字段对齐），供 API 响应。 */
export function modulesOf(settings) {
	return { ...settings.modules };
}

/** 只取「用量模块内容」展示键（含折叠后展示信息），供 API 响应。 */
export function usageDisplayOf(settings) {
	return normalizeUsageDisplay(settings?.usage);
}

/** 只取「上下文」模块设置，供 API 响应。 */
export function contextSettingsOf(settings) {
	return normalizeContextSettings(settings?.context);
}

/** 只取模块顺序，供 API 响应（始终返回完整排列）。 */
export function moduleOrderOf(settings) {
	return normalizeModuleOrder(settings?.order);
}

/** v0.18.2：只取「HUD 面板设置」，供 API 响应。 */
export function panelSettingsOf(settings) {
	return normalizePanelSettings(settings?.panel);
}

/** v0.20.0：只取「AI 生成提示词」，供 API 响应（空字符串 = 使用默认提示词）。 */
export function commitPromptOf(settings) {
	return normalizeCommitPrompt(settings?.commitPrompt);
}
