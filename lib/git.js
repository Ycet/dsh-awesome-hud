// dsh-awesome-hud — git 纯解析（host）
// 本文件只做字符串解析，不执行任何命令、不触碰文件系统，便于 node --test 单测。
// 与 lib/client.js 中的镜像逻辑无交集（client 只消费 host 已解析的 JSON）。

/** 单文件状态字母（porcelain XY 两列中的左列；未跟踪为 ?，忽略为 !）。 */
export function statusLetter(xy) {
	if (typeof xy !== "string" || xy.length < 2) return "?";
	const [x, y] = xy;
	if (x === "?" && y === "?") return "?";
	if (x === "!" && y === "!") return "!";
	if (x === " " && y === "?") return "?";
	return x === " " ? y : x;
}

/**
 * 解析 `git status --porcelain=v1 -z` 输出。
 * -z 下条目以 NUL 分隔；重命名/复制的格式为 `XY new\0old\0`（新路径在前）。
 * 返回 [{status, path, oldPath?}]，忽略 ignored(!!) 条目。
 */
export function parsePorcelainZ(input) {
	const parts = String(input ?? "").split("\0");
	const entries = [];
	for (let i = 0; i < parts.length; i += 1) {
		const token = parts[i];
		if (token.length === 0) continue;
		const xy = token.slice(0, 2);
		const rest = token.slice(3); // "XY path"：XY + 空格 + path
		// 防御：-z 下仍有以空格开头的续段，或怪异输入
		if (xy.length < 2 || !/^[A-Za-z ?]{2}$/.test(xy)) continue;
		const status = statusLetter(xy);
		if (status === "!") continue;
		if (status === "R" || status === "C") {
			const oldPath = parts[i + 1] ?? "";
			if (oldPath !== "") i += 1; // 消耗旧路径段
			entries.push({ status, path: rest, oldPath });
		} else {
			entries.push({ status, path: rest });
		}
	}
	return entries;
}

/** 汇总需求判空：是否存在任何变更（含未跟踪）。 */
export function anyChange(entries) {
	return entries.length > 0;
}

/**
 * 解析 `git diff --numstat`（未暂存、已暂存同格式）输出；不可解析的行被忽略。
 * 返回 [{added, deleted, path}]。
 */
export function parseNumstat(output) {
	const lines = String(output ?? "").split("\n");
	const rows = [];
	for (const line of lines) {
		if (line.trim() === "") continue;
		const tab1 = line.indexOf("\t");
		if (tab1 < 0) continue;
		const tab2 = line.indexOf("\t", tab1 + 1);
		if (tab2 < 0) continue;
		const added = line.slice(0, tab1);
		const deleted = line.slice(tab1 + 1, tab2);
		const path = line.slice(tab2 + 1);
		if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted) || path === "") continue;
		rows.push({ added: Number(added), deleted: Number(deleted), path });
	}
	return rows;
}

/** 按 path 合并未暂存 + 已暂存两组的行数（同一文件多组相加）。 */
export function mergeNumstat(groups) {
	const byPath = new Map();
	for (const rows of groups) {
		for (const row of rows) {
			const value = byPath.get(row.path) ?? { added: 0, deleted: 0 };
			value.added += row.added;
			value.deleted += row.deleted;
			byPath.set(row.path, value);
		}
	}
	return byPath;
}

/**
 * 为每个未跟踪（status ??）文件统计行数：以 `git diff --no-index --numstat /dev/null <file>`
 * 的解析结果为准（全新增行）。退出码 1 属预期，不视为失败。
 */
export function countUntracked(numstatRows, untrackedPaths) {
	const byPath = mergeNumstat([numstatRows]);
	const result = [];
	for (const path of untrackedPaths) {
		const value = byPath.get(path) ?? { added: 0, deleted: 0 };
		// 文件异常（无法读取）时 added 可能为 0，不影响展示
		result.push({ added: value.added, deleted: 0 });
	}
	return result;
}

/** 分支名：`git symbolic-ref --short -q HEAD` 输出；空串 → 分离头（由调用方回退短哈希）。 */
export function normalizeBranch(output) {
	const branch = String(output ?? "").trim();
	return branch === "" ? null : branch;
}

/** 解析 `git status --short`（v1 非 -z 兼容路径，当前实现仅用 -z；此函数供测试校验 statusLetter 语义）。 */
export function parseStatusShort(input) {
	const lines = String(input ?? "").split("\n").filter((line) => line.trim() !== "");
	return lines.map((line) => {
		const xy = line.slice(0, 2);
		const rest = line.slice(3).trim();
		// 重命名格式：`R  old-name -> new-name`（箭头后为展示路径）
		const arrow = rest.indexOf(" -> ");
		if (arrow >= 0) {
			return { status: statusLetter(xy), path: rest.slice(arrow + 4), oldPath: rest.slice(0, arrow) };
		}
		return { status: statusLetter(xy), path: rest };
	});
}
