// dsh-awesome-hud — git 纯解析（host）
// 本文件只做字符串解析，不执行任何命令、不触碰文件系统，便于 node --test 单测。
// 与 lib/client.js 中的镜像逻辑无交集（client 只消费 host 已解析的 JSON）。

/**
 * v0.21.1：新建 .gitignore 时预置的通用排除项（不带前导斜杠，覆盖任意层级同名项）。
 * 只收系统文件、依赖目录与日志，避免把 dist / .env 这类项目相关项强加给用户。
 */
export const GITIGNORE_DEFAULT_LINES = Object.freeze([
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",
	".codegraph",
	"node_modules/",
	"npm-debug.log*",
	"yarn-debug.log*",
	"yarn-error.log*",
]);

/** .gitignore 里需要反斜杠转义的通配字符（保证文件名被当作字面量）。 */
const GITIGNORE_GLOB_CHARS = /[\\*?[\]]/g;

/**
 * v0.21.1：把路径转成 .gitignore 字面量片段。
 * 转义 `\ * ? [ ]`，并处理行首 `#`/`!`（gitignore 里的注释与反选标记）与行尾空格。
 * @param value 已归一为 POSIX 斜杠、去掉首尾斜杠的相对路径。
 * @returns 可直接写入 .gitignore 的片段。
 */
export function escapeGitignorePath(value) {
	const text = String(value ?? "");
	// 先转义反斜杠与通配符，再处理行首/行尾的特殊含义字符
	let escaped = text.replace(GITIGNORE_GLOB_CHARS, (char) => `\\${char}`);
	if (escaped.startsWith("#") || escaped.startsWith("!")) escaped = `\\${escaped}`;
	if (escaped.endsWith(" ")) escaped = `${escaped.slice(0, -1)}\\ `;
	return escaped;
}

/**
 * v0.21.1：为某个仓库内路径生成 .gitignore 规则。
 * 统一 POSIX 斜杠、去掉首尾斜杠后加前导斜杠锚定到 .gitignore 所在目录（即仓库根），
 * 目录再补尾斜杠表示忽略整棵子树。
 * @param relativePath 相对仓库根的路径（可能是 `a\b` 或 `dir/` 形式）。
 * @param isDirectory 是否目录条目。
 * @returns 形如 `/path/to/file` 或 `/dir/` 的规则；路径为空时返回 ""（调用方按错误处理）。
 */
export function gitignoreRuleFor(relativePath, isDirectory = false) {
	const normalized = String(relativePath ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
	if (normalized === "") return "";
	const body = escapeGitignorePath(normalized);
	return isDirectory ? `/${body}/` : `/${body}`;
}

/** 规则比较用的归一形式：忽略前导/尾随斜杠差异（`/a`、`a`、`a/` 视为同一项）。 */
function ruleKey(line) {
	return String(line ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * v0.21.1：把一条规则并入 .gitignore 文本（纯函数，不读写文件）。
 * - 已有等价规则（仅前导/尾随斜杠不同也算）时 changed=false、duplicate=true；
 * - 追加前保证原文本以换行结尾，避免与新行粘连；
 * - 原文本为空或只有空白时按其本身为空处理（created=true 时由调用方补模板）。
 * @param text 现有 .gitignore 内容（不存在时传 ""）。
 * @param rule 由 {@link gitignoreRuleFor} 生成的规则。
 * @returns {{ text: string, changed: boolean, duplicate: boolean }}
 */
export function mergeGitignore(text, rule) {
	const source = typeof text === "string" ? text : "";
	const nextRule = String(rule ?? "").trim();
	if (nextRule === "") return { text: source, changed: false, duplicate: true };
	const key = ruleKey(nextRule);
	const lines = source.split(/\r?\n/);
	for (const line of lines) {
		if (ruleKey(line.trim()) === key) return { text: source, changed: false, duplicate: true };
	}
	if (source.trim() === "") {
		return { text: `${nextRule}\n`, changed: true, duplicate: false };
	}
	const head = source.endsWith("\n") ? source : `${source}\n`;
	return { text: `${head}${nextRule}\n`, changed: true, duplicate: false };
}

/**
 * v0.21.1：新建 .gitignore 的初始内容（通用项 + 空行 + 本次规则）。
 * @param rule {@link gitignoreRuleFor} 生成的规则。
 * @returns 以换行结尾的完整文件内容。
 */
export function buildGitignoreTemplate(rule) {
	const lines = [...GITIGNORE_DEFAULT_LINES];
	const nextRule = String(rule ?? "").trim();
	if (nextRule !== "") lines.push("", nextRule);
	return `${lines.join("\n")}\n`;
}

/**
 * v0.21.2：初始化仓库时补全 `.gitignore`（纯函数，不读写文件）。
 * 只把 `GITIGNORE_DEFAULT_LINES` 里**缺失**的通用项追加到末尾，已有规则原样保留：
 *  - 已有等价规则（仅前导/尾随斜杠不同也算，如 `node_modules` 与 `node_modules/`）不重复写；
 *  - 追加时沿用原文的换行风格（原文含 `\r\n` 就用 `\r\n`），末尾缺换行先补一个；
 *  - 原文为空或只有空白时按新建处理，直接返回模板全文。
 * @param text 现有 .gitignore 内容（不存在时传 ""）。
 * @returns {{ text: string, added: string[], changed: boolean }}
 */
export function mergeGitignoreDefaults(text) {
	const source = typeof text === "string" ? text : "";
	const defaults = [...GITIGNORE_DEFAULT_LINES];
	if (source.trim() === "") return { text: buildGitignoreTemplate(""), added: defaults, changed: true };
	const present = new Set(source.split(/\r?\n/).map((line) => ruleKey(line.trim())));
	const missing = defaults.filter((line) => !present.has(ruleKey(line)));
	if (missing.length === 0) return { text: source, added: [], changed: false };
	// 换行风格：原文用过 CRLF 就继续用 CRLF，避免整文件混行。
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const head = source.endsWith("\n") ? source : `${source}${eol}`;
	// 原文以 CRLF 结尾时 head 已带 \n，补 eol 会多一个空行；按实际结尾判定。
	const separator = head.endsWith(eol) ? "" : eol;
	return { text: `${head}${separator}${missing.join(eol)}${eol}`, added: missing, changed: true };
}

/** 单文件状态字母（porcelain XY 两列中的左列；未跟踪为 ?，忽略为 !）。 */
export function statusLetter(xy) {
	if (typeof xy !== "string" || xy.length < 2) return "?";
	const [x, y] = xy;
	if (x === "?" && y === "?") return "?";
	if (x === "!" && y === "!") return "!";
	if (x === " " && y === "?") return "?";
	return x === " " ? y : x;
}

/** porcelain XY 双列：X 列（暂存侧）是否有变更。 */
function stagedColumn(xy) {
	return typeof xy === "string" && xy.length >= 2 && xy[0] !== " " && xy[0] !== "?" && xy[0] !== "!";
}

/** porcelain XY 双列：Y 列（工作区侧）是否有变更（含未跟踪 ??）。 */
function unstagedColumn(xy) {
	return typeof xy === "string" && xy.length >= 2 && xy[1] !== " " && xy[1] !== "!";
}

/**
 * 解析 `git status --porcelain=v1 -z` 输出。
 * -z 下条目以 NUL 分隔；重命名/复制的格式为 `XY new\0old\0`（新路径在前）。
 * 返回 [{status, path, oldPath?, staged, unstaged}]，忽略 ignored(!!) 条目。
 * staged = X 列有变更（已暂存）；unstaged = Y 列有变更（工作区侧，含未跟踪）。
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
		const common = { status, staged: stagedColumn(xy), unstaged: unstagedColumn(xy) };
		if (status === "R" || status === "C") {
			const oldPath = parts[i + 1] ?? "";
			if (oldPath !== "") i += 1; // 消耗旧路径段
			entries.push({ ...common, path: rest, oldPath });
		} else {
			entries.push({ ...common, path: rest });
		}
	}
	return entries;
}

/** 是否未跟踪文件（porcelain ?? 语义：status 字母 ? 且工作区新增）。 */
export function isUntracked(entry) {
	return entry !== null && typeof entry === "object" && entry.status === "?";
}

/**
 * 是否 intent-to-add 条目（`git add -N` 预登记、索引中尚无内容的「新增」文件）。
 * porcelain v1 中展示为 ` A`（X 列为空格、Y 列为 A），据此与真正已暂存的新文件（`A `）区分。
 * 这类文件不能用 `git restore` 还原（索引内容为空，会把工作区文件清空），必须按未跟踪处理。
 */
export function isIntentToAdd(entry) {
	return entry !== null && typeof entry === "object"
		&& entry.status === "A" && entry.staged === false && entry.unstaged === true;
}

/**
 * 是否目录条目：porcelain 对嵌套仓库/子模块等「目录」以 `?? dir/`（带尾斜杠）返回。
 * 这类条目 `git clean -f` 不会删除（需要 -d，且默认拒绝删除嵌套仓库），撤销时必须单独处理并校验结果。
 */
export function isDirectoryEntry(entry) {
	return entry !== null && typeof entry === "object"
		&& entry.status === "?" && typeof entry.path === "string" && entry.path.endsWith("/");
}

/** 未暂存分组中「可被 restore/revert 的已跟踪文件」判定（未跟踪文件无法 restore）。 */
export function isRevertable(entry) {
	return entry !== null && typeof entry === "object" && entry.unstaged === true && entry.status !== "?";
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

/** 解析 `git for-each-ref --format=%(refname:short) refs/heads` 输出 → 本地分支名数组（去空、去 \r）。 */
export function parseBranchList(stdout) {
	if (typeof stdout !== "string") return [];
	return stdout
		.split("\n")
		.map((line) => line.replace(/\r$/, "").trim())
		.filter((line) => line !== "");
}

/**
 * 校验分支名（保守版 git check-ref-format --branch 语义）：
 * 非空、无首尾空白、长度受限、不以 - 或 . 开头、不以 . 结尾、不含空白与非法字符、
 * 不含 `..` 与 `@{` 序列。合法返回规范化值，非法返回 null。
 */
export function sanitizeGitBranch(value) {
	if (typeof value !== "string") return null;
	const name = value.trim();
	if (name !== value || name === "" || name.length > 256) return null;
	if (name.startsWith("-") || name.startsWith(".") || name.endsWith(".")) return null;
	if (name.includes("..") || name.includes("@{") || name.includes("/.") || name.endsWith(".lock")) return null;
	if (/[\s~^:?*[\]\\\u007f]/.test(name)) return null;
	return name;
}

/**
 * 解析 git checkout 失败输出：本地修改将被切换覆盖的冲突。
 * 命中返回 {code:"local-changes-conflict", files:[...]}；其它错误返回 null。
 */
export function parseCheckoutConflict(stderr) {
	if (typeof stderr !== "string") return null;
	const match = /would be overwritten by checkout:([\s\S]*?)(?:Please commit your changes|Please move or remove|Aborting|$)/i.exec(stderr);
	if (match === null) return null;
	const files = match[1].split("\n").map((line) => line.trim()).filter((line) => line !== "");
	if (files.length === 0) return null;
	return { code: "local-changes-conflict", files };
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

/** 提交 id（graph 数据 %H 全量 40 位十六进制）校验：合法返回小写形式，非法返回 null。 */
export function sanitizeGitCommit(value) {
	if (typeof value !== "string") return null;
	const hash = value.trim();
	if (hash !== value || !/^[0-9a-fA-F]{40}$/.test(hash)) return null;
	return hash.toLowerCase();
}

/** reset 模式白名单：仅允许 git 原生的三种明确模式。 */
export function sanitizeGitResetMode(value) {
	return value === "soft" || value === "mixed" || value === "hard" ? value : null;
}

/**
 * 解析 git merge 失败输出：本地修改将被合并覆盖。
 * 命中返回 {code:"local-changes-conflict", files:[...]}；其它错误返回 null。
 */
export function parseMergeLocalChanges(stderr) {
	if (typeof stderr !== "string") return null;
	const match = /would be overwritten by merge:([\s\S]*?)(?:Please commit your changes|Please move or remove|Aborting|$)/i.exec(stderr);
	if (match === null) return null;
	const files = match[1].split("\n").map((line) => line.trim().replace(/^"/, "").replace(/"$/, "")).filter((line) => line !== "");
	if (files.length === 0) return null;
	return { code: "local-changes-conflict", files };
}

/**
 * 解析 git merge 冲突输出（CONFLICT 行）→ 冲突文件路径数组（去重）。
 * 行格式：`CONFLICT (content): Merge conflict in <path>` 或
 * `CONFLICT (modify/delete): <path> deleted in … and modified in …` 等；
 * 未命中返回 []。host 优先用 `git diff --name-only --diff-filter=U`，本函数仅作兜底。
 */
export function parseMergeConflictFiles(stderr) {
	if (typeof stderr !== "string") return [];
	const files = [];
	for (const line of String(stderr).split("\n")) {
		const m = /^CONFLICT \([^)]*\):\s*(.*)$/i.exec(line.trim());
		if (m === null) continue;
		const desc = m[1];
		let path = null;
		if (desc.startsWith("Merge conflict in ")) {
			path = desc.slice("Merge conflict in ".length);
		} else {
			const first = /^(\S+)(?:\s|$)/.exec(desc);
			if (first !== null) path = first[1];
		}
		if (path !== null && path !== "" && !files.includes(path)) files.push(path);
	}
	return files;
}
