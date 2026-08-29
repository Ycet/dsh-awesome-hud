// dsh-awesome-hud — host settings 命名空间的默认值/校验（纯函数）
// 实际 z(schemastery) schema 定义在 lib/index.js；此处的纯函数保证:
//  - 读侧：任何历史/手工改坏的 section 都能收敛为安全值
//  - 写侧：浏览器传入的 patch 只接受白名单字段

export const MODULE_KEYS = Object.freeze(["context", "git", "subagents", "tasks", "mcp", "balance"]);

export function defaultModules() {
	return Object.fromEntries(MODULE_KEYS.map((key) => [key, true]));
}

export function defaultSettings() {
	return { version: 1, modules: defaultModules() };
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

/**
 * 读侧收敛：把任意可能损坏的 section 收敛为完整 settings。
 * 不改变合法的历史结构（如未来新增字段）。
 */
export function normalizeSettings(raw) {
	const base = defaultSettings();
	if (!isPlainObject(raw)) return base;
	const modules = isPlainObject(raw.modules) ? raw.modules : {};
	const out = {
		version: typeof raw.version === "number" ? raw.version : base.version,
		modules: {},
	};
	for (const key of MODULE_KEYS) {
		out.modules[key] = typeof modules[key] === "boolean" ? modules[key] : base.modules[key];
	}
	return out;
}

/** 只取本插件关心的模块键（与 schema 字段对齐），供 API 响应。 */
export function modulesOf(settings) {
	return { ...settings.modules };
}
