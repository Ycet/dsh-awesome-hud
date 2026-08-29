// dsh-awesome-hud — git 提交图数据与泳道布局纯解析（host 与单测共用）
// git log --pretty=format:%H%x1f%P%x1f%D%x1f%s%x1f%ar 输出一行一条提交，
// 字段以 0x1f 分隔：完整哈希、空格分隔的父母、引用描述(%D)、主题、相对时间。
// 布局算法为经典泳道（lane）模型：每个提交占据一行，列 = 泳道；
// 首父沿原泳道直行，合并边在当行弯入目标泳道，之后沿目标泳道下行。

/** 解析 %D（如 "HEAD -> dev, tag: v1.2.3, origin/dev"）为引用数组。 */
export function parseRefs(raw) {
	const out = [];
	for (const part of String(raw ?? "").split(", ")) {
		const text = part.trim();
		if (text === "") continue;
		if (text.startsWith("tag: ")) {
			out.push({ text: text.slice(5).trim(), kind: "tag" });
		} else if (text.includes(" -> ")) {
			// 形态：HEAD -> dev（符号引用）
			const [head, target] = text.split(" -> ");
			if (head.trim() !== "") out.push({ text: head.trim(), kind: "head" });
			if (target.trim() !== "") out.push({ text: target.trim(), kind: "branch" });
		} else {
			out.push({ text, kind: "branch" });
		}
	}
	return out;
}

/** 解析 git log 输出 → [{hash, parents[], refs[], subject, date}]；非法行跳过。 */
export function parseGitLogOutput(text) {
	const commits = [];
	for (const line of String(text ?? "").split("\n")) {
		const trimmed = line.trimEnd();
		if (trimmed === "") continue;
		const fields = trimmed.split("\u001f");
		if (fields.length < 5) continue;
		const [hash, parents, refs, subject, date] = fields;
		if (!/^[0-9a-f]{40}$/.test(hash)) continue;
		commits.push({
			hash,
			parents: parents === "" ? [] : parents.split(" "),
			refs: parseRefs(refs),
			subject,
			date,
		});
	}
	return commits;
}

/**
 * 泳道布局：commits 需按 git topo 顺序（子前父后）。
 * 返回 { cols, rows: [{ commit, col, continued, edges:[{to}], passThrough:[], lane }] }：
 *  - col：本提交所在泳道（新分支取首个空泳道，否则追加）
 *  - continued：该泳道来自上方（有入线）
 *  - edges：除首父外的合并边目标泳道（首父直行不产生边）
 *  - passThrough：本行贯穿（上方激活、非本提交列）的泳道
 *  - lane：泳道着色下标（col % 6）
 */
export function layoutGraph(commits) {
	const lanes = [];
	const rows = [];
	for (const commit of commits ?? []) {
		const lanesBefore = lanes.slice();
		let found = -1;
		for (let i = 0; i < lanes.length; i += 1) {
			if (lanes[i] === commit.hash) { found = i; break; }
		}
		const continued = found !== -1;
		let col;
		if (continued) {
			col = found;
		} else {
			col = lanes.findIndex((value) => value === null);
			if (col === -1) { col = lanes.length; lanes.push(null); }
		}
		lanes[col] = null;
		const edges = [];
		let straight = false;
		const parents = Array.isArray(commit.parents) ? commit.parents : [];
		if (parents.length > 0) {
			// 首父：若已存在于其他泳道（两泳道合流），弯线接入并关闭本泳道；否则沿本泳道直行。
			const p0 = parents[0];
			const p0col = lanes.indexOf(p0);
			straight = p0col === -1 || p0col === col;
			if (!straight) {
				edges.push({ to: p0col });
			} else {
				lanes[col] = p0;
			}
			const seen = new Set([...edges.map((edge) => edge.to), col]);
			for (let i = 1; i < parents.length; i += 1) {
				let pc = lanes.indexOf(parents[i]);
				if (pc === -1) {
					pc = lanes.findIndex((value) => value === null);
					if (pc === -1) { pc = lanes.length; lanes.push(null); }
					lanes[pc] = parents[i];
				}
				if (!seen.has(pc)) { seen.add(pc); edges.push({ to: pc }); }
			}
		}
		const passThrough = [];
		for (let k = 0; k < lanesBefore.length; k += 1) {
			if (lanesBefore[k] !== null && k !== col) passThrough.push(k);
		}
		rows.push({ commit, col, continued, edges, passThrough, lane: col % 6, straight });
	}
	return { cols: Math.max(1, lanes.length), rows };
}
