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
		const CSS_TAG = "dsh-awesome-hud/client.css";
		const PANEL_WIDTH = 335;
		// 菜单可隐藏的模块（会话模块恒展示）
		const MODULE_KEYS = ["context", "git", "subagents", "tasks", "mcp"];

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
			gitSummary: "{modified} 修改 · {added} 新增 · {untracked} 未跟踪",
			gitChangedCount: "{count}",
			gitGraphFailed: "git graph 加载失败",
			graphLoading: "加载中…",
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
			fallbackSession: "新会话",
			expandModule: "展开",
			collapseModule: "折叠",
			closeModal: "关闭",
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
			gitSummary: "{modified} modified · {added} added · {untracked} untracked",
			gitChangedCount: "{count}",
			gitGraphFailed: "Failed to load git graph",
			graphLoading: "Loading…",
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
			fallbackSession: "New session",
			expandModule: "Expand",
			collapseModule: "Collapse",
			closeModal: "Close",
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

		// —— better-sidebar 协调状态（模块级）——
		let hudBeforeSidebar = false; // 侧边栏打开时被动的 HUD，待侧边栏关闭后恢复
		let pendingOpen = false;      // 打开 HUD 时自动关侧边栏失败 → 延迟打开（Q10）

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
			else openHud(ctx);
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
		const css = ".hud-btn{border:1px solid var(--dsw-alias-border-l2);width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:0;font-size:13px;line-height:20px;display:inline-flex}.hud-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.hud-icon{color:var(--dsw-alias-label-primary)}.hud-panel{position:fixed;right:8px;width:335px;max-height:80vh;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;background:var(--hud-surface-bg,var(--dsw-static-neutral-bluish-00));border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;user-select:none;box-shadow:0 10px 30px rgba(0,0,0,.16)}.hud-panel-body{overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column}.hud-section{flex:none;border:0;background:0 0}.hud-section+.hud-section{border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-module-head{display:flex;align-items:center;gap:8px;padding:10px 14px;min-height:20px;cursor:default;position:relative}.hud-module-head[data-fold=true]{cursor:pointer}.hud-module-title{font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}.hud-module-count{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-module-pill{flex:none;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-radius:999px;padding:1px 9px;font-size:11px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary);border:0}.hud-module-fold{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;padding:0;display:inline-flex;align-items:center;justify-content:center;transition:transform .15s var(--ds-ease-in-out,ease)}.hud-module-fold[data-fold=true]{transform:rotate(-90deg)}.hud-module-body{padding:2px 14px 12px;display:flex;flex-direction:column;gap:6px}.hud-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;min-width:0}.hud-row-label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-chip{flex:none;border-radius:999px;padding:1px 9px;font-size:11px;line-height:18px;font-weight:500;border:0}.hud-chip[data-kind=busy]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}.hud-chip[data-kind=done]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent)}.hud-chip[data-kind=warn]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-chip[data-kind=pending]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}.hud-chip[data-kind=idle]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-session-meta{display:flex;flex-direction:column;gap:6px;padding:2px 14px 12px}.hud-session-name-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.hud-session-name{font-weight:500;font-size:13px;line-height:20px;overflow-wrap:anywhere;min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-primary)}.hud-model-row{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;min-width:0}.hud-model-row .hud-model-note{color:var(--dsw-alias-label-secondary)}.hud-model-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;display:inline-block}.hud-model-chips{display:flex;align-items:center;gap:6px}.hud-model-chip{border-radius:999px;padding:2px 10px;font-size:11px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary);border:0;flex:none}.hud-context-row{display:flex;align-items:center;gap:10px;padding:2px 14px 8px}.hud-bar{flex:1 1 auto;height:8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);overflow:hidden}.hud-bar-fill{height:100%;border-radius:999px;transition:width .3s var(--ds-ease-in-out,ease)}.hud-breakdown{display:flex;align-items:baseline;justify-content:space-between;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:0 14px 12px}.hud-breakdown .hud-used{color:var(--dsw-alias-label-primary)}.hud-btn-small{flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.hud-btn-small:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-btn-small:disabled{opacity:.55;cursor:not-allowed}.hud-file-row{display:flex;align-items:center;gap:8px;font-size:13px;line-height:24px;min-width:0}.hud-file-status{flex:none;border-radius:6px;padding:0 6px;min-width:18px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:11px;line-height:18px;border:1px solid transparent}.hud-file-status[data-kind=M]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-status[data-kind=A]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,transparent)}.hud-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}.hud-file-status[data-kind=?]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}.hud-file-status[data-kind=R]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-status[data-kind=C]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-file-diff{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:18px}.hud-diff-add{color:var(--dsw-alias-state-success-primary)}.hud-diff-del{color:var(--dsw-alias-state-error-primary)}.hud-git-btn{align-self:flex-start}.hud-git-summary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding-top:2px}.hud-subagent-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-subagent-row:hover .hud-subagent-name{color:var(--dsw-alias-brand-primary)}.hud-subagent-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-subagent-arrow{flex:none;color:var(--dsw-alias-label-secondary)}.hud-task-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-task-icon{flex:none;width:16px;height:16px;display:inline-flex}.hud-task-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-task-row[data-done=true] .hud-task-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-mcp-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-mcp-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-mcp-row[data-off=true] .hud-mcp-name{color:var(--dsw-alias-label-secondary)}.hud-switch{flex:none;width:30px;height:18px;border-radius:999px;border:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);position:relative;cursor:pointer;padding:0;transition:background .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]{background:var(--dsw-alias-state-success-primary)}.hud-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]::after{left:14px}.hud-settings-btn{flex:none;border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px;display:inline-flex;border-radius:6px}.hud-settings-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-settings-pop{position:fixed;z-index:2147483000;width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px;display:flex;flex-direction:column;gap:2px}.hud-settings-title{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);padding:2px 6px}.hud-settings-item{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:13px;line-height:19px}.hud-settings-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-item input{accent-color:var(--dsw-alias-brand-primary)}.hud-modal{position:fixed;inset:0;z-index:2147483001;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}.hud-modal-card{width:min(680px,calc(100vw - 40px));max-height:min(70vh,calc(100vh - 48px));display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;animation:hud-modal-in .16s var(--ds-ease-in-out,ease)}.hud-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-modal-title{flex:1 1 auto;min-width:0;font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-modal-close{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;flex:none}.hud-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover)}.hud-modal-close:focus-visible,.hud-git-btn:focus-visible,.hud-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.hud-modal-body{min-height:0;padding:12px 14px 14px;display:flex;flex-direction:column}.hud-git-graph{flex:1 1 auto;min-height:120px;overflow:auto;overscroll-behavior:contain;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-canvas{position:relative;min-height:100%;box-sizing:border-box}.hud-git-svg{position:absolute;left:0;top:0;pointer-events:none}.hud-git-rows{display:flex;flex-direction:column;min-width:max-content}.hud-git-cr{display:flex;align-items:center;gap:8px;height:24px;min-width:0;padding:0 14px 0 0;box-sizing:border-box}.hud-git-hash{flex:none;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-git-subject{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}.hud-git-refs{flex:none;display:inline-flex;align-items:center;gap:4px}.hud-git-ref{flex:none;border-radius:999px;padding:0 7px;font-size:10px;line-height:16px;border:1px solid transparent;white-space:nowrap}.hud-git-ref[data-kind=head]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent)}.hud-git-ref[data-kind=tag]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}.hud-git-ref[data-kind=branch]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}.hud-git-date{margin-left:auto;flex:none;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.hud-graph-loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:4px 2px}.hud-spinner{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);border-top-color:var(--dsw-alias-state-business-primary);animation:hud-spin .7s linear infinite}.hud-graph-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:6px 2px}@keyframes hud-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}@keyframes hud-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.hud-modal-card{animation:none}.hud-spinner{animation-duration:1.4s}}.hud-toasts{position:fixed;bottom:12px;right:12px;z-index:2147483002;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}.hud-toast{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:9px;padding:8px 12px;font-size:13px;line-height:19px;box-shadow:0 4px 16px rgba(0,0,0,.16)}.hud-toast[data-kind=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-error-primary)}.hud-toast[data-kind=success]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-border-l2))}body{--hud-surface-bg:var(--dsw-static-neutral-bluish-00);--hud-lane-0:#4176e6;--hud-lane-1:#22c55e;--hud-lane-2:#f59e0b;--hud-lane-3:#f25a5a;--hud-lane-4:#60a5fa;--hud-lane-5:#7c3aed}body[data-ds-dark-theme]{--hud-surface-bg:var(--dsw-static-neutral-bluish-900);--hud-lane-0:#679efe;--hud-lane-1:#4ed17e;--hud-lane-2:#f7ad31;--hud-lane-3:#f25a5a;--hud-lane-4:#93c5fd;--hud-lane-5:#a78bfa}";

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
			return { context: true, git: true, subagents: true, tasks: true, mcp: true };
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
				const latestRef = react.useRef(null);
				react.useEffect(() => {
					let alive = true;
					getSettings().then((body) => {
						if (!alive) return;
						latestRef.current = body.modules ?? null;
						setModules(body.modules ?? null);
					}).catch(() => { if (alive) setModules(null); });
					return () => { alive = false; };
				}, []);
				const update = react.useCallback((patch) => {
					const base = latestRef.current ?? defaultModules();
					const next = { ...base, ...patch };
					latestRef.current = next;
					setModules(next);
					call("settings", { modules: next }).catch((error) => {
						toast(interpolate(t("settingsSaveFailed"), { detail: error?.message ?? String(error) }));
					});
				}, []);
				return [modules, update];
			}

			// —— 会话模块（不可折叠；右上角设置按钮）——
			const MODULE_LABELS = {
				context: () => t("contextModule"),
				git: () => t("gitModule"),
				subagents: () => t("subagentsModule"),
				tasks: () => t("tasksModule"),
				mcp: () => t("mcpModule"),
			};

			function SettingsMenu(props) {
				const modules = props.modules ?? defaultModules();
				return react.createElement("div", { className: "hud-settings-pop", style: props.style },
					react.createElement("div", { className: "hud-settings-title" }, t("settingsModules")),
					MODULE_KEYS.map((key) => react.createElement("label", { className: "hud-settings-item", key },
						react.createElement("input", {
							type: "checkbox",
							checked: modules[key] !== false,
							onChange: (event) => { props.onChange({ [key]: event.target.checked }); },
						}),
						react.createElement("span", null, MODULE_LABELS[key]()))));
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
						react.createElement(SettingsMenu, { modules: props.modules, onChange: props.onModulesChange, style }),
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
						}, react.createElement(Icon, { name: "settings", color: "var(--dsw-alias-label-secondary)" })),
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
			/** 一行内的泳道图形：入线、直行线、合并弯线、贯穿线、提交圆点。 */
			function graphRowShapes(row, colW, rowH) {
				const mid = rowH / 2;
				const cx = row.col * colW + colW / 2;
				const color = `var(--hud-lane-${row.lane})`;
				const shapes = [];
				if (row.continued) {
					shapes.push(react.createElement("line", { key: "in", x1: cx, y1: 0, x2: cx, y2: mid, strokeWidth: 2, style: { stroke: color } }));
				}
				if (row.straight) {
					shapes.push(react.createElement("line", { key: "straight", x1: cx, y1: mid, x2: cx, y2: rowH, strokeWidth: 2, style: { stroke: color } }));
				}
				for (const edge of row.edges) {
					const px = edge.to * colW + colW / 2;
					const d = `M ${cx} ${mid} C ${cx} ${mid + 6}, ${px} ${mid + 6}, ${px} ${rowH}`;
					shapes.push(react.createElement("path", { key: `e${edge.to}`, d, fill: "none", strokeWidth: 2, style: { stroke: color } }));
				}
				for (const k of row.passThrough) {
					const kx = k * colW + colW / 2;
					shapes.push(react.createElement("line", { key: `p${k}`, x1: kx, y1: 0, x2: kx, y2: rowH, strokeWidth: 2, style: { stroke: `var(--hud-lane-${k % 6})` } }));
				}
				shapes.push(react.createElement("circle", { key: "dot", cx, cy: mid, r: 3.5, style: { fill: color } }));
				return shapes;
			}

			/** 图形化 git 提交图：左侧 SVG 泳道 + 右侧提交元信息行。 */
			function GitGraphView(props) {
				const commits = Array.isArray(props.commits) ? props.commits : [];
				const colW = 16;
				const rowH = 24;
				const layout = mirrorLayoutGraph(commits);
				const width = layout.cols * colW;
				const height = layout.rows.length * rowH;
				return react.createElement("div", { className: "hud-git-graph" },
					react.createElement("div", { className: "hud-git-canvas", style: { height } },
						react.createElement("svg", { className: "hud-git-svg", width, height, "aria-hidden": "true" },
							layout.rows.map((row) => react.createElement("g", { key: row.commit.hash }, graphRowShapes(row, colW, rowH)))),
						react.createElement("div", { className: "hud-git-rows", style: { marginLeft: width + 10 } },
							layout.rows.map((row) => {
								const commit = row.commit;
								return react.createElement("div", { className: "hud-git-cr", key: commit.hash },
									react.createElement("span", { className: "hud-git-hash" }, commit.hash.slice(0, 7)),
									react.createElement("span", { className: "hud-git-subject", title: commit.subject }, commit.subject),
									commit.refs.length === 0 ? null : react.createElement("span", { className: "hud-git-refs" },
										commit.refs.map((ref) => react.createElement("span", { className: "hud-git-ref", "data-kind": ref.kind, key: `${ref.kind}:${ref.text}` }, ref.text))),
									react.createElement("span", { className: "hud-git-date" }, commit.date));
							}))));
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
				const counts = { modified: 0, added: 0, untracked: 0 };
				for (const file of props.git.files) {
					if (file.status === "?") counts.untracked += 1;
					else if (file.status === "A") counts.added += 1;
					else counts.modified += 1;
				}
				const summaryText = interpolate(t("gitSummary"), { modified: counts.modified, added: counts.added, untracked: counts.untracked });
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
							react.createElement("button", {
								type: "button",
								ref: openBtnRef,
								className: "hud-btn-small hud-git-btn",
								title: t("gitGraph"),
								onClick: openGraph,
							}, react.createElement(Icon, { name: "git-graph" }), t("gitGraph")),
							props.git.files.map((file) => react.createElement("div", { className: "hud-file-row", key: file.path },
								react.createElement("span", { className: "hud-file-status", "data-kind": file.status }, file.status),
								react.createElement("span", { className: "hud-file-path", title: file.path }, file.path),
								react.createElement("span", { className: "hud-file-diff" },
									react.createElement("span", { className: "hud-diff-add" }, `+${file.added ?? "?"}`),
									" ",
									react.createElement("span", { className: "hud-diff-del" }, `-${file.deleted ?? 0}`)))),
							react.createElement("div", { className: "hud-git-summary" }, summaryText))),
					modal);
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
								react.createElement("span", { className: "hud-chip", "data-kind": entry.activity === "running" ? "busy" : "done" }, entry.activity === "running" ? t("subagentRunning") : t("subagentDone")),
								react.createElement("span", { className: "hud-subagent-arrow" }, "\u2197"));
						})));
			}

			// —— 任务模块 ——
			function TasksModule(props) {
				const done = props.todos.filter((item) => item.status === "completed").length;
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
							return react.createElement("div", { className: "hud-task-row", "data-done": isDone, key: `${item.content}-${index}` },
								react.createElement("span", { className: "hud-task-icon" }, react.createElement(Icon, { name: isDone ? "tasks-done" : "tasks-todo", keepColors: true })),
								react.createElement("span", { className: "hud-task-name" }, item.content));
						})));
			}

			// —— MCP 模块 ——
			function McpModule(props) {
				const [toggling, setToggling] = react.useState(null);
				const toggle = async (server, enabled) => {
					setToggling(server);
					try {
						const body = await call("mcp/toggle", { sessionId: props.sessionId, server, enabled });
						props.onState(body);
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
							? react.createElement("div", { className: "hud-row" }, react.createElement("span", { className: "hud-row-label" }, t("mcpNone")))
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

			// —— 面板主体 ——
			function HudPanel() {
				const sessionsStore = ctx.get("sessions")?.list;
				const state = useSnapshot(sessionsStore, (s) => s, null);
				const workspacesStore = ctx.get("workspaces")?.list;
				const workspaceItems = useSnapshot(workspacesStore, (s) => s.items, []);
				const current = state?.current ?? undefined;
				const summary = current === undefined ? undefined : state?.byId?.[current];
				const [modules, updateModules] = useHudModules();
				const [git, setGit] = react.useState(null);
				const [subagents, setSubagents] = react.useState([]);
				const [mcp, setMcp] = react.useState(null);
				const [folds, setFolds] = react.useState({ git: false, subagents: false, tasks: false, mcp: true });
				const [top, setTop] = react.useState(76);
				const [limitH, setLimitH] = react.useState(null); // 由输入框顶约束的高度上限

				// 布局推挤：开 → 写自有变量；卸载（收起）→ 归零（#root 规则取 max(自有, sidebar)）
				react.useEffect(() => {
					document.documentElement.style.setProperty("--dsh-awesome-hud-width", `${PANEL_WIDTH}px`);
					return () => document.documentElement.style.setProperty("--dsh-awesome-hud-width", "0px");
				}, []);

				// 面板定位：顶部 = 会话头部（header 元素）底部 + 8px；
				// 高度上限 = 输入框顶 - 面板顶 - 8px；并直接对「会话正文容器 +
				// 输入框容器」写入内联 margin-right 完成让位（不推头部，避免触发
				// 中间栏紧凑布局；内联样式优先级最高，与 better-sidebar 互不干扰）。
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
						if (compRect !== undefined && compRect.top > nextTop + 120) {
							setLimitH(Math.round(compRect.top - nextTop - 8));
						} else {
							setLimitH(null);
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
				// git / 子代理 / MCP：面板打开时轮询（5s），切会话立即刷新
				react.useEffect(() => {
					if (sessionId === "") { setGit(null); setSubagents([]); setMcp(null); return undefined; }
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
					refreshGit(); refreshSubagents(); refreshMcp();
					const timer = window.setInterval(() => { refreshGit(); refreshSubagents(); refreshMcp(); }, 5000);
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
					react.createElement("div", { className: "hud-panel-body" },
						react.createElement(SessionModule, {
							workspaceTitle,
							sessionTitle: summary?.title ?? summary?.displayTitle ?? t("fallbackSession"),
							statusText,
							statusKind,
							providerLabel: modelMeta.providerLabel,
							modelId: modelMeta.modelId,
							effortLabel: modelMeta.effortLabel,
							modules: activeModules,
							onModulesChange: updateModules,
						}),
						activeModules.context === false ? null : react.createElement(ContextModule, {
							sessionId,
							pressure,
							running: summary?.running ?? false,
						}),
						activeModules.git === false || git === null || !git.isRepo ? null : react.createElement(GitModule, {
							sessionId,
							git,
							fold: folds.git,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, git: value })),
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
						activeModules.mcp === false || mcp === null || mcp.total === 0 ? null : react.createElement(McpModule, {
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
