// dsh-awesome-hud — browser half（ModuleLoader bundle）
//
// 功能：
//   1. 会话头部「HUD面板」按钮（conversation.session.header.utilities，order -11，
//      位于 dsh-session-plus 的 open-workspace(order -10) 左侧）。
//   2. 悬浮 HUD 面板（shell.overlay）：六模块，单卡片分区样式（与实际设计稿一致：
//      整卡 + 细分隔线分区、实心色调徽章/芯片、灰底药丸计数、绿色开关）。
//   3. HUD 设置菜单（会话模块右上角）：模块可见性勾选，写入 host settings。
//   4. 全部图标经 host 资产路由 /awesome-hud/assets/<name>.svg 加载内联渲染；
//      单色图标注入 currentColor 以跟随主题。
window.__ModuleLoader__.load({
	id: "dsh-awesome-hud",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");

		const NS = "awesomeHud";
		const PREFIX = "/awesome-hud/api";
		const ASSET_PATH = "/awesome-hud/assets";
		const HUD_OPEN_KEY = "dsh-awesome-hud:open";
		const FOLDS_STORAGE_KEY = "dsh-awesome-hud:folds";
		const CSS_TAG = "dsh-awesome-hud/client.css";
		const PANEL_WIDTH = 300;
		// 菜单可隐藏的模块（会话模块恒展示）
		const MODULE_KEYS = ["context", "balance", "git", "subagents", "tasks", "plans", "mcp"];

		const zh = {
			hudLabel: "HUD面板",
			hudOpen: "展开 HUD 面板",
			hudClose: "收起 HUD 面板",
			statusIdle: "空闲中",
			statusRunning: "任务中",
			statusApproval: "待审批",
			statusAnswer: "待回答",
			statusSubagents: "等待子任务",
			workspaceFallback: "未命名工作区",
			contextModule: "上下文窗口",
			contextCompress: "压缩",
			contextUsed: "已用 {tokens} tokens",
			contextLimit: "上限 {tokens}",
			contextCompressing: "压缩中…",
			contextCompressed: "压缩完成",
			contextBusy: "会话正在运行，无法压缩",
			contextFailed: "压缩失败：{detail}",
			contextUnavailable: "压缩服务不可用",
			settingsSaveFailed: "设置保存失败：{detail}",
			gitModule: "git 变更",
			gitGraph: "git graph",
			gitSummary: "{modified} 修改 · {added} 新增 · {deleted} 删除 · {untracked} 未跟踪",
			gitChangedCount: "{count}",
			gitGraphFailed: "git graph 加载失败",
			graphLoading: "加载中…",
			graphFilesNone: "无文件变更",
			copyShortHash: "复制短哈希",
			copyFullHash: "复制完整哈希",
			copyMessage: "复制提交信息",
			copiedShortHash: "已复制短哈希",
			copiedFullHash: "已复制完整哈希",
			copiedMessage: "已复制提交信息",
			copyFailed: "复制失败：{detail}",
			subagentsModule: "子代理任务",
			subagentRunning: "执行中",
			subagentDone: "已完成",
			subagentOpenFailed: "无法打开子代理会话",
			tasksModule: "任务",
			taskDone: "已完成",
			taskTodo: "待完成",
			mcpModule: "MCP",
			mcpNone: "未接入 MCP 服务",
			mcpToggleFailed: "MCP 切换失败：{detail}",
			settingsTitle: "HUD 设置",
			settingsModules: "展示模块",
			settingsUsageTitle: "用量模块内容",
			settingsUsageDeepseek: "DeepSeek 余额",
			settingsUsageOpencode: "OpenCode Go 用量",
			settingsCancel: "取消",
			settingsConfirm: "确认",
			balanceModule: "用量",
			balanceTotal: "DeepSeek 余额",
			balanceJump: "跳转",
			jumpDeepseek: "deepseek",
			jumpOpencode: "opencode go",
			balanceLoadFailed: "余额获取失败",
			valueOpenDeepseek: "打开设置：账户：deepseek",
			valueOpenOpencode: "打开设置：账户：opencode go",
			ocRolling: "oc-go 5h用量",
			ocWeekly: "oc-go 1w用量",
			ocMonthly: "oc-go 1m用量",
			fallbackSession: "新会话",
			expandModule: "展开",
			collapseModule: "折叠",
			closeModal: "关闭",
			tasksSummary: "{done} 已完成 · {active} 进行中 · {pending} 待处理",
			plansModule: "计划清单",
			plansDiscarded: "已废弃",
			plansPending: "待审批",
			plansApproved: "已执行",
			plansSummary: "{approved} 已执行 · {pending} 待审批 · {discarded} 已废弃",
			plansUntitled: "未命名计划",
			plansCreatedAt: "产出于 {time}",
			gitActionsTitle: "文件操作",
			gitAddToStage: "add to stage",
			gitRemoveFromStage: "remove from stage",
			gitRevertOption: "revert",
			gitRevertAllTitle: "撤销全部未暂存变更？",
			gitRevertAllConfirm: "将撤销 {count} 个已跟踪文件的未暂存变更，未跟踪新建文件保留、暂存区不受影响。此操作不可恢复。",
			gitRevertFileTitle: "撤销该文件的变更？",
			gitRevertFileUntracked: "「{path}」为新建文件，撤销将删除该文件，此操作不可恢复。",
			gitRevertFileTracked: "将还原「{path}」的未暂存变更。",
			gitAffectedFiles: "受影响文件（{count}）",
			gitCancel: "取消",
			gitConfirmDanger: "确认撤销",
			gitConfirmDelete: "确认删除",
			gitCommitTitle: "commit",
			gitCommitSummary: "将提交 {count} 个暂存文件",
			gitCommitPlaceholder: "输入提交信息",
			gitAiGenerate: "generate",
			gitAiGenerating: "生成中…",
			gitAiUnavailable: "当前会话无可用的模型配置",
			gitCommitEmpty: "请输入提交信息",
			gitCancelOrCommit: "取消",
			gitConfirmCommit: "commit",
			gitStageDone: "已暂存「{path}」",
			gitUnstageDone: "已取消暂存「{path}」",
			gitRevertDone: "已撤销「{path}」的变更",
			gitRevertAllDone: "已撤销 {count} 个文件的未暂存变更",
			gitCommitDone: "提交成功",
			gitOperationFailed: "操作失败：{detail}",
			gitAiFailed: "提交信息生成失败：{detail}",
		};
		const en = {
			hudLabel: "HUD panel",
			hudOpen: "Open HUD panel",
			hudClose: "Close HUD panel",
			statusIdle: "Idle",
			statusRunning: "Running",
			statusApproval: "Awaiting approval",
			statusAnswer: "Awaiting answer",
			statusSubagents: "Waiting for subagents",
			workspaceFallback: "Untitled workspace",
			contextModule: "Context window",
			contextCompress: "Compact",
			contextUsed: "{tokens} tokens used",
			contextLimit: "limit {tokens}",
			contextCompressing: "Compacting…",
			contextCompressed: "Compaction complete",
			contextBusy: "Session is running; compaction unavailable",
			contextFailed: "Compaction failed: {detail}",
			contextUnavailable: "Compaction service unavailable",
			settingsSaveFailed: "Failed to save settings: {detail}",
			gitModule: "Git changes",
			gitGraph: "git graph",
			gitSummary: "{modified} modified · {added} added · {deleted} deleted · {untracked} untracked",
			gitChangedCount: "{count}",
			gitGraphFailed: "Failed to load git graph",
			graphLoading: "Loading…",
			graphFilesNone: "No file changes",
			copyShortHash: "Copy short hash",
			copyFullHash: "Copy full hash",
			copyMessage: "Copy commit message",
			copiedShortHash: "Short hash copied",
			copiedFullHash: "Full hash copied",
			copiedMessage: "Commit message copied",
			copyFailed: "Copy failed: {detail}",
			subagentsModule: "Subagents",
			subagentRunning: "Running",
			subagentDone: "Completed",
			subagentOpenFailed: "Failed to open subagent session",
			tasksModule: "Tasks",
			taskDone: "Completed",
			taskTodo: "Pending",
			mcpModule: "MCP",
			mcpNone: "No MCP servers connected",
			mcpToggleFailed: "MCP toggle failed: {detail}",
			settingsTitle: "HUD settings",
			settingsModules: "Modules",
			settingsUsageTitle: "Usage module content",
			settingsUsageDeepseek: "DeepSeek balance",
			settingsUsageOpencode: "OpenCode Go usage",
			settingsCancel: "Cancel",
			settingsConfirm: "Confirm",
			balanceModule: "Usage",
			balanceTotal: "DeepSeek balance",
			balanceJump: "Open",
			jumpDeepseek: "deepseek",
			jumpOpencode: "opencode go",
			balanceLoadFailed: "Failed to load balance",
			valueOpenDeepseek: "Open Settings → Account → deepseek",
			valueOpenOpencode: "Open Settings → Account → opencode go",
			ocRolling: "oc-go 5h usage",
			ocWeekly: "oc-go 1w usage",
			ocMonthly: "oc-go 1m usage",
			fallbackSession: "New session",
			expandModule: "Expand",
			collapseModule: "Collapse",
			closeModal: "Close",
			tasksSummary: "{done} completed · {active} in progress · {pending} pending",
			plansModule: "Plan list",
			plansDiscarded: "Discarded",
			plansPending: "Pending review",
			plansApproved: "Approved",
			plansSummary: "{approved} approved · {pending} pending review · {discarded} discarded",
			plansUntitled: "Untitled plan",
			plansCreatedAt: "Created {time}",
			gitActionsTitle: "File actions",
			gitAddToStage: "add to stage",
			gitRemoveFromStage: "remove from stage",
			gitRevertOption: "revert",
			gitRevertAllTitle: "Discard all unstaged changes?",
			gitRevertAllConfirm: "Changes in {count} tracked files will be discarded; untracked new files are kept and the staged area is untouched. This cannot be undone.",
			gitRevertFileTitle: "Discard changes of this file?",
			gitRevertFileUntracked: "「{path}」is a new file; discarding will delete it. This cannot be undone.",
			gitRevertFileTracked: "The unstaged changes of 「{path}」will be reverted.",
			gitAffectedFiles: "Affected files ({count})",
			gitCancel: "Cancel",
			gitConfirmDanger: "Discard",
			gitConfirmDelete: "Delete",
			gitCommitTitle: "commit",
			gitCommitSummary: "{count} staged file(s) will be committed",
			gitCommitPlaceholder: "Enter commit message",
			gitAiGenerate: "generate",
			gitAiGenerating: "Generating…",
			gitAiUnavailable: "No model selected for this session",
			gitCommitEmpty: "Enter a commit message",
			gitCancelOrCommit: "Cancel",
			gitConfirmCommit: "commit",
			gitStageDone: "Staged 「{path}」",
			gitUnstageDone: "Unstaged 「{path}」",
			gitRevertDone: "Reverted 「{path}」",
			gitRevertAllDone: "Discarded unstaged changes in {count} file(s)",
			gitCommitDone: "Committed successfully",
			gitOperationFailed: "Operation failed: {detail}",
			gitAiFailed: "Commit message generation failed: {detail}",
		};

		/** 浏览器侧 Host 基址（与官方插件同款 null-origin 兜底）。 */
		function hostBase() {
			const origin = globalThis.location?.origin;
			return origin !== undefined && origin !== "null" ? origin : "http://dsh.internal";
		}

		function interpolate(template, values) { return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""); }

		/** host JSON API：POST /awesome-hud/api/<method>。错误携带 code。 */
		function call(method, payload) {
			return fetch(`${hostBase()}${PREFIX}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) }).then(async (response) => {
				const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
				if (!response.ok || body.ok !== true) {
					const error = new Error(typeof body.error === "string" ? body.error : body.error?.message || `HTTP ${response.status}`);
					error.code = typeof body.code === "string" ? body.code : undefined;
					throw error;
				}
				return body;
			});
		}

		/** 读取模块设置（GET）。 */
		function getSettings() {
			return fetch(`${hostBase()}${PREFIX}/settings`).then(async (response) => {
				const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
				if (!response.ok || body.ok !== true) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
				return body;
			});
		}

		// —— 图标：host 资产文本 + 内联渲染（单色注入 currentColor 跟随主题）——
		const ICON_CACHE = {};
		function iconKey(name, keepColors) { return `${name}|${keepColors ? 1 : 0}`; }
		function adaptIcon(text, keepColors) {
			let out = text;
			if (!keepColors) {
				out = out
					.replace(/fill="#(?:000000|2c2c2c|1f1f1f|333333)"/gi, 'fill="currentColor"')
					.replace(/stroke="#(?:000000|2c2c2c|1f1f1f|333333)"/gi, 'stroke="currentColor"');
			}
			return out
				.replace(/\swidth="[0-9.]+"/, "")
				.replace(/\sheight="[0-9.]+"/, "")
				.replace("<svg ", '<svg width="16" height="16" style="display:block;width:16px;height:16px" ');
		}
		function loadIcon(name, keepColors) {
			const key = iconKey(name, keepColors);
			if (ICON_CACHE[key] === undefined) {
				ICON_CACHE[key] = fetch(`${hostBase()}${ASSET_PATH}/${name}.svg`).then((response) => {
					if (!response.ok) throw new Error(`icon ${name}: HTTP ${response.status}`);
					return response.text();
				}).then((text) => adaptIcon(text, keepColors));
			}
			return ICON_CACHE[key];
		}
		/** 16px 内联图标。 */
		function Icon(props) {
			const [svg, setSvg] = react.useState("");
			react.useEffect(() => {
				let alive = true;
				loadIcon(props.name, props.keepColors ?? false).then((text) => { if (alive) setSvg(text); }).catch(() => { /* 加载失败静默占位 */ });
				return () => { alive = false; };
			}, [props.name, props.keepColors]);
			return react.createElement("span", {
				className: "hud-icon",
				"aria-hidden": "true",
				style: { width: 16, height: 16, display: "inline-flex", flex: "none", color: props.color ?? "var(--dsw-alias-label-primary)" },
				dangerouslySetInnerHTML: svg === "" ? undefined : { __html: svg },
			});
		}

		// —— HUD 开合状态（模块级 store，localStorage 持久化；无记录默认展开）——
		let hudOpenState = true;
		try {
			const saved = globalThis.localStorage?.getItem(HUD_OPEN_KEY);
			hudOpenState = saved === null ? true : saved === "1";
		} catch { hudOpenState = true; }
		const hudListeners = new Set();
		function getHudOpen() { return hudOpenState; }
		function subscribeHud(listener) { hudListeners.add(listener); return () => hudListeners.delete(listener); }
		function publishHud() { for (const listener of [...hudListeners]) listener(); }
		function setHudOpen(open) {
			if (hudOpenState === open) return;
			hudOpenState = open;
			try { globalThis.localStorage?.setItem(HUD_OPEN_KEY, open ? "1" : "0"); } catch { /* 存储不可用时仅内存 */ }
			publishHud();
		}
		/** 仅切换内存态不写 localStorage（新会话页临时收起/recover 用）。 */
		function setHudOpenTransient(open) {
			if (hudOpenState === open) return;
			hudOpenState = open;
			publishHud();
		}

		// —— better-sidebar 协调状态（模块级）——
		let hudBeforeSidebar = false; // 侧边栏打开时被动的 HUD，待侧边栏关闭后恢复
		let pendingOpen = false;      // 打开 HUD 时自动关侧边栏失败 → 延迟打开（Q10）
		let hudBlankCollapsed = false; // 新会话页被动收起标记（用户手动开合后清除）

		/** 向 better-sidebar 的折叠按钮发 DOM 点击（第二按钮为右侧面板开关）。 */
		function clickSidebarCollapse() {
			if (typeof document === "undefined") return false;
			const cluster = document.querySelector("[data-dsh-toggle-cluster]");
			if (cluster === null) return false;
			const buttons = cluster.querySelectorAll("button");
			const target = buttons[1] ?? buttons[0];
			if (target === undefined) return false;
			target.click();
			return true;
		}
		/** 等待右侧面板关闭（timeoutMs 超时）。 */
		function waitSidebarClosed(sidebar, timeoutMs) {
			return new Promise((resolve) => {
				if (!(sidebar.getSnapshot().state?.panelOpen ?? false)) { resolve(true); return; }
				let done = false;
				const finish = (ok) => {
					if (done) return;
					done = true;
					window.clearTimeout(timer);
					unsubscribe();
					resolve(ok);
				};
				const unsubscribe = sidebar.subscribeState(() => {
					if (!(sidebar.getSnapshot().state?.panelOpen ?? false)) finish(true);
				});
				const timer = window.setTimeout(() => finish(false), timeoutMs);
			});
		}
		/** 打开 HUD；若 better-sidebar 面板开着：先尝试自动关闭，失败则记 pendingOpen。 */
		function openHud(ctx) {
			const sidebar = ctx.get("betterSidebar");
			if (sidebar !== undefined && (sidebar.getSnapshot().state?.panelOpen ?? false)) {
				const attempted = clickSidebarCollapse();
				if (attempted) {
					waitSidebarClosed(sidebar, 500).then((closed) => {
						if (closed) setHudOpen(true);
						else pendingOpen = true;
					});
				} else {
					pendingOpen = true;
				}
				return;
			}
			setHudOpen(true);
		}
		function toggleHud(ctx) {
			if (getHudOpen()) setHudOpen(false);
			else { hudBlankCollapsed = false; openHud(ctx); }
		}

		/** 附加 better-sidebar 状态监听（服务可能晚于本插件出现：初始探测 + slots/changed 重试）。 */
		function attachSidebarWatcher(ctx) {
			let unsubscribe = null;
			let prevOpen = false;
			const sync = () => {
				const sidebar = ctx.get("betterSidebar");
				if (sidebar === undefined) {
					if (unsubscribe !== null) { unsubscribe(); unsubscribe = null; }
					return;
				}
				if (unsubscribe !== null) return;
				prevOpen = sidebar.getSnapshot().state?.panelOpen ?? false;
				unsubscribe = sidebar.subscribeState(() => {
					const open = sidebar.getSnapshot().state?.panelOpen ?? false;
					if (open && !prevOpen) {
						// 侧边栏被打开 → 若 HUD 开启则自动关闭并记住恢复
						if (getHudOpen()) {
							hudBeforeSidebar = true;
							setHudOpen(false);
						}
					} else if (!open && prevOpen) {
						// 侧边栏被关闭 → 恢复被动的 HUD 或延迟打开的 HUD
						if (hudBeforeSidebar || pendingOpen) {
							hudBeforeSidebar = false;
							pendingOpen = false;
							setHudOpen(true);
						}
					}
					prevOpen = open;
				});
			};
			sync();
			return sync;
		}

		// —— 样式（完全对照 HUD_preview 设计稿：单卡片 + 分隔线分区；
		//     颜色全部经 --dsw-alias-* token / color-mix，支持浅深主题）——
		const css = ".hud-btn{border:1px solid var(--dsw-alias-border-l2);width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:0;font-size:13px;line-height:20px;display:inline-flex}.hud-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.hud-icon{color:var(--dsw-alias-label-primary)}.hud-panel{position:fixed;right:8px;width:300px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;background:var(--hud-surface-bg,var(--dsw-static-neutral-bluish-00));border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;user-select:none;box-shadow:0 10px 30px rgba(0,0,0,.16)}.hud-panel-body{overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;scrollbar-width:none}.hud-panel-body::-webkit-scrollbar{width:6px;height:6px}.hud-panel-body::-webkit-scrollbar-thumb{background:transparent;border-radius:999px}.hud-panel-body::-webkit-scrollbar-track{background:transparent}.hud-panel-body[data-scrolling='1']{scrollbar-width:thin}.hud-panel-body[data-scrolling='1']::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2)}.hud-panel-body[data-scrolling='1']::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2)}.hud-panel-body[data-fading='1']{scrollbar-width:thin}.hud-panel-body[data-fading='1']::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-scrollbar-bg-l2) 45%,transparent)}.hud-section{flex:none;border:0;background:0 0}.hud-section+.hud-section{border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-module-head{display:flex;align-items:center;gap:8px;padding:10px 14px;min-height:20px;cursor:default;position:relative}.hud-module-head[data-fold=true]{cursor:pointer}.hud-module-title{font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}.hud-module-count{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-module-pill{flex:none;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-radius:999px;padding:1px 9px;font-size:11px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary);border:0}.hud-module-fold{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;padding:0;display:inline-flex;align-items:center;justify-content:center;transition:transform .15s var(--ds-ease-in-out,ease)}.hud-module-fold[data-fold=true]{transform:rotate(-90deg)}.hud-module-body{padding:2px 14px 12px;display:flex;flex-direction:column;gap:6px}.hud-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;min-width:0}.hud-row-label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-chip{flex:none;border-radius:999px;padding:1px 9px;font-size:11px;line-height:18px;font-weight:500;border:0}.hud-chip[data-kind=busy]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}.hud-chip[data-kind=done]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent)}.hud-chip[data-kind=warn]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-chip[data-kind=pending]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}.hud-chip[data-kind=idle]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-session-meta{display:flex;flex-direction:column;gap:6px;padding:2px 14px 12px}.hud-session-name-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.hud-session-name{font-weight:500;font-size:13px;line-height:20px;overflow-wrap:anywhere;min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-primary)}.hud-model-row{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;min-width:0}.hud-model-row .hud-model-note{color:var(--dsw-alias-label-secondary)}.hud-model-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;display:inline-block}.hud-model-chips{display:flex;align-items:center;gap:6px}.hud-model-chip{border-radius:999px;padding:2px 10px;font-size:11px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary);border:0;flex:none}.hud-context-row{display:flex;align-items:center;gap:10px;padding:2px 14px 8px}.hud-bar{flex:1 1 auto;height:8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);overflow:hidden}.hud-bar-fill{height:100%;border-radius:999px;transition:width .3s var(--ds-ease-in-out,ease)}.hud-breakdown{display:flex;align-items:baseline;justify-content:space-between;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:0 14px 12px}.hud-breakdown .hud-used{color:var(--dsw-alias-label-primary)}.hud-btn-small{flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.hud-btn-small:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-btn-small:disabled{opacity:.55;cursor:not-allowed}.hud-file-row{display:flex;align-items:center;gap:8px;font-size:13px;line-height:24px;min-width:0}.hud-file-status{flex:none;border-radius:6px;padding:0 6px;min-width:18px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:11px;line-height:18px;border:1px solid transparent}.hud-file-status[data-kind=M]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 15%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent)}.hud-file-status[data-kind=A]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}.hud-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}.hud-file-status[data-kind=?]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent)}.hud-file-status[data-kind=R]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-status[data-kind=C]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-file-diff{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:18px}.hud-diff-add{color:var(--dsw-alias-state-success-primary)}.hud-diff-del{color:var(--dsw-alias-state-error-primary)}.hud-git-btn{align-self:flex-start}.hud-git-summary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding-top:2px}.hud-balance-value{flex:none;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-click{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}.hud-click:hover{color:var(--dsw-alias-state-business-primary)}.hud-usage-row{padding-left:24px;align-items:center}.hud-subagent-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-subagent-row:hover .hud-subagent-name{color:var(--dsw-alias-brand-primary)}.hud-subagent-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-subagent-arrow{flex:none;color:var(--dsw-alias-label-secondary)}.hud-task-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-task-icon{flex:none;width:16px;height:16px;display:inline-flex}.hud-task-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-task-row[data-done=true] .hud-task-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-mcp-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-mcp-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-mcp-row[data-off=true] .hud-mcp-name{color:var(--dsw-alias-label-secondary)}.hud-switch{flex:none;width:30px;height:18px;border-radius:999px;border:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);position:relative;cursor:pointer;padding:0;transition:background .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]{background:var(--dsw-alias-state-success-primary)}.hud-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]::after{left:14px}.hud-settings-btn{flex:none;border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px;display:inline-flex;border-radius:6px}.hud-settings-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-settings-pop{position:fixed;z-index:2147483000;width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px;display:flex;flex-direction:column;gap:2px}.hud-settings-title{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);padding:2px 6px}.hud-settings-title-gap{margin-top:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-settings-item{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:13px;line-height:19px}.hud-settings-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-item input{accent-color:var(--dsw-alias-brand-primary)}.hud-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:6px 0 2px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);margin-top:4px}.hud-settings-btn{flex:none;border-radius:8px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-settings-btn[data-kind=cancel]{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.hud-settings-btn[data-kind=cancel]:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-btn[data-kind=confirm]{border:1px solid transparent;background:var(--dsw-alias-state-business-primary);color:#fff}.hud-settings-btn[data-kind=confirm]:hover{filter:brightness(1.06)}.hud-modal{position:fixed;inset:0;z-index:2147483001;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}.hud-modal-card{width:min(680px,calc(100vw - 40px));max-height:min(70vh,calc(100vh - 48px));display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;animation:hud-modal-in .16s var(--ds-ease-in-out,ease)}.hud-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-modal-title{flex:1 1 auto;min-width:0;font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-modal-close{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;flex:none}.hud-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover)}.hud-modal-close:focus-visible,.hud-git-btn:focus-visible,.hud-btn:focus-visible,.hud-git-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.hud-modal-body{min-height:0;padding:12px 14px 14px;display:flex;flex-direction:column}.hud-git-graph{flex:1 1 auto;min-height:120px;overflow:auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-rows{display:flex;flex-direction:column;gap:2px;min-width:0;padding-bottom:2px}.hud-git-item{display:flex;align-items:stretch;min-width:0;border-radius:8px;box-sizing:border-box;background:transparent;transition:background .12s var(--ds-ease-in-out,ease)}.hud-git-item[data-open=true]{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}.hud-git-lane{position:relative;flex:none;border-radius:8px 0 0 8px;min-height:40px}.hud-git-lane-svg{position:absolute;left:0;top:0;display:block;pointer-events:none}.hud-git-content{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}.hud-git-head{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:40px;padding:0 14px 0 10px;box-sizing:border-box;border:0;background:0 0;border-radius:8px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary);font:inherit}.hud-git-head:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}.hud-git-head[data-open=true]{border-radius:8px 8px 0 0}.hud-git-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:19px;font-weight:500;color:var(--dsw-alias-label-primary)}.hud-git-subject[data-open=true]{font-weight:600}.hud-git-refs{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:40%;overflow:hidden}.hud-git-ref{flex:none;display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:1px 7px;font-size:10px;line-height:16px;border:1px solid transparent;white-space:nowrap}.hud-git-ref[data-kind=branch]{color:#fff;background:var(--dsw-alias-state-business-primary);border-color:transparent;font-weight:500}.hud-git-ref[data-kind=head]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent)}.hud-git-ref[data-kind=tag]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}.hud-git-date{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.hud-git-drawer{min-height:0;overflow:auto;box-sizing:border-box;padding:0 14px 10px 18px;display:flex;flex-direction:column;justify-content:flex-start;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-file{display:flex;align-items:center;gap:8px;height:26px;min-width:0;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei')}.hud-git-file-badge{flex:none;width:32px;font-size:11px;line-height:16px;font-weight:700;color:var(--dsw-alias-label-secondary)}.hud-git-file-badge[data-kind=js]{color:#f3b020}.hud-git-file-badge[data-kind=ts]{color:var(--dsw-alias-state-business-primary)}.hud-git-file-badge[data-kind=svg]{color:#22c55e}.hud-git-file-name{flex:none;max-width:56%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-git-file-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);padding-right:8px}.hud-git-file-status{flex:none;width:18px;text-align:right;font-size:12px;line-height:19px;font-weight:700}.hud-git-file-status[data-kind=M]{color:var(--dsw-alias-state-warn-primary)}.hud-git-file-status[data-kind=A]{color:var(--dsw-alias-state-success-primary)}.hud-git-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary)}.hud-git-file-status[data-kind=R],.hud-git-file-status[data-kind=C]{color:var(--dsw-alias-state-business-primary)}.hud-git-file-status[data-kind='?']{color:var(--dsw-alias-state-error-primary)}.hud-git-file-empty{display:flex;align-items:center;height:26px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-git-menu{position:fixed;z-index:2147483005;width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 10px 34px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}.hud-git-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;cursor:pointer;text-align:left}.hud-git-menu-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-git-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-git-menu-item .hud-icon{color:var(--dsw-alias-label-secondary)}.hud-git-tip{position:fixed;z-index:2147483006;max-width:460px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--hud-surface-bg);box-shadow:0 8px 26px rgba(0,0,0,.2);padding:7px 10px;pointer-events:none;animation:hud-tip-in .12s var(--ds-ease-in-out,ease);display:flex;flex-direction:column;gap:2px}.hud-git-tip[data-below=false]{transform:translateY(-100%)}.hud-git-tip-subject{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.hud-git-tip-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');word-break:break-all}@keyframes hud-tip-in{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.hud-git-tip{animation:none}}.hud-graph-loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:4px 2px}.hud-spinner{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);border-top-color:var(--dsw-alias-state-business-primary);animation:hud-spin .7s linear infinite}.hud-graph-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:6px 2px}@keyframes hud-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}@keyframes hud-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.hud-modal-card{animation:none}.hud-spinner{animation-duration:1.4s}}.hud-toasts{position:fixed;bottom:12px;right:12px;z-index:2147483002;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}.hud-toast{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:9px;padding:8px 12px;font-size:13px;line-height:19px;box-shadow:0 4px 16px rgba(0,0,0,.16)}.hud-toast[data-kind=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-error-primary)}.hud-toast[data-kind=success]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-border-l2))}body{--hud-surface-bg:var(--dsw-static-neutral-bluish-00);--hud-lane-0:#4176e6;--hud-lane-1:#22c55e;--hud-lane-2:#f59e0b;--hud-lane-3:#f25a5a;--hud-lane-4:#60a5fa;--hud-lane-5:#7c3aed}body[data-ds-dark-theme]{--hud-surface-bg:var(--dsw-static-neutral-bluish-900);--hud-lane-0:#679efe;--hud-lane-1:#4ed17e;--hud-lane-2:#f7ad31;--hud-lane-3:#f25a5a;--hud-lane-4:#93c5fd;--hud-lane-5:#a78bfa}.hud-plan-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-plan-row:hover .hud-plan-name{color:var(--dsw-alias-brand-primary)}.hud-plan-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-plan-row[data-state=discarded] .hud-plan-name,.hud-plan-row[data-state=approved] .hud-plan-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-plan-meta{display:flex;align-items:center;gap:8px;padding:0 0 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.hud-plan-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 2px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-plan-body h1{font-size:17px;line-height:24px;font-weight:700;margin:10px 0 6px}.hud-plan-body h1:first-child{margin-top:0}.hud-plan-body h2{font-size:15px;line-height:22px;font-weight:700;margin:10px 0 6px}.hud-plan-body h3{font-size:14px;line-height:20px;font-weight:700;margin:8px 0 5px}.hud-plan-body h4,.hud-plan-body h5,.hud-plan-body h6{font-size:13px;line-height:19px;font-weight:700;margin:8px 0 5px}.hud-plan-body p{margin:5px 0}.hud-plan-body ul,.hud-plan-body ol{margin:5px 0;padding-left:22px}.hud-plan-body li{margin:2px 0}.hud-plan-body code{font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);border-radius:4px;padding:1px 5px}.hud-plan-body pre{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:8px;padding:8px 10px;overflow:auto;margin:6px 0}.hud-plan-body pre code{background:0 0;padding:0;font-size:12px;line-height:18px;white-space:pre}.hud-plan-body a{color:var(--dsw-alias-state-business-primary);text-decoration:underline;text-underline-offset:3px}.hud-plan-body blockquote{margin:6px 0;padding:2px 12px;border-left:3px solid color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);color:var(--dsw-alias-label-secondary)}.hud-plan-body hr{border:0;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:8px 0}.hud-task-progress{color:var(--dsw-alias-state-business-primary);fill:none;display:block;animation:1s linear infinite hud-task-spin}@keyframes hud-task-spin{to{transform:rotate(360deg)}}.hud-plan-body .hud-plan-table-wrap{max-width:100%;overflow-x:auto;margin:6px 0}.hud-plan-body table{border-collapse:collapse;font-size:12.5px;line-height:19px;min-width:100%}.hud-plan-body th,.hud-plan-body td{border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);padding:4px 8px;text-align:left;vertical-align:top}.hud-plan-body th{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);font-weight:600}.hud-plan-body table code{font-size:11.5px}.hud-git-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-bottom:2px}.hud-git-group{flex:none;display:flex;align-items:baseline;gap:7px;padding:8px 0 2px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}.hud-git-group-count{flex:none;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary)}.hud-git-file-btn{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:2px 4px;box-sizing:border-box;border:0;border-radius:6px;background:0 0;cursor:pointer;text-align:left;font-size:13px;line-height:24px;color:var(--dsw-alias-label-primary)}.hud-git-file-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-git-file-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-git-file-btn .hud-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-git-menu-item-danger{color:var(--dsw-alias-state-error-primary)}.hud-git-menu-item-danger:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}.hud-confirm-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.hud-confirm-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}.hud-confirm-note-danger{color:var(--dsw-alias-state-error-primary)}.hud-confirm-list{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:8px;padding:6px 10px;display:flex;flex-direction:column;gap:2px;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-confirm-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);padding-top:10px}.hud-btn-danger{border:1px solid transparent;background:var(--dsw-alias-state-error-primary);color:#fff}.hud-btn-danger:hover{filter:brightness(1.06)}.hud-btn-danger:disabled{opacity:.55;cursor:not-allowed}.hud-commit-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}.hud-commit-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:7px 10px;font-size:13px;line-height:19px}.hud-commit-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-commit-input::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-commit-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);padding-top:10px}.hud-btn-ai{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer}.hud-btn-ai:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}.hud-btn-ai:disabled{opacity:.55;cursor:not-allowed}";

		/** store 基础 hook（SnapshotStore → React 订阅）。 */
		function useSnapshot(store, selector, fallback) {
			const [value, setValue] = react.useState(() => (store === undefined ? fallback : selector(store.getSnapshot())));
			react.useEffect(() => {
				if (store === undefined) return undefined;
				const listener = () => setValue(selector(store.getSnapshot()));
				const unsubscribe = store.subscribe(listener);
				return () => unsubscribe();
			}, [store, selector]);
			return value;
		}

		/** 镜像 lib/graph.js 的 layoutGraph（bundle 自包含，无包内 import；两处必须同步修改）。 */
		function mirrorLayoutGraph(commits) {
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

		/** 镜像 lib/status.js 的 deriveSessionStatus（bundle 自包含，无包内 import；两处必须同步修改）。 */
		function deriveSessionStatus(facts) {
			if (facts.pendingInteraction === "approval") return "approval";
			if (facts.pendingInteraction === "question" || facts.pendingInteraction === "plan-review") return "answer";
			if (facts.subagentActive) return "subagents";
			if (facts.running) return "running";
			return "idle";
		}

		/** 模型提供商显示名解析（同 dsh-session-plus label 语义；失败回退 provider 原始值）。 */
		function resolveProviderLabel(current, groups) {
			if (current === null || current === undefined || typeof current.provider !== "string") return null;
			if (Array.isArray(groups)) {
				for (const group of groups) {
					if (group !== null && typeof group === "object" && group.id === current.provider && typeof group.name === "string" && group.name.length > 0) {
						return group.name;
					}
				}
			}
			return current.provider;
		}

		/** 推理等级显示名（groups → model.reasoning.efforts；查不到回退原始 id）。 */
		function resolveEffortLabel(current, groups) {
			if (current === null || current === undefined || typeof current.reasoningEffort !== "string") return null;
			if (Array.isArray(groups)) {
				for (const group of groups) {
					if (group === null || typeof group !== "object" || group.id !== current.provider || !Array.isArray(group.models)) continue;
					for (const model of group.models) {
						if (model !== null && typeof model === "object" && model.id === current.model && Array.isArray(model.reasoning?.efforts)) {
							for (const effort of model.reasoning.efforts) {
								if (effort !== null && typeof effort === "object" && effort.id === current.reasoningEffort && typeof effort.name === "string" && effort.name.length > 0) {
									return effort.name;
								}
							}
						}
					}
				}
			}
			return current.reasoningEffort;
		}

		function defaultModules() {
			return { context: true, git: true, subagents: true, tasks: true, mcp: true, balance: true, plans: true };
		}
		function defaultUsageDisplay() {
			return { deepseek: true, opencode: true };
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-awesome-hud: dictionaries");
			const t = ctx.locale.bind(NS);

			ctx.effect(() => {
				if (typeof document === "undefined") return;
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-awesome-hud";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = css;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "dsh-awesome-hud: styles");

			ctx.effect(() => {
				const sync = attachSidebarWatcher(ctx);
				const stop = typeof ctx.on === "function" ? ctx.on("slots/changed", () => sync()) : null;
				return () => { if (stop !== null) stop(); };
			}, "dsh-awesome-hud: sidebar watcher");

			// —— toast 层 ——
			let toastState = { toasts: [] };
			const toastListeners = new Set();
			const toastSubscribe = (listener) => { toastListeners.add(listener); return () => toastListeners.delete(listener); };
			const toastPublish = () => { for (const listener of [...toastListeners]) listener(toastState); };
			const toast = (message, kind = "error") => {
				const id = `${Date.now()}-${Math.random()}`;
				toastState = { toasts: [...toastState.toasts, { id, message, kind }] };
				toastPublish();
				window.setTimeout(() => {
					toastState = { toasts: toastState.toasts.filter((item) => item.id !== id) };
					toastPublish();
				}, 2400);
			};
			function ToastLayer() {
				const [state, setState] = react.useState(() => toastState);
				react.useEffect(() => toastSubscribe((next) => setState(next)), []);
				if (state.toasts.length === 0) return null;
				return react.createElement("div", { className: "hud-toasts", "aria-live": "polite" },
					state.toasts.map((item) => react.createElement("div", { className: "hud-toast", "data-kind": item.kind, key: item.id }, item.message)));
			}

			// —— 头部按钮：HUD 面板 ——
			function HudButton() {
				return react.createElement("button", {
					type: "button",
					className: "hud-btn",
					"aria-label": t("hudOpen"),
					title: t("hudLabel"),
					onClick: () => toggleHud(ctx),
				}, react.createElement(Icon, { name: "hud-toggle" }));
			}

			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "hud-toggle",
				order: -11,
				locale: NS,
			}, HudButton));

			// —— 模块标题/折叠头 ——
			function ModuleHead(props) {
				const foldable = props.foldable ?? true;
				const fold = props.fold ?? false;
				const headProps = { className: "hud-module-head", "data-fold": foldable ? fold : false };
				if (foldable && props.onToggle) headProps.onClick = () => props.onToggle();
				return react.createElement("div", headProps,
					react.createElement(Icon, { name: props.icon }),
					react.createElement("span", { className: "hud-module-title" }, props.title),
					props.countText === undefined || props.countText === null ? null : react.createElement("span", { className: props.pill === false ? "hud-module-count" : "hud-module-count hud-module-pill" }, props.countText),
					props.extra === undefined ? null : props.extra,
					foldable ? react.createElement("button", {
						type: "button",
						className: "hud-module-fold",
						"data-fold": fold,
						"aria-label": t(fold ? "expandModule" : "collapseModule"),
						onClick: (event) => { event.stopPropagation(); props.onToggle?.(); },
					}, "\u25BE") : null);
			}

			// —— 模块设置（host settings 持久化）——
			function useHudModules() {
				const [modules, setModules] = react.useState(null);
				const [usageDisp, setUsageDisp] = react.useState(null);
				const latestRef = react.useRef(null);
				const usageRef = react.useRef(null);
				react.useEffect(() => {
					let alive = true;
					getSettings().then((body) => {
						if (!alive) return;
						latestRef.current = body.modules ?? null;
						usageRef.current = body.usage ?? null;
						setModules(body.modules ?? null);
						setUsageDisp(body.usage ?? null);
					}).catch(() => { if (alive) { setModules(null); setUsageDisp(null); } });
					return () => { alive = false; };
				}, []);
				const save = react.useCallback((patchModules, patchUsage) => {
					call("settings", { ...(patchModules === null ? {} : { modules: patchModules }), ...(patchUsage === null ? {} : { usage: patchUsage }) }).catch((error) => {
						toast(interpolate(t("settingsSaveFailed"), { detail: error?.message ?? String(error) }));
					});
				}, []);
				const updateModules = react.useCallback((patch) => {
					const base = latestRef.current ?? defaultModules();
					const next = { ...base, ...patch };
					latestRef.current = next;
					setModules(next);
					save(next, null);
				}, [save]);
				const updateUsage = react.useCallback((patch) => {
					const base = usageRef.current ?? defaultUsageDisplay();
					const next = { ...base, ...patch };
					usageRef.current = next;
					setUsageDisp(next);
					save(null, next);
				}, [save]);
				return [modules, updateModules, usageDisp, updateUsage];
			}

			// —— 会话模块（不可折叠；右上角设置按钮）——
			const MODULE_LABELS = {
				context: () => t("contextModule"),
				git: () => t("gitModule"),
				subagents: () => t("subagentsModule"),
				tasks: () => t("tasksModule"),
				mcp: () => t("mcpModule"),
				balance: () => t("balanceModule"),
				plans: () => t("plansModule"),
			};

			function SettingsMenu(props) {
				const [draft, setDraft] = react.useState(() => ({ ...(props.modules ?? defaultModules()) }));
				const [usageDraft, setUsageDraft] = react.useState(() => ({ ...(props.usage ?? defaultUsageDisplay()) }));
				const keys = MODULE_KEYS.filter((key) => key !== "balance" || props.balanceAvailable === true);
				return react.createElement("div", { className: "hud-settings-pop", style: props.style },
					react.createElement("div", { className: "hud-settings-title" }, t("settingsModules")),
					keys.map((key) => react.createElement("label", { className: "hud-settings-item", key },
						react.createElement("input", {
							type: "checkbox",
							checked: draft[key] !== false,
							onChange: (event) => { setDraft((prev) => ({ ...prev, [key]: event.target.checked })); },
						}),
						react.createElement(Icon, { name: key, color: "var(--dsw-alias-label-primary)" }),
						react.createElement("span", null, MODULE_LABELS[key]()))),
					props.balanceAvailable !== true ? null : react.createElement(react.Fragment, null,
						react.createElement("div", { className: "hud-settings-title hud-settings-title-gap" }, t("settingsUsageTitle")),
						["deepseek", "opencode"].map((key) => react.createElement("label", { className: "hud-settings-item", key: `usage-${key}` },
							react.createElement("input", {
								type: "checkbox",
								checked: usageDraft[key] !== false,
								onChange: (event) => { setUsageDraft((prev) => ({ ...prev, [key]: event.target.checked })); },
							}),
							react.createElement(Icon, { name: key === "deepseek" ? "deepseek" : "icon-opencode", color: "var(--dsw-alias-label-primary)" }),
							react.createElement("span", null, t(key === "deepseek" ? "settingsUsageDeepseek" : "settingsUsageOpencode"))))),
					react.createElement("div", { className: "hud-settings-actions" },
						react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "cancel", onClick: props.onCancel }, t("settingsCancel")),
						react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "confirm", onClick: () => props.onConfirm(draft, usageDraft) }, t("settingsConfirm"))));
			}

			function SessionModule(props) {
				const [menuOpen, setMenuOpen] = react.useState(false);
				const btnRef = react.useRef(null);
				// 设置弹层 portal 到 body + fixed 定位：脱离面板滚动容器（overflow:hidden/auto）的裁剪，
				// 面板高度变化（如关闭模块）不再导致弹层选项被截断。
				let menu = null;
				if (menuOpen) {
					const rect = btnRef.current?.getBoundingClientRect?.() ?? null;
					const vw = typeof window !== "undefined" ? window.innerWidth : 0;
					const style = rect === null
						? { top: 34, right: 8 }
						: { top: Math.max(8, rect.bottom + 4), right: Math.max(8, vw - rect.right - 6) };
					menu = react_dom.createPortal(
						react.createElement(SettingsMenu, { modules: props.modules, usage: props.usage, balanceAvailable: props.balanceAvailable, onConfirm: (draft, usageDraft) => { props.onModulesChange(draft); props.onUsageChange?.(usageDraft); setMenuOpen(false); }, onCancel: () => setMenuOpen(false), style }),
						document.body
					);
				}
				return react.createElement("div", { className: "hud-section", style: { position: "relative" } },
					react.createElement("div", { className: "hud-module-head" },
						react.createElement(Icon, { name: "session" }),
						react.createElement("span", { className: "hud-module-title", title: props.workspaceTitle }, props.workspaceTitle),
						react.createElement("button", {
							type: "button",
							ref: btnRef,
							className: "hud-settings-btn",
							"aria-label": t("settingsTitle"),
							title: t("settingsTitle"),
							onClick: () => setMenuOpen((value) => !value),
						}, react.createElement(Icon, { name: "settings", color: "var(--dsw-alias-label-primary)" })),
						menu),
					react.createElement("div", { className: "hud-session-meta" },
						react.createElement("div", { className: "hud-session-name-row" },
							react.createElement("div", { className: "hud-session-name" }, props.sessionTitle),
							react.createElement("span", { className: "hud-chip", "data-kind": props.statusKind }, props.statusText)),
						react.createElement("div", { className: "hud-model-row" },
							react.createElement("span", { className: "hud-model-dot" }),
							react.createElement("span", null, props.providerLabel ?? ""),
							react.createElement("span", { className: "hud-model-note" }, "")),
						react.createElement("div", { className: "hud-model-chips" },
							props.modelId === null ? null : react.createElement("span", { className: "hud-model-chip" }, props.modelId),
							props.effortLabel === null ? null : react.createElement("span", { className: "hud-model-chip" }, props.effortLabel))));
			}

			// —— 上下文窗口模块（不可折叠）——
			function ContextModule(props) {
				const pressure = props.pressure;
				const [compacting, setCompacting] = react.useState(false);
				const disabled = compacting || props.running;
				const ratio = pressure === null || !(pressure.projectedTokens > 0) || !(pressure.contextWindow > 0)
					? null
					: Math.min(100, (pressure.projectedTokens / pressure.contextWindow) * 100);
				const barColor = ratio === null ? "color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)"
					: ratio <= 40 ? "var(--dsw-alias-state-success-primary)"
						: ratio <= 90 ? "var(--dsw-alias-state-warn-primary)"
							: "var(--dsw-alias-state-error-primary)";
				const onCompact = async () => {
					if (disabled) return;
					setCompacting(true);
					try {
						await call("compact", { sessionId: props.sessionId });
						toast(t("contextCompressed"), "success");
					} catch (error) {
						if (error?.code === "busy") toast(t("contextBusy"));
						else if (error?.code === "unavailable") toast(t("contextUnavailable"));
						else toast(interpolate(t("contextFailed"), { detail: error?.message ?? String(error) }));
					} finally {
						setCompacting(false);
					}
				};
				const label = ratio === null ? "" : `${ratio.toFixed(1)}%`;
				return react.createElement("div", { className: "hud-section" },
					react.createElement("div", { className: "hud-module-head" },
						react.createElement(Icon, { name: "context" }),
						react.createElement("span", { className: "hud-module-title" }, t("contextModule")),
						react.createElement("span", { className: "hud-module-count" }, label)),
					react.createElement("div", { className: "hud-context-row" },
						react.createElement("div", { className: "hud-bar" },
							react.createElement("div", { className: "hud-bar-fill", style: { width: `${ratio ?? 0}%`, background: barColor } })),
						react.createElement("button", {
							type: "button",
							className: "hud-btn-small",
							disabled,
							onClick: onCompact,
						}, compacting ? t("contextCompressing") : t("contextCompress"))),
					react.createElement("div", { className: "hud-breakdown" },
						pressure !== null && pressure.projectedTokens !== undefined
							? react.createElement("span", { className: "hud-used" }, interpolate(t("contextUsed"), { tokens: formatTokens(pressure.projectedTokens) }))
							: react.createElement("span", { className: "hud-used" }, ""),
						pressure !== null && pressure.contextWindow !== undefined
							? react.createElement("span", null, interpolate(t("contextLimit"), { tokens: formatTokens(pressure.contextWindow) }))
							: null));
			}

			function formatTokens(value) {
				if (typeof value !== "number" || !Number.isFinite(value)) return "—";
				if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
				return String(value);
			}

			// —— git 模块 ——
			/** git 文件类型徽章：按扩展名给出文本与配色 kind。 */
			function fileBadgeOf(path) {
				const base = String(path ?? "").split("/").pop() ?? "";
				const dot = base.lastIndexOf(".");
				const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
				const label = {
					js: "JS", mjs: "JS", cjs: "JS", jsx: "JS", ts: "TS", tsx: "TS", json: "{}",
					md: "MD", yml: "YML", yaml: "YML", svg: "SVG", css: "CSS", scss: "CSS", less: "CSS",
					png: "IMG", jpg: "IMG", jpeg: "IMG", gif: "IMG", webp: "IMG", ico: "IMG", lock: "LOCK",
				}[ext] ?? (ext === "" ? "FILE" : ext.toUpperCase().slice(0, 4));
				const kind = { js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "ts", tsx: "ts", svg: "svg" }[ext] ?? "other";
				return { label, kind };
			}

			/** 分支引用药丸内的小图标（与 host 资产 git-branch-line.svg 同源，内联避免二次请求）。 */
			function BranchIcon(props) {
				const size = props.size ?? 12;
				return react.createElement("svg", {
					width: size, height: size, viewBox: "0 0 1024 1024", "aria-hidden": "true",
					fill: "currentColor", style: { display: "block", flex: "none" },
				}, react.createElement("path", { d: "M303.146667 648.96A128.042667 128.042667 0 1 1 213.333333 647.253333V376.746667a128.042667 128.042667 0 1 1 85.333334 0V512c35.669333-26.794667 79.957333-42.666667 128-42.666667h170.666666a128.042667 128.042667 0 0 0 123.52-94.293333 128.042667 128.042667 0 1 1 86.698667 2.730667A213.418667 213.418667 0 0 1 597.333333 554.666667h-170.666666a128.042667 128.042667 0 0 0-123.52 94.293333zM256 725.333333a42.666667 42.666667 0 1 0 0 85.333334 42.666667 42.666667 0 0 0 0-85.333334zM256 213.333333a42.666667 42.666667 0 1 0 0 85.333334 42.666667 42.666667 0 0 0 0-85.333334z m512 0a42.666667 42.666667 0 1 0 0 85.333334 42.666667 42.666667 0 0 0 0-85.333334z" }));
			}

			/** 复制文本：优先 Clipboard API，失败回退 execCommand。 */
			async function writeClipboard(text) {
				try {
					if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
						await navigator.clipboard.writeText(text);
						return true;
					}
				} catch { /* 尝试回退 */ }
				try {
					if (typeof document === "undefined") return false;
					const area = document.createElement("textarea");
					area.value = text;
					area.setAttribute("readonly", "");
					area.style.position = "fixed";
					area.style.left = "-9999px";
					document.body.appendChild(area);
					area.select();
					const ok = document.execCommand("copy");
					area.remove();
					return ok === true;
				} catch { return false; }
			}

			/** 图形化 git 提交图：左侧泳道（CSS/SVG 混排）+ 右侧提交行。
			 *  行点击展开文件抽屉（参考 UI），右键打开复制菜单。 */
			const GIT_FILE_H = 26;
			const GIT_DRAWER_PAD = 12;
			const GIT_DRAWER_MAX = 240;
			function GitGraphView(props) {
				const commits = Array.isArray(props.commits) ? props.commits : [];
				const colW = 16;
				const headH = 40;
				const dotY = headH / 2;
				const layout = mirrorLayoutGraph(commits);
				const width = layout.cols * colW;
				const [expanded, setExpanded] = react.useState(null);
				const [menu, setMenu] = react.useState(null);
				const [tip, setTip] = react.useState(null);
				const tipTimer = react.useRef(null);
				const menuRef = react.useRef(null);
				const menuItemRefs = react.useRef([]);
				const headRefs = react.useRef({});

				const laneOf = (index) => `var(--hud-lane-${index % 6})`;
				const colX = (lane) => lane * colW + colW / 2;

				const closeMenu = (refocus) => {
					const owner = menu === null ? null : menu.commit;
					setMenu(null);
					if (refocus === true && owner !== null) headRefs.current[owner.hash]?.focus();
				};

				// 菜单打开期间：外部点击 / Escape（捕获阶段阻断，防误关弹窗）/ 窗口变化 → 关闭
				react.useEffect(() => {
					if (menu === null) return undefined;
					const onDown = (event) => {
						if (menuRef.current !== null && menuRef.current.contains(event.target)) return;
						closeMenu(false);
					};
					const onKey = (event) => {
						if (event.key === "Escape") { event.stopPropagation(); closeMenu(true); }
					};
					const onViewport = () => closeMenu(false);
					document.addEventListener("mousedown", onDown);
					document.addEventListener("keydown", onKey, true);
					globalThis.window?.addEventListener("resize", onViewport);
					globalThis.window?.addEventListener("blur", onViewport);
					menuItemRefs.current[0]?.focus();
					return () => {
						document.removeEventListener("mousedown", onDown);
						document.removeEventListener("keydown", onKey, true);
						globalThis.window?.removeEventListener("resize", onViewport);
						globalThis.window?.removeEventListener("blur", onViewport);
					};
				}, [menu]);

				const clearTip = () => {
					if (tipTimer.current !== null) {
						globalThis.clearTimeout(tipTimer.current);
						tipTimer.current = null;
					}
					setTip(null);
				};

				// 卸载时清掉悬停定时器，避免泄漏
				react.useEffect(() => () => {
					if (tipTimer.current !== null) globalThis.clearTimeout(tipTimer.current);
				}, []);

				/** 悬停 500ms 后显示完整提交信息提示；离开/点击/滚动即取消。 */
				const hoverTip = (event, commit) => {
					clearTip();
					const rect = event.currentTarget.getBoundingClientRect();
					tipTimer.current = globalThis.setTimeout(() => {
						tipTimer.current = null;
						const maxWidth = 460;
						const left = Math.max(8, Math.min(rect.left, globalThis.innerWidth - maxWidth - 8));
						const below = rect.top < 120;
						setTip({ left, top: below ? rect.bottom + 8 : rect.top - 8, below, commit });
					}, 500);
				};

				const openMenu = (event, commit) => {
					event.preventDefault();
					clearTip();
					const margin = 8;
					const menuW = 208;
					const menuH = 3 * 31 + 30;
					const x = Math.max(margin, Math.min(event.clientX, globalThis.innerWidth - menuW - margin));
					const y = Math.max(margin, Math.min(event.clientY, globalThis.innerHeight - menuH - margin));
					menuItemRefs.current = [];
					setMenu({ x, y, commit });
				};

				const runCopy = async (kind) => {
					if (menu === null) return;
					const commit = menu.commit;
					const text = kind === "short" ? commit.hash.slice(0, 7) : kind === "full" ? commit.hash : commit.subject;
					const ok = await writeClipboard(text);
					closeMenu(false);
					if (ok) toast(kind === "short" ? t("copiedShortHash") : kind === "full" ? t("copiedFullHash") : t("copiedMessage"), "success");
					else toast(interpolate(t("copyFailed"), { detail: "clipboard unavailable" }));
				};

				/** 单行泳道 SVG：贯穿线、入线、直行线、合并弯线、圆点（viewBox 与像素一致，无拉伸）。 */
				const renderLane = (row, rowH, open) => {
					const shapes = [];
					for (const k of row.passThrough) {
						shapes.push(react.createElement("line", {
							key: `p${k}`, x1: colX(k), y1: 0, x2: colX(k), y2: rowH,
							stroke: laneOf(k), strokeWidth: 2,
						}));
					}
					if (row.continued) {
						shapes.push(react.createElement("line", { key: "in", x1: colX(row.col), y1: 0, x2: colX(row.col), y2: dotY, stroke: laneOf(row.lane), strokeWidth: 2 }));
					}
					if (row.straight) {
						shapes.push(react.createElement("line", { key: "out", x1: colX(row.col), y1: dotY, x2: colX(row.col), y2: rowH, stroke: laneOf(row.lane), strokeWidth: 2 }));
					}
					for (const edge of row.edges) {
						const px = colX(edge.to);
						shapes.push(react.createElement("path", {
							key: `e${edge.to}`, d: `M ${colX(row.col)} ${dotY} C ${colX(row.col)} ${dotY + 14}, ${px} ${dotY + 14}, ${px} ${rowH}`,
							fill: "none", stroke: laneOf(row.lane), strokeWidth: 2,
						}));
					}
					const isHead = Array.isArray(row.commit?.refs) && row.commit.refs.some((ref) => ref.kind === "head");
					const r = isHead ? (open ? 7.5 : 6.5) : (open ? 6 : 4.5);
					shapes.push(react.createElement("circle", {
						key: "dot", cx: colX(row.col), cy: dotY, r,
						fill: isHead ? "#fff" : laneOf(row.lane),
						stroke: isHead ? laneOf(row.lane) : (open ? "var(--hud-surface-bg)" : "none"),
						strokeWidth: isHead ? 2.5 : (open ? 2.5 : 0),
					}));
					return react.createElement("svg", { className: "hud-git-lane-svg", width, height: rowH, viewBox: `0 0 ${width} ${rowH}`, "aria-hidden": "true" }, ...shapes);
				};

				/** 文件抽屉行：类型徽章 + 文件名 + 目录 + 状态字母。 */
				const renderFiles = (commit) => {
					const files = Array.isArray(commit.files) ? commit.files : [];
					if (files.length === 0) {
						return react.createElement("div", { className: "hud-git-file-empty" }, t("graphFilesNone"));
					}
					return files.map((file) => {
						const badge = fileBadgeOf(file.path);
						const slash = file.path.lastIndexOf("/");
						const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
						const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
						const tip = file.oldPath === null ? `${file.status} ${file.path}` : `${file.status} ${file.oldPath} → ${file.path}`;
						return react.createElement("div", { className: "hud-git-file", key: `${file.status}:${file.path}`, title: tip },
							react.createElement("span", { className: "hud-git-file-badge", "data-kind": badge.kind }, badge.label),
							react.createElement("span", { className: "hud-git-file-name" }, name),
							react.createElement("span", { className: "hud-git-file-dir" }, dir),
							react.createElement("span", { className: "hud-git-file-status", "data-kind": file.status }, file.status));
					});
				};

				const menuOverlay = menu === null ? null : react.createElement("div", { className: "hud-git-menu", role: "menu", ref: menuRef, style: { left: menu.x, top: menu.y } },
					react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-item",
						ref: (el) => { menuItemRefs.current[0] = el; }, onClick: () => runCopy("short"),
					}, react.createElement(Icon, { name: "copy" }), react.createElement("span", null, t("copyShortHash"))),
					react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-item",
						ref: (el) => { menuItemRefs.current[1] = el; }, onClick: () => runCopy("full"),
					}, react.createElement(Icon, { name: "copy" }), react.createElement("span", null, t("copyFullHash"))),
					react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-item",
						ref: (el) => { menuItemRefs.current[2] = el; }, onClick: () => runCopy("subject"),
					}, react.createElement(Icon, { name: "copy" }), react.createElement("span", null, t("copyMessage"))));

				return react.createElement(react.Fragment, null,
					react.createElement("div", { className: "hud-git-graph", onScroll: () => { closeMenu(false); clearTip(); } },
						react.createElement("div", { className: "hud-git-rows" },
							layout.rows.map((row) => {
								const commit = row.commit;
								const open = commit.hash === expanded;
								const files = Array.isArray(commit.files) ? commit.files : [];
								const drawerH = open ? Math.min((files.length === 0 ? 1 : files.length) * GIT_FILE_H + GIT_DRAWER_PAD, GIT_DRAWER_MAX) : 0;
								const rowH = headH + drawerH;
								const tipText = `${commit.subject}（${commit.hash.slice(0, 7)} · ${commit.date}）`;
								const refs = Array.isArray(commit.refs) ? commit.refs.filter((ref) => ref.kind !== "head") : [];
								return react.createElement("div", { className: "hud-git-item", "data-open": open, style: { height: rowH }, key: commit.hash },
									react.createElement("div", { className: "hud-git-lane", style: { width } }, renderLane(row, rowH, open)),
									react.createElement("div", { className: "hud-git-content" },
										react.createElement("button", {
											type: "button",
											className: "hud-git-head",
											"data-open": open,
											ref: (el) => { headRefs.current[commit.hash] = el; },
											"aria-expanded": open,
											"aria-label": tipText,
											onClick: () => { clearTip(); setExpanded(open ? null : commit.hash); },
											onMouseEnter: (event) => hoverTip(event, commit),
											onMouseLeave: () => clearTip(),
											onContextMenu: (event) => openMenu(event, commit),
											onKeyDown: (event) => {
												if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
													event.preventDefault();
													const rect = event.currentTarget.getBoundingClientRect();
													openMenu({ preventDefault: () => {}, clientX: rect.left + 8, clientY: rect.bottom + 4 }, commit);
												}
											},
										},
											react.createElement("span", { className: "hud-git-subject", "data-open": open }, commit.subject),
											refs.length === 0 ? null : react.createElement("span", { className: "hud-git-refs" },
												refs.map((ref) => react.createElement("span", { className: "hud-git-ref", "data-kind": ref.kind, key: `${ref.kind}:${ref.text}`, title: ref.text },
													ref.kind === "branch" ? react.createElement(BranchIcon, { size: 11 }) : null,
													ref.text))),
											react.createElement("span", { className: "hud-git-date" }, commit.date)),
										open ? react.createElement("div", { className: "hud-git-drawer", style: { height: drawerH } }, renderFiles(commit)) : null));
							}))),
					menuOverlay,
					tip === null ? null : react.createElement("div", {
						className: "hud-git-tip",
						"data-below": tip.below,
						style: { left: tip.left, top: tip.top },
						role: "tooltip",
					},
						react.createElement("div", { className: "hud-git-tip-subject" }, tip.commit.subject),
						react.createElement("div", { className: "hud-git-tip-meta" },
							`${tip.commit.hash} · ${tip.commit.date}`)));
			}

			function GitModule(props) {
				const [graphOpen, setGraphOpen] = react.useState(false);
				const [graphState, setGraphState] = react.useState({ commits: null, error: "" });
				const openBtnRef = react.useRef(null);
				const closeBtnRef = react.useRef(null);
				const openGraph = async () => {
					setGraphOpen(true);
					setGraphState({ commits: null, error: "" });
					try {
						const body = await call("git/graph", { sessionId: props.sessionId });
						if (!Array.isArray(body.commits)) throw new Error(body.error ?? t("gitGraphFailed"));
						setGraphState({ commits: body.commits, error: "" });
					} catch (error) {
						setGraphState({ commits: null, error: error?.message ?? String(error) });
					}
				};
				const closeGraph = () => setGraphOpen(false);
				// 键盘可达性：打开时聚焦关闭按钮，关闭后焦点归还触发按钮。
				react.useEffect(() => {
					if (!graphOpen) return undefined;
					closeBtnRef.current?.focus();
					return () => { openBtnRef.current?.focus(); };
				}, [graphOpen]);
				let modal = null;
				if (graphOpen) {
					modal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("gitGraph"),
						onClick: closeGraph,
						onKeyDown: (event) => { if (event.key === "Escape") closeGraph(); },
					},
						react.createElement("div", { className: "hud-modal-card", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "git-graph" }),
								react.createElement("span", { className: "hud-modal-title" }, t("gitGraph")),
								react.createElement("button", {
									type: "button",
									ref: closeBtnRef,
									className: "hud-modal-close",
									onClick: closeGraph,
								}, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								graphState.error !== ""
									? react.createElement("div", { className: "hud-graph-error" }, graphState.error)
									: graphState.commits === null
										? react.createElement("div", { className: "hud-graph-loading" },
											react.createElement("span", { className: "hud-spinner", "aria-hidden": "true" }),
											t("graphLoading"))
										: react.createElement(GitGraphView, { commits: graphState.commits }))));
				}
				const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 };
				for (const file of props.git.files) {
					if (file.status === "?") counts.untracked += 1;
					else if (file.status === "A") counts.added += 1;
					else if (file.status === "D") counts.deleted += 1;
					else counts.modified += 1;
				}
				const summaryText = interpolate(t("gitSummary"), { modified: counts.modified, added: counts.added, deleted: counts.deleted, untracked: counts.untracked });
				// 分组：staged / changes（组名固定英文；无文件的分组不展示）
				const stagedFiles = props.git.files.filter((file) => file.staged === true);
				const changesFiles = props.git.files.filter((file) => file.unstaged === true);
				const stagedCount = props.git.counts?.staged ?? stagedFiles.length;
				const revertableCount = props.git.revertable ?? props.git.files.filter((file) => file.unstaged === true && file.status !== "?").length;
				// 文件行菜单 / 撤销确认弹窗 / commit 弹窗
				const [menu, setMenu] = react.useState(null);
				const [confirm, setConfirm] = react.useState(null);
				const [commitOpen, setCommitOpen] = react.useState(false);
				const [commitMessage, setCommitMessage] = react.useState("");
				const [aiBusy, setAiBusy] = react.useState(false);
				const commitInputRef = react.useRef(null);
				react.useEffect(() => {
					if (!commitOpen) return undefined;
					commitInputRef.current?.focus();
					return undefined;
				}, [commitOpen]);
				const runWrite = async (method, extra, onOk) => {
					try {
						const body = await call(method, { sessionId: props.sessionId, ...extra });
						props.onGit(body.git);
						if (onOk !== undefined) onOk(body);
					} catch (error) {
						toast(interpolate(t("gitOperationFailed"), { detail: error?.message ?? String(error) }));
					}
				};
				const openFileMenu = (event, file, group) => {
					const rect = event.currentTarget.getBoundingClientRect();
					setMenu({ file, group, left: Math.max(8, rect.left), top: rect.bottom + 4 });
				};
				const doStage = (file) => {
					setMenu(null);
					runWrite("git/stage", { path: file.path }, () => toast(interpolate(t("gitStageDone"), { path: file.path })));
				};
				const doUnstage = (file) => {
					setMenu(null);
					runWrite("git/unstage", { path: file.path }, () => toast(interpolate(t("gitUnstageDone"), { path: file.path })));
				};
				const openRevertFileConfirm = (file) => { setMenu(null); setConfirm({ kind: "revert-file", file }); };
				const openRevertAllConfirm = () => {
					const files = props.git.files.filter((item) => item.unstaged === true && item.status !== "?");
					if (files.length === 0) return;
					setConfirm({ kind: "revert-all", files });
				};
				const cancelConfirm = () => setConfirm(null);
				const confirmRevert = () => {
					const current = confirm;
					if (current === null) return;
					setConfirm(null);
					if (current.kind === "revert-all") {
						runWrite("git/revert-all", {}, () => toast(interpolate(t("gitRevertAllDone"), { count: current.files.length })));
					} else {
						runWrite("git/revert-file", { path: current.file.path }, () => toast(interpolate(t("gitRevertDone"), { path: current.file.path })));
					}
				};
				const openCommit = () => { setCommitMessage(""); setCommitOpen(true); };
				const closeCommit = () => setCommitOpen(false);
				const doCommit = async () => {
					const text = commitMessage.trim();
					if (text === "") { toast(t("gitCommitEmpty")); return; }
					try {
						const body = await call("git/commit", { sessionId: props.sessionId, message: text });
						props.onGit(body.git);
						setCommitOpen(false);
						setCommitMessage("");
						toast(t("gitCommitDone"));
					} catch (error) {
						toast(interpolate(t("gitOperationFailed"), { detail: error?.message ?? String(error) }));
					}
				};
				const doAiGenerate = async () => {
					let current = null;
					try {
						const directory = ctx.get("modelDirectories")?.directoryFor?.(props.sessionId);
						current = directory?.store?.getSnapshot?.()?.current ?? null;
					} catch { current = null; }
					if (current === null || typeof current.provider !== "string" || typeof current.model !== "string") {
						toast(t("gitAiUnavailable"));
						return;
					}
					setAiBusy(true);
					try {
						const body = await call("git/commit-ai", { sessionId: props.sessionId, provider: current.provider, model: current.model });
						setCommitMessage((body.message ?? "").trim());
					} catch (error) {
						toast(interpolate(t("gitAiFailed"), { detail: error?.message ?? String(error) }));
					} finally {
						setAiBusy(false);
					}
				};
				// 文件行（可点击弹选项菜单；菜单选项按所在分组决定——staged 组 remove，changes 组 add/revert）
				const renderFileRow = (file, group) => react.createElement("button", {
					type: "button",
					className: "hud-git-file-btn",
					key: file.path,
					title: file.path,
					onClick: (event) => openFileMenu(event, file, group),
				},
					react.createElement("span", { className: "hud-file-status", "data-kind": file.status }, file.status),
					react.createElement("span", { className: "hud-file-path" }, file.path),
					react.createElement("span", { className: "hud-file-diff" },
						react.createElement("span", { className: "hud-diff-add" }, `+${file.added ?? "?"}`),
						" ",
						react.createElement("span", { className: "hud-diff-del" }, `-${file.deleted ?? 0}`)));
				// 文件行选项弹窗
				let fileMenu = null;
				if (menu !== null) {
					fileMenu = react.createElement(react.Fragment, null,
						react.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 2147483004, background: "transparent" }, onClick: () => setMenu(null) }),
						react.createElement("div", { className: "hud-git-menu", role: "menu", style: { left: menu.left, top: menu.top } },
							menu.group === "staged"
								? react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: () => doUnstage(menu.file) },
									react.createElement(Icon, { name: "revert" }),
									react.createElement("span", null, t("gitRemoveFromStage")))
								: react.createElement(react.Fragment, null,
									react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: () => doStage(menu.file) },
										react.createElement(Icon, { name: "commit" }),
										react.createElement("span", null, t("gitAddToStage"))),
									react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item hud-git-menu-item-danger", onClick: () => openRevertFileConfirm(menu.file) },
										react.createElement(Icon, { name: "revert" }),
										react.createElement("span", null, t("gitRevertOption"))))));
				}
				// 撤销二次确认弹窗（含受影响文件清单）
				let confirmModal = null;
				if (confirm !== null) {
					const isAll = confirm.kind === "revert-all";
					const files = isAll ? confirm.files : [confirm.file];
					const note = isAll
						? interpolate(t("gitRevertAllConfirm"), { count: files.length })
						: confirm.file.status === "?"
							? interpolate(t("gitRevertFileUntracked"), { path: confirm.file.path })
							: interpolate(t("gitRevertFileTracked"), { path: confirm.file.path });
					confirmModal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": isAll ? t("gitRevertAllTitle") : t("gitRevertFileTitle"),
						onClick: cancelConfirm,
						onKeyDown: (event) => { if (event.key === "Escape") cancelConfirm(); },
					},
						react.createElement("div", { className: "hud-modal-card", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "revert" }),
								react.createElement("span", { className: "hud-modal-title" }, isAll ? t("gitRevertAllTitle") : t("gitRevertFileTitle")),
								react.createElement("button", { type: "button", className: "hud-modal-close", onClick: cancelConfirm }, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								react.createElement("div", { className: "hud-confirm-body" },
									react.createElement("div", { className: confirm.file?.status === "?" ? "hud-confirm-note hud-confirm-note-danger" : "hud-confirm-note" }, note),
									react.createElement("div", { className: "hud-git-group" },
										react.createElement("span", null, t("gitAffectedFiles")),
										react.createElement("span", { className: "hud-git-group-count" }, String(files.length))),
									react.createElement("div", { className: "hud-confirm-list" },
										files.map((file) => react.createElement("div", { key: file.path }, file.path))),
									react.createElement("div", { className: "hud-confirm-actions" },
										react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "cancel", onClick: cancelConfirm }, t("gitCancel")),
										react.createElement("button", {
											type: "button",
											className: "hud-btn-danger",
											onClick: confirmRevert,
										}, isAll ? t("gitConfirmDanger") : confirm.file.status === "?" ? t("gitConfirmDelete") : t("gitConfirmDanger")))))));
				}
				// commit 弹窗（输入框 + AI 生成 + 提交）
				let commitModal = null;
				if (commitOpen) {
					commitModal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("gitCommitTitle"),
						onClick: closeCommit,
						onKeyDown: (event) => { if (event.key === "Escape") closeCommit(); },
					},
						react.createElement("div", { className: "hud-modal-card", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "commit" }),
								react.createElement("span", { className: "hud-modal-title" }, t("gitCommitTitle")),
								react.createElement("button", { type: "button", className: "hud-modal-close", onClick: closeCommit }, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								react.createElement("div", { className: "hud-confirm-body" },
									react.createElement("div", { className: "hud-commit-note" },
										interpolate(t("gitCommitSummary"), { count: stagedCount })),
									react.createElement("input", {
										type: "text",
										ref: commitInputRef,
										className: "hud-commit-input",
										placeholder: t("gitCommitPlaceholder"),
										value: commitMessage,
										onChange: (event) => setCommitMessage(event.target.value),
										onKeyDown: (event) => { if (event.key === "Enter" && commitMessage.trim() !== "" && !aiBusy) doCommit(); },
									}),
									react.createElement("div", { className: "hud-commit-actions" },
										react.createElement("button", {
											type: "button",
											className: "hud-btn-ai",
											disabled: aiBusy,
											title: t("gitCommitTitle"),
											onClick: doAiGenerate,
										},
											react.createElement(Icon, { name: "ai-generate" }),
											aiBusy ? t("gitAiGenerating") : t("gitAiGenerate")),
										react.createElement("button", {
											type: "button",
											className: "hud-btn-small",
											disabled: commitMessage.trim() === "" || aiBusy,
											onClick: doCommit,
										},
											react.createElement(Icon, { name: "commit" }),
											t("gitConfirmCommit")))))));
				}
				return react.createElement(react.Fragment, null,
					react.createElement("div", { className: "hud-section" },
						react.createElement(ModuleHead, {
							icon: "git",
							title: props.git.branch ?? t("gitModule"),
							countText: props.git.changedCount > 0 ? interpolate(t("gitChangedCount"), { count: props.git.changedCount }) : null,
							fold: props.fold,
							onToggle: () => props.onFoldChange(!props.fold),
						}),
						props.fold ? null : react.createElement("div", { className: "hud-module-body" },
							react.createElement("div", { className: "hud-git-actions" },
								react.createElement("button", {
									type: "button",
									ref: openBtnRef,
									className: "hud-btn-small hud-git-btn",
									title: t("gitGraph"),
									onClick: openGraph,
								}, react.createElement(Icon, { name: "git-graph" }), t("gitGraph")),
								react.createElement("button", {
									type: "button",
									className: "hud-btn-small hud-git-btn",
									disabled: stagedCount === 0,
									title: t("gitCommitTitle"),
									onClick: openCommit,
								}, react.createElement(Icon, { name: "commit" }), "commit"),
								react.createElement("button", {
									type: "button",
									className: "hud-btn-small hud-git-btn",
									disabled: revertableCount === 0,
									title: t("gitRevertAllTitle"),
									onClick: openRevertAllConfirm,
								}, react.createElement(Icon, { name: "revert" }), "revert")),
							stagedFiles.length === 0 ? null : react.createElement(react.Fragment, null,
								// 组名固定英文（需求指定 staged）
								react.createElement("div", { className: "hud-git-group" },
									react.createElement("span", null, "staged"),
									react.createElement("span", { className: "hud-git-group-count" }, String(stagedFiles.length))),
								stagedFiles.map((file) => renderFileRow(file, "staged"))),
							changesFiles.length === 0 ? null : react.createElement(react.Fragment, null,
								// 组名固定英文（需求指定 changes）
								react.createElement("div", { className: "hud-git-group" },
									react.createElement("span", null, "changes"),
									react.createElement("span", { className: "hud-git-group-count" }, String(changesFiles.length))),
								changesFiles.map((file) => renderFileRow(file, "changes"))),
							react.createElement("div", { className: "hud-git-summary" }, summaryText))),
					modal,
					fileMenu,
					confirmModal,
					commitModal);
			}

			// —— 子代理模块 ——
			function SubagentsModule(props) {
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "subagents",
						title: t("subagentsModule"),
						countText: String(props.entries.length),
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						props.entries.map((entry) => {
							const row = props.byId[entry.id];
							const label = entry.label ?? row?.title ?? row?.displayTitle ?? entry.id;
							return react.createElement("button", {
								type: "button",
								className: "hud-subagent-row",
								key: entry.id,
								style: { paddingLeft: (entry.depth - 1) * 14 },
								onClick: () => { props.onOpen(entry); },
							},
								react.createElement("span", { className: "hud-subagent-name", title: label }, label),
								react.createElement("span", { className: "hud-chip", "data-kind": entry.activity === "running" ? "pending" : "done" }, entry.activity === "running" ? t("subagentRunning") : t("subagentDone")),
								react.createElement("span", { className: "hud-subagent-arrow" }, "\u2197"));
						})));
			}

			// —— 任务模块 ——
			// 执行中任务图标：DeepSeek 官方 TodoPanel 的 ProgressGlyph 复刻（渐变圆环 + 1s 线性旋转动画）。
			function TaskProgressIcon() {
				const gradientId = react.useId();
				return react.createElement("svg", {
					viewBox: "0 0 14 14",
					width: 16,
					height: 16,
					fill: "none",
					className: "hud-task-progress",
					"aria-hidden": "true",
				},
					react.createElement("defs", null,
						react.createElement("linearGradient", {
							id: gradientId,
							x1: "2.5",
							y1: "12",
							x2: "10.5",
							y2: "3.5",
							gradientUnits: "userSpaceOnUse",
						},
							react.createElement("stop", { stopColor: "currentColor" }),
							react.createElement("stop", { offset: "1", stopColor: "currentColor", stopOpacity: "0" }))),
					react.createElement("circle", { cx: "7", cy: "7", r: "6.4", stroke: `url(#${gradientId})`, strokeWidth: "1.2" }));
			}
			function TasksModule(props) {
				const done = props.todos.filter((item) => item.status === "completed").length;
				const active = props.todos.filter((item) => item.status === "in_progress").length;
				const pending = props.todos.length - done - active;
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "tasks",
						title: t("tasksModule"),
						countText: `${done}/${props.todos.length}`,
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						props.todos.map((item, index) => {
							const isDone = item.status === "completed";
							const isProgress = item.status === "in_progress";
							const icon = isDone
								? react.createElement(Icon, { name: "tasks-done", keepColors: true })
								: isProgress
									? react.createElement(TaskProgressIcon, null)
									: react.createElement(Icon, { name: "tasks-todo" });
							return react.createElement("div", { className: "hud-task-row", "data-done": isDone, key: `${item.content}-${index}` },
								react.createElement("span", { className: "hud-task-icon" }, icon),
								react.createElement("span", { className: "hud-task-name" }, item.content));
						}),
						react.createElement("div", { className: "hud-git-summary" },
							interpolate(t("tasksSummary"), { done, active, pending }))));
			}

			// —— 轻量 markdown 渲染（计划弹窗正文：标题/粗体/斜体/行内代码/代码块/列表/链接/引用/分隔线，其余按文本）——
			const INLINE_PATTERN = /(`[^`\n]+`)|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
			function renderInline(text, keyBase) {
				const out = [];
				let last = 0;
				let index = 0;
				let match;
				INLINE_PATTERN.lastIndex = 0;
				while ((match = INLINE_PATTERN.exec(text)) !== null) {
					if (match.index > last) {
						out.push(react.createElement(react.Fragment, { key: `${keyBase}-t${index++}` }, text.slice(last, match.index)));
					}
					const token = match[0];
					if (token.startsWith("`")) {
						out.push(react.createElement("code", { key: `${keyBase}-c${index++}` }, token.slice(1, -1)));
					} else if (token.startsWith("[")) {
						out.push(react.createElement("a", { key: `${keyBase}-a${index++}`, href: match[3], target: "_blank", rel: "noopener noreferrer", onClick: (event) => event.stopPropagation() }, match[2]));
					} else if (token.startsWith("**")) {
						out.push(react.createElement("strong", { key: `${keyBase}-b${index++}` }, token.slice(2, -2)));
					} else {
						out.push(react.createElement("em", { key: `${keyBase}-i${index++}` }, token.slice(1, -1)));
					}
					last = match.index + token.length;
				}
				if (last < text.length) out.push(react.createElement(react.Fragment, { key: `${keyBase}-t${index++}` }, text.slice(last)));
				return out.length > 0 ? out : null;
			}
			/** GFM 表格行分割：跳过 `\|` 转义与反引号代码 span 内的 `|`。 */
			function splitTableRow(line) {
				const text = line.trim();
				const inner = /^\|(.*)\|$/.exec(text);
				const body = inner !== null ? inner[1] : text.replace(/^\|/, "");
				const cells = [];
				let current = "";
				let inCode = false;
				for (let i = 0; i < body.length; i++) {
					const ch = body[i];
					if (ch === "\\" && i + 1 < body.length) { current += body[i + 1]; i++; continue; }
					if (ch === "`") { inCode = !inCode; current += ch; continue; }
					if (ch === "|" && !inCode) { cells.push(current.trim()); current = ""; continue; }
					current += ch;
				}
				cells.push(current.trim());
				return cells;
			}
			/** 表格分隔行对齐：每列返回 "center" | "right" | "left" | null（null = 默认左对齐）。 */
			function parseAlignRow(sepRow) {
				return splitTableRow(sepRow).map((cell) => {
					const c = cell.trim();
					if (c.startsWith(":") && c.endsWith(":")) return "center";
					if (c.endsWith(":")) return "right";
					if (c.startsWith(":")) return "left";
					return null;
				});
			}
			/** 将确认的表格候选（表头 + 分隔行 + 数据行）渲染为滚动容器中的 table。 */
			function renderTableBlock(rows) {
				const header = splitTableRow(rows[0]);
				const aligns = parseAlignRow(rows[1]);
				const cellProps = (align, key) => ({
					key,
					...(align !== null && align !== "left" ? { style: { textAlign: align } } : {}),
				});
				const headRow = react.createElement("tr", { key: "thead-tr" },
					header.map((cell, i) => react.createElement("th", cellProps(aligns[i] ?? null, `th-${i}`), renderInline(cell, `thc-${i}`))));
				const bodyRows = rows.slice(2).map(splitTableRow);
				const body = bodyRows.map((row, r) => react.createElement("tr", { key: `tr-${r}` },
					row.map((cell, i) => react.createElement("td", cellProps(aligns[i] ?? null, `td-${r}-${i}`), renderInline(cell, `tdc-${r}-${i}`)))));
				return react.createElement("div", { className: "hud-plan-table-wrap" },
					react.createElement("table", null,
						react.createElement("thead", null, headRow),
						react.createElement("tbody", null, body)));
			}
			function renderMarkdown(text) {
				const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
				const out = [];
				let keySeq = 0;
				const nextKey = (prefix) => `${prefix}-${keySeq++}`;
				let inCode = false;
				let codeBuf = [];
				let listTag = null;
				let listItems = [];
				let tableBuf = null; // GFM 表格候选行缓冲（首行起连续 | 行）
				const pushList = () => {
					if (listItems.length === 0) return;
					out.push(react.createElement(listTag, { key: nextKey("list") },
						listItems.map((item) => react.createElement("li", { key: nextKey("li") }, renderInline(item, nextKey("in"))))));
					listTag = null;
					listItems = [];
				};
				const isTableCandidate = (trimmed) => /^\s*\|.*\|\s*$/.test(trimmed);
				const flushTable = () => {
					if (tableBuf === null) return;
					const sep = tableBuf[1]?.trim() ?? "";
					if (tableBuf.length >= 2 && /-+/.test(sep) && /^\s*\|?[\s:|-]+\|?\s*$/.test(sep)) {
						// 表头 + 分隔行 + 数据行 → 表格
						pushList();
						out.push(renderTableBlock(tableBuf));
					} else {
						// 仅含 | 的普通文本行 → 按段落原样输出
						for (const tline of tableBuf) {
							pushList();
							out.push(react.createElement("p", { key: nextKey("p") }, renderInline(tline, nextKey("in"))));
						}
					}
					tableBuf = null;
				};
				for (const line of lines) {
					const trimmed = line.trim();
					if (inCode) {
						if (/^```/.test(trimmed)) {
							out.push(react.createElement("pre", { key: nextKey("pre") }, react.createElement("code", null, codeBuf.join("\n"))));
							inCode = false;
						} else {
							codeBuf.push(line);
						}
						continue;
					}
					if (/^```/.test(trimmed)) { inCode = true; codeBuf = []; continue; }
					// 非表格候选行出现时先结束挂起的表格候选（标题/列表/引用/hr/段落等统一在此 flush）
					if (tableBuf !== null && !isTableCandidate(trimmed)) flushTable();
					const heading = /^(#{1,6})\s+\S/.exec(trimmed);
					if (heading !== null) {
						pushList();
						out.push(react.createElement(`h${heading[1].length}`, { key: nextKey("h") },
							renderInline(trimmed.replace(/^#{1,6}\s+/, ""), nextKey("in"))));
						continue;
					}
					const ulItem = /^[-*+]\s+/.exec(trimmed);
					const olItem = /^\d+[.)]\s+/.exec(trimmed);
					if (ulItem !== null || olItem !== null) {
						const tag = ulItem !== null ? "ul" : "ol";
						if (listTag !== tag) pushList();
						listTag = tag;
						listItems.push(ulItem !== null ? trimmed.slice(ulItem[0].length) : trimmed.replace(/^\d+[.)]\s+/, ""));
						continue;
					}
					if (/^>\s?/.test(trimmed)) {
						pushList();
						out.push(react.createElement("blockquote", { key: nextKey("bq") },
							renderInline(trimmed.replace(/^>\s?/, ""), nextKey("in"))));
						continue;
					}
					if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) {
						pushList();
						out.push(react.createElement("hr", { key: nextKey("hr") }));
						continue;
					}
					if (isTableCandidate(trimmed)) {
						if (tableBuf === null) tableBuf = [];
						tableBuf.push(line);
						continue;
					}
					if (trimmed === "") { pushList(); continue; }
					pushList();
					out.push(react.createElement("p", { key: nextKey("p") }, renderInline(line, nextKey("in"))));
				}
				if (inCode && codeBuf.length > 0) {
					out.push(react.createElement("pre", { key: nextKey("pre") }, react.createElement("code", null, codeBuf.join("\n"))));
				}
				flushTable();
				pushList();
				return out.length > 0 ? out : null;
			}

			// —— 计划清单模块 ——
			function planStatusMeta(status) {
				if (status === "approved") return { kind: "done", label: t("plansApproved") };
				if (status === "discarded") return { kind: "warn", label: t("plansDiscarded") };
				return { kind: "pending", label: t("plansPending") };
			}
			function formatPlanTime(time) {
				if (typeof time !== "number" || !Number.isFinite(time)) return "";
				const date = new Date(time);
				const pad = (n) => String(n).padStart(2, "0");
				return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
			}
			function PlansModule(props) {
				const [openId, setOpenId] = react.useState(null);
				const closeBtnRef = react.useRef(null);
				const plan = openId === null ? null : props.plans.find((item) => item.id === openId) ?? null;
				react.useEffect(() => {
					if (openId === null) return undefined;
					closeBtnRef.current?.focus();
					return () => { closeBtnRef.current?.focus(); };
				}, [openId]);
				let modal = null;
				if (plan !== null) {
					const meta = planStatusMeta(plan.status);
					const title = plan.title ?? t("plansUntitled");
					modal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": title,
						onClick: () => setOpenId(null),
						onKeyDown: (event) => { if (event.key === "Escape") setOpenId(null); },
					},
						react.createElement("div", { className: "hud-modal-card", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "plans" }),
								react.createElement("span", { className: "hud-modal-title", title }, title),
								react.createElement("button", {
									type: "button",
									ref: closeBtnRef,
									className: "hud-modal-close",
									onClick: () => setOpenId(null),
								}, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								react.createElement("div", { className: "hud-plan-meta" },
									react.createElement("span", { className: "hud-chip", "data-kind": meta.kind }, meta.label),
									plan.time === null ? null : react.createElement("span", null, interpolate(t("plansCreatedAt"), { time: formatPlanTime(plan.time) }))),
								react.createElement("div", { className: "hud-plan-body" }, renderMarkdown(plan.plan)))));
				}
				return react.createElement(react.Fragment, null,
					react.createElement("div", { className: "hud-section" },
						react.createElement(ModuleHead, {
							icon: "plans",
							title: t("plansModule"),
							countText: String(props.plans.length),
							fold: props.fold,
							onToggle: () => props.onFoldChange(!props.fold),
						}),
						props.fold ? null : react.createElement("div", { className: "hud-module-body" },
							props.plans.map((item) => {
								const meta = planStatusMeta(item.status);
								const label = item.title ?? item.excerpt ?? t("plansUntitled");
								return react.createElement("button", {
									type: "button",
									className: "hud-plan-row",
									"data-state": item.status,
									key: item.id,
									title: label,
									onClick: () => setOpenId(item.id),
								},
									react.createElement("span", { className: "hud-plan-name" }, label),
									react.createElement("span", { className: "hud-chip", "data-kind": meta.kind }, meta.label));
							}),
							react.createElement("div", { className: "hud-git-summary" },
								interpolate(t("plansSummary"), {
									approved: props.plans.filter((item) => item.status === "approved").length,
									pending: props.plans.filter((item) => item.status === "pending").length,
									discarded: props.plans.filter((item) => item.status === "discarded").length,
								})))),
					modal);
			}

			// —— MCP 模块 ——
			function McpModule(props) {
				const [toggling, setToggling] = react.useState(null);
				const toggle = async (server, enabled) => {
					setToggling(server);
					try {
						const body = await call("mcp/toggle", { server, enabled });
						props.onState(body);
						if (body.message !== undefined) toast(body.message, "success");
					} catch (error) {
						toast(interpolate(t("mcpToggleFailed"), { detail: error?.message ?? String(error) }));
					} finally {
						setToggling(null);
					}
				};
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "mcp",
						title: t("mcpModule"),
						countText: `${props.enabled ?? 0}/${props.total ?? 0}`,
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						props.servers.length === 0
							? react.createElement("div", { className: "hud-row hud-usage-row" }, react.createElement("span", { className: "hud-row-label" }, t("mcpNone")))
							: props.servers.map((server) => react.createElement("div", { className: "hud-mcp-row", key: server.name, "data-off": !server.enabled },
								react.createElement("span", { className: "hud-mcp-name", title: server.name }, server.name),
								react.createElement("button", {
									type: "button",
									className: "hud-switch",
									"data-on": server.enabled,
									"aria-label": server.name,
									disabled: toggling === server.name,
									onClick: () => toggle(server.name, !server.enabled),
								})))));
			}

			// —— 余额模块（数据源 = dsh-account-usage 插件同源路由 /api/account-usage/deepseek-summary；
			//     仅当该插件已安装且配置了 DEEPSEEK_PLATFORM_TOKEN 时才展示，否则整体隐藏；
			//     金额格式与 dsh-account-usage 保持一致（fmtMoney 镜像））——
			const ACCOUNT_SUMMARY_URL = "/api/account-usage/deepseek-summary";
			const ACCOUNT_OPENCODE_URL = "/api/account-usage/opencode";
			const DEEPSEEK_PLATFORM_URL = "https://platform.deepseek.com";
			const OPENCODE_GO_PAGE_URL = "https://opencode.ai/workspace/wrk_01KWW4E4FYP5MRWA0GVTQP5JA6/go";
			function fmtBalanceMoney(value, currency) {
				if (value === null || value === undefined || Number.isNaN(value)) return "—";
				const sym = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
				const s = value !== 0 && Math.abs(value) < 0.01 ? value.toFixed(4) : value.toFixed(2);
				return sym + s;
			}
			/** OpenCode Go 窗口百分比（dsh-account-usage 的 pickWindow 同构：percent 缺失显示 —）。 */
			function fmtOcPercent(windowData) {
				const percent = windowData !== null && windowData !== undefined && typeof windowData.percent === "number" && Number.isFinite(windowData.percent)
					? windowData.percent
					: null;
				return percent === null ? "—" : `${Math.round(percent)}%`;
			}
			/**
			 * 打开 DSH 设置面板「账户」分区并切换到指定 tab（deepseek | opencode）。
			 * DSH 设置壳（ui-settings-general SettingsRoot）的打开状态是组件本地 state，
			 * 无公开 API；此处模拟点击路径：侧栏底部触发按钮（aria-haspopup="dialog"）
			 * → 面板导航「账户/Account」→ 页内 tab（deepseek / opencode go）。
			 */
			function openSettingsAccount(tab) {
				const isOpencode = tab === "opencode";
				const findButton = (scope, pattern) => {
					const nodes = Array.from(scope.querySelectorAll("button"));
					return nodes.find((node) => pattern.test((node.textContent ?? "").trim())) ?? null;
				};
				const step = (delay, action) => { globalThis.setTimeout(action, delay); };
				step(0, () => {
					const trigger = document.querySelector('button[aria-haspopup="dialog"]');
					if (trigger !== null) trigger.click();
				});
				step(140, () => {
					const dialog = document.querySelector('[role="dialog"]');
					if (dialog === null) return;
					const nav = findButton(dialog, /账户|^Account$/i);
					if (nav !== null) nav.click();
				});
				const clickTab = () => {
					const dialog = document.querySelector('[role="dialog"]');
					if (dialog === null) return;
					const tabBtn = findButton(dialog, isOpencode ? /opencode\s*go/i : /^deepseek$/i);
					if (tabBtn !== null) tabBtn.click();
				};
				step(260, clickTab);
				step(520, clickTab); // 二次尝试（分区内容异步挂载较慢时兜底）
			}
			function BalanceModule(props) {
				const balance = props.balance;
				const opencode = props.opencode;
				const dsOk = balance !== null && balance.available === true && balance.error === null;
				const ocUsable = opencode !== null && opencode.available === true;
				const display = props.display ?? null;
				const showDs = display === null || display.deepseek !== false;
				const showOc = display === null || display.opencode !== false;
				const jumpDeepseek = () => { window.open(DEEPSEEK_PLATFORM_URL, "_blank", "noopener"); setJumpOpen(false); };
				const jumpOpencode = () => { window.open(OPENCODE_GO_PAGE_URL, "_blank", "noopener"); setJumpOpen(false); };
				const [jumpOpen, setJumpOpen] = react.useState(false);
				const jumpBtnRef = react.useRef(null);
				// DeepSeek 余额 = 充值余额 + 赠送余额（仅 deepseek 可用时展示该行）
				const total = (balance?.data?.toppedUp ?? 0) + (balance?.data?.granted ?? 0);
				const oc = ocUsable ? opencode.usage : null;
				const jumpBtn = dsOk || ocUsable
					? react.createElement("button", {
						type: "button",
						ref: jumpBtnRef,
						className: "hud-btn-small hud-git-btn",
						onClick: (event) => { event.stopPropagation(); setJumpOpen((v) => !v); },
					}, t("balanceJump"))
					: null;
				let jumpMenu = null;
				if (jumpOpen) {
					const rect = jumpBtnRef.current?.getBoundingClientRect?.() ?? null;
					const vw = typeof window !== "undefined" ? window.innerWidth : 0;
					const style = rect === null
						? { top: 34, right: 8 }
						: { top: Math.max(8, rect.bottom + 4), right: Math.max(8, vw - rect.right - 6) };
					jumpMenu = react_dom.createPortal(
						react.createElement(react.Fragment, null,
							react.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 2147483004, background: "transparent" }, onClick: () => setJumpOpen(false) }),
							react.createElement("div", { className: "hud-git-menu", role: "menu", style },
								react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: jumpDeepseek },
									react.createElement(Icon, { name: "deepseek" }),
									react.createElement("span", null, t("jumpDeepseek"))),
								react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: jumpOpencode },
									react.createElement(Icon, { name: "icon-opencode" }),
									react.createElement("span", null, t("jumpOpencode"))))),
						document.body);
				}
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "balance",
						title: t("balanceModule"),
						fold: props.fold,
						onToggle: () => props.onFoldChange?.(!props.fold),
						extra: jumpBtn,
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						balance !== null && balance.available === true && showDs
							? (balance.error === null
								? react.createElement("div", { className: "hud-row hud-usage-row" },
									react.createElement(Icon, { name: "deepseek" }), react.createElement("span", { className: "hud-row-label" }, t("balanceTotal")),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenDeepseek"), onClick: () => openSettingsAccount("deepseek") }, fmtBalanceMoney(total, balance.data?.currency)))
								: react.createElement("div", { className: "hud-git-summary" }, balance.error))
							: null,
						ocUsable && oc !== null && showOc
							? react.createElement(react.Fragment, null,
								react.createElement("div", { className: "hud-row hud-usage-row" },
									react.createElement(Icon, { name: "icon-opencode" }), react.createElement("span", { className: "hud-row-label" }, t("ocRolling")),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenOpencode"), onClick: () => openSettingsAccount("opencode") }, fmtOcPercent(oc.rolling))),
								react.createElement("div", { className: "hud-row hud-usage-row" },
									react.createElement(Icon, { name: "icon-opencode" }), react.createElement("span", { className: "hud-row-label" }, t("ocWeekly")),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenOpencode"), onClick: () => openSettingsAccount("opencode") }, fmtOcPercent(oc.weekly))),
								react.createElement("div", { className: "hud-row hud-usage-row" },
									react.createElement(Icon, { name: "icon-opencode" }), react.createElement("span", { className: "hud-row-label" }, t("ocMonthly")),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenOpencode"), onClick: () => openSettingsAccount("opencode") }, fmtOcPercent(oc.monthly))))
							: null),
					jumpMenu);
			}

			function loadStoredFolds() {
				const fallback = { git: false, subagents: false, tasks: false, mcp: false, usage: false, plans: false }; // MCP/用量/计划 默认展开
				try {
					const raw = globalThis.localStorage?.getItem(FOLDS_STORAGE_KEY);
					if (typeof raw === "string" && raw !== "") {
						const parsed = JSON.parse(raw);
						if (parsed !== null && typeof parsed === "object") {
							return {
								git: typeof parsed.git === "boolean" ? parsed.git : fallback.git,
								subagents: typeof parsed.subagents === "boolean" ? parsed.subagents : fallback.subagents,
								tasks: typeof parsed.tasks === "boolean" ? parsed.tasks : fallback.tasks,
								mcp: typeof parsed.mcp === "boolean" ? parsed.mcp : fallback.mcp,
								usage: typeof parsed.usage === "boolean" ? parsed.usage : fallback.usage,
								plans: typeof parsed.plans === "boolean" ? parsed.plans : fallback.plans,
							};
						}
					}
				} catch { /* 损坏数据回退默认 */ }
				return fallback;
			}

			// —— 面板主体 ——
			function HudPanel() {
				const sessionsStore = ctx.get("sessions")?.list;
				const state = useSnapshot(sessionsStore, (s) => s, null);
				const workspacesStore = ctx.get("workspaces")?.list;
				const workspaceItems = useSnapshot(workspacesStore, (s) => s.items, []);
				const current = state?.current ?? undefined;
				const summary = current === undefined ? undefined : state?.byId?.[current];
				const [modules, updateModules, usageDisp, updateUsage] = useHudModules();
				const [git, setGit] = react.useState(null);
				const [subagents, setSubagents] = react.useState([]);
				const [mcp, setMcp] = react.useState(null);
				const [plans, setPlans] = react.useState([]);
				// 余额模块：调 dsh-account-usage 同源路由（其 host 端有 30s 缓存）；
				// —— deepseek / opencode go 各自独立可用：
				//    deepseek：ok → 有数据；no-token → 未配置；404 → 插件未装。
				//    opencode：ok + keySource → 已配置（订阅中）；no-key → 未配置；
				//    unauthorized → 未订阅/订阅到期；其余失败 → 视为不可用。
				// 模块与设置行可见性 = deepseek 可用 ∪ opencode 可用；
				// 刷新规则与 dsh-account-usage 一致：面板打开时立即 + 每 60s 轮询。
				const [balance, setBalance] = react.useState(null);
				const [opencode, setOpencode] = react.useState(null);
				react.useEffect(() => {
					let alive = true;
					const refreshBalance = async () => {
						let response;
						try {
							response = await fetch(`${hostBase()}${ACCOUNT_SUMMARY_URL}`);
						} catch {
							if (alive) setBalance({ available: false, data: null, error: null });
							return;
						}
						if (response.status === 404) { // 未安装 dsh-account-usage
							if (alive) setBalance({ available: false, data: null, error: null });
							return;
						}
						let body = null;
						try { body = await response.json(); } catch { body = null; }
						if (!alive) return;
						if (body !== null && body.ok === true) {
							setBalance({ available: true, data: body.balance ?? null, error: null });
						} else if (body !== null && body.code === "no-token") {
							// 插件已装但未配置 DEEPSEEK_PLATFORM_TOKEN
							setBalance({ available: false, data: null, error: null });
						} else {
							setBalance({ available: true, data: null, error: (body !== null && typeof body.message === "string" && body.message !== "") ? body.message : t("balanceLoadFailed") });
						}
					};
					const refreshOpencode = async () => {
						let response;
						try {
							response = await fetch(`${hostBase()}${ACCOUNT_OPENCODE_URL}`);
						} catch {
							if (alive) setOpencode({ available: false, usage: null });
							return;
						}
						if (response.status === 404) { // 未安装 dsh-account-usage
							if (alive) setOpencode({ available: false, usage: null });
							return;
						}
						let body = null;
						try { body = await response.json(); } catch { body = null; }
						if (!alive) return;
						// ok + keySource：已配置且订阅有效；no-key/unauthorized/其他失败 → 不可用
						const usable = body !== null && body.ok === true
							&& typeof body.keySource === "string" && body.keySource !== "";
						if (alive) setOpencode(usable ? { available: true, usage: body.usage ?? null } : { available: false, usage: null });
					};
					refreshBalance();
					refreshOpencode();
					const timer = window.setInterval(() => { refreshBalance(); refreshOpencode(); }, 60000);
					return () => { alive = false; window.clearInterval(timer); };
				}, []);
				const [folds, setFolds] = react.useState(loadStoredFolds);
				// 折叠/展开状态持久化：变更即写 localStorage，刷新后保持
				react.useEffect(() => {
					try { globalThis.localStorage?.setItem(FOLDS_STORAGE_KEY, JSON.stringify(folds)); } catch { /* 存储不可用仅内存 */ }
				}, [folds]);
				const [top, setTop] = react.useState(76);
				const [limitH, setLimitH] = react.useState(null); // 高度上限（≤ 视口内，留 8px 底部边距）
				const bodyRef = react.useRef(null);
				const scrollTimerRef = react.useRef(null);
				const fadeTimerRef = react.useRef(null);
				// 滚动条只在面板上下滑动时展示：滚动中标记 data-scrolling，停止 2s 后先进入
				// data-fading 半透明中间态，再短暂延迟后完全隐藏（两段式渐隐，WebKit 滚动条不支持 transition）
				const onPanelScroll = () => {
					const el = bodyRef.current;
					if (el === null) return;
					el.dataset.scrolling = "1";
					delete el.dataset.fading;
					if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
					if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
					scrollTimerRef.current = window.setTimeout(() => {
						el.dataset.fading = "1";
						fadeTimerRef.current = window.setTimeout(() => {
							delete el.dataset.fading;
							delete el.dataset.scrolling;
						}, 700);
					}, 2000);
				};
				react.useEffect(() => () => {
					if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
					if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
				}, []);

				// 布局推挤：开 → 写自有变量；卸载（收起）→ 归零（#root 规则取 max(自有, sidebar)）
				react.useEffect(() => {
					document.documentElement.style.setProperty("--dsh-awesome-hud-width", `${PANEL_WIDTH}px`);
					return () => document.documentElement.style.setProperty("--dsh-awesome-hud-width", "0px");
				}, []);

				// 面板定位：顶部 = 会话头部（header 元素）底部 + 8px；
				// 高度上限 = 输入框底部 - 面板顶（面板撑满时底部与输入框底部平齐）；
				// 并直接对「会话正文容器 + 输入框容器」写入内联 margin-right 完成让位
				// （不推头部，避免触发中间栏紧凑布局；内联样式优先级最高，与
				// better-sidebar 互不干扰；让位宽度 = PANEL_WIDTH）。
				react.useEffect(() => {
					const headerWrapper = document.querySelector('[data-slot="conversation.session.header"]');
					const headerEl = headerWrapper !== null
						? (headerWrapper.querySelector(":scope > header") ?? headerWrapper)
						: null;
					const composerEl = document.querySelector('[data-slot="conversation.composer.bar"]')
						?? document.querySelector('[data-slot="conversation.composer"]');
					// 正文容器 = 会话槽位宿主的直接父元素（内部包含会话正文 + 输入框座；
					// 只推该容器，避免输入框被二次推挤）
					const sessionHost = document.querySelector('[data-slot="conversation.session"]');
					const pushBody = sessionHost?.parentElement ?? null;
					const update = () => {
						const headRect = headerEl?.getBoundingClientRect();
						const compRect = composerEl?.getBoundingClientRect();
						const nextTop = Math.max(8, Math.round((headRect?.bottom ?? 0) + 8));
						setTop(nextTop);
						// 上限不超过「视口底部 - 8px」，防止面板底超出聊天页可视高度
						const vhLimit = Math.max(120, Math.round(window.innerHeight - nextTop - 8));
						if (compRect !== undefined && compRect.bottom > nextTop + 120) {
							setLimitH(Math.min(Math.round(compRect.bottom - nextTop), vhLimit));
						} else {
							setLimitH(vhLimit);
						}
					};
					update();
					// 让位：正文容器（含输入框）右移出面板宽度
					if (pushBody !== null) pushBody.style.marginRight = `${PANEL_WIDTH}px`;
					const observer = new ResizeObserver(update);
					if (headerEl !== null) observer.observe(headerEl);
					if (composerEl !== null) observer.observe(composerEl);
					window.addEventListener("resize", update);
					return () => {
						observer.disconnect();
						window.removeEventListener("resize", update);
						if (pushBody !== null) pushBody.style.marginRight = "";
					};
					// 会话切换会重建会话正文 DOM，需重新查询并应用让位
				}, [current]);

				const sessionId = current ?? "";
				// git / 子代理 / MCP / 计划：面板打开时轮询（5s），切会话立即刷新
				react.useEffect(() => {
					if (sessionId === "") { setGit(null); setSubagents([]); setMcp(null); setPlans([]); return undefined; }
					let alive = true;
					const refreshGit = async () => {
						try {
							const body = await call("git", { sessionId });
							if (alive) setGit(body);
						} catch { if (alive) setGit({ isRepo: false }); }
					};
					const refreshSubagents = async () => {
						try {
							const body = await call("subagents", { sessionId });
							if (alive) setSubagents(body.entries ?? []);
						} catch { if (alive) setSubagents([]); }
					};
					const refreshMcp = async () => {
						try {
							const body = await call("mcp", { sessionId });
							if (alive) setMcp(body);
						} catch { if (alive) setMcp(null); }
					};
					const refreshPlans = async () => {
						try {
							const body = await call("plans", { sessionId });
							if (alive) setPlans(Array.isArray(body.plans) ? body.plans : []);
						} catch { if (alive) setPlans([]); }
					};
					refreshGit(); refreshSubagents(); refreshMcp(); refreshPlans();
					const timer = window.setInterval(() => { refreshGit(); refreshSubagents(); refreshMcp(); refreshPlans(); }, 5000);
					return () => { alive = false; window.clearInterval(timer); };
				}, [sessionId]);

				const workspaceTitle = resolveWorkspaceTitle(summary?.cwd, workspaceItems);
				const projection = summary?.projectionValues ?? {};
				const todos = Array.isArray(projection.todos) ? projection.todos.filter((item) => item && typeof item === "object" && typeof item.content === "string") : [];
				const pressure = projection.contextPressure ?? null;
				const subagentActive = subagents.some((entry) => entry.activity === "running");
				const statusKey = deriveSessionStatus({ running: summary?.running ?? false, pendingInteraction: summary?.pendingInteraction, subagentActive });
				const statusMap = {
					idle: ["idle", t("statusIdle")],
					running: ["busy", t("statusRunning")],
					approval: ["pending", t("statusApproval")],
					answer: ["pending", t("statusAnswer")],
					subagents: ["pending", t("statusSubagents")],
				};
				const statusKind = statusMap[statusKey][0];
				const statusText = statusMap[statusKey][1];

				// 模型信息（可选服务 modelDirectories，缺失降级）
				let modelMeta = { providerLabel: null, modelId: null, effortLabel: null };
				try {
					const directory = ctx.get("modelDirectories")?.directoryFor?.(sessionId);
					const modelStore = directory?.store;
					if (modelStore !== undefined) {
						const snapshot = modelStore.getSnapshot();
						const currentSel = snapshot?.current ?? null;
						if (currentSel !== null && typeof currentSel === "object") {
							modelMeta = {
								providerLabel: resolveProviderLabel(currentSel, snapshot?.groups ?? []) ?? currentSel.provider,
								modelId: typeof currentSel.model === "string" ? currentSel.model : null,
								effortLabel: resolveEffortLabel(currentSel, snapshot?.groups ?? []),
							};
						}
					}
				} catch { /* 模型目录不可用时降级 */ }

				const activeModules = modules ?? defaultModules();

				const openSubagent = (entry) => {
					try {
						ctx.get("sessions")?.openSubagent({ parentSessionId: entry.parentId, childSessionId: entry.id, mode: entry.mode });
					} catch (error) {
						toast(t("subagentOpenFailed"));
						void error;
					}
				};

				return react.createElement("section", {
					className: "hud-panel",
					style: { top, maxHeight: limitH === null ? undefined : `${limitH}px` },
					"aria-label": t("hudLabel"),
				},
					react.createElement("div", { className: "hud-panel-body", ref: bodyRef, onScroll: onPanelScroll },
						react.createElement(SessionModule, {
							workspaceTitle,
							sessionTitle: summary?.title ?? summary?.displayTitle ?? t("fallbackSession"),
							statusText,
							statusKind,
							providerLabel: modelMeta.providerLabel,
							modelId: modelMeta.modelId,
							effortLabel: modelMeta.effortLabel,
							modules: activeModules,
							usage: usageDisp,
							balanceAvailable: (balance !== null && balance.available === true) || (opencode !== null && opencode.available === true),
							onModulesChange: updateModules,
							onUsageChange: updateUsage,
						}),
						activeModules.context === false ? null : react.createElement(ContextModule, {
							sessionId,
							pressure,
							running: summary?.running ?? false,
						}),
						activeModules.balance === false
							|| ((balance === null || balance.available !== true) && (opencode === null || opencode.available !== true))
							? null
							: react.createElement(BalanceModule, { balance, opencode, display: usageDisp, fold: folds.usage, onFoldChange: (value) => setFolds((prev) => ({ ...prev, usage: value })) }),
						activeModules.git === false || git === null || !git.isRepo ? null : react.createElement(GitModule, {
							sessionId,
							git,
							fold: folds.git,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, git: value })),
							onGit: (snapshot) => setGit(snapshot),
						}),
						activeModules.subagents === false || subagents.length === 0 ? null : react.createElement(SubagentsModule, {
							entries: subagents,
							byId: state?.byId ?? {},
							onOpen: openSubagent,
							fold: folds.subagents,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, subagents: value })),
						}),
						activeModules.tasks === false || todos.length === 0 ? null : react.createElement(TasksModule, {
							todos,
							fold: folds.tasks,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, tasks: value })),
						}),
						activeModules.plans === false || plans.length === 0 ? null : react.createElement(PlansModule, {
							plans: [...plans].reverse(),
							fold: folds.plans,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, plans: value })),
						}),
						activeModules.mcp === false || mcp === null ? null : react.createElement(McpModule, {
							sessionId,
							servers: mcp.servers,
							enabled: mcp.enabled,
							total: mcp.total,
							fold: folds.mcp,
							onState: (body) => setMcp(body),
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, mcp: value })),
						})));
			}

			function resolveWorkspaceTitle(cwd, items) {
				if (cwd === undefined || cwd === "" || !Array.isArray(items)) return t("workspaceFallback");
				for (const item of items) {
					if (item !== null && typeof item === "object" && typeof item.path === "string" && item.path === cwd && typeof item.title === "string" && item.title.length > 0) {
						return item.title;
					}
				}
				const base = String(cwd).split("/").filter(Boolean).pop();
				return base ?? t("workspaceFallback");
			}

			// —— HUD 面板壳（监听 open 状态，关闭即卸载）——
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "awesome-hud",
				order: 70,
				label: () => t("hudLabel"),
				locale: NS,
			}, function HudPanelRoot() {
				const [open, setOpen] = react.useState(() => getHudOpen());
				react.useEffect(() => subscribeHud(() => setOpen(getHudOpen())), []);
				// 新开会话页面（无会话 / blank：未开始的空会话）默认不展示 HUD：
				// 进入空白新会话 → 临时收起（不写 localStorage，保留用户记忆）；
				// 进入真实会话（非 blank）→ 若此前因新会话页被动收起且用户未干预，恢复打开。
				// 用户手动开合会清除被动标记（经 toggleHud → 见 HudButton / setHudOpen 调用点）。
				const blankSessionsStore = ctx.get("sessions")?.list;
				const blankSnap = useSnapshot(blankSessionsStore, (s) => s, null);
				const blankState = blankSnap === null
					? { current: undefined, byId: null }
					: { current: blankSnap.current, byId: blankSnap.byId };
				const isBlank = blankSnap === null
					? null // store 未就绪 → 不确定，不动作（避免初载误判收起）
					: blankState.current === undefined || (blankState.byId?.[blankState.current]?.blank ?? false) === true;
				const prevBlankRef = react.useRef(null);
				react.useEffect(() => {
					if (isBlank === null) { prevBlankRef.current = null; return; }
					const prev = prevBlankRef.current;
					prevBlankRef.current = isBlank;
					if (prev === null) {
						// 首次判定：若落在新会话页（含刷新后）默认收起，不持久化
						if (isBlank && getHudOpen()) {
							hudBlankCollapsed = true;
							setHudOpenTransient(false);
						}
						return;
					}
					if (isBlank === prev) return;
					if (isBlank) {
						// 新会话页：若 HUD 开着则临时收起（不持久化），并置被动标记
						if (getHudOpen()) {
							hudBlankCollapsed = true;
							setHudOpenTransient(false);
						}
					} else if (hudBlankCollapsed) {
						// 回到真实会话：恢复打开（清除被动标记）
						hudBlankCollapsed = false;
						setHudOpen(true);
					}
				}, [isBlank]);
				react.useEffect(() => () => { hudBlankCollapsed = false; }, []);
				return react.createElement(react.Fragment, null,
					open ? react.createElement(HudPanel, null) : null,
					react.createElement(ToastLayer, null));
			}));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
