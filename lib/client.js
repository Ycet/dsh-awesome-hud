// dsh-awesome-hud — browser half（ModuleLoader bundle）
//
// 功能：
//   1. 会话头部「HUD面板」按钮（conversation.session.header.utilities，order 1，
//      放在「更多」右侧、底部边栏按钮左侧）。
//   2. 新建会话页（无会话 / 空白会话过渡态）：该页不渲染 session header，故经
//      shell.overlay 在右侧边栏按钮左侧提供悬浮「HUD面板」按钮；
//      该页恒从隐藏开始（内存态、不写 localStorage），点击后展开并让输入框等内容左移让位，
//      面板位置与已有会话完全一致（固定贴页面右侧）。
//   3. 悬浮 HUD 面板（shell.overlay）：单卡片分区样式（与实际设计稿一致：
//      整卡 + 细分隔线分区、实心色调徽章/芯片、灰底药丸计数、绿色开关）；
//      v0.20.0 起面板样式可切换（「HUD面板通用设置 → HUD 面板样式」，默认卡片样式）：
//      卡片样式保持圆角悬浮卡片；边栏样式改为通高贴边、透明底，与内容区之间用一条分隔线区分，
//      模块之间的分隔线左右各缩进 14px（模块内容与交互完全不变）；
//      新建会话页只展示该页有数据源的模块（会话 / 用量 / 便笺 / 待办 / MCP，
//      以及目标工作区确为 git 仓库时的 git）。
//   4. HUD 设置弹窗（会话模块右上角）：模块显隐、排列顺序、面板样式/侧位与用量模块内容，写入 host settings。
//   5. 「便笺」「待办」按工作区共享（v0.12.0 起）：同一工作区目录下的所有会话共用
//      一份内容（含便笺高度与待办顺序）；无 cwd 的会话降级为会话级隔离；
//      升级时按工作区做一次性归并迁移（旧会话级键保留，便于回滚）。
//   6. 面板开合状态按会话独立（v0.13.0 起）：各会话各自记忆，互不影响；
//      新建会话页恒从隐藏开始（只存内存态、不持久化）。
//      v0.15.3 起可见性改为派生：可见 = 会话展开记忆 && 右侧栏未展开；
//      侧栏开合只临时遮挡、不改写记忆，关闭侧栏后自然恢复（除非用户手动收起过 HUD）。
//   7. 全部图标经 host 资产路由 /awesome-hud/assets/<name>.svg 加载内联渲染；
//      单色图标注入 currentColor 以跟随主题。
window.__ModuleLoader__.load({
	id: "dsh-awesome-hud",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		// v0.18.1：菜单图标直接使用 DSH 官方图标包。该包是 Web 前端的平台 seed 模块
		// （与 react/react-dom 同一张表），因此无需新增依赖、资产或 inject 声明；
		// 极老版本没有这个 seed 时静默降级为内置资产图标，面板照常加载。
		let primitives = null;
		try { primitives = require("@deepseek-ai/dsh-client-ui-primitives"); } catch { primitives = null; }
		/** 取官方图标组件；缺失时返回 null（不校验类型：memo/forwardRef 组件是对象，React 一样能渲染）。 */
		function officialIcon(name) {
			if (primitives === null || primitives === undefined) return null;
			const component = primitives[name];
			return component === null || component === undefined ? null : component;
		}
		// 布局推挤必须在同一提交内应用/清理（侧栏展开→面板卸载→同步移除正文留白），
		// 因此优先使用 useLayoutEffect；缺失时回退 useEffect，不引入额外依赖。
		const useLayoutEffect = typeof react.useLayoutEffect === "function" ? react.useLayoutEffect : react.useEffect;

		const NS = "awesomeHud";
		const PREFIX = "/awesome-hud/api";
		const ASSET_PATH = "/awesome-hud/assets";
		const HUD_OPEN_KEY = "dsh-awesome-hud:open";
		const FOLDS_STORAGE_KEY = "dsh-awesome-hud:folds";
		const NOTES_STORAGE_KEY = "dsh-awesome-hud:notes";
		const TODOS_STORAGE_KEY = "dsh-awesome-hud:todos";
		// 便笺/待办按工作区共享（v0.12.0 起）；迁移标记键记录「已按工作区归并过」的路径。
		const WORKSPACE_MIGRATED_KEY = "dsh-awesome-hud:workspace-migrated";
		const WORKSPACE_MIGRATED_VERSION = 1;
		const CSS_TAG = "dsh-awesome-hud/client.css";
		const PANEL_WIDTH = 300;
		// v0.18.2：面板可展开的侧位与边距；「HUD 面板设置」localStorage 首帧镜像键。
		const HUD_PANEL_GAP = 8;
		const PANEL_SIDES = ["left", "right"];
		// v0.20.0：面板样式（card 圆角卡片 / sidebar 通高贴边边栏）；默认 card，与宿主 settings.js 同规则。
		const PANEL_STYLES = ["card", "sidebar"];
		// 左侧面板最近一次测量到的水平锚点（会话区左缘 + 8px）：缓存后重开面板不必等一帧再定位。
		let lastPanelLeft = HUD_PANEL_GAP;
		const PANEL_SETTINGS_KEY = "dsh-awesome-hud:panel";
		// 新建会话页几何：面板与已有会话完全一致（固定贴视口右侧、宽度 300、顶部同标题栏下沿）；
		// 新建页按钮位于右侧边栏按钮左侧；Windows 额外避开原生标题栏，全屏时取消该偏移。
		const HUD_NEW_SESSION_TOP = 52;
		const HUD_FLOAT_INSET = 12;
		const HUD_FLOAT_RIGHT = 72;
		/** 悬浮入口与右侧按钮簇的间距（与聊天页 utilities 的 gap 一致）。 */
		const HUD_FLOAT_GAP = 8;
		/** 右侧栏角落按钮的宽度（DSH 与 better-sidebar 的按钮均为 28px）。 */
		const HUD_FLOAT_SLOT_SIZE = 28;
		/** 便笺可保存的图片张数上限（与宿主 maxImagesPerMessage 的默认值一致）。 */
		const NOTE_MAX_IMAGES = 20;
		/** 便笺条数上限：允许 5–20，默认 5（可在 HUD 设置 → 便笺 中调整）。 */
		const NOTE_COUNT_MIN = 5;
		const NOTE_COUNT_MAX = 20;
		const NOTE_COUNT_DEFAULT = 5;

		/** 便笺条数上限收敛：取整并夹到 5–20；非数字回默认 5。 */
		function normalizeNoteMaxCount(value) {
			const number = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(number)) return NOTE_COUNT_DEFAULT;
			return Math.min(NOTE_COUNT_MAX, Math.max(NOTE_COUNT_MIN, Math.round(number)));
		}
		/** Windows 原生标题栏占用的视口高度；跟随宿主变量，避免按钮与面板进入窗口控件区域。 */
		function hudChromeTop() {
			if (typeof document === "undefined") return 0;
			const root = document.documentElement;
			if (!root?.hasAttribute("data-windows-titlebar") || root.hasAttribute("data-fullscreen")) return 0;
			const style = window.getComputedStyle(root);
			const top = Number.parseFloat(style.getPropertyValue("--dsh-frame-chrome-top") || style.getPropertyValue("--dsh-windows-titlebar-height"));
			return Number.isFinite(top) && top >= 0 ? top : 40;
		}
		// 新建会话页可展示的模块白名单（其余模块在该页没有数据源，不占位）
		const NEW_SESSION_MODULE_KEYS = ["balance", "git", "mcp", "note", "todo"];
		const TURN_NAVIGATION_RIGHT_GAP = 12;
		const TURN_NAVIGATION_MIN_COLUMN_WIDTH = 720;
		// Mirrors rc.1 ConversationRoot's width resolver, but uses the HUD-reserved
		// body width so the host's drag preference remains valid while the panel is open.
		const HUD_CONTENT_WIDTH = "min(var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-awesome-hud-column-width) * .64), 920px)), max(640px, calc(var(--dsh-awesome-hud-column-width) - 176px)))";
		/**
		 * HUD 为面板让位时会改写会话正文容器的内联属性（v0.15.10 起集中登记）。
		 * v0.18.2：同时登记左右两侧的外边距——切换「面板展开位置」时，旧侧位由卸载
		 * 流程按原值还原，新侧位再写入，不会把上一次写入的 300px 当成宿主原值。
		 */
		const INLINE_PUSH_PROPS = ["margin-left", "margin-right", "--dsh-awesome-hud-column-width", "--dsh-chat-content-width", "--dsh-composer-card-max-width"];
		/**
		 * 让位时还要把「会话滚动容器」向面板的对侧补回面板宽度（见 pushScrollContainer）：
		 * 右侧面板补右缘、左侧面板补左缘，滚动条因此仍停在窗口右缘（macOS 覆盖式滚动条与
		 * 常驻滚动条都成立），而不是被正文收窄带到面板边缘。
		 */
		const SCROLL_PUSH_PROPS = ["margin-left", "margin-right", "padding-left", "padding-right"];
		/**
		 * v0.15.16：「轨迹」「统计」等视图把输入框改成绝对定位浮层（视图根节点带
		 * data-conversation-composer-overlay），宿主的 composerSeat 于是从 sticky 变成
		 * `position:absolute; left:0; right:var(--dsh-scrollbar-width)`。绝对定位的百分比/auto
		 * 尺寸按 **padding box** 解析，而 HUD 让位靠给滚动容器加 padding —— 对绝对定位
		 * 子元素无效，输入框仍横跨整窗并压到面板下方。这里按同一选择器补写对应侧收窄。
		 */
		const COMPOSER_OVERLAY_SELECTOR = "[data-conversation-composer-overlay]";
		/** 输入框座位被让位时改写的属性（只写 margin，保留宿主自己的 left/right 原值）。 */
		const COMPOSER_SEAT_PUSH_PROPS = ["margin-left", "margin-right"];
		/** 输入框座位（[data-composer-seat]）——宿主 ConversationRoot 渲染的 composer 容器。 */
		const COMPOSER_SEAT_SELECTOR = "[data-composer-seat]";
		/**
		 * 节点 → 属性 → 「插件首次改写前」的原值。WeakMap 跨面板挂载周期保留：
		 * 旧实现每次挂载都把当前值当原值，只要有一次卸载没跑完（宿主重建节点、
		 * 异常退出），快照就会把插件自己写的 300px 记成原值，此后每次卸载都写回
		 * 300px —— 正文永久变窄、右侧留下一条没有内容的空白带（v0.15.10 修复）。
		 */
		const inlinePushOriginals = new WeakMap();
		function rememberInlineOriginal(node, property) {
			if (node === null || node === undefined) return { property, value: "", priority: "" };
			let map = inlinePushOriginals.get(node);
			if (map === undefined) {
				map = new Map();
				inlinePushOriginals.set(node, map);
			}
			const known = map.get(property);
			if (known !== undefined) return known;
			const saved = {
				property,
				value: node.style.getPropertyValue(property),
				priority: node.style.getPropertyPriority(property),
			};
			map.set(property, saved);
			return saved;
		}
		/** 把写入过的内联属性还原成首次改写前的值；当前值已被宿主或他人改过时不覆盖。 */
		function restoreInlinePush(node, writes) {
			if (node === null || node === undefined) return;
			for (const [property, value] of writes) {
				if (node.style.getPropertyValue(property) !== value) continue;
				const saved = rememberInlineOriginal(node, property);
				if (saved.value === "") node.style.removeProperty(property);
				else node.style.setProperty(property, saved.value, saved.priority);
			}
		}
		/**
		 * v0.16.1：解析「会话正文容器」（让位时要收窄的那个节点）。
		 *
		 * 旧实现直接用 `scrollEl.parentElement` 当正文容器，这在旧版 DSH 成立——
		 * 那时 [data-conversation-scroll] 是正文容器的**直接子元素**。DSH 0.2.2-rc.2 起，
		 * 宿主在两者之间插入了新的包装层（实测为 div.QwyHXq_layer + div[data-slot="conversation.hero.frame"]），
		 * parentElement 于是命中包装层，让位写到了错误的节点上：
		 * 正文/输入框都不左移、与 HUD 面板重叠，而滚动容器的右缘补偿却照常生效。
		 *
		 * 现在改为「向上找最近的 [data-conversation-content]」：
		 *   - 新版：命中真正的正文容器（滚动容器的祖先，中间隔几层都不影响）；
		 *   - 旧版：滚动容器的父节点本身就是正文容器，结果与旧实现一致（向后兼容）；
		 *   - 兜底：万一属性被改名，退回 parentElement，保持既有行为而不是完全不让位。
		 * @param scrollEl 会话滚动容器（[data-conversation-scroll]）。
		 * @returns 正文容器；滚动容器不存在时返回 null。
		 */
		function resolveConversationBody(scrollEl) {
			if (scrollEl === null || scrollEl === undefined) return null;
			if (typeof scrollEl.closest === "function") {
				const body = scrollEl.closest("[data-conversation-content]");
				if (body !== null && body !== undefined) return body;
			}
			return scrollEl.parentElement ?? null;
		}
		/**
		 * 给 HUD 面板让位时，正文容器被加了对应侧的外边距；滚动条是该容器的子元素
		 * （[data-conversation-scroll]）自己的，于是也被挤到面板边缘。这里把滚动容器向
		 * 面板的对侧补回面板宽度，并用等量 padding 守住内容宽度：
		 *   - 右侧面板：补右缘（margin-right 负值 / padding-right 正值），滚动条停在窗口最右侧；
		 *   - 左侧面板（v0.18.2）：补左缘（margin-left 负值 / padding-left 正值），滚动条仍在
		 *     窗口右侧（滚动条属于滚动容器，与占位侧无关），正文仍停在面板右侧不重叠。
		 * 不改变正文容器的既有变量与测量，也就不会挪动会话页右缘的「轮次导航」指示条。
		 * @param scrollEl 会话滚动容器（[data-conversation-scroll]）。
		 * @param side 面板侧位（"left" | "right"），缺省按右侧（历史行为）。
		 * @returns 本次写入的「属性 → 值」；调用方登记到 pushWrites，卸载时按归属还原。
		 */
		function pushScrollContainer(scrollEl, side = "right") {
			const writes = new Map();
			if (scrollEl === null || scrollEl === undefined || !scrollEl.style) return writes;
			for (const property of SCROLL_PUSH_PROPS) rememberInlineOriginal(scrollEl, property);
			const margin = `${-PANEL_WIDTH}px`;
			const padding = `${PANEL_WIDTH}px`;
			const marginProp = side === "left" ? "margin-left" : "margin-right";
			const paddingProp = side === "left" ? "padding-left" : "padding-right";
			if (scrollEl.style.getPropertyValue(marginProp) !== margin) scrollEl.style.setProperty(marginProp, margin);
			if (scrollEl.style.getPropertyValue(paddingProp) !== padding) scrollEl.style.setProperty(paddingProp, padding);
			writes.set(marginProp, margin);
			writes.set(paddingProp, padding);
			return writes;
		}
		/**
		 * v0.15.16：给「输入框浮层视图」的 composer 座位补写面板侧收窄。
		 *
		 * 背景：常规对话视图的 composerSeat 是文档流内的 sticky 元素，宽度受滚动容器的
		 * padding 约束，HUD 让位天然生效。但「轨迹」「统计」等视图的根节点带
		 * `data-conversation-composer-overlay`，宿主的规则把座位改成
		 * `position:absolute; left:0; right:var(--dsh-scrollbar-width); bottom:0`：
		 * 绝对定位元素按 padding box 解析，滚动容器的 padding 完全不起作用，于是
		 * 座位宽度仍是「窗口宽 − 滚动条」，而滚动容器又被 HUD 拉回窗口边缘 ——
		 * 输入框实打实地横跨到面板下方。
		 *
		 * 修复：只在该浮层视图存在时，给座位写面板侧的 `margin`（300px）。绝对定位元素同时
		 * 指定 left/right 时，margin 直接参与可用宽度计算，能精确减掉面板宽度；不覆写宿主的
		 * `left/right`，保留它自己的滚动条补偿，也避免与宿主后续版本改动打架。
		 * 常规对话视图（无该属性）一律不写，避免与 sticky 布局叠加造成双重收窄。
		 * @param scrollEl 会话滚动容器（[data-conversation-scroll]）。
		 * @param side 面板侧位（"left" | "right"），缺省按右侧（历史行为）。
		 * @returns 本次写入的「属性 → 值」；调用方登记到 pushWrites，卸载时按归属还原。
		 */
		function pushComposerSeat(scrollEl, side = "right") {
			const writes = new Map();
			if (scrollEl === null || scrollEl === undefined || typeof scrollEl.querySelector !== "function") return writes;
			// 只有「输入框浮层」视图才需要：常规对话视图的 sticky 座位已由滚动容器 padding 收窄。
			if (scrollEl.querySelector(COMPOSER_OVERLAY_SELECTOR) === null) return writes;
			const seat = scrollEl.querySelector(COMPOSER_SEAT_SELECTOR);
			if (seat === null || seat === undefined || !seat.style) return writes;
			for (const property of COMPOSER_SEAT_PUSH_PROPS) rememberInlineOriginal(seat, property);
			const margin = `${PANEL_WIDTH}px`;
			const prop = side === "left" ? "margin-left" : "margin-right";
			if (seat.style.getPropertyValue(prop) !== margin) seat.style.setProperty(prop, margin);
			writes.set(prop, margin);
			return writes;
		}
		// 菜单可隐藏的模块（会话模块恒展示）
		const MODULE_KEYS = ["context", "balance", "outputs", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"];
		// v0.18.2：「用量设置」的字段（三行数据 + 「跳转」按钮开关），与 host lib/settings.js 保持一致。
		const USAGE_SETTING_KEYS = ["deepseek", "opencode", "codex", "showJump"];

		// 输入法选词期间的 Enter / Escape 属于候选窗口，不能触发 HUD 的提交或取消操作。
		// 同时记录输入控件的 composition 状态，兼容 React 包装事件和缺少 isComposing 的环境。
		const composingInputs = new WeakSet();
		const IME_INPUT_PROPS = {
			onCompositionStart: (event) => { composingInputs.add(event.currentTarget); },
			onCompositionEnd: (event) => { composingInputs.delete(event.currentTarget); },
			onBlur: (event) => { composingInputs.delete(event.currentTarget); },
		};
		function isImeComposing(event) {
			const nativeEvent = event.nativeEvent;
			// 229 是旧式 IME 键码；compositionend 先于确认键 keydown 时仍需忽略该确认键。
			return event.isComposing === true || nativeEvent?.isComposing === true
				|| event.keyCode === 229 || nativeEvent?.keyCode === 229
				|| composingInputs.has(event.target);
		}

		const zh = {
			hudLabel: "HUD面板",
			hudOpen: "展开 HUD 面板",
			hudClose: "收起 HUD 面板",
			hudNewSessionOpen: "展开 HUD 面板（新建会话）",
			statusIdle: "空闲中",
			statusRunning: "任务中",
			statusApproval: "待审批",
			statusAnswer: "待回答",
			statusSubagents: "等待子任务",
			workspaceFallback: "未命名工作区",
			contextModule: "上下文",
			contextCompress: "压缩",
			contextOccupancy: "{used} / {limit}（{percent}%）",
			contextStatsTitle: "会话统计",
			contextStatsLlmTime: "模型用时",
			contextStatsToolTime: "工具调用用时",
			contextStatsTtft: "首 token 平均（TTFT）",
			contextStatsTps: "输出速度（TPS）",
			contextStatsCounts: "{turns} 轮 {steps} 步",
			contextStatsCountsSpeed: "{turns} 轮 {steps} 步 · {tps} tok/s",
			contextUsageTitle: "Token 用量",
			contextUsageCacheHit: "缓存命中",
			contextUsageUncached: "未缓存输入",
			contextUsageCacheRead: "缓存读取",
			contextUsageCacheWrite: "缓存写入",
			contextUsageOutput: "输出",
			contextUsageLine: "{total} tok · 缓存命中 {percent}%",
			contextUsageLineNoCache: "{total} tok",
			contextDurationSeconds: "{seconds} 秒",
			contextDurationMinutes: "{minutes} 分 {seconds} 秒",
			settingsContextTitle: "「上下文」模块设置",
			settingsContextBarStyle: "始终显示分段进度条",
			settingsContextStats: "显示「会话统计」",
			settingsContextUsage: "显示「Token 用量」",
			// v0.18.7：上下文模块固定在会话模块下方（仅在它是模块排序首位时可开启）
			settingsContextPin: "上下文模块位置固定",
			settingsContextStatsHint: "在进度条下方展示会话轮/步与 tok/s",
			settingsContextUsageHint: "在进度条下方展示 Token 总量与缓存命中",
			settingsContextBarStyleHint: "默认单色，开启后始终显示分段进度条",
			settingsContextPinHint: "固定在面板顶部，不随滚动区移动",
			settingsContextPinOrder: "上下文模块不在模块排序首位，暂不可开启",
			settingsContextPinHidden: "上下文模块已隐藏，无需固定",
			contextCompressing: "压缩中…",
			contextCompressed: "压缩完成",
			contextBusy: "会话正在运行，无法压缩",
			contextFailed: "压缩失败：{detail}",
			contextUnavailable: "压缩服务不可用",
			settingsSaveFailed: "设置保存失败：{detail}",
			settingsOpenFailed: "无法打开账户设置，请从账号菜单进入设置",
			gitModule: "git 变更",
			outputsModule: "产物",
			outputsLimitHint: "仅展示最近改动的 {limit} 个文件。",

			outputsExpandRest: "展开其余 {count} 个文件",
			plansExpandRest: "展开其余 {count} 条计划",
			subagentsExpandRest: "展开其余 {count} 个子代理",
			listCollapse: "收起",
			outputsOpenFailed: "无法在右侧栏打开该文件。",
			gitGraph: "git graph",
			gitSummary: "{modified} 修改 · {added} 新增 · {deleted} 删除 · {untracked} 未跟踪",
			gitChangedCount: "{count}",
			gitGraphFailed: "git graph 加载失败",
			graphLoading: "加载中…",
			graphEmpty: "当前仓库还没有任何提交",
			graphFilesNone: "无文件变更",
			graphLoadMore: "加载更多",
			graphLoadingMore: "加载下一页…",
			graphAllLoaded: "已显示全部提交",
			graphRetry: "重试",
			copyShortHash: "复制短哈希",
			copyFullHash: "复制完整哈希",
			copyMessage: "复制提交信息",
			copiedShortHash: "已复制短哈希",
			copiedFullHash: "已复制完整哈希",
			copiedMessage: "已复制提交信息",
			copyFailed: "复制失败：{detail}",
			gitMergeToCurrent: "合并至当前分支",
			gitMergeDone: "已合并「{commit}」至当前分支",
			gitMergeUpToDate: "该提交已包含在当前分支，无需合并",
			gitMergeLocalChanges: "本地修改将阻止合并：{files}（请先提交或暂存）",
			gitMergeConflict: "合并冲突，已自动回滚：{files}",
			gitMergeFailed: "合并失败：{detail}",
			gitBranchCreateHere: "从此处创建分支",
			gitBranchCreatedHere: "已从 {commit} 创建并切换到分支「{branch}」",
			gitBranchCreateBlocked: "Git 操作进行中，暂不能创建分支",
			gitResetSoft: "reset(soft)-保留暂存",
			gitResetMixed: "reset(mix)-取消暂存",
			gitResetHard: "reset(hard)-撤回更改",
			gitResetConfirm: "确认？",
			gitResetCancel: "取消",
			gitResetChecking: "正在检查重置条件…",
			gitResetCheckFailed: "无法检查重置条件",
			gitResetCurrentHead: "当前版本无需回退",
			gitResetNotCurrentAncestor: "仅可重置到当前分支历史中的提交",
			gitResetDetachedHead: "当前未检出本地分支，无法重置分支",
			gitResetOperationInProgress: "请先完成或中止当前 Git 操作",
			gitResetHardWarning: "将撤回已跟踪文件的未提交修改；未跟踪文件不会被删除",
			gitResetSoftDone: "已以 reset --soft 回退至 {commit}",
			gitResetMixedDone: "已以 reset --mixed 回退至 {commit}",
			gitResetHardDone: "已以 reset --hard 回退至 {commit}",
			gitResetFailed: "重置失败：{detail}",
			sessionRename: "重命名",
			sessionRenameDone: "已重命名",
			sessionRenameFailed: "重命名失败：{detail}",
			sessionRenameUnavailable: "会话服务不可用，无法重命名",
			// v0.18.1：工作区/会话标题悬浮菜单与内联改名
			workspaceMenuLabel: "工作区操作",
			workspaceMenuRename: "重命名工作区",
			workspaceMenuRevealFinder: "在 Finder 中显示",
			workspaceMenuRevealExplorer: "在资源管理器中显示",
			workspaceMenuRevealFolder: "在文件夹中显示",
			workspaceMenuCopyPath: "复制工作区路径",
			workspaceRenameTitle: "重命名工作区",
			workspaceRenameDone: "工作区已重命名",
			workspaceRenameFailed: "重命名工作区失败：{detail}",
			workspaceRenameUnregistered: "当前目录未注册为工作区，无法重命名",
			workspaceRenameServiceDown: "工作区服务不可用，无法重命名",
			workspaceRenameConflict: "工作区名称「{name}」已被占用",
			workspacePathMissing: "当前工作区没有可用路径",
			revealUnavailable: "宿主环境不支持打开本地文件管理器",
			revealFailed: "无法显示文件位置：{detail}",
			copiedWorkspacePath: "已复制工作区路径",
			sessionMenuLabel: "会话操作",
			sessionMenuPin: "置顶会话",
			sessionMenuUnpin: "取消置顶",
			sessionMenuRename: "重命名",
			sessionMenuFork: "分支会话",
			sessionMenuCopyId: "复制会话 ID",
			sessionMenuCopyName: "复制会话名称",
			sessionMenuArchive: "归档会话",
			sessionPinDone: "已置顶会话",
			sessionUnpinDone: "已取消置顶",
			sessionPinFailed: "置顶操作失败：{detail}",
			sessionPinUnavailable: "会话服务不可用，无法置顶",
			sessionPinArchived: "会话已归档，无法置顶",
			sessionForkDone: "已创建分支会话",
			sessionForkFailed: "分支会话失败：{detail}",
			sessionForkNeedsOpen: "该会话需要迁移后才能分支，请先打开它",
			sessionForkUnavailable: "会话服务不可用，无法分支",
			sessionArchiveDone: "已归档会话",
			sessionArchiveFailed: "归档会话失败：{detail}",
			sessionArchiveUnavailable: "会话服务不可用，无法归档",
			sessionArchiveArchived: "会话已归档",
			copiedSessionId: "已复制会话 ID",
			copiedSessionName: "已复制会话名称",
			subagentsModule: "子代理任务",
			subagentRunning: "执行中",
			subagentDone: "已完成",
			subagentOpenFailed: "无法打开子代理会话",
			tasksModule: "任务",
			tasksExpandDone: "展开已完成任务",
			taskDone: "已完成",
			taskTodo: "待完成",
			mcpModule: "MCP",
			mcpNone: "未接入 MCP 服务",
			mcpToggleFailed: "MCP 切换失败：{detail}",
			settingsTitle: "HUD 设置",
			settingsModules: "展示模块",
			settingsPanelTitle: "HUD面板通用设置",
			// v0.20.0：「HUD 面板样式」（卡片 / 边栏），位于「HUD 面板展开位置」上方，默认卡片样式。
			settingsPanelStyle: "HUD 面板样式",
			settingsPanelStyleCard: "卡片样式",
			settingsPanelStyleSidebar: "边栏样式",
			settingsPanelStyleHint: "卡片样式悬浮于页面之上；边栏样式通高贴边，用一条分隔线区分",
			settingsPanelSide: "HUD 面板展开位置",
			settingsPanelSideLeft: "左侧",
			settingsPanelSideRight: "右侧",
			settingsPanelSideHint: "面板显示在正文的左侧或右侧，正文与输入框同步让位",
			settingsPanelNewSessionOpen: "新建会话页默认展示",
			settingsPanelNewSessionOpenHint: "每次进入新建会话页都按此值初始化",
			settingsPanelChatOpen: "聊天会话页默认展示",
			settingsPanelChatOpenHint: "仅影响还没有开合记忆的会话",
			settingsUsageTitle: "「用量」模块设置",
			settingsUsageDeepseek: "DeepSeek 余额",
			settingsUsageOpencode: "OpenCode Go 用量",
			settingsUsageCodex: "codex额度",
			settingsUsageJump: "展示「跳转」按钮",
			settingsUsageDeepseekHint: "显示 DeepSeek 账户余额",
			settingsUsageOpencodeHint: "显示 OpenCode Go 的 5h/1w/1m 用量",
			settingsUsageCodexHint: "显示 Codex 账户的剩余额度",
			settingsUsageJumpHint: "在「用量」标题右侧显示「跳转」按钮",
			settingsUsageOpencodeMissing: "需安装并启用 dsh-account-usage",
			settingsUsageOpencodeUnconfigured: "未配置 OpenCode Go 密钥或订阅已失效",
			settingsUsageCodexMissing: "需安装并登录 dsh-codex-subscription",
			settingsCancel: "取消",
			settingsConfirm: "保存设置",
			settingsReset: "恢复默认",
			settingsDrag: "拖动排序",
			settingsDragHint: "拖动手柄排序（从上到下即面板顺序）",
			settingsModuleLocked: "新建会话页不展示该模块，开关在会话页修改",
			settingsHostOutdated: "宿主半未更新：面板位置与默认开合暂未持久化，重启 DSH 后生效",
			// —— v0.18.5：「使用说明」标签页（按模块分节，中英成对维护）；
			//     v0.19.0 起文案按 ASD-STE100 重写：一句一动作、祈使句写指令、无括号与分号 ——
			settingsGuideTab: "使用说明",
			guideKindShow: "展示",
			guideKindAct: "功能",
			guideKindSet: "设置",
			guidePanelTitle: "HUD 面板",
			guidePanelEntry: "点击会话页右上角的「HUD面板」，开合面板。新建会话页使用同位置的悬浮按钮。",
			guidePanelSide: "面板默认在会话区右侧展开，也可以在左侧展开。面板展开时，正文与输入框让出位置。",
			// v0.20.0：面板样式（卡片 / 边栏）——边栏样式靠分隔线与正文区分。
			guidePanelStyle: "在「HUD面板通用设置」里选择卡片样式或边栏样式。默认卡片样式。边栏样式去掉圆角卡片，改用分隔线区分面板与正文。",
			guidePanelMemory: "开合状态按会话保存。新建会话页默认收起。默认值可在「HUD面板通用设置」里修改。",
			guidePanelSidebar: "右侧栏展开期间，面板临时隐藏。右侧栏关闭后，面板自动恢复。",
			guidePanelNewSession: "新建会话页只展示六个模块。六个模块是会话、用量、git、便笺、待办与 MCP。",
			guidePanelFold: "点击模块标题可折叠或展开。「会话」与「上下文」以外的模块都支持。折叠状态刷新后保持。",
			guidePanelSettingsEntry: "点击「会话」模块右上角的齿轮，打开「HUD 设置」。顶部「使用说明」打开本页。",
			guidePanelSettingsLayout: "左栏勾选模块，控制模块显隐。拖动卡片手柄可排序，从上到下就是面板顺序。",
			guidePanelSettingsCards: "右栏有三张卡片。卡片依次是面板通用设置、上下文模块设置与用量模块设置。",
			guidePanelSettingsSave: "有改动时「恢复默认」可点。「确认」保存并关闭。取消、Esc 与关闭都不保存。",
			guidePanelSettingsLocked: "在新建会话页打开设置时，该页不展示的四个模块置灰。开关按真实状态显示，但不能修改。",
			guideSessionTitle: "会话模块",
			guideSessionShowNames: "工作区名称、会话名称与会话状态。状态有任务中、待审批、待回答、等待子任务与空闲中。",
			guideSessionShowModel: "模型提供商、模型名与推理等级。",
			guideSessionWorkspaceMenu: "点击工作区名称，打开菜单。菜单项有重命名、在文件管理器中显示与复制路径。",
			guideSessionSessionMenu: "点击会话名称，打开菜单。菜单项有置顶、重命名、分支会话、复制 ID、复制名称与归档。",
			guideSessionRename: "选择「重命名」后，名称原位变为输入框。按 Enter 保存，按 Esc 取消。点击其他位置也会保存。",
			guideSessionNewPage: "新建会话页不显示会话标题与状态徽标。",
			guideContextTitle: "上下文模块",
			guideContextShowBar: "占用进度条用颜色表示占用率。0% 到 40% 为绿色，40% 到 90% 为黄色，超过 90% 为红色。",
			guideContextShowRatio: "标题右侧显示当前占用与最大上下文，并显示占用率。点标题行可折叠模块。再点一次展开。",
			guideContextShowLines: "底部有两行信息。第一行是会话统计：轮数、步数与 tok/s。第二行是 Token 用量：总量与缓存命中。",
			guideContextHoverBar: "鼠标悬浮在进度条上，进度条改为分段样式。分段表示 System prompt、Tool definitions 与 Messages。",
			guideContextHoverLines: "鼠标悬浮在两行上，显示完整统计与用量明细。",
			guideContextCompress: "会话空闲时「压缩」可点。任务进行中「压缩」置灰。",
			guideUsageTitle: "用量模块",
			guideUsageShowDeepseek: "DeepSeek 余额。余额始终展示，没有数据时显示 —。",
			guideUsageShowOpencode: "OpenCode Go 三个窗口的用量百分比。",
			guideUsageShowCodex: "codex 额度。已订阅时显示 5 小时与每周额度，未订阅时显示免费额度。有 gpt-reserve 额度时追加一行。",
			guideUsageClick: "点击余额或百分比，打开对应的设置页。",
			guideUsageJump: "点击模块头部的「跳转」，打开用量网页菜单。",
			guideGitTitle: "git 模块",
			guideOutputsTitle: "产物模块",
			guideOutputsShowList: "本会话改动过的文档、表格、演示与图片，包含终端命令的改动。没有产物时模块不显示。",
			guideOutputsShowOrder: "按最后一次改动排序，最多展示 10 个文件。默认先显示 3 个文件，可展开查看全部。默认在「git」上方。",
			// v0.20.0：文件行悬停提示（0.5 秒后显示文件名与完整路径）。
			guideOutputsHover: "鼠标在文件行上停留 0.5 秒，显示文件的完整相对路径。",
			guideOutputsOpen: "点击文件，在右侧栏打开文件内容。",
			guideOutputsScope: "只列工作区内、仍存在的文件。重启 DSH 后同样保留。",
			guideGitShowBranch: "当前分支与变更文件数量。",
			guideGitShowFiles: "变更文件分为已暂存与未暂存两组。组名右侧是文件数量。每行先显示状态字母，再显示文件名与灰色相对目录。",
			guideGitBranch: "点击分支按钮，可切换或新建分支。工作区不是仓库时，按钮显示「初始化仓库」。",
			guideGitDiff: "左键点击文件，在右侧栏打开 diff。右键点击文件，可暂存或撤销。",
			guideGitCommit: "点击「commit」，提交暂存区。点击「AI generate」，按提交规范生成提交信息。",
			// v0.20.0：commit 弹窗内的 AI 生成提示词。
			guideGitPrompt: "提交弹窗顶部可展开 AI 生成提示词。编辑后保存，generate 使用新提示词，不再补日期前缀与版本号。可恢复默认提示词。",
			guideGitRevert: "点击「revert」，撤销全部未暂存变更。未跟踪文件一并删除。操作前需要二次确认。",
			guideGitGraph: "点击「git graph」，查看提交列表。右键点击提交，可复制、建分支、合并或 reset。",
			guideSubagentsTitle: "子代理任务模块",
			guideSubagentsShowList: "当前会话的全部子代理，按层级缩进。超过 3 个时先显示 3 个。",
			guideSubagentsShowState: "执行中的子代理为黄色，已完成的为绿色。",
			guideSubagentsOpen: "点击条目，在官方右侧栏打开该子代理会话。主会话保持打开。",
			guideSubagentsOnly: "仅在存在子代理时展示模块。",
			guideTasksTitle: "任务模块",
			guideTasksShowList: "待办任务列表与完成状态。进行中的任务带旋转图标。已完成的任务收在列表下方，可展开查看。",
			guideTasksShowCount: "底部显示已完成、进行中与待处理的数量。",
			guideTasksLive: "任务变化时，列表自动刷新。",
			guideTasksOnly: "仅在存在任务时展示模块。",
			guidePlansTitle: "计划清单模块",
			guidePlansShowList: "plan 模式产出的计划。待审批为黄色，已执行为绿色，已废弃为灰色并带删除线。超过 3 个时先显示 3 个。",
			guidePlansShowCount: "底部显示三种状态的数量。",
			guidePlansOpen: "点击任意一行，查看计划全文。全文按 Markdown 渲染。",
			guidePlansOnly: "仅在存在计划记录时展示模块。",
			guideMcpTitle: "MCP 模块",
			guideMcpShowList: "已接入的 MCP 服务与全局启停状态。",
			guideMcpToggle: "点击开关立即启停，不需要刷新页面。",
			guideMcpScope: "只影响目标服务。部分环境需要重启 DSH 后才生效。",
			guideNoteTitle: "便笺模块",
			guideNoteShowShared: "多条便笺按工作区共享。同一工作区目录下的所有会话共用同一组便笺。",
			guideNoteShowCount: "每条便笺单独保存标题与文字。便笺不限制字数，图片最多 20 张。",
			guideNoteFold: "折叠状态刷新后保持。",
			guideNoteList: "便笺条列表展示全部便笺。鼠标悬停在便笺条上时，显示编辑与删除按钮。",
			guideNoteDrag: "按住便笺条左侧的拖动条，可调整便笺顺序。",
			guideNoteCreateFromChat: "点击「从聊天创建」，用输入框的文字与图片新建便笺。",
			guideNoteAdd: "点击「添加便笺」，新建空白便笺并进入编辑视图。",
			guideNoteDeleteAll: "删除单条便笺需要二次确认。点击「删除全部便笺」可删除全部便笺，同样需要确认。",
			guideNoteEdit: "点击编辑按钮进入编辑视图。点击返回按钮回到便笺列表。在编辑视图可修改标题，标题为空时自动生成。",
			guideNoteImages: "在编辑视图可直接粘贴图片。按住缩略图左右拖动可调整图片顺序。",
			guideNoteResize: "拖动输入框底部的手柄可调整高度。所有便笺共用同一高度。",
			guideNoteImport: "点击「从聊天导入」，先清空便笺的文字与图片。再写入会话输入框的文字与图片，图片以外的附件跳过。便笺不为空时先确认。",
			guideNoteSend: "点击「添加至聊天」，先清空会话输入框的文字与图片。再写入便笺内容，图片按便笺顺序加入。会话输入框不为空时先确认。",
			guideNoteClear: "点击「清空」，需要二次确认。确认后同时清除文字与图片。内容为空时「清空」置灰。",
			guideNoteImportEnabled: "输入框有内容时，「从聊天创建」与「从聊天导入」才可点。",
			guideNoteLimit: "在 HUD 设置 → 便笺 中可调整便笺条数上限。范围为 5–20，默认 5。",
			guideTodoTitle: "待办模块",
			guideTodoShowShared: "待办按工作区共享。同一工作区目录下的会话共用一份清单与顺序。",
			guideTodoShowCount: "标题显示已完成数量。已完成的待办收在下方，可展开查看。",
			guideTodoCheck: "勾选条目即标记完成。取消勾选即恢复。",
			guideTodoEdit: "在输入框里输入内容，按 Enter 新增条目。鼠标悬浮条目时，才显示编辑与删除按钮。",
			guideTodoDrag: "拖动行最左侧的手柄，可调整顺序。手柄热区覆盖整行高度。松手后保存顺序。",
			guideTodoClear: "点击「清空已完成」，需要二次确认。没有已完成项时按钮置灰。",
			guideTodoFold: "折叠状态刷新后保持。",
			balanceModule: "用量",
			balanceTotal: "DeepSeek 余额",
			balanceJump: "跳转",
			jumpDeepseek: "deepseek",
			jumpOpencode: "opencode go",
			balanceLoadFailed: "余额获取失败",
			usageEmptyHint: "暂无用量数据：登录 DeepSeek 账号可查看余额；安装并启用 dsh-account-usage 可查看 OpenCode Go 用量；安装并登录 dsh-codex-subscription 可查看 Codex 额度。",
			valueOpenDeepseek: "打开设置 → 账号与余额 → deepseek",
			valueOpenOpencode: "打开设置 → 账号与余额 → opencode go",
			valueOpenCodex: "打开设置：Codex 订阅",
			codexFiveHour: "codex 5h额度",
			codexWeekly: "codex 周额度",
			codexFreeQuota: "codex 免费额度",
			codexReserve: "codex gpt-reserve额度",
			codexReserveNamed: "codex gpt-reserve额度（{name}）",
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
			gitRevertAllConfirm: "将撤销 {count} 个未暂存变更：已跟踪文件的变更将被还原，未跟踪新建文件将被删除；暂存区不受影响。此操作不可恢复。",
			gitRevertAllStagedNote: "暂存区中的 {count} 个文件不会被撤销；如需撤销它们，请先移除暂存（remove from stage）再执行 revert。",
			gitRevertFileTitle: "撤销该文件的变更？",
			gitRevertFileUntracked: "「{path}」为新建文件，撤销将删除该文件，此操作不可恢复。",
			gitRevertFileIntentToAdd: "「{path}」为预登记（intent-to-add）的新文件，撤销将删除该文件，此操作不可恢复。",
			gitRevertFileTracked: "将还原「{path}」的未暂存变更。",
			gitRevertFileStagedPartial: "该文件在暂存区已有内容：本次只还原未暂存部分，文件与暂存内容都会保留。",
			gitAffectedFiles: "受影响文件（{count}）",
			gitCancel: "取消",
			gitConfirmDanger: "确认撤销",
			gitConfirmDelete: "确认删除",
			gitCommitTitle: "commit",
			gitCommitSummary: "将提交 {count} 个暂存文件",
			gitCommitPlaceholder: "输入提交信息",
			gitAiGenerate: "generate",
			gitAiGenerating: "生成中…",
			gitAiConfirm: "确认？",
			gitAiConfirmHint: "将调用 DeepSeek 官方 DeepSeek Flash 系列模型（effort: low）生成提交信息，不使用当前会话模型。",
			// v0.20.0：Git commit 弹窗顶部的「AI 生成提示词」区域。
			gitPromptTitle: "AI 生成提示词",
			gitPromptCustom: "已自定义",
			gitPromptHint: "仅影响「generate」生成的提交信息；暂存区 diff 由插件自动附加。自定义后不再补默认的日期前缀与版本号。",
			gitPromptPlaceholders: "可用占位符：{{spec}} 提交规范、{{today}} 当天日期、{{project}} 项目与版本、{{sessionContext}} 会话上下文",
			gitPromptSave: "保存",
			gitPromptRestore: "恢复默认",
			gitPromptSaved: "已保存提示词",
			gitPromptRestored: "已恢复默认提示词",
			gitPromptLoadFailed: "提示词加载失败：{detail}",
			gitPromptSaveFailed: "提示词保存失败：{detail}",
			gitPromptNotPersistent: "宿主半未更新：提示词仅在本次运行内有效，重启 DSH 后失效",
			gitCommitEmpty: "请输入提交信息",
			gitCancelOrCommit: "取消",
			gitConfirmCommit: "commit",
			gitStageDone: "已暂存「{path}」",
			gitStageAllTitle: "暂存全部未暂存文件",
			gitStageAllDone: "已暂存 {count} 个文件",
			gitUnstageAllTitle: "取消暂存全部暂存文件",
			gitUnstageAllDone: "已取消暂存 {count} 个文件",
			gitUnstageDone: "已取消暂存「{path}」",
			gitRevertDone: "已撤销「{path}」的变更",
			gitRevertAllDone: "已撤销 {count} 个文件的未暂存变更",
			gitRevertAllDoneWithStaged: "已撤销 {count} 个文件的未暂存变更；{staged} 个已暂存文件未受影响",
			gitRevertSkipped: "有 {count} 个条目无法通过 revert 撤销（嵌套仓库/子模块或权限限制）：{paths}；请手动处理。",
			gitStagedHint: "已暂存文件不会被 revert 撤销；如需撤销请先移除暂存。",
			gitDiffUnavailable: "无法打开右侧 git diff：需要安装并启用 dsh-better-sidebar",
			gitDiffOpenFailed: "打开 git diff 失败：{detail}",
			gitCommitDone: "提交成功",
			gitOperationFailed: "操作失败：{detail}",
			gitAiFailed: "提交信息生成失败：{detail}",
			gitAiVersionWarn: "已生成并填入提交信息，但版本号可能未按规范递增，请核对后手动调整",
			gitBranchSwitch: "切换分支",
			gitBranchLoading: "加载中…",
			gitBranchEmpty: "当前仓库暂无本地分支",
			gitBranchListFailed: "获取分支列表失败：{detail}",
			gitBranchSwitched: "已切换到分支「{branch}」",
			gitBranchAlreadyOn: "当前已在分支「{branch}」",
			gitBranchFailed: "切换分支失败：{detail}",
			gitBranchConflict: "切换分支失败：以下文件的本地变更会阻止切换：{files}。请先处理这些变更（提交/暂存/移动或删除）后再试。",
			gitBranchAdd: "添加分支",
			gitBranchAddPlaceholder: "新分支名称…",
			gitBranchAddConfirm: "添加",
			gitBranchCreated: "已创建并切换到分支「{branch}」",
			gitBranchCreateFailed: "添加分支失败：{detail}",
			gitInitRepo: "初始化仓库",
			gitInitRepoTitle: "在当前工作区初始化 git 仓库",
			gitInitDone: "已初始化 git 仓库",
			gitInitFailed: "初始化仓库失败：{detail}",
			gitNoRepo: "当前工作区不是 git 仓库",
			noteModule: "便笺",
			notePlaceholder: "在这里随手记录…",
			noteClear: "清空",
			noteClearConfirm: "确认?",
			noteClearFailed: "清空失败：无法保存便笺",
			noteSendToChat: "添加至聊天",
			noteSendFailed: "添加失败：无法访问当前会话输入框",
			noteSendTargetMissing: "添加失败：当前工作区没有可用的会话",
			noteSendBusy: "添加失败：会话正在发送中，请稍后再试",
			// v0.19.0：便笺图片、从聊天导入与覆盖确认
			noteImageLimit: "便笺最多保存 {count} 张图片",
			noteImageRemove: "移除这张图片",
			noteImagePreview: "查看大图",
			noteImageStorageUnavailable: "当前环境无法持久化图片，图片只在本次会话内保留",
			noteImageUnavailable: "当前 DSH 版本不支持把图片加入输入框，已只写入文字",
			noteImportFromChat: "从聊天导入",
			noteImportEmpty: "会话输入框里没有可导入的内容",
			noteImportConfirm: "将先清空便笺里的文字与图片，再写入会话输入框的内容",
			noteImportSkippedFiles: "已跳过 {count} 个非图片附件",
			noteAddOverwriteConfirm: "将先清空会话输入框里的文字与图片，再写入便笺内容",
			noteConfirmOverwrite: "清空并写入",
			// v0.20.0：多便笺（列表视图 / 编辑视图 / 条数上限）。
			noteDefaultTitle: "便笺{count}",
			noteUntitled: "未命名便笺",
			noteEmpty: "还没有便笺，点「添加便笺」新建。",
			noteAdd: "添加便笺",
			noteCreateFromChat: "从聊天创建",
			noteDeleteAll: "删除全部便笺",
			noteDeleteAllTitle: "删除全部便笺",
			noteDeleteAllNote: "将删除全部 {count} 条便笺及其图片，此操作不可撤销。",
			noteDeleteAllConfirm: "删除全部",
			noteDeleteTitle: "删除便笺",
			noteDeleteNote: "将删除「{title}」及其图片，此操作不可撤销。",
			noteDeleteConfirm: "删除",
			noteDelete: "删除便笺",
			noteEdit: "编辑便笺",
			noteBack: "返回便笺列表",
			noteDrag: "拖动排序",
			noteTitlePlaceholder: "便笺标题",
			noteStorageUnavailable: "保存失败：无法写入本地存储",
			noteLimitReached: "便笺数量已达上限 {count} 条，请在 HUD 设置中调整",
			noteCapRejected: "无法保存：工作区「{workspaces}」的便笺数量超过上限 {count}",
			settingsNoteTitle: "「便笺」模块设置",
			settingsNoteMax: "便笺条数上限",
			settingsNoteMaxHint: "5–20，默认 5",
			noteWorkspaceCount: "「{path}」（{count} 条）",
			noteWorkspaceSeparator: "、",
			noteWorkspaceMore: " 等 {count} 个工作区",
			todoModule: "待办",
			todoExpandDone: "展开已完成待办",
			todoPlaceholder: "添加待办事项…",
			todoCancel: "取消",
			todoConfirm: "确认",
			todoEdit: "编辑",
			todoDelete: "删除",
			todoMarkDone: "标记为已完成",
			todoMarkPending: "标记为待完成",
			todoClear: "清空已完成",
			todoClearTitle: "清空已完成待办",
			todoClearNote: "将清空当前待办列表中所有已完成的待办事项，此操作不可撤销。",
			todoClearConfirm: "清空",
			todoDrag: "拖动排序",
		};
		const en = {
			hudLabel: "HUD panel",
			hudOpen: "Open HUD panel",
			hudClose: "Close HUD panel",
			hudNewSessionOpen: "Open HUD panel (new session)",
			statusIdle: "Idle",
			statusRunning: "Running",
			statusApproval: "Awaiting approval",
			statusAnswer: "Awaiting answer",
			statusSubagents: "Waiting for subagents",
			workspaceFallback: "Untitled workspace",
			contextModule: "Context",
			contextCompress: "Compact",
			contextOccupancy: "{used} / {limit} ({percent}%)",
			contextStatsTitle: "Session stats",
			contextStatsLlmTime: "Model time",
			contextStatsToolTime: "Tool time",
			contextStatsTtft: "TTFT average",
			contextStatsTps: "Output speed (TPS)",
			contextStatsCounts: "{turns} turns · {steps} steps",
			contextStatsCountsSpeed: "{turns} turns · {steps} steps · {tps} tok/s",
			contextUsageTitle: "Token usage",
			contextUsageCacheHit: "Cache hit",
			contextUsageUncached: "Uncached input",
			contextUsageCacheRead: "Cache read",
			contextUsageCacheWrite: "Cache write",
			contextUsageOutput: "Output",
			contextUsageLine: "{total} tok · cache hit {percent}%",
			contextUsageLineNoCache: "{total} tok",
			contextDurationSeconds: "{seconds}s",
			contextDurationMinutes: "{minutes}m {seconds}s",
			settingsContextTitle: "\u201CContext\u201D module settings",
			settingsContextBarStyle: "Always show segmented bar",
			settingsContextStats: "Show session stats",
			settingsContextUsage: "Show token usage",
			// v0.18.7: keep the Context module pinned below the Session module (only when it is ordered first)
			settingsContextPin: "Pin the context module in place",
			settingsContextStatsHint: "Show turns/steps and tok/s below the bar",
			settingsContextUsageHint: "Show total tokens and cache hits below the bar",
			settingsContextBarStyleHint: "Single color by default; always show the segmented bar",
			settingsContextPinHint: "Keep the module pinned to the top of the panel",
			settingsContextPinOrder: "The Context module is not first in the module order",
			settingsContextPinHidden: "The Context module is hidden",
			contextCompressing: "Compacting…",
			contextCompressed: "Compaction complete",
			contextBusy: "Session is running; compaction unavailable",
			contextFailed: "Compaction failed: {detail}",
			contextUnavailable: "Compaction service unavailable",
			settingsSaveFailed: "Failed to save settings: {detail}",
			settingsOpenFailed: "Cannot open account settings; use the account menu to open Settings",
			gitModule: "Git changes",
			outputsModule: "Outputs",
			outputsLimitHint: "Only the {limit} most recent files are shown.",

			outputsExpandRest: "Show {count} more files",
			plansExpandRest: "Show {count} more plans",
			subagentsExpandRest: "Show {count} more subagents",
			listCollapse: "Collapse",
			outputsOpenFailed: "Cannot open this file in the right sidebar.",
			gitGraph: "git graph",
			gitSummary: "{modified} modified · {added} added · {deleted} deleted · {untracked} untracked",
			gitChangedCount: "{count}",
			gitGraphFailed: "Failed to load git graph",
			graphLoading: "Loading…",
			graphEmpty: "This repository has no commits yet",
			graphFilesNone: "No file changes",
			graphLoadMore: "Load more",
			graphLoadingMore: "Loading next page…",
			graphAllLoaded: "All commits loaded",
			graphRetry: "Retry",
			copyShortHash: "Copy short hash",
			copyFullHash: "Copy full hash",
			copyMessage: "Copy commit message",
			copiedShortHash: "Short hash copied",
			copiedFullHash: "Full hash copied",
			copiedMessage: "Commit message copied",
			copyFailed: "Copy failed: {detail}",
			gitMergeToCurrent: "Merge into current branch",
			gitMergeDone: "Merged {commit} into current branch",
			gitMergeUpToDate: "Commit already included in current branch",
			gitMergeLocalChanges: "Local changes block the merge: {files} (commit or stash first)",
			gitMergeConflict: "Merge conflict — auto-aborted: {files}",
			gitMergeFailed: "Merge failed: {detail}",
			gitBranchCreateHere: "Create branch here",
			gitBranchCreatedHere: "Created and switched to branch \"{branch}\" from {commit}",
			gitBranchCreateBlocked: "A Git operation is in progress, so a branch cannot be created now",
			gitResetSoft: "reset (soft) — keep staged",
			gitResetMixed: "reset (mixed) — unstage changes",
			gitResetHard: "reset (hard) — discard changes",
			gitResetConfirm: "Confirm?",
			gitResetCancel: "Cancel",
			gitResetChecking: "Checking reset availability…",
			gitResetCheckFailed: "Unable to check reset availability",
			gitResetCurrentHead: "Current commit does not need a reset",
			gitResetNotCurrentAncestor: "Only commits in the current branch history can be reset to",
			gitResetDetachedHead: "No local branch is checked out, so it cannot be reset",
			gitResetOperationInProgress: "Finish or abort the current Git operation first",
			gitResetHardWarning: "This discards uncommitted changes to tracked files; untracked files are kept",
			gitResetSoftDone: "Reset --soft to {commit}",
			gitResetMixedDone: "Reset --mixed to {commit}",
			gitResetHardDone: "Reset --hard to {commit}",
			gitResetFailed: "Reset failed: {detail}",
			sessionRename: "Rename",
			sessionRenameDone: "Session renamed",
			sessionRenameFailed: "Rename failed: {detail}",
			sessionRenameUnavailable: "Session service unavailable; cannot rename",
			// v0.18.1: workspace/session title hover menus and inline renaming
			workspaceMenuLabel: "Workspace actions",
			workspaceMenuRename: "Rename workspace",
			workspaceMenuRevealFinder: "Show in Finder",
			workspaceMenuRevealExplorer: "Show in File Explorer",
			workspaceMenuRevealFolder: "Show in folder",
			workspaceMenuCopyPath: "Copy workspace path",
			workspaceRenameTitle: "Rename workspace",
			workspaceRenameDone: "Workspace renamed",
			workspaceRenameFailed: "Workspace rename failed: {detail}",
			workspaceRenameUnregistered: "This directory is not a registered workspace; cannot rename",
			workspaceRenameServiceDown: "Workspace service unavailable; cannot rename",
			workspaceRenameConflict: "Workspace name \"{name}\" is already in use",
			workspacePathMissing: "This workspace has no usable path",
			revealUnavailable: "This host cannot open a local file manager",
			revealFailed: "Could not show the file location: {detail}",
			copiedWorkspacePath: "Copied workspace path",
			sessionMenuLabel: "Session actions",
			sessionMenuPin: "Pin session",
			sessionMenuUnpin: "Unpin session",
			sessionMenuRename: "Rename",
			sessionMenuFork: "Fork session",
			sessionMenuCopyId: "Copy Session ID",
			sessionMenuCopyName: "Copy Session Name",
			sessionMenuArchive: "Archive session",
			sessionPinDone: "Session pinned",
			sessionUnpinDone: "Session unpinned",
			sessionPinFailed: "Pin failed: {detail}",
			sessionPinUnavailable: "Session service unavailable; cannot pin",
			sessionPinArchived: "This session is archived and cannot be pinned",
			sessionForkDone: "Forked session created",
			sessionForkFailed: "Fork failed: {detail}",
			sessionForkNeedsOpen: "This session must be migrated first; open it before forking",
			sessionForkUnavailable: "Session service unavailable; cannot fork",
			sessionArchiveDone: "Session archived",
			sessionArchiveFailed: "Archive failed: {detail}",
			sessionArchiveUnavailable: "Session service unavailable; cannot archive",
			sessionArchiveArchived: "The session is already archived",
			copiedSessionId: "Copied Session ID",
			copiedSessionName: "Copied session name",
			subagentsModule: "Subagents",
			subagentRunning: "Running",
			subagentDone: "Completed",
			subagentOpenFailed: "Failed to open subagent session",
			tasksModule: "Tasks",
			tasksExpandDone: "Show completed tasks",
			taskDone: "Completed",
			taskTodo: "Pending",
			mcpModule: "MCP",
			mcpNone: "No MCP servers connected",
			mcpToggleFailed: "MCP toggle failed: {detail}",
			settingsTitle: "HUD settings",
			settingsModules: "Modules",
			settingsPanelTitle: "HUD panel general settings",
			// v0.20.0：panel style (card / sidebar), above the side row; card is the default.
			settingsPanelStyle: "HUD panel style",
			settingsPanelStyleCard: "Card",
			settingsPanelStyleSidebar: "Sidebar",
			settingsPanelStyleHint: "Card style floats above the page; Sidebar style runs full height with a divider",
			// v0.19.0：panel display mode (fixed / hover)
			settingsPanelSide: "HUD panel side",
			settingsPanelSideLeft: "Left",
			settingsPanelSideRight: "Right",
			settingsPanelSideHint: "Show the panel to the left or right of the body, which makes room",
			settingsPanelNewSessionOpen: "Show by default on the new-session page",
			settingsPanelNewSessionOpenHint: "Applied every time the new-session page opens",
			settingsPanelChatOpen: "Show by default in chat sessions",
			settingsPanelChatOpenHint: "Only affects sessions without remembered state",
			settingsUsageTitle: "\u201CUsage\u201D module settings",
			settingsUsageDeepseek: "DeepSeek balance",
			settingsUsageOpencode: "OpenCode Go usage",
			settingsUsageCodex: "Codex quota",
			settingsUsageJump: "Show the \u201CJump\u201D button",
			settingsUsageDeepseekHint: "Show the DeepSeek account balance",
			settingsUsageOpencodeHint: "Show OpenCode Go 5h/1w/1m usage",
			settingsUsageCodexHint: "Show the remaining Codex quota",
			settingsUsageJumpHint: "Show the Jump button next to the Usage title",
			settingsUsageOpencodeMissing: "Install and enable dsh-account-usage",
			settingsUsageOpencodeUnconfigured: "OpenCode Go key missing or subscription expired",
			settingsUsageCodexMissing: "Install and sign in to dsh-codex-subscription",
			settingsCancel: "Cancel",
			settingsConfirm: "Save settings",
			settingsReset: "Reset to defaults",
			settingsDrag: "Drag to reorder",
			settingsDragHint: "Drag the handle to reorder (top to bottom = panel order)",
			settingsModuleLocked: "Not shown on the new-session page; change it from a chat session",
			settingsHostOutdated: "The host half is not updated: panel side and defaults are not persisted yet. Restart DSH.",
			// —— v0.18.5: “Usage guide” tab (one section per module; keep zh/en in pairs).
			//     From v0.19.0 the wording follows ASD-STE100: one action per sentence, imperative for instructions, no parentheses or semicolons. ——
			settingsGuideTab: "Usage guide",
			guideKindShow: "Display",
			guideKindAct: "Features",
			guideKindSet: "Settings",
			guidePanelTitle: "HUD panel",
			guidePanelEntry: "Click “HUD panel” at the top right of a chat page to open or close the panel. The new-session page uses a floating button in the same position.",
			guidePanelSide: "The panel opens on the right side of the conversation area by default. You can also open it on the left side. The conversation body and the chat input move away from the panel.",
			// v0.20.0: panel style (card / sidebar) — sidebar relies on a divider against the body.
			guidePanelStyle: "Choose Card or Sidebar in “HUD panel general settings”. The default is Card. Sidebar draws no rounded card and uses a divider against the conversation body.",
			guidePanelMemory: "The panel remembers the open state for each session. The new-session page starts collapsed. You can change the default in “HUD panel” settings.",
			guidePanelSidebar: "While the right sidebar is open, the panel hides temporarily. The panel shows again when the sidebar closes.",
			guidePanelNewSession: "The new-session page shows six modules. The modules are Session, Usage, Git, Notes, To-do and MCP.",
			guidePanelFold: "Click a module title to fold or unfold the module. All modules do this except Session and Context. The folded state survives a refresh.",
			guidePanelSettingsEntry: "Click the gear at the top right of the Session module to open “HUD settings”. The “Usage guide” tab at the top of the dialog is this page.",
			guidePanelSettingsLayout: "Select modules in the left pane to show or hide them. Drag a card handle to change the order. The order goes from top to bottom.",
			guidePanelSettingsCards: "The right pane has three cards. The cards are panel general settings, Context module settings and Usage module settings.",
			guidePanelSettingsSave: "“Reset to defaults” is available after you change a setting. “Confirm” saves the settings and closes the dialog. Cancel, Esc and Close discard your changes.",
			guidePanelSettingsLocked: "On the new-session page, the four hidden modules are disabled. The switches show the real state, but you cannot change them.",
			guideSessionTitle: "Session module",
			guideSessionShowNames: "The workspace name, the session name and the session state. The states are Running, Awaiting approval, Awaiting answer, Waiting for subagents and Idle.",
			guideSessionShowModel: "The model provider, the model name and the reasoning effort.",
			guideSessionWorkspaceMenu: "Click the workspace name to open a menu. The menu items are rename, show in the file manager and copy path.",
			guideSessionSessionMenu: "Click the session name to open a menu. The menu items are pin, unpin, rename, fork session, copy ID, copy name and archive.",
			guideSessionRename: "Select “Rename” to edit the name in place. Press Enter to save or Esc to cancel. A click on another position also saves the name.",
			guideSessionNewPage: "The new-session page hides the session title and the state chip.",
			guideContextTitle: "Context module",
			guideContextShowBar: "The occupancy bar shows the occupancy with colors. Green is from 0% to 40%. Yellow is from 40% to 90% and red is above 90%.",
			guideContextShowRatio: "The header shows the used context, the maximum context and the percentage. Click the header to fold the module. Click again to expand it.",
			guideContextShowLines: "The bottom has two lines. The first line shows the turns, the steps and tok/s. The second line shows the total tokens and the cache hits.",
			guideContextHoverBar: "Point to the bar. The bar changes to the segmented style. The segments show System prompt, Tool definitions and Messages.",
			guideContextHoverLines: "Point to either line to see the full statistics and usage details.",
			guideContextCompress: "“Compact” is available while the session is idle. It is disabled while a task runs.",
			guideUsageTitle: "Usage module",
			guideUsageShowDeepseek: "The DeepSeek balance. The balance is always shown, and it shows — without data.",
			guideUsageShowOpencode: "The OpenCode Go usage percentages for its three windows.",
			guideUsageShowCodex: "The Codex quota. A subscribed account shows the 5-hour and the weekly quota, and an account without a subscription shows the free quota. A gpt-reserve quota adds one more row.",
			guideUsageClick: "Click a balance or a percentage to open the matching settings page.",
			guideUsageJump: "Click “Jump” in the module header to open the usage site menu.",
			guideGitTitle: "Git module",
			guideOutputsTitle: "Outputs module",
			guideOutputsShowList: "The documents, sheets, slides and images that this session changed, including terminal-command edits. The module stays hidden while there are no outputs.",
			guideOutputsShowOrder: "The most recent change comes first. Three files show first and more files open on click. The list holds 10 files at most and sits above git by default.",
			// v0.20.0: hover tip on output file rows.
			guideOutputsHover: "Hover a file row for 0.5 seconds to show the full relative path.",
			guideOutputsOpen: "Click a file to open its content in the right sidebar.",
			guideOutputsScope: "Only workspace files that still exist are listed.",
			guideGitShowBranch: "The current branch and the number of changed files.",
			guideGitShowFiles: "Changed files are in two groups: staged and changes. The file count is at the right of each group name. Each row shows the status letter, the file name and the relative folder in gray.",
			guideGitBranch: "Click the branch button to switch to a branch or to create one. If the workspace is not a repository, the button shows “init repo”.",
			guideGitDiff: "Left-click a file to open the diff in the right sidebar. Right-click a file to stage it or to revert it.",
			guideGitCommit: "Click “commit” to commit the staged files. Click “AI generate” to write a message that follows the commit convention.",
			guideGitPrompt: "The commit dialog has a collapsible AI prompt. Edit and save it, or restore the default. Generate then uses it as it is and skips the automatic date and version checks.",
			guideGitRevert: "Click “revert” to discard all unstaged changes. Untracked files are also deleted. Confirm the operation first.",
			guideGitGraph: "Click “git graph” to see the commits. Right-click a commit to copy it, to create a branch, to merge it or to reset it.",
			guideSubagentsTitle: "Subagents module",
			guideSubagentsShowList: "All subagents of the current session, indented by level. Three show first when there are more.",
			guideSubagentsShowState: "A running subagent is yellow and a finished subagent is green.",
			guideSubagentsOpen: "Click a row to open that subagent session in the official right sidebar. The main session stays open.",
			guideSubagentsOnly: "The module shows only when subagents exist.",
			guideTasksTitle: "Tasks module",
			guideTasksShowList: "The task list and the task states. A running task has a rotating icon. Completed tasks stay at the bottom and open on click.",
			guideTasksShowCount: "The bottom shows the counts of completed, running and pending tasks.",
			guideTasksLive: "The list refreshes when the tasks change.",
			guideTasksOnly: "The module shows only when tasks exist.",
			guidePlansTitle: "Plan list module",
			guidePlansShowList: "The plans from plan mode. Yellow is pending approval, green is executed and grey is discarded with a strikethrough. Three show first when there are more.",
			guidePlansShowCount: "The bottom shows the counts of the three states.",
			guidePlansOpen: "Click a row to read the full plan. The plan uses Markdown.",
			guidePlansOnly: "The module shows only when plan records exist.",
			guideMcpTitle: "MCP module",
			guideMcpShowList: "The connected MCP servers and their global on and off state.",
			guideMcpToggle: "The switch takes effect immediately. You do not need to refresh the page.",
			guideMcpScope: "Only the target server changes. Some environments need a restart of DSH.",
			guideNoteTitle: "Notes module",
			guideNoteShowShared: "Notes are shared per workspace. All sessions in the same workspace directory use the same notes.",
			guideNoteShowCount: "Each note keeps its own title and text. A note has no length limit and up to 20 images.",
			guideNoteFold: "The folded state survives a refresh.",
			guideNoteList: "The note list shows every note. Point to a note to show the edit and delete buttons.",
			guideNoteDrag: "Hold the drag handle at the left of a note to change its order.",
			guideNoteCreateFromChat: "Click “Create from chat” to start a note from the chat input text and images.",
			guideNoteAdd: "Click “Add note” to create an empty note and open the editor.",
			guideNoteDeleteAll: "A single delete asks first. Click “Delete all notes” to remove every note, which also asks first.",
			guideNoteEdit: "Click the edit button to open the editor. Click the back button to return. An empty title becomes an automatic title.",
			guideNoteImages: "Paste images in the editor. Drag a thumbnail left or right to change the image order.",
			guideNoteResize: "Drag the handle under the input to change the height. All notes share one height.",
			guideNoteImport: "Click “Import from chat” to clear the note text and images first. It then writes the chat input and skips non-image attachments. It asks first when the note is not empty.",
			guideNoteSend: "Click “Add to chat” to clear the chat input first. It then writes the note text and adds its images in note order. It asks first when the chat input is not empty.",
			guideNoteClear: "Click “Clear” to start a confirmation. A second click removes the text and the images. The button is disabled while the note is empty.",
			guideNoteImportEnabled: "“Create from chat” and “Import from chat” work only when the chat input has text or images.",
			guideNoteLimit: "Change the note limit in HUD settings, in the Notes card. The range is 5–20, and the default is 5.",
			guideTodoTitle: "To-do module",
			guideTodoShowShared: "The list is shared per workspace. All sessions in the same workspace directory use one list and order.",
			guideTodoShowCount: "The header shows the completed count. Completed items stay at the bottom and open on click.",
			guideTodoCheck: "Check an item to complete it. Uncheck it to restore it.",
			guideTodoEdit: "Type in the input and press Enter to add an item. The edit and delete buttons show when you point to an item.",
			guideTodoDrag: "Drag the handle at the left of a row to change the order. The handle covers the full row height. The new order is saved on release.",
			guideTodoClear: "Click “Clear completed” to start a confirmation. The button is disabled when no item is completed.",
			guideTodoFold: "The folded state survives a refresh.",
			balanceModule: "Usage",
			balanceTotal: "DeepSeek balance",
			balanceJump: "Open",
			jumpDeepseek: "deepseek",
			jumpOpencode: "opencode go",
			balanceLoadFailed: "Failed to load balance",
			usageEmptyHint: "No usage data yet: sign in to DeepSeek for the balance, install and enable dsh-account-usage for OpenCode Go usage, or install and sign in to dsh-codex-subscription for Codex quota.",
			valueOpenDeepseek: "Open Settings → Account & balance → deepseek",
			valueOpenOpencode: "Open Settings → Account & balance → opencode go",
			valueOpenCodex: "Open Settings → Codex subscription",
			codexFiveHour: "Codex 5h quota",
			codexWeekly: "Codex weekly quota",
			codexFreeQuota: "Codex free quota",
			codexReserve: "Codex gpt-reserve quota",
			codexReserveNamed: "Codex gpt-reserve quota ({name})",
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
			gitRevertAllConfirm: "{count} unstaged change(s) will be discarded: tracked files are reverted and untracked new files are deleted; the staged area is untouched. This cannot be undone.",
			gitRevertAllStagedNote: "{count} staged file(s) will NOT be discarded; to discard them, remove them from the stage first, then run revert.",
			gitRevertFileTitle: "Discard changes of this file?",
			gitRevertFileUntracked: "「{path}」is a new file; discarding will delete it. This cannot be undone.",
			gitRevertFileIntentToAdd: "「{path}」is an intent-to-add file; discarding will delete it. This cannot be undone.",
			gitRevertFileTracked: "The unstaged changes of 「{path}」will be reverted.",
			gitRevertFileStagedPartial: "This file also has staged content: only the unstaged part is reverted; the file and its staged content are kept.",
			gitAffectedFiles: "Affected files ({count})",
			gitCancel: "Cancel",
			gitConfirmDanger: "Discard",
			gitConfirmDelete: "Delete",
			gitCommitTitle: "commit",
			gitCommitSummary: "{count} staged file(s) will be committed",
			gitCommitPlaceholder: "Enter commit message",
			gitAiGenerate: "generate",
			gitAiGenerating: "Generating…",
			gitAiConfirm: "Confirm?",
			gitAiConfirmHint: "This will use DeepSeek's official DeepSeek Flash model (effort: low), not the current session model.",
			// v0.20.0: "AI prompt" section inside the Git commit dialog.
			gitPromptTitle: "AI prompt",
			gitPromptCustom: "Custom",
			gitPromptHint: "Only affects commit messages from generate. The staged diff is appended automatically; a custom prompt also disables the automatic date-prefix and version checks.",
			gitPromptPlaceholders: "Placeholders: {{spec}} commit convention, {{today}} today's date, {{project}} project and version, {{sessionContext}} session context",
			gitPromptSave: "Save",
			gitPromptRestore: "Restore default",
			gitPromptSaved: "Prompt saved",
			gitPromptRestored: "Default prompt restored",
			gitPromptLoadFailed: "Failed to load the prompt: {detail}",
			gitPromptSaveFailed: "Failed to save the prompt: {detail}",
			gitPromptNotPersistent: "The host half is not updated: the prompt lasts only for this run and is lost after a DSH restart",
			gitCommitEmpty: "Enter a commit message",
			gitCancelOrCommit: "Cancel",
			gitConfirmCommit: "commit",
			gitStageDone: "Staged 「{path}」",
			gitStageAllTitle: "Stage all unstaged files",
			gitStageAllDone: "Staged {count} file(s)",
			gitUnstageAllTitle: "Unstage all staged files",
			gitUnstageAllDone: "Unstaged {count} file(s)",
			gitUnstageDone: "Unstaged 「{path}」",
			gitRevertDone: "Reverted 「{path}」",
			gitRevertAllDone: "Discarded unstaged changes in {count} file(s)",
			gitRevertAllDoneWithStaged: "Discarded unstaged changes in {count} file(s); {staged} staged file(s) were left untouched",
			gitRevertSkipped: "{count} entr(y/ies) could not be reverted (nested repository/submodule or permissions): {paths}; please handle them manually.",
			gitStagedHint: "Staged files are not affected by revert; remove them from the stage first if you want to discard them.",
			gitDiffUnavailable: "Cannot open the git diff in the right sidebar: install and enable dsh-better-sidebar",
			gitDiffOpenFailed: "Failed to open the git diff: {detail}",
			gitCommitDone: "Committed successfully",
			gitOperationFailed: "Operation failed: {detail}",
			gitAiFailed: "Commit message generation failed: {detail}",
			gitAiVersionWarn: "Message filled in, but the version number may not follow the increment rule — please verify and adjust manually",
			gitBranchSwitch: "Switch branch",
			gitBranchLoading: "Loading…",
			gitBranchEmpty: "No local branches",
			gitBranchListFailed: "Failed to load branches: {detail}",
			gitBranchSwitched: "Switched to branch \"{branch}\"",
			gitBranchAlreadyOn: "Already on branch \"{branch}\"",
			gitBranchFailed: "Failed to switch branch: {detail}",
			gitBranchConflict: "Failed to switch branch: local changes in these files block the switch: {files}. Commit, stash, move or delete them first.",
			gitBranchAdd: "Add branch",
			gitBranchAddPlaceholder: "New branch name…",
			gitBranchAddConfirm: "Add",
			gitBranchCreated: "Created and switched to branch \"{branch}\"",
			gitBranchCreateFailed: "Failed to create branch: {detail}",
			gitInitRepo: "init repo",
			gitInitRepoTitle: "Initialize a git repository in the current workspace",
			gitInitDone: "Git repository initialized",
			gitInitFailed: "Failed to initialize the repository: {detail}",
			gitNoRepo: "The current workspace is not a git repository",
			noteModule: "Notes",
			notePlaceholder: "Jot something down…",
			noteClear: "Clear",
			noteClearConfirm: "Confirm?",
			noteClearFailed: "Clear failed: unable to save the note",
			noteSendToChat: "Add to chat",
			noteSendFailed: "Failed: cannot access the current session input",
			noteSendTargetMissing: "Failed: no session available in this workspace",
			noteSendBusy: "Failed: the session is sending right now, try again in a moment",
			// v0.19.0: note images, import from chat, overwrite confirmation
			noteImageLimit: "A note holds at most {count} images",
			noteImageRemove: "Remove this image",
			noteImagePreview: "View full size",
			noteImageStorageUnavailable: "Images cannot be persisted here, so they stay for this session only",
			noteImageUnavailable: "This DSH version cannot add images to the input; only the text was written",
			noteImportFromChat: "Import from chat",
			noteImportEmpty: "The session input has nothing to import",
			noteImportConfirm: "This clears the note's text and images first, then writes what the session input holds",
			noteImportSkippedFiles: "Skipped {count} non-image attachment(s)",
			noteAddOverwriteConfirm: "This clears the session input's text and images first, then writes the note",
			noteConfirmOverwrite: "Clear and write",
			// v0.20.0: multiple notes (list view / editor view / count limit).
			noteDefaultTitle: "Note {count}",
			noteUntitled: "Untitled note",
			noteEmpty: "No notes yet. Click “Add note” to create one.",
			noteAdd: "Add note",
			noteCreateFromChat: "Create from chat",
			noteDeleteAll: "Delete all notes",
			noteDeleteAllTitle: "Delete all notes",
			noteDeleteAllNote: "This deletes all {count} notes and their images. This cannot be undone.",
			noteDeleteAllConfirm: "Delete all",
			noteDeleteTitle: "Delete note",
			noteDeleteNote: "This deletes “{title}” and its images. This cannot be undone.",
			noteDeleteConfirm: "Delete",
			noteDelete: "Delete note",
			noteEdit: "Edit note",
			noteBack: "Back to notes",
			noteDrag: "Drag to reorder",
			noteTitlePlaceholder: "Note title",
			noteStorageUnavailable: "Save failed: unable to write local storage",
			noteLimitReached: "The note limit is reached ({count}). Change it in HUD settings.",
			noteCapRejected: "Cannot save: workspace “{workspaces}” has more notes than the limit {count}.",
			settingsNoteTitle: "Notes module settings",
			settingsNoteMax: "Maximum notes",
			settingsNoteMaxHint: "5–20, default 5",
			noteWorkspaceCount: "“{path}” ({count} notes)",
			noteWorkspaceSeparator: ", ",
			noteWorkspaceMore: " and {count} more workspaces",
			todoModule: "Todo",
			todoExpandDone: "Show completed items",
			todoPlaceholder: "Add a todo…",
			todoCancel: "Cancel",
			todoConfirm: "Confirm",
			todoEdit: "Edit",
			todoDelete: "Delete",
			todoMarkDone: "Mark as completed",
			todoMarkPending: "Mark as pending",
			todoClear: "Clear completed",
			todoClearTitle: "Clear completed todos",
			todoClearNote: "This will remove all completed todos from the list. This action cannot be undone.",
			todoClearConfirm: "Clear",
			todoDrag: "Drag to reorder",
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
					// 冲突文件清单等结构化附带数据由 host 回传，提示文案需要它列出现有文件
					if (Array.isArray(body.files)) error.files = body.files;
					throw error;
				}
				return body;
			});
		}

		// —— 宿主原生打开能力（v0.18.1）：每页只探测一次，失败按不可用处理 ——
		// available=false 时「在 Finder 中显示」置灰；fileManager 决定该项文案（finder/explorer/directory）。
		let hostDesktopCache = null;
		function readHostDesktop() {
			if (hostDesktopCache !== null) return hostDesktopCache;
			hostDesktopCache = call("workspace/desktop")
				.then((body) => ({
					available: body?.available === true,
					fileManager: typeof body?.fileManager === "string" ? body.fileManager : null,
				}))
				.catch(() => ({ available: false, fileManager: null }));
			return hostDesktopCache;
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
		// 会话统计/Token 用量使用 DSH 官方 StatsPills 同款图标（regular / stroke-width 1）。
		// 内联而不是新增资产路由：这两个图标随本次客户端改动立即生效，旧 host 也不会 404。
		const INLINE_ICONS = Object.freeze({
			gauge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1"><path d="M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096" stroke="currentColor"></path><path d="M8 8.49994L11.6114 4.88855" stroke="currentColor"></path><path d="M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z" fill="currentColor"></path></svg>`,
			database: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1"><path d="M13.1967 5.1869C13.7232 4.77378 14.0003 4.30517 14.0001 3.82819C14.0003 3.3512 13.7232 2.88259 13.1967 2.46947C12.6702 2.05635 11.9128 1.71328 11.0006 1.47475C10.0885 1.23621 9.05371 1.11062 8.00039 1.1106C6.94707 1.11057 5.9123 1.23612 5.00009 1.47461C4.08742 1.71301 3.32948 2.05604 2.80249 2.46919C2.2755 2.88235 1.99805 3.35106 1.99805 3.82819C1.99805 4.30531 2.2755 4.77402 2.80249 5.18718C3.32948 5.60033 4.08742 5.94336 5.00009 6.18176C5.9123 6.42025 6.94707 6.5458 8.00039 6.54578C9.05371 6.54575 10.0885 6.42016 11.0006 6.18163C11.9128 5.94309 12.6702 5.60002 13.1967 5.1869Z" stroke="currentColor"></path><path d="M2 3.80371V11.7848" stroke="currentColor"></path><path d="M14 3.80371V11.7848" stroke="currentColor"></path><path d="M2 7.81396C2 8.60524 2.63214 9.36411 3.75736 9.92363C4.88258 10.4832 6.4087 10.7975 8 10.7975C9.5913 10.7975 11.1174 10.4832 12.2426 9.92363C13.3679 9.36411 14 8.60524 14 7.81396" stroke="currentColor"></path><path d="M2 11.7847C2 12.6081 2.63214 13.3977 3.75736 13.98C4.88258 14.5622 6.4087 14.8893 8 14.8893C9.5913 14.8893 11.1174 14.5622 12.2426 13.98C13.3679 13.3977 14 12.6081 14 11.7847" stroke="currentColor"></path></svg>`,
		});
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
				if (INLINE_ICONS[name] !== undefined) {
					ICON_CACHE[key] = Promise.resolve(adaptIcon(INLINE_ICONS[name], keepColors));
				} else {
					ICON_CACHE[key] = fetch(`${hostBase()}${ASSET_PATH}/${name}.svg`).then((response) => {
						if (!response.ok) throw new Error(`icon ${name}: HTTP ${response.status}`);
						return response.text();
					}).then((text) => adaptIcon(text, keepColors));
				}
			}
			return ICON_CACHE[key];
		}
		/** 16px 内联图标。 */
		function Icon(props) {
			const svgSize = props.size ?? 16;
			const [svg, setSvg] = react.useState("");
			react.useEffect(() => {
				let alive = true;
				loadIcon(props.name, props.keepColors ?? false).then((text) => { if (alive) setSvg(text); }).catch(() => { /* 加载失败静默占位 */ });
				return () => { alive = false; };
			}, [props.name, props.keepColors]);
			return react.createElement("span", {
				className: "hud-icon",
				"aria-hidden": "true",
				"data-size": svgSize === 16 ? undefined : svgSize,
				style: { width: svgSize, height: svgSize, display: "inline-flex", flex: "none", color: props.color ?? "var(--dsw-alias-label-primary)" },
				dangerouslySetInnerHTML: svg === "" ? undefined : { __html: svg },
			});
		}

		/** 官方图标（默认 14px）：颜色跟随 currentColor，seed 缺失时返回 null 交给调用方回退。 */
		function OfficialIcon(props) {
			const Component = officialIcon(props.name);
			if (Component === null) return null;
			const iconSize = props.size ?? 14;
			return react.createElement("span", {
				className: props.className === undefined ? "hud-icon hud-official-icon" : `hud-icon hud-official-icon ${props.className}`,
				"aria-hidden": "true",
				style: { width: iconSize, height: iconSize, display: "inline-flex", flex: "none", color: props.color ?? "var(--dsw-alias-label-secondary)" },
			}, react.createElement(Component, { size: iconSize }));
		}

		/** 菜单行图标：优先官方图标，缺失时回退到内置资产图标（仍缺失则不渲染）。 */
		function MenuIcon(props) {
			if (officialIcon(props.official) !== null) return react.createElement(OfficialIcon, { name: props.official, size: 14 });
			return props.asset === undefined ? null : react.createElement(Icon, { name: props.asset, size: 14 });
		}

		// —— 通用上下文菜单（v0.18.1）——
		// 菜单固定宽度与行高：与既有 .hud-git-menu 视觉一致，仅用于视口夹取的尺寸估算。
		const HUD_MENU_WIDTH = 200;
		const HUD_MENU_ITEM_HEIGHT = 29;
		const HUD_MENU_DIVIDER_HEIGHT = 9;
		const HUD_MENU_PADDING = 12;
		const HUD_MENU_MARGIN = 8;

		/** 视口尺寸：测试环境没有 window.innerWidth 时返回 0（不夹取，仅用原始坐标）。 */
		function viewportSize() {
			const width = Number(globalThis.innerWidth) || Number(globalThis.window?.innerWidth) || 0;
			const height = Number(globalThis.innerHeight) || Number(globalThis.window?.innerHeight) || 0;
			return { width, height };
		}

		/** 把菜单左上角夹取到视口内（四周 8px 边距）。 */
		function clampMenuPosition(x, y, itemCount, dividerCount) {
			const { width, height } = viewportSize();
			const estimatedHeight = HUD_MENU_PADDING + itemCount * HUD_MENU_ITEM_HEIGHT + dividerCount * HUD_MENU_DIVIDER_HEIGHT;
			const left = Number.isFinite(x) ? x : 0;
			const top = Number.isFinite(y) ? y : 0;
			return {
				left: width > 0 ? Math.max(HUD_MENU_MARGIN, Math.min(left, width - HUD_MENU_WIDTH - HUD_MENU_MARGIN)) : left,
				top: height > 0 ? Math.max(HUD_MENU_MARGIN, Math.min(top, height - estimatedHeight - HUD_MENU_MARGIN)) : top,
			};
		}

		/**
		 * 菜单锚点：优先鼠标位置；键盘触发（clientX/Y 为 0）时退到元素左下角。
		 * 测试里的事件对象可能没有 currentTarget，因此全程做可选调用。
		 */
		function menuAnchorFrom(event) {
			const rect = typeof event?.currentTarget?.getBoundingClientRect === "function" ? event.currentTarget.getBoundingClientRect() : null;
			const pointerX = typeof event?.clientX === "number" && event.clientX > 0 ? event.clientX : null;
			const pointerY = typeof event?.clientY === "number" && event.clientY > 0 ? event.clientY : null;
			return {
				x: pointerX ?? (rect === null ? HUD_MENU_MARGIN : rect.left),
				y: pointerY ?? (rect === null ? HUD_MENU_MARGIN : rect.bottom + 4),
			};
		}

		/**
		 * HUD 通用菜单：portal 到 body，透明遮罩点击关闭，Esc 关闭。
		 * 打开期间固定坐标不跟随面板滚动或窗口缩放（与 v0.18.1 的交互约定一致）。
		 */
		function HudMenu(props) {
			const items = (Array.isArray(props.items) ? props.items : []).filter((item) => item !== null && item !== undefined);
			const dividers = items.filter((item) => item.separatorBefore === true).length;
			const position = clampMenuPosition(props.x, props.y, items.length, dividers);
			const close = props.onClose;
			react.useEffect(() => {
				if (typeof globalThis.addEventListener !== "function") return undefined;
				const onKeyDown = (event) => {
					// 输入法选词期间的 Esc 属于候选窗口，不关闭菜单。
					if (isImeComposing(event)) return;
					if (event.key !== "Escape") return;
					event.stopPropagation?.();
					props.onClose?.();
				};
				globalThis.addEventListener("keydown", onKeyDown, true);
				return () => globalThis.removeEventListener("keydown", onKeyDown, true);
			}, [close]);
			const menu = react.createElement("div", { className: "hud-git-menu hud-context-menu", role: "menu", "aria-label": props.label, style: { left: position.left, top: position.top, width: HUD_MENU_WIDTH } },
				items.map((item) => react.createElement(react.Fragment, { key: item.key },
					item.separatorBefore === true ? react.createElement("div", { className: "hud-git-menu-divider" }) : null,
					react.createElement("button", {
						type: "button",
						role: "menuitem",
						className: "hud-git-menu-item",
						disabled: item.disabled === true,
						"aria-disabled": item.disabled === true ? "true" : undefined,
						title: item.disabled === true ? item.reason ?? item.label : undefined,
						onClick: (event) => {
							event.stopPropagation?.();
							if (item.disabled === true) return;
							close?.();
							item.run?.();
						},
					},
					item.icon === undefined ? null : react.createElement(MenuIcon, item.icon),
					react.createElement("span", { className: "hud-menu-label" }, item.label)))));
			return react_dom.createPortal(react.createElement(react.Fragment, null,
				react.createElement("div", {
					style: { position: "fixed", inset: 0, zIndex: 2147483004, background: "transparent" },
					onClick: () => close?.(),
					onContextMenu: (event) => { event.preventDefault(); close?.(); },
				}),
				menu), document.body);
		}

		// —— v0.18.2：「HUD 面板设置」持有者（面板样式 + 展开侧位 + 两处默认开合）——
		//     宿主 settings 是权威值，但读取是异步的；面板首帧（位置/是否展开）必须同步可得，
		//     因此先读 localStorage 镜像，宿主设置返回后再对账（旧宿主没有 panel 段时保持镜像）。
		//     v0.20.0：追加 style（面板样式，默认 card，与宿主 lib/settings.js 同规则）。
		function defaultPanelSettings() {
			return { style: "card", side: "right", newSessionOpen: false, chatOpen: true };
		}
		function normalizePanelSettings(raw) {
			const base = defaultPanelSettings();
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
			return {
				style: PANEL_STYLES.includes(raw.style) ? raw.style : base.style,
				side: PANEL_SIDES.includes(raw.side) ? raw.side : base.side,
				newSessionOpen: typeof raw.newSessionOpen === "boolean" ? raw.newSessionOpen : base.newSessionOpen,
				chatOpen: typeof raw.chatOpen === "boolean" ? raw.chatOpen : base.chatOpen,
			};
		}
		/**
		 * v0.20.0：收敛宿主响应里的面板设置。
		 * 旧宿主的 schema 里没有 style 字段，响应天然缺该键；此时沿用 fallbackStyle（当前内存/镜像里的样式），
		 * 不能用默认值把它覆盖掉（否则用户切到边栏后一刷新就被打回卡片）。
		 * @param raw 宿主返回的 panel 段。
		 * @param fallbackStyle 缺 style 时沿用的样式。
		 * @returns 收敛后的面板设置；raw 为空时返回 null（调用方保持现状）。
		 */
		function normalizeHostPanelSettings(raw, fallbackStyle) {
			if (raw === null || raw === undefined || typeof raw !== "object") return null;
			const style = raw.style === "sidebar" || raw.style === "card"
				? raw.style
				: (fallbackStyle === "sidebar" ? "sidebar" : "card");
			return normalizePanelSettings({ ...raw, style });
		}
		// —— v0.20.0：「便笺」模块设置（条数上限，5–20，默认 5）——
		// 收敛函数与便笺模块共用（函数声明提升，定义在便笺区域）。
		function defaultNoteSettings() {
			return { maxCount: NOTE_COUNT_DEFAULT };
		}
		function normalizeNoteSettings(raw) {
			const base = defaultNoteSettings();
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
			return { maxCount: normalizeNoteMaxCount(raw.maxCount) };
		}

		/** 便笺条目计数：v4 按 notes 数，v3 单便笺记 1，坏数据记 0。 */
		function noteCountOfEntry(raw) {
			if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return 0;
			if (Array.isArray(raw.notes)) return raw.notes.filter((note) => note !== null && typeof note === "object" && !Array.isArray(note)).length;
			if (typeof raw.text === "string" || Number.isFinite(raw.updatedAt)) return 1;
			return 0;
		}

		/**
		 * 扫描本浏览器全部工作区的便笺条数（供设置保存前校验）。
		 * @returns {{ key: string, count: number }[]} 按条数从多到少排序。
		 */
		function scanNoteCounts() {
			const storage = loadJsonStorage(NOTES_STORAGE_KEY) ?? {};
			const rows = [];
			for (const key of Object.keys(storage)) {
				const count = noteCountOfEntry(storage[key]);
				if (count > 0) rows.push({ key, count });
			}
			return rows.sort((left, right) => right.count - left.count);
		}

		/** 上限校验：返回便笺条数超过 maxCount 的工作区清单（空数组 = 通过）。 */
		function noteCountViolations(maxCount) {
			return scanNoteCounts().filter((row) => row.count > maxCount);
		}

		function loadPanelPrefsMirror() {
			try {
				const raw = globalThis.localStorage?.getItem(PANEL_SETTINGS_KEY) ?? null;
				if (raw === null || raw === "") return defaultPanelSettings();
				return normalizePanelSettings(JSON.parse(raw));
			} catch { return defaultPanelSettings(); }
		}
		function savePanelPrefsMirror(next) {
			try { globalThis.localStorage?.setItem(PANEL_SETTINGS_KEY, JSON.stringify(next)); } catch { /* 存储不可用仅内存 */ }
		}
		let panelPrefs = loadPanelPrefsMirror();
		let panelPrefsPromise = null;
		/**
		 * 面板设置的订阅者（面板根）：侧位会影响「左侧抽屉展开时隐藏面板」的派生可见性，
		 * 所以把缓存变化统一广播出来，而不是各组件自己去轮询。
		 */
		const panelPrefsListeners = new Set();
		function subscribePanelPrefs(listener) { panelPrefsListeners.add(listener); return () => panelPrefsListeners.delete(listener); }
		function publishPanelPrefs() { for (const listener of [...panelPrefsListeners]) { try { listener(); } catch { /* 单个订阅者异常不影响其它组件 */ } } }
		// 最近一次「成功读/写」的设置快照：只作为面板重挂时的首帧种子（避免先闪一帧旧值）。
		// 注意：不能把它当成「整页只读一次」的缓存——面板在切页面、关开面板、开合右侧栏时都会重挂，
		// 若重挂时复用页面加载时的旧快照，就会把用户刚确认的设置（面板侧位、跳转开关…）回退掉。
		let lastSettingsBody = null;
		function rememberSettingsBody(body) {
			if (body === null || body === undefined || body.ok !== true) return;
			lastSettingsBody = body;
		}
		// 最近一次被接受的「用量设置」。旧宿主的 usage 里没有 v0.18.2 新增的 showJump，
		// 缺键时沿用本次运行内的选择（否则面板重挂后「跳转」按钮又冒出来），重启宿主后自然消失。
		let lastUsageDisplay = null;
		function acceptUsageDisplay(raw) {
			if (raw === null || raw === undefined) return null;
			const out = { ...raw };
			for (const key of USAGE_SETTING_KEYS) {
				if (typeof out[key] !== "boolean") out[key] = (lastUsageDisplay?.[key] ?? true) === true;
			}
			lastUsageDisplay = out;
			return out;
		}
		/** 面板侧位（同步可读，供面板定位与几何让位使用）。 */
		function getPanelSide() { return panelPrefs.side === "left" ? "left" : "right"; }
		/** v0.20.0：面板样式（同步可读，供面板根节点与几何 effect 使用）；未知值回退 card。 */
		function getPanelStyle() { return panelPrefs.style === "sidebar" ? "sidebar" : "card"; }
		/**
		 * 首次加载宿主面板设置：单次请求、结果缓存（useHudModules 复用同一 promise，避免二次 GET）。
		 * 旧宿主响应里没有 panel 字段时不清空镜像，避免把用户已选好的侧位/默认值冲掉。
		 */
		function ensurePanelPrefs() {
			if (panelPrefsPromise !== null) return panelPrefsPromise;
			panelPrefsPromise = getSettings().then((body) => {
				// 启动快照可作为首次进入面板时的首帧数据源，但仍然会随写入刷新。
				rememberSettingsBody(body);
				// v0.20.0：缺 style 时沿用当前样式（旧宿主没有该字段）。
				const raw = normalizeHostPanelSettings(body?.panel, getPanelStyle());
				if (raw === null) {
					// 旧宿主没有 panel 段：设置本身不变，但仍要广播一次，让订阅者拿到最新一致状态。
					publishPanelPrefs();
					return panelPrefs;
				}
				// 只在首次加载时对账当前作用域开合；用户本次运行手动开合过则不动。
				applyPanelPrefs(raw, { reconcile: true });
				return panelPrefs;
			}).catch(() => panelPrefs);
			return panelPrefsPromise;
		}
		/** 写入缓存 + 镜像 + 广播；reconcile 时把「无记忆」作用域的初始开合对齐到新默认值。 */
		function applyPanelPrefs(next, options = {}) {
			panelPrefs = normalizePanelSettings(next);
			savePanelPrefsMirror(panelPrefs);
			if (options.reconcile === true && !hudUserToggled) reconcileScopeOpenState();
			publishPanelPrefs();
		}
		/** 把当前作用域的初始开合对齐到设置默认值：已有记忆的会话永远保留记忆。 */
		function reconcileScopeOpenState() {
			if (hudScopeKey === NEW_SESSION_SCOPE) {
				setHudOpenTransient(panelPrefs.newSessionOpen);
				return;
			}
			loadHudStorage();
			if (hudPersisted.has(hudScopeKey)) return;
			setHudOpenTransient(panelPrefs.chatOpen);
		}

		// —— HUD 开合状态（模块级 store，localStorage 持久化；无记录默认展开）——
		//     开合状态按会话独立保存：`NEW_SESSION_SCOPE` 为新建会话页的临时态，
		//     从不持久化，故每次新建会话都按「新建会话页默认展示/隐藏」初始化；真实会话各写各的键。
		//     旧版本（≤ v0.12.0）把单一布尔值直接存在 HUD_OPEN_KEY 下，首次激活时迁移为
		//     「会话 id → 状态」的对象存储（默认仅作用于该次会话，不扩散到其它会话）。
		const NEW_SESSION_SCOPE = "\u0000new-session";
		const hudPersisted = new Map();
		// 初始作用域即「新建会话页」：按设置里的默认值起步，避免刷新后先闪一下相反状态。
		let hudOpenState = panelPrefs.newSessionOpen;
		/** 用户本次运行是否手动开合过面板：为真时不再用设置默认值纠正当前状态。 */
		let hudUserToggled = false;
		let hudScopeKey = NEW_SESSION_SCOPE;
		let hudStorageLoaded = false;
		function loadHudStorage() {
			if (hudStorageLoaded) return;
			hudStorageLoaded = true;
			let raw = null;
			try { raw = globalThis.localStorage?.getItem(HUD_OPEN_KEY) ?? null; } catch { raw = null; }
			if (raw === null || raw === "") return;
			try {
				const parsed = JSON.parse(raw);
				if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
					for (const [key, value] of Object.entries(parsed)) {
						if (value === "1" || value === 1 || value === true) hudPersisted.set(key, true);
						else if (value === "0" || value === 0 || value === false) hudPersisted.set(key, false);
					}
					return;
				}
			} catch { /* 非 JSON：按旧版单一布尔值处理 */ }
			// 旧格式 "1"/"0" 在首个激活的作用域上生效
			if (raw === "1" || raw === "0") hudPersisted.set("\u0000legacy", raw === "1");
		}
		function saveHudStorage() {
			try {
				globalThis.localStorage?.setItem(HUD_OPEN_KEY, JSON.stringify(Object.fromEntries(
					Array.from(hudPersisted, ([key, value]) => [key, value ? "1" : "0"]),
				)));
			} catch { /* 存储不可用时仅内存 */ }
		}
		/** 切换到某个作用域（会话 id / 新建会话页）的开合状态；变更时通知订阅者。 */
		function activateHudScope(sessionId) {
			const next = typeof sessionId === "string" && sessionId !== "" ? sessionId : NEW_SESSION_SCOPE;
			if (next === hudScopeKey) return;
			loadHudStorage();
			if (hudScopeKey !== NEW_SESSION_SCOPE) hudPersisted.set(hudScopeKey, hudOpenState);
			hudScopeKey = next;
			if (next === NEW_SESSION_SCOPE) {
				// v0.18.2：按「新建会话页默认展示/隐藏」初始化（仍只写内存，不落任何会话记忆）。
				hudOpenState = panelPrefs.newSessionOpen;
			} else if (hudPersisted.has("\u0000legacy")) {
				// 旧版本没有会话维度：把上次记忆交给首个会话，之后不再复用
				hudOpenState = hudPersisted.get("\u0000legacy");
				hudPersisted.delete("\u0000legacy");
				hudPersisted.set(next, hudOpenState);
				saveHudStorage();
			} else {
				// 无开合记忆的会话按「聊天会话页默认展示/隐藏」起步。
				hudOpenState = hudPersisted.has(next) ? hudPersisted.get(next) : panelPrefs.chatOpen;
			}
			publishHud();
		}
		/** 渲染期安全版：只读取目标作用域的状态，不切换、不广播（供 useState 初始化）。 */
		function peekHudOpen(sessionId) {
			const next = typeof sessionId === "string" && sessionId !== "" ? sessionId : NEW_SESSION_SCOPE;
			if (next === hudScopeKey) return hudOpenState;
			if (next === NEW_SESSION_SCOPE) return panelPrefs.newSessionOpen;
			loadHudStorage();
			if (hudPersisted.has(next)) return hudPersisted.get(next);
			if (hudPersisted.has("\u0000legacy")) return hudPersisted.get("\u0000legacy");
			return panelPrefs.chatOpen;
		}
		const hudListeners = new Set();
		function getHudOpen() { return hudOpenState; }
		function subscribeHud(listener) { hudListeners.add(listener); return () => hudListeners.delete(listener); }
		function publishHud() { for (const listener of [...hudListeners]) listener(); }
		function setHudOpen(open) {
			if (hudOpenState === open) return;
			hudOpenState = open;
			// 新建会话页只改内存态：保证该页每次进入都从隐藏开始，也不污染任何会话的记忆
			if (hudScopeKey !== NEW_SESSION_SCOPE) {
				hudPersisted.set(hudScopeKey, open);
				saveHudStorage();
			}
			publishHud();
		}
		/** 仅切换内存态不写 localStorage（新会话页临时收起/recover 用）。 */
		function setHudOpenTransient(open) {
			if (hudOpenState === open) return;
			hudOpenState = open;
			publishHud();
		}

		/** 主会话判定同时供面板、入口与侧栏恢复守卫使用，不能放在 apply 的局部作用域。 */
		function activeSessionId(binding, snapshot) {
			// 新版 DSH 以 uiSession 的主视图绑定为准；sessions.list.current 可能不再更新。
			if (binding !== null && binding !== undefined) return binding.key;
			return snapshot?.current;
		}
		function isNewSessionPage(snapshot, current) {
			// 显式传入 undefined 表示主视图没有会话；只有省略参数时才使用旧版列表 current。
			if (arguments.length < 2) current = snapshot?.current;
			if (snapshot === null || snapshot === undefined) return false;
			if (current === undefined || current === null) return true;
			return (snapshot.byId?.[current]?.blank ?? false) === true;
		}

		// —— 右侧栏可见性与 HUD 互斥（v0.15.3 起改为派生可见性）——
		// 侧栏开合只影响「HUD 是否可见」，不改写会话展开记忆：
		//   可见 = 会话展开记忆 && 右侧栏未展开
		// 因此关闭右侧栏自然恢复；只有用户主动点收起 HUD 才会写入收起记忆。
		// v0.18.2：面板在左侧时额外与「左侧会话列表抽屉」互斥——窄窗口下该抽屉是覆盖式遮罩，
		// 抽屉展开期间把面板临时隐藏（同样不改写展开记忆），关闭抽屉后自动恢复。
		let sidebarExpanded = false;
		let leftDrawerOpen = false;
		const sidebarListeners = new Set();
		function getSidebarExpanded() { return sidebarExpanded; }
		/** 左侧会话列表抽屉是否处于展开态（由宿主 frame 属性派生）。 */
		function getLeftDrawerOpen() { return leftDrawerOpen; }
		function subscribeSidebar(listener) { sidebarListeners.add(listener); return () => sidebarListeners.delete(listener); }
		function publishSidebar() { for (const listener of [...sidebarListeners]) listener(); }
		function setSidebarExpanded(value) {
			const next = value === true;
			if (sidebarExpanded === next) return;
			sidebarExpanded = next;
			publishSidebar();
		}
		function setLeftDrawerOpen(value) {
			const next = value === true;
			if (leftDrawerOpen === next) return;
			leftDrawerOpen = next;
			publishSidebar();
		}
		/** 宿主 frame：抽屉模式且未收起 = 抽屉正覆盖正文（[data-sidebar-collapsed] 缺省才表示展开）。 */
		function readLeftDrawerOpen() {
			if (typeof document === "undefined" || typeof document.querySelector !== "function") return false;
			return document.querySelector("[data-sidebar-drawer]:not([data-sidebar-collapsed])") !== null;
		}
		/** HUD 面板是否应展示：展开记忆叠加右侧栏/左侧抽屉互斥后的派生结果。 */
		function isHudVisible() {
			if (!getHudOpen()) return false;
			if (sidebarExpanded) return false;
			if (getPanelSide() === "left" && leftDrawerOpen) return false;
			return true;
		}
		/** 当前主视图会话的作用域 id（新建会话页返回 undefined），供按钮首帧读取正确记忆。 */
		function activeHudScopeSessionId(ctx) {
			let snapshot = null;
			let binding = null;
			try { snapshot = ctx.get("sessions")?.list?.getSnapshot?.() ?? null; } catch { snapshot = null; }
			try { binding = ctx.uiSession?.adapter?.current?.getSnapshot?.() ?? null; } catch { binding = null; }
			const current = activeSessionId(binding, snapshot);
			return isNewSessionPage(snapshot, current) ? undefined : current;
		}

		/** 保留的其他会话边栏也可能留在 DOM 中，只取当前可见且已展开的官方面板。 */
		function visibleOfficialSidebarPanel() {
			if (typeof document === "undefined") return null;
			for (const panel of document.querySelectorAll("[data-sidebar-right-panel][data-sidebar-right-open]")) {
				if (panel.closest("[hidden]") !== null) continue;
				const rect = panel.getBoundingClientRect();
				if (rect.width > 0 && rect.right > 0 && rect.left < window.innerWidth) return panel;
			}
			return null;
		}

		/** 边栏收起时以官方展开按钮为锚点，避免固定右边距在不同布局中产生大空隙。 */
		function visibleOfficialSidebarExpandButton() {
			if (typeof document === "undefined") return null;
			for (const button of document.querySelectorAll("[data-sidebar-right-expand]")) {
				if (button.closest("[hidden]") !== null) continue;
				const rect = button.getBoundingClientRect();
				if (rect.width > 0 && rect.right > 0 && rect.left < window.innerWidth) return button;
			}
			return null;
		}

		/**
		 * 聊天会话页里 HUD 入口排在同排工具区首位（utilities order 1），因此位于「底部面板」切换按钮左侧；
		 * 新建会话页不渲染会话页眉，better-sidebar 会把该切换按钮以兜底形式 portal 到右侧栏按钮左侧。
		 * 计算悬浮入口位置时先预留它的宽度与间距，让两页的按钮顺序/间距一致，也不与它争同一个槽位
		 * （否则兜底按钮会被挤到入口左侧，或两个按钮在首帧/侧栏开合后短暂重叠）。
		 * 预留槽位必须在兜底按钮挂载「之前」就生效：它首次测量发生在渲染阶段，看到入口占着自然槽位就会左退，
		 * 之后入口再左移时两者会落到同一位置。因此这里先按 better-sidebar 服务是否激活预留同尺寸槽位，
		 * 节点出现后再用它的真实宽度校正（并只认与右侧栏按钮同一行、真正渲染了宽高的节点）。
		 * @param anchorRect 右侧栏展开按钮的矩形。
		 * @param ctx 插件上下文（用于判断 better-sidebar 是否激活）。
		 * @returns 需要额外预留的宽度（没有兜底按钮/未安装 better-sidebar 时为 0）。
		 */
		function floatingHudReserve(anchorRect, ctx) {
			if (typeof document !== "undefined" && typeof document.querySelector === "function") {
				const fallback = document.querySelector("[data-dsh-dock-fallback]");
				if (fallback !== null && fallback !== undefined && typeof fallback.getBoundingClientRect === "function") {
					const rect = fallback.getBoundingClientRect();
					if (rect.width > 0 && rect.height > 0) {
						// 同一行判定：纵向与右侧栏按钮重叠（没有 top/bottom 的测试桩视为同行，保持可测）。
						const sameRow = !(Number.isFinite(rect.bottom) && Number.isFinite(anchorRect.top) && rect.bottom <= anchorRect.top)
							&& !(Number.isFinite(rect.top) && Number.isFinite(anchorRect.bottom) && rect.top >= anchorRect.bottom);
						if (sameRow) return rect.width + HUD_FLOAT_GAP;
					}
				}
			}
			// 兜底按钮还没挂载：better-sidebar 已激活说明它随后会出现在同一排，先预留同尺寸槽位。
			if (ctx !== null && ctx !== undefined && typeof ctx.get === "function") {
				try {
					if (ctx.get("betterSidebar") !== undefined) return HUD_FLOAT_SLOT_SIZE + HUD_FLOAT_GAP;
				} catch { /* 服务未就绪时按未安装处理 */ }
			}
			return 0;
		}

		/**
		 * 是否正打开覆盖全屏的大图预览。
		 * dsh-codex-subscription 的图片查看器是 role=dialog + aria-modal 的固定浮层
		 * （position: fixed; inset: 0; z-index: 1000），而 HUD 入口位于层级远高于它的
		 * shell.overlay 中，会浮在大图与右上角关闭按钮之上，故预览期间隐藏悬浮入口。
		 * 只按「模态浮层语义 + 视口覆盖率」判定，不绑定第三方类名。
		 */
		function fullscreenPreviewOpen() {
			if (typeof document === "undefined" || typeof window === "undefined") return false;
			for (const node of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
				const style = window.getComputedStyle(node);
				if (style.position !== "fixed" && style.position !== "absolute") continue;
				if (style.display === "none" || style.visibility === "hidden") continue;
				const rect = node.getBoundingClientRect();
				if (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95) return true;
			}
			return false;
		}

		/** 预览浮层在 body 子树中挂载/卸载；每次变更后重新判定入口可见性。 */
		function watchFullscreenPreview(onChange) {
			const update = () => onChange(fullscreenPreviewOpen());
			if (typeof document === "undefined" || document.body === null) return () => {};
			if (typeof MutationObserver === "undefined") { update(); return () => {}; }
			const observer = new MutationObserver(update);
			observer.observe(document.body, { subtree: true, childList: true });
			update();
			return () => { observer.disconnect(); };
		}

		/**
		 * 入口定位目标：可见展开按钮优先；其卸载后按官方面板左缘避让。
		 * kind 标明测量依据：expand=收起态按钮锚点，panel=展开中的面板，fallback=兜底右边距。
		 * 入口在侧栏展开时隐藏，因此「面板锚点」只会在收起动画的过渡期被测到，不能写入位置。
		 */
		function floatingHudTarget(ctx) {
			const expand = visibleOfficialSidebarExpandButton();
			if (expand !== null) {
				const rect = expand.getBoundingClientRect();
				// 与聊天页保持一致：入口排在右侧按钮簇（含 better-sidebar 兜底切换按钮）左侧。
				return {
					element: expand,
					kind: "expand",
					inset: Math.max(0, window.innerWidth - rect.left + HUD_FLOAT_GAP + floatingHudReserve(rect, ctx)),
				};
			}
			const panel = visibleOfficialSidebarPanel();
			return {
				element: panel,
				kind: panel !== null ? "panel" : "fallback",
				inset: panel !== null
					? Math.max(HUD_FLOAT_RIGHT, window.innerWidth - panel.getBoundingClientRect().left + 12)
					: HUD_FLOAT_RIGHT,
			};
		}

		/** 边栏开合可能跨越多次布局提交；立即更新后再校准，避免快速关闭时沿用旧面板左缘。 */
		function watchFloatingHudPosition(ctx, setInset) {
			let observed = null;
			let frame = null;
			let settleTimer = null;
			const observer = new ResizeObserver(() => scheduleSync());
			const sync = () => {
				const { element, inset, kind } = floatingHudTarget(ctx);
				if (element !== observed) {
					if (observed !== null) observer.unobserve(observed);
					if (element !== null) observer.observe(element);
					observed = element;
				}
				// 只在「确认处于收起态」时写入位置：
				//   - 侧栏展开期间入口不可见，此时测到的都是展开态布局，写进去会让关闭瞬间先闪到侧栏左缘；
				//   - 刚关闭时官方面板节点可能还没卸完（收起动画），同样不能把入口拉到旧面板位置。
				// 因此保留打开侧栏前的位置，等官方展开按钮重新挂载后的同步（含 350ms 复查）再校正。
				if (kind !== "panel" && !getSidebarExpanded()) setInset(inset);
			};
			const scheduleSync = () => {
				sync();
				if (frame !== null) window.cancelAnimationFrame(frame);
				if (settleTimer !== null) window.clearTimeout(settleTimer);
				// RAF 处理同一次 React 提交；延时复查处理边栏收起动画与按钮稍后挂载。
				frame = window.requestAnimationFrame(() => { frame = null; sync(); });
				settleTimer = window.setTimeout(() => { settleTimer = null; sync(); }, 350);
			};
			const stopSidebar = sidebarBridge(ctx).subscribeState(scheduleSync);
			const stopHud = subscribeHud(scheduleSync);
			window.addEventListener("resize", scheduleSync);
			scheduleSync();
			return () => {
				stopSidebar();
				stopHud();
				observer.disconnect();
				window.removeEventListener("resize", scheduleSync);
				if (frame !== null) window.cancelAnimationFrame(frame);
				if (settleTimer !== null) window.clearTimeout(settleTimer);
			};
		}

		/** 官方侧栏没有公开订阅接口；观察其渲染标记，服务负责主动收起。 */
		function sidebarBridge(ctx) {
			return {
				getSnapshot() {
					const official = ctx.get("sidebarRight");
					// 服务绑定在 React useEffect 中更新，比 DOM 提交晚；优先读取已渲染状态。
					const officialOpen = visibleOfficialSidebarPanel() !== null || (official?.isExpanded?.() ?? false);
					return { state: { panelOpen: officialOpen || (ctx.get("betterSidebar")?.getSnapshot().state?.panelOpen ?? false) } };
				},
				subscribeState(listener) {
					const stop = ctx.get("betterSidebar")?.subscribeState(listener);
					const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(listener);
					if (typeof document !== "undefined" && document.body) {
						// v0.18.2：左侧会话列表抽屉（窄窗口遮罩）的展开/收起也要驱动派生可见性。
						observer?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-sidebar-right-open", "hidden", "data-sidebar-drawer", "data-sidebar-collapsed"] });
					}
					return () => { stop?.(); observer?.disconnect(); };
				},
			};
		}
		function collapseSidebars(ctx) {
			const official = ctx.get("sidebarRight");
			let attempted = false;
			if (official?.isExpanded?.() && typeof official.toggleExpanded === "function") {
				try { official.toggleExpanded(); attempted = true; } catch { /* 会话已卸载时延迟恢复 HUD。 */ }
			}
			if (ctx.get("betterSidebar")?.getSnapshot().state?.panelOpen) attempted = clickSidebarCollapse() || attempted;
			return attempted;
		}

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
		/** 打开 HUD：先记录展开意图，再尝试收起右侧栏（HUD 优先）。
		 *  侧栏收起失败（版本兼容降级）时面板保持隐藏，
		 *  待用户手动关闭右侧栏后由派生可见性自动展示。 */
		function openHud(ctx) {
			hudUserToggled = true;
			setHudOpen(true);
			collapseSidebars(ctx);
		}
		function toggleHud(ctx) {
			hudUserToggled = true;
			if (isHudVisible()) setHudOpen(false);
			else openHud(ctx);
		}
		/** 侧栏可见性监视：DOM 标记 + better-sidebar 服务（服务可能晚到：slots/changed 时重挂）。 */
		function attachSidebarWatcher(ctx) {
			let unsubscribe = null;
			const read = () => sidebarBridge(ctx).getSnapshot().state?.panelOpen ?? false;
			const readDrawer = () => readLeftDrawerOpen();
			const sync = () => {
				if (unsubscribe !== null) { unsubscribe(); unsubscribe = null; }
				// 初始/重挂时立即对账一次，随后由 DOM 变更与 better-sidebar 状态驱动。
				setSidebarExpanded(read());
				setLeftDrawerOpen(readDrawer());
				unsubscribe = sidebarBridge(ctx).subscribeState(() => {
					setSidebarExpanded(read());
					// v0.18.2：左侧抽屉同样影响派生可见性（仅在值变化时广播）。
					setLeftDrawerOpen(readDrawer());
				});
			};
			sync();
			sync.dispose = () => { unsubscribe?.(); unsubscribe = null; };
			return sync;
		}

		// —— 样式（完全对照 HUD_preview 设计稿：单卡片 + 分隔线分区；
		//     颜色全部经 --dsw-alias-* token / color-mix，支持浅深主题）——
		const css = ".hud-btn{border:1px solid var(--dsw-alias-border-l2);width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:0;font-size:13px;line-height:20px;display:inline-flex}.hud-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.hud-icon{color:var(--dsw-alias-label-primary)}.hud-panel{position:fixed;width:300px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;background:var(--hud-surface-bg,var(--dsw-static-neutral-bluish-00));border:0.5px solid var(--dsw-alias-border-l2);border-radius:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;user-select:none}.hud-panel[data-side=right]{right:8px}.hud-panel[data-side=left]{left:8px;right:auto}.hud-panel-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;scrollbar-width:none;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-panel-body::-webkit-scrollbar{width:0;height:0;display:none}.hud-panel-body::-webkit-scrollbar-thumb,.hud-panel-body::-webkit-scrollbar-track{background:transparent}.hud-section{flex:none;border:0;background:0 0}.hud-panel-body>.hud-section{border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-panel-body>.hud-section:first-child{border-top:0}.hud-module-head{display:flex;align-items:center;gap:8px;padding:10px 14px;min-height:20px;cursor:default;position:relative}.hud-module-head[data-fold=true]{cursor:pointer}.hud-module-title{font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}.hud-module-count{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-module-pill{flex:none;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-radius:999px;padding:1px 9px;font-size:11px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary);border:0}.hud-module-fold{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;padding:0;display:inline-flex;align-items:center;justify-content:center;transition:transform .15s var(--ds-ease-in-out,ease)}.hud-module-fold[data-fold=true]{transform:rotate(-90deg)}.hud-module-body{padding:2px 14px 12px;display:flex;flex-direction:column;gap:6px}.hud-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;min-width:0}.hud-row-label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-chip{flex:none;border-radius:999px;padding:1px 9px;font-size:11px;line-height:18px;font-weight:500;border:0}.hud-chip[data-kind=busy]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}.hud-chip[data-kind=done]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent)}.hud-chip[data-kind=warn]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-chip[data-kind=pending]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}.hud-chip[data-kind=idle]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-session-meta{display:flex;flex-direction:column;gap:6px;padding:2px 14px 12px}.hud-session-name-row{display:flex;align-items:center;gap:8px}.hud-session-name{box-sizing:border-box;display:block;font:inherit;font-weight:500;font-size:13px;line-height:20px;min-width:0;max-width:100%;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);text-align:left;border:0;appearance:none;-webkit-appearance:none;background:0 0;border-radius:6px;padding:2px 6px;margin:-2px 0 -2px -6px;cursor:pointer;transition:background .12s var(--ds-ease-in-out,ease)}.hud-session-name:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-session-name:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.hud-session-name:disabled{cursor:default}.hud-session-name-row .hud-chip{margin-left:auto}.hud-session-edit{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:3px 9px;font-size:13px;line-height:19px;font-family:inherit}.hud-session-edit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-session-edit::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-model-row{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;min-width:0}.hud-model-row .hud-model-note{color:var(--dsw-alias-label-secondary)}.hud-model-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;display:inline-block}.hud-model-chips{display:flex;align-items:center;gap:6px}.hud-model-chip{border-radius:999px;padding:2px 10px;font-size:11px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary);border:0;flex:none}.hud-context-count{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}.hud-context-row{display:flex;align-items:center;gap:10px;padding:2px 14px 2px}.hud-bar{position:relative;flex:1 1 auto;height:18px;display:flex;align-items:center;cursor:help}.hud-bar-track{width:100%;height:8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);overflow:hidden}.hud-bar-fill{height:100%;border-radius:999px;transition:width .3s var(--ds-ease-in-out,ease)}.hud-context-segments{display:flex;height:100%;border-radius:999px;overflow:hidden}.hud-context-segment{height:100%;flex:none}.hud-context-stats{display:flex;flex-direction:column;gap:3px;padding:0 14px 10px}.hud-context-stat{display:flex;align-items:center;gap:6px;min-width:0;padding:2px 6px;margin-left:-6px;border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:help;transition:background .12s var(--ds-ease-in-out,ease)}.hud-context-stat:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-context-stat .hud-icon{color:var(--dsw-alias-label-tertiary)}.hud-context-stat-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}.hud-context-tip{position:fixed;z-index:2147483006;width:min(260px,calc(100vw - 24px));box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 8px 26px rgba(0,0,0,.2);padding:9px 10px;pointer-events:none;color:var(--dsw-alias-label-primary);animation:hud-tip-in .12s var(--ds-ease-in-out,ease)}.hud-context-tip[data-below=false]{transform:translateY(-100%)}.hud-context-tip-head{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}.hud-context-tip-head .hud-icon{color:var(--dsw-alias-label-secondary)}.hud-context-tip-head-value{margin-left:auto;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}.hud-context-tip-rule{height:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:7px 0 5px}.hud-context-tip-rows{display:flex;flex-direction:column;gap:3px}.hud-context-tip-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-context-tip-label{display:inline-flex;align-items:center;gap:6px;min-width:0}.hud-context-tip-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}.hud-context-swatch{display:inline-block;flex:none;width:8px;height:8px;border-radius:2px}.hud-btn-small{flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.hud-btn-small:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-btn-small:disabled{opacity:.55;cursor:not-allowed}.hud-file-row{display:flex;align-items:center;gap:8px;font-size:13px;line-height:24px;min-width:0}.hud-file-status{flex:none;border-radius:6px;padding:0 6px;min-width:18px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:11px;line-height:18px;border:1px solid transparent}.hud-file-status[data-kind=M]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 15%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent)}.hud-file-status[data-kind=A]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}.hud-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}.hud-file-status[data-kind=?]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent)}.hud-file-status[data-kind=R]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-status[data-kind=C]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-diff{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:18px}.hud-diff-add{color:var(--dsw-alias-state-success-primary)}.hud-diff-del{color:var(--dsw-alias-state-error-primary)}.hud-git-btn{align-self:flex-start}.hud-git-summary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding-top:2px}.hud-balance-value{flex:none;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-click{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}.hud-click:hover{color:var(--dsw-alias-state-business-primary)}.hud-usage-row{padding-left:24px;align-items:center}.hud-subagent-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-subagent-row:hover .hud-subagent-name{color:var(--dsw-alias-brand-primary)}.hud-subagent-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-subagent-arrow{flex:none;color:var(--dsw-alias-label-secondary)}.hud-task-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-task-icon{flex:none;width:16px;height:16px;display:inline-flex}.hud-task-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-task-row[data-done=true] .hud-task-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-mcp-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-mcp-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-mcp-row[data-off=true] .hud-mcp-name{color:var(--dsw-alias-label-secondary)}.hud-switch{flex:none;width:30px;height:18px;border-radius:999px;border:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);position:relative;cursor:pointer;padding:0;transition:background .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]{background:var(--dsw-alias-state-success-primary)}.hud-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]::after{left:14px}.hud-settings-btn{flex:none;border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px;display:inline-flex;border-radius:6px}.hud-settings-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-settings-grip{flex:none;width:18px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;display:inline-flex;align-items:center;justify-content:center;padding:0;margin-left:-2px}.hud-settings-grip:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-secondary)}.hud-settings-grip:active{cursor:grabbing}.hud-settings-btn[data-kind=reset]{border:1px solid transparent;background:0 0;color:var(--dsw-alias-label-secondary);margin-right:auto}.hud-settings-btn[data-kind=reset]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}.hud-settings-btn[data-kind=reset]:disabled{opacity:.45;cursor:not-allowed}.hud-settings-btn{flex:none;border-radius:8px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-settings-btn[data-kind=cancel]{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.hud-settings-btn[data-kind=cancel]:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-btn[data-kind=confirm]{border:1px solid transparent;background:var(--dsw-alias-state-business-primary);color:#fff}.hud-settings-btn[data-kind=confirm]:hover{filter:brightness(1.06)}.hud-modal{position:fixed;inset:0;z-index:2147483001;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}.hud-modal-card{width:min(680px,calc(100vw - 40px));max-height:min(70vh,calc(100vh - 48px));display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;animation:hud-modal-in .16s var(--ds-ease-in-out,ease)}.hud-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-modal-title{flex:1 1 auto;min-width:0;font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-modal-close{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;flex:none}.hud-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover)}.hud-modal-close:focus-visible,.hud-git-btn:focus-visible,.hud-btn:focus-visible,.hud-git-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.hud-modal-body{min-height:0;padding:12px 14px 14px;display:flex;flex-direction:column}.hud-git-graph{flex:1 1 auto;min-height:120px;overflow:auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-rows{display:flex;flex-direction:column;gap:2px;min-width:0;padding-bottom:2px}.hud-git-item{display:flex;align-items:stretch;min-width:0;border-radius:8px;box-sizing:border-box;background:transparent;transition:background .12s var(--ds-ease-in-out,ease)}.hud-git-item[data-open=true]{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}.hud-git-lane{position:relative;flex:none;border-radius:8px 0 0 8px;min-height:40px}.hud-git-lane-svg{position:absolute;left:0;top:0;display:block;pointer-events:none}.hud-git-content{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}.hud-git-head{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:40px;padding:0 14px 0 10px;box-sizing:border-box;border:0;background:0 0;border-radius:8px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary);font:inherit}.hud-git-head:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}.hud-git-head[data-open=true]{border-radius:8px 8px 0 0}.hud-git-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:19px;font-weight:500;color:var(--dsw-alias-label-primary)}.hud-git-subject[data-open=true]{font-weight:600}.hud-git-refs{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:40%;overflow:hidden}.hud-git-ref{flex:none;display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:1px 7px;font-size:10px;line-height:16px;border:1px solid transparent;white-space:nowrap}.hud-git-ref[data-kind=branch]{color:#fff;background:var(--dsw-alias-state-business-primary);border-color:transparent;font-weight:500}.hud-git-ref[data-kind=head]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent)}.hud-git-ref[data-kind=tag]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}.hud-git-date{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.hud-git-drawer{min-height:0;overflow:auto;box-sizing:border-box;padding:0 14px 10px 18px;display:flex;flex-direction:column;justify-content:flex-start;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-file{display:flex;align-items:center;gap:8px;height:26px;min-width:0;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei')}.hud-git-file-badge{flex:none;width:32px;font-size:11px;line-height:16px;font-weight:700;color:var(--dsw-alias-label-secondary)}.hud-git-file-badge[data-kind=js]{color:#f3b020}.hud-git-file-badge[data-kind=ts]{color:var(--dsw-alias-state-business-primary)}.hud-git-file-badge[data-kind=svg]{color:#22c55e}.hud-git-file-name{flex:none;max-width:56%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-git-file-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);padding-right:8px}.hud-git-file-status{flex:none;width:18px;text-align:right;font-size:12px;line-height:19px;font-weight:700}.hud-git-file-status[data-kind=M]{color:var(--dsw-alias-state-warn-primary)}.hud-git-file-status[data-kind=A]{color:var(--dsw-alias-state-success-primary)}.hud-git-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary)}.hud-git-file-status[data-kind=R],.hud-git-file-status[data-kind=C]{color:var(--dsw-alias-state-business-primary)}.hud-git-file-status[data-kind='?']{color:var(--dsw-alias-state-error-primary)}.hud-git-file-empty{display:flex;align-items:center;height:26px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-git-menu{position:fixed;z-index:2147483005;width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 10px 34px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}.hud-git-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;cursor:pointer;text-align:left}.hud-git-menu-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-git-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-git-menu-item .hud-icon{color:var(--dsw-alias-label-secondary)}.hud-git-tip{position:fixed;z-index:2147483006;max-width:460px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--hud-surface-bg);box-shadow:0 8px 26px rgba(0,0,0,.2);padding:7px 10px;pointer-events:none;animation:hud-tip-in .12s var(--ds-ease-in-out,ease);display:flex;flex-direction:column;gap:2px}.hud-git-tip[data-below=false]{transform:translateY(-100%)}.hud-git-tip-subject{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.hud-git-tip-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');word-break:break-all}.hud-git-tip-refs{display:flex;flex-wrap:wrap;gap:4px;min-width:0;max-width:100%;padding:1px 0 2px}.hud-git-tip-ref{flex:0 1 auto;min-width:0;max-width:100%}.hud-git-tip-ref-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@keyframes hud-tip-in{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.hud-git-tip,.hud-file-tip{animation:none}}.hud-graph-loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:4px 2px}.hud-spinner{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);border-top-color:var(--dsw-alias-state-business-primary);animation:hud-spin .7s linear infinite}.hud-graph-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:6px 2px}.hud-graph-empty{display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:4px 2px}@keyframes hud-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}@keyframes hud-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.hud-modal-card{animation:none}.hud-spinner{animation-duration:1.4s}}.hud-toasts{position:fixed;bottom:12px;right:12px;z-index:2147483002;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}.hud-toast{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:9px;padding:8px 12px;font-size:13px;line-height:19px;box-shadow:0 4px 16px rgba(0,0,0,.16)}.hud-toast[data-kind=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-error-primary)}.hud-toast[data-kind=success]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-success-primary)}.hud-toast[data-kind=warn]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-warn-primary)}body{--hud-surface-bg:var(--dsw-static-neutral-bluish-00);--hud-lane-0:#4176e6;--hud-lane-1:#22c55e;--hud-lane-2:#f59e0b;--hud-lane-3:#f25a5a;--hud-lane-4:#60a5fa;--hud-lane-5:#7c3aed}body[data-ds-dark-theme]{--hud-surface-bg:var(--dsw-static-neutral-bluish-900);--hud-lane-0:#679efe;--hud-lane-1:#4ed17e;--hud-lane-2:#f7ad31;--hud-lane-3:#f25a5a;--hud-lane-4:#93c5fd;--hud-lane-5:#a78bfa}.hud-plan-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-plan-row:hover .hud-plan-name{color:var(--dsw-alias-brand-primary)}.hud-plan-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-plan-row[data-state=discarded] .hud-plan-name,.hud-plan-row[data-state=approved] .hud-plan-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-plan-meta{display:flex;align-items:center;gap:8px;padding:0 0 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.hud-plan-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 2px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-plan-body h1{font-size:17px;line-height:24px;font-weight:700;margin:10px 0 6px}.hud-plan-body h1:first-child{margin-top:0}.hud-plan-body h2{font-size:15px;line-height:22px;font-weight:700;margin:10px 0 6px}.hud-plan-body h3{font-size:14px;line-height:20px;font-weight:700;margin:8px 0 5px}.hud-plan-body h4,.hud-plan-body h5,.hud-plan-body h6{font-size:13px;line-height:19px;font-weight:700;margin:8px 0 5px}.hud-plan-body p{margin:5px 0}.hud-plan-body ul,.hud-plan-body ol{margin:5px 0;padding-left:22px}.hud-plan-body li{margin:2px 0}.hud-plan-body code{font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);border-radius:4px;padding:1px 5px}.hud-plan-body pre{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:8px;padding:8px 10px;overflow:auto;margin:6px 0}.hud-plan-body pre code{background:0 0;padding:0;font-size:12px;line-height:18px;white-space:pre}.hud-plan-body a{color:var(--dsw-alias-state-business-primary);text-decoration:underline;text-underline-offset:3px}.hud-plan-body blockquote{margin:6px 0;padding:2px 12px;border-left:3px solid color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);color:var(--dsw-alias-label-secondary)}.hud-plan-body hr{border:0;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:8px 0}.hud-task-progress{color:var(--dsw-alias-state-business-primary);fill:none;display:block;animation:1s linear infinite hud-task-spin}@keyframes hud-task-spin{to{transform:rotate(360deg)}}.hud-plan-body .hud-plan-table-wrap{max-width:100%;overflow-x:auto;margin:6px 0}.hud-plan-body table{border-collapse:collapse;font-size:12.5px;line-height:19px;min-width:100%}.hud-plan-body th,.hud-plan-body td{border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);padding:4px 8px;text-align:left;vertical-align:top}.hud-plan-body th{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);font-weight:600}.hud-plan-body table code{font-size:11.5px}.hud-git-actions{display:flex;align-items:center;gap:4px;flex-wrap:nowrap;padding-bottom:2px}.hud-git-actions .hud-btn-small{flex:none;white-space:nowrap;gap:4px;padding:4px 9px}.hud-icon[data-size] svg{width:13px!important;height:13px!important}.hud-icon[data-size='14'] svg{width:14px!important;height:14px!important}.hud-git-group{flex:none;display:flex;align-items:baseline;gap:7px;padding:8px 0 2px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}.hud-git-group-count{flex:none;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary)}.hud-git-group-btn{flex:none;width:18px;height:18px;margin-left:auto;padding:0;border:0;border-radius:99px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-git-group-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}.hud-git-group-btn:disabled{opacity:.4;cursor:not-allowed}.hud-git-file-btn{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:2px 4px;box-sizing:border-box;border:0;border-radius:6px;background:0 0;cursor:pointer;text-align:left;font-size:13px;line-height:24px;color:var(--dsw-alias-label-primary)}.hud-git-file-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-git-file-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-file-tip{position:fixed;z-index:2147483006;max-width:min(520px,calc(100vw - 24px));box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--hud-surface-bg);box-shadow:0 8px 26px rgba(0,0,0,.2);padding:5px 9px;pointer-events:none;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;word-break:break-all;animation:hud-tip-in .12s var(--ds-ease-in-out,ease)}.hud-confirm-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.hud-confirm-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}.hud-confirm-note-danger{color:var(--dsw-alias-state-error-primary)}.hud-confirm-list{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:8px;padding:6px 10px;display:flex;flex-direction:column;gap:2px;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-confirm-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);padding-top:10px}.hud-btn-danger{flex:none;border:1px solid transparent;background:var(--dsw-alias-state-error-primary);color:#fff;border-radius:8px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-btn-danger:hover{filter:brightness(1.06)}.hud-btn-danger:disabled{opacity:.55;cursor:not-allowed}.hud-commit-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}.hud-commit-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:7px 10px;font-size:13px;line-height:19px}.hud-commit-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-commit-input::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-commit-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);padding-top:10px}.hud-btn-ai{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer}.hud-btn-ai:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}.hud-btn-ai:disabled{opacity:.55;cursor:not-allowed}.hud-git-more{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 2px 4px}.hud-git-more-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 16px;font-size:12px;line-height:18px;cursor:pointer}.hud-git-more-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.hud-git-more-btn:disabled{opacity:.55;cursor:not-allowed}.hud-git-more-loading{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.hud-git-more-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;text-align:center;flex-wrap:wrap}.hud-git-more-end{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:8px 2px 4px}.hud-output-row{display:flex;align-items:baseline;gap:6px;width:100%;min-width:0;box-sizing:border-box;padding:3px 4px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;font:inherit;font-size:13px;line-height:20px}.hud-output-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-output-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-output-name{flex:none;max-width:60%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.hud-output-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-output-hint{padding-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.hud-list-more{width:100%;box-sizing:border-box;padding:3px 4px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;text-align:left}.hud-list-more:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-list-more:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-note-area{box-sizing:border-box;width:100%;min-height:56px;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:8px 10px;font-size:13px;line-height:19px;font-family:inherit}.hud-note-area:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-note-area::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-note-wrap{position:relative}.hud-note-resize{position:absolute;left:0;right:0;bottom:0;height:8px;cursor:ns-resize;touch-action:none;z-index:1;display:flex;align-items:flex-end;justify-content:center}.hud-note-resize::after{content:'';position:absolute;left:8px;right:8px;bottom:2px;height:2px;border-radius:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);transition:background .12s var(--ds-ease-in-out,ease)}.hud-note-resize:hover::after,.hud-note-resize:active::after{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent)}.hud-note-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.hud-note-buttons{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:nowrap;min-width:0;flex:1 1 100%}.hud-note-buttons[data-stacked]{flex-wrap:wrap}.hud-note-buttons[data-stacked] .hud-btn-small{box-sizing:border-box;white-space:nowrap}.hud-note-buttons[data-stacked] .hud-note-clear{order:-1;flex:1 0 100%;justify-content:center}.hud-note-buttons[data-stacked] .hud-note-import,.hud-note-buttons[data-stacked] .hud-note-send{flex:1 1 0;min-width:0;justify-content:center;padding-left:8px;padding-right:8px}.hud-todo-input-row{display:flex;align-items:center;gap:6px}.hud-todo-input{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:6px 9px;font-size:13px;line-height:18px;font-family:inherit}.hud-todo-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-todo-input::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-ic-btn{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-ic-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}.hud-ic-btn:disabled{opacity:.45;cursor:not-allowed}.hud-ic-btn[data-kind=confirm]:hover:not(:disabled){color:var(--dsw-alias-state-success-primary)}.hud-todo-list{display:flex;flex-direction:column;gap:2px}.hud-todo-list[data-settling=true] .hud-todo-item{transition:none}.hud-todo-item{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:8px;min-width:0;transition:transform .16s var(--ds-ease-in-out,ease)}.hud-todo-item[data-dragging=true]{opacity:.55;position:relative;z-index:2;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);outline:1px dashed color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);outline-offset:-1px}.hud-todo-check{flex:none;width:20px;height:20px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-todo-check:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-todo-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-todo-item[data-done=true] .hud-todo-text{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-todo-edit{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:3px 8px;font-size:13px;line-height:18px;font-family:inherit}.hud-todo-edit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-todo-grip{flex:none;width:22px;height:24px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-todo-grip:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-secondary)}.hud-todo-grip:active{cursor:grabbing}.hud-modal-card-sm{width:min(360px,calc(100vw - 40px))}.hud-branch-switch{max-width:150px}.hud-branch-switch .hud-icon{color:inherit}.hud-branch-switch span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-branch-menu{position:fixed;z-index:2147483005;min-width:210px;max-width:280px;max-height:min(320px,50vh);overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 10px 34px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}.hud-branch-add{flex:none;display:flex;align-items:center;gap:4px;padding:1px 2px}.hud-branch-add-input{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:4px 8px;font-size:12px;line-height:18px;font-family:inherit}.hud-branch-add-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-branch-divider{flex:none;height:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:2px 4px}.hud-branch-scroll{overflow-y:auto;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;gap:2px}.hud-branch-menu .hud-git-menu-item[data-current=true]{color:var(--dsw-alias-state-business-primary);font-weight:600}.hud-branch-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.hud-branch-check{flex:none;width:14px;text-align:center}.hud-branch-note{padding:5px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-branch-note-error{color:var(--dsw-alias-state-error-primary)}.hud-git-menu-divider{flex:none;height:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:3px 4px}.hud-git-menu-item:disabled{opacity:.55;cursor:not-allowed}.hud-git-menu-item:disabled:hover{background:0 0}.hud-btn[data-open=false]{color:var(--dsw-alias-label-tertiary)}.hud-btn[data-open=false]:hover{color:var(--dsw-alias-label-secondary)}.hud-module-head .hud-branch-switch{margin-left:-4px}.hud-settings-modal{padding:12px}.hud-settings-modal-card{width:min(760px,calc(100vw - 40px));height:min(760px,calc(100vh - 24px));max-height:calc(100vh - 24px)}.hud-settings-panes{flex:1 1 auto;min-height:0;display:flex;align-items:stretch}.hud-settings-pane{min-height:0;box-sizing:border-box}.hud-settings-pane-modules{flex:none;width:240px;display:flex;flex-direction:column;gap:8px;padding:12px 12px 12px 14px;overflow:hidden;border-right:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-settings-pane-detail{flex:1 1 auto;min-width:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 14px;display:flex;flex-direction:column;gap:14px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-settings-section{display:flex;flex-direction:column;gap:8px;min-width:0}.hud-settings-section-head{display:flex;align-items:baseline;gap:8px;min-width:0}.hud-settings-section-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}.hud-settings-section-hint{flex:1 1 auto;min-width:0;text-align:right;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.hud-settings-pane-modules .hud-settings-section-head{flex-direction:column;align-items:flex-start;gap:2px}.hud-settings-pane-modules .hud-settings-section-hint{flex:none;text-align:left}.hud-settings-list{display:flex;flex-direction:column;gap:6px;min-height:0;flex:none}.hud-settings-list[data-settling=true] .hud-settings-card{transition:none}.hud-settings-card{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);transition:border-color .12s var(--ds-ease-in-out,ease),background .12s var(--ds-ease-in-out,ease),opacity .12s var(--ds-ease-in-out,ease),transform .16s var(--ds-ease-in-out,ease)}.hud-settings-card:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-card:focus-within{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,var(--dsw-alias-border-l2))}.hud-settings-card[data-off=true]{opacity:.58;background:transparent}.hud-settings-card[data-off=true]:hover{opacity:.8}.hud-settings-card[data-locked=true]{opacity:.55;cursor:default}.hud-settings-card[data-locked=true]:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}.hud-settings-card[data-locked=true] .hud-settings-card-label{cursor:default}.hud-settings-card[data-locked=true] input[type=checkbox]{cursor:not-allowed}.hud-settings-card[data-dragging=true]{opacity:.55;position:relative;z-index:2;border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);box-shadow:0 6px 18px rgba(0,0,0,.25)}.hud-settings-card-label{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;cursor:pointer}.hud-settings-card-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary)}.hud-settings-card input[type=checkbox]{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}.hud-settings-footer{flex:none;display:flex;align-items:center;gap:8px;padding:10px 16px 12px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-settings-section-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}.hud-settings-section-card>.hud-settings-section-title{padding:2px 2px 4px}.hud-setting-row{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:6px 2px}.hud-setting-row[data-disabled=true] .hud-setting-name{color:var(--dsw-alias-label-secondary)}.hud-setting-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}.hud-setting-name{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.hud-setting-name .hud-icon{color:var(--dsw-alias-label-secondary);flex:none}.hud-setting-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.hud-setting-control{flex:none;display:flex;align-items:center;min-height:20px}.hud-official-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}.hud-official-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.hud-official-switch:disabled{cursor:default;opacity:.5}.hud-official-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.hud-official-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}.hud-official-switch[aria-checked=false] .hud-official-switch-thumb{background:var(--dsw-alias-switch-thumb)}.hud-official-switch[aria-checked=true] .hud-official-switch-thumb{transform:translate(16px)}.hud-seg{display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:4px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-interactive-bg-hover)}.hud-seg-item{border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-secondary);padding:2px 12px;font-size:12px;line-height:18px;cursor:pointer;font-family:inherit}.hud-seg-item:hover:not(:disabled):not([data-on=true]){color:var(--dsw-alias-label-primary)}.hud-seg-item[data-on=true]{background:var(--dsw-alias-bg-layer-1,var(--hud-surface-bg));color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft,0 1px 2px rgba(0,0,0,.12))}.hud-seg-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-seg-item:disabled{opacity:.5;cursor:not-allowed}@media(max-height:640px){.hud-settings-pane-modules{padding:8px 10px;gap:6px}.hud-settings-card{padding:4px 7px;gap:6px}.hud-settings-list{gap:4px}.hud-settings-pane-detail{padding:8px 14px 10px;gap:10px}.hud-setting-row{padding:4px 2px}}";

		/** store 基础 hook（SnapshotStore → React 订阅）。 */
		function useSnapshot(store, selector, fallback) {
			const [value, setValue] = react.useState(() => (store === undefined ? fallback : selector(store.getSnapshot())));
			react.useEffect(() => {
				if (store === undefined) return undefined;
				const listener = () => setValue(selector(store.getSnapshot()));
				const unsubscribe = store.subscribe(listener);
				// 订阅后立即同步，覆盖会话切换以及 render 到 effect 之间发生的更新。
				listener();
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

		/**
		 * v0.19.0：会话状态 → 视觉口径（徽章 kind + i18n 文案键 + 鲸鱼配色）。
		 * 「空闲 = 黑 / 等待（待批准·待回答·等子代理）= 黄 / 工作中 = 蓝」统一在此映射。
		 * @param statusKey deriveSessionStatus 的结果。
		 */
		function sessionStatusView(statusKey) {
			const pending = { kind: "pending", color: "var(--dsw-alias-state-warn-primary)" };
			switch (statusKey) {
				case "running": return { kind: "busy", textKey: "statusRunning", color: "var(--dsw-alias-state-business-primary)" };
				case "approval": return { ...pending, textKey: "statusApproval" };
				case "answer": return { ...pending, textKey: "statusAnswer" };
				case "subagents": return { ...pending, textKey: "statusSubagents" };
				default: return { kind: "idle", textKey: "statusIdle", color: "var(--dsw-alias-label-primary)" };
			}
		}

		/** Root hook is supplied by dsh-client-ui-session in rc.1. Keep the HUD
		 * renderable if an older or incomplete module graph omits that hook. */
		function useNoPendingInteraction() {
			return undefined;
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
			return { context: true, git: true, outputs: true, subagents: true, tasks: true, mcp: true, balance: true, plans: true, note: true, todo: true };
		}
		function defaultUsageDisplay() {
			// v0.18.2：showJump 与三行用量数据同属「用量设置」，默认展示「跳转」按钮。
			return { deepseek: true, opencode: true, codex: true, showJump: true };
		}
		function defaultContextSettings() {
			// v0.18.7：pinned = 上下文模块固定在会话模块下方（默认关闭，升级后面板观感不变）。
			return { barStyle: "default", showStats: true, showUsage: true, pinned: false };
		}
		/** 与 host 同规则收敛上下文设置；旧设置缺字段时直接使用默认值。 */
		function normalizeContextSettings(value) {
			const base = defaultContextSettings();
			if (value === null || typeof value !== "object" || Array.isArray(value)) return base;
			return {
				barStyle: value.barStyle === "segmented" || value.barStyle === "default" ? value.barStyle : base.barStyle,
				showStats: typeof value.showStats === "boolean" ? value.showStats : base.showStats,
				showUsage: typeof value.showUsage === "boolean" ? value.showUsage : base.showUsage,
				pinned: typeof value.pinned === "boolean" ? value.pinned : base.pinned,
			};
		}
		/**
		 * v0.16.0：模块默认展示顺序（与 host lib/settings.js 的 DEFAULT_MODULE_ORDER 保持一致）。
		 * 只需与 host 侧同步这一份默认值；实际顺序始终由 host 读侧收敛后下发。
		 */
		function defaultModuleOrder() {
			return [...MODULE_KEYS];
		}
		/**
		 * v0.16.0：把任意顺序收敛成 MODULE_KEYS 的完整排列（与 host normalizeModuleOrder 同规则）。
		 * 客户端也要收敛一次：设置弹窗的草稿来自可能残缺的历史数据，
		 * 面板渲染更不能因为顺序数组缺项而漏渲染模块。
		 * @param value 顺序数组（可能残缺、含未知键或重复）。
		 * @returns 完整且无重复的模块顺序。
		 */
		function normalizeModuleOrder(value) {
			const fallback = defaultModuleOrder();
			if (!Array.isArray(value)) return fallback;
			const seen = new Set();
			const out = [];
			for (const key of value) {
				if (typeof key !== "string" || !MODULE_KEYS.includes(key) || seen.has(key)) continue;
				seen.add(key);
				out.push(key);
			}
			for (const key of MODULE_KEYS) {
				if (seen.has(key)) continue;
				seen.add(key);
				// v0.19.1：补齐缺失键时按锚点落位（`outputs` 排在 `git` 之前），旧配置补进来的
				// `outputs` 不会停在末尾。锚点直接内联（不引用模块级常量），这样测试可以把
				// 本函数单独抽出来跑。
				// v0.19.2：锚点只对「保存顺序里缺失的键」生效——用户拖动后的位置必须原样保留，
				// 否则每次确认设置都会被拉回锚点旁，看起来像排序没生效。
				const pair = [["outputs", "git"]].find(([anchored]) => anchored === key);
				const anchorIndex = pair === undefined ? -1 : out.indexOf(pair[1]);
				if (anchorIndex >= 0) out.splice(anchorIndex, 0, key);
				else out.push(key);
			}
			return out;
		}
		/**
		 * v0.18.7：「上下文模块位置固定」的可用性判定（纯函数，设置弹窗与面板共用）。
		 * 规则：只有「已启用模块」排序首位是 context 时才允许固定；被隐藏的模块直接给出 hidden 原因。
		 * 口径取舍：按「已启用」而不是「当前恰好渲染出 DOM」判定——subagents/tasks/plans 数据为空时
		 * 不渲染任何节点，若按 DOM 判定，开关会随数据出现/消失来回置灰，用户无法预期。
		 * @param order 模块顺序（任意，内部归一化）
		 * @param modules 模块开关（false = 隐藏）
		 * @returns {{ allowed: boolean, reason: null | "hidden" | "order" }}
		 */
		function contextPinState(order, modules) {
			if (modules !== null && modules !== undefined && modules.context === false) return { allowed: false, reason: "hidden" };
			const firstEnabled = normalizeModuleOrder(order).filter((key) => modules?.[key] !== false)[0];
			return firstEnabled === "context" ? { allowed: true, reason: null } : { allowed: false, reason: "order" };
		}

		// 会话入口依赖两个服务：先等列表就绪，再读取当前视图；否则新建页首帧可能没有按钮。
		const inject = ["slots", "locale", "sessions", "uiSession"];

		/** 同一 bundle 实例只 apply 一次：防宿主对同一实例重复应用造成
		 *  slots 注册/面板内容重复累积（HMR 新 bundle 走新闭包，不受影响）。 */
		let applied = false;

		function apply(ctx) {
			if (applied) return;
			applied = true;
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-awesome-hud: dictionaries");
			const t = ctx.locale.bind(NS);

			ctx.effect(() => {
				if (typeof document === "undefined") return;
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-awesome-hud";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = `${css}.hud-breakdown{justify-content:flex-start;white-space:nowrap}.hud-breakdown-item{min-width:0;overflow:hidden;text-overflow:ellipsis}.hud-breakdown-sep{flex:none;color:var(--dsw-alias-label-tertiary)}.hud-git-ref[data-kind=branch]{color:#111827;background:#e5e7eb;border-color:#d1d5db}.hud-git-ref[data-kind=branch][data-current=true]{color:#fff;background:var(--dsw-alias-state-business-primary);border-color:transparent}.hud-git-graph-menu{width:238px}.hud-git-menu-reset-confirm,.hud-git-menu-merge-confirm{display:flex;align-items:center;gap:5px;padding:1px 0}.hud-git-menu-confirm,.hud-git-menu-cancel{flex:1 1 0;border:0;border-radius:6px;padding:3px 7px;font-size:12px;line-height:17px;cursor:pointer}.hud-git-menu-confirm{background:var(--dsw-alias-state-error-primary);color:#fff}.hud-git-menu-confirm:hover:not(:disabled){filter:brightness(1.06)}.hud-git-menu-cancel{background:#e5e7eb;color:#111827}.hud-git-menu-cancel:hover:not(:disabled){background:#d1d5db}.hud-git-menu-confirm:disabled,.hud-git-menu-cancel:disabled{opacity:.55;cursor:not-allowed}.hud-commit-input{min-height:76px;resize:vertical;font-family:inherit}`;
				tag.textContent += ".hud-btn-ai{background:var(--hud-surface-bg)}.hud-btn-ai:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-btn-danger,.hud-git-menu-confirm{border:1px solid var(--dsw-alias-state-error-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-state-error-primary)}.hud-btn-danger:hover:not(:disabled),.hud-git-menu-confirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--hud-surface-bg));filter:none}.hud-note-clear-confirm{border:1px solid var(--dsw-alias-state-error-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-state-error-primary)}.hud-note-clear-confirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--hud-surface-bg));filter:none}.hud-commit-ai-hint{flex:1 1 auto;min-width:0;max-width:300px;text-align:right;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:15px;overflow-wrap:anywhere}.hud-btn-ai-confirm{border-color:var(--dsw-alias-state-error-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-state-error-primary)}.hud-btn-ai-confirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--hud-surface-bg));filter:none}";
				tag.textContent += ".hud-git-menu-cancel{border:1px solid var(--dsw-alias-label-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary)}.hud-git-menu-cancel:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--hud-surface-bg))}.hud-git-menu-branch-create{display:flex;align-items:center;gap:4px;padding:1px 2px}";
				// 入口按钮与官方边栏按钮共用 28px 无边框底座、15px 图标；仅保留悬停底色。
				tag.textContent += ".hud-btn{border:0;width:28px;height:28px;border-radius:28px;padding:6px;box-sizing:border-box;line-height:1}.hud-btn .hud-icon svg{width:15px!important;height:15px!important}";
				// Windows 窗口控件在 HTML 层之上，需让入口位于标题栏下方；鼠标操作不触发窗口拖动。
				tag.textContent += `.hud-btn-float{position:fixed;top:${HUD_FLOAT_INSET}px;z-index:2147482000;-webkit-app-region:no-drag}html[data-windows-titlebar] .hud-btn-float{top:calc(var(--dsh-frame-chrome-top,var(--dsh-windows-titlebar-height,40px)) + ${HUD_FLOAT_INSET}px)}html[data-windows-titlebar][data-fullscreen] .hud-btn-float{top:${HUD_FLOAT_INSET}px}`;
				// v0.18.1：工作区标题（可点击菜单 + 原位改名）、置顶图钉与菜单文案。
				tag.textContent += `.hud-workspace-name{box-sizing:border-box;flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:0;appearance:none;-webkit-appearance:none;background:0 0;font:inherit;font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 6px;margin:-2px -6px;cursor:pointer;transition:background .12s var(--ds-ease-in-out,ease)}.hud-workspace-name:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-workspace-name:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.hud-workspace-edit{box-sizing:border-box;flex:1 1 auto;min-width:0;max-width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:2px 6px;font:inherit;font-weight:600;font-size:13px;line-height:19px;margin:-2px -6px}.hud-workspace-edit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-workspace-edit::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-pin-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;margin-left:-2px}.hud-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
				// v0.18.5：设置弹窗顶部标签行与「使用说明」页（左目录 240px + 右分节卡片）。
				tag.textContent += `.hud-settings-head{padding:0 14px;height:48px;align-items:stretch}.hud-settings-tabs{flex:1 1 auto;min-width:0;display:flex;align-items:stretch;gap:2px}.hud-settings-tab{display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;line-height:19px;font-weight:600;cursor:pointer;white-space:nowrap;transition:color .12s var(--ds-ease-in-out,ease),background .12s var(--ds-ease-in-out,ease)}.hud-settings-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}.hud-settings-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-settings-head .hud-modal-close{align-self:center}.hud-settings-body{flex:1 1 auto;min-height:0;position:relative;display:flex;align-items:stretch}.hud-settings-panes[data-hidden=true]{visibility:hidden;pointer-events:none}.hud-settings-guide{position:absolute;inset:0;display:flex;align-items:stretch}.hud-guide-toc{flex:none;width:240px;box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;padding:12px 10px 12px 14px;display:flex;flex-direction:column;gap:2px;border-right:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-guide-toc-item{display:flex;align-items:center;width:100%;min-width:0;padding:6px 10px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer;transition:background .12s var(--ds-ease-in-out,ease),color .12s var(--ds-ease-in-out,ease)}.hud-guide-toc-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}.hud-guide-toc-item[data-active=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-label-primary);font-weight:600}.hud-guide-toc-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-guide-toc-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-guide-content{flex:1 1 auto;min-width:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 14px;display:flex;flex-direction:column;gap:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-guide-section{display:flex;flex-direction:column;gap:8px;scroll-margin-top:8px;padding:8px 12px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}.hud-guide-section-title{display:flex;align-items:center;margin:0;font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-guide-group{display:flex;flex-direction:column;gap:3px;min-width:0}.hud-guide-group-label{font-size:11px;line-height:16px;font-weight:600;color:var(--dsw-alias-label-secondary)}.hud-guide-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}.hud-guide-item{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}@media(max-height:640px){.hud-settings-head{height:42px}.hud-guide-toc{padding:8px 8px 8px 10px}.hud-guide-content{padding:8px 14px 10px;gap:8px}.hud-guide-section{padding:6px 10px 8px}}`;
				// v0.18.5：待办条目改为卡片式（与「HUD 设置」里的模块卡片同款）；编辑/删除按钮默认隐藏，悬浮或聚焦该行时出现。
				// v0.18.7：操作区改为绝对定位浮层，文字独占整行宽度；行底色抽成变量，浮层本体用同色实底、
				//           左侧用伪元素做 16px 渐隐（实底保证按钮区绝不透字），悬浮时不再挤压文字换行
				//           （此前的「隐藏时仍占位」会白白吃掉约 60px）。
				tag.textContent += `.hud-todo-list{gap:6px}.hud-todo-item{position:relative;padding:6px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:10px;--hud-todo-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--hud-surface-bg));background:var(--hud-todo-bg);transition:transform .16s var(--ds-ease-in-out,ease),border-color .12s var(--ds-ease-in-out,ease),background .12s var(--ds-ease-in-out,ease)}.hud-todo-item:not([data-dragging=true]):hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);--hud-todo-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--hud-surface-bg))}.hud-todo-actions{position:absolute;top:0;bottom:0;right:8px;display:inline-flex;align-items:center;gap:6px;background:var(--hud-todo-bg);opacity:0;visibility:hidden;transition:opacity .12s var(--ds-ease-in-out,ease)}.hud-todo-actions::before{content:'';position:absolute;top:0;bottom:0;right:100%;width:16px;pointer-events:none;background:linear-gradient(90deg,transparent 0,var(--hud-todo-bg) 16px)}.hud-todo-item:hover .hud-todo-actions,.hud-todo-item:has(:focus-visible) .hud-todo-actions{opacity:1;visibility:visible}.hud-todo-item[data-dragging=true] .hud-todo-actions{opacity:0;visibility:hidden}@media(hover:none){.hud-todo-text{padding-right:60px}.hud-todo-actions{opacity:1;visibility:visible}}`;
				// v0.18.6：待办拖动手柄的可拖动热区扩展到整行高度（多行文本也能在整列任意位置直接拖起）。
				tag.textContent += `.hud-todo-grip{align-self:stretch;height:auto;min-height:24px;margin:-6px 0;padding:6px 0}`;
				// v0.18.7：会话名称的悬浮/点击热区改为整行宽度（右侧状态胶囊与置顶图钉仍占位，高度不变）。
				//           工作区名称的基础规则本就是 flex:1 1 auto，这里一并写明，避免后续被改回按文字收缩。
				tag.textContent += `.hud-session-name{flex:1 1 auto}.hud-workspace-name{flex:1 1 auto}`;
				// v0.18.7：「上下文模块位置固定」——开启后上下文模块移出滚动容器，插在会话模块正下方；
				//           固定区 flex:none 不参与收缩（否则面板撑满时会被压缩、统计行被裁掉），
				//           仅用 max-height + 内部滚动兜住矮窗口。
				tag.textContent += `.hud-panel-pin{flex:none;min-height:0;max-height:55vh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-panel-pin::-webkit-scrollbar{width:0;height:0;display:none}`;
				// v0.19.0：便笺图片（缩略图横滑栏 / 悬浮移除 / 灯箱）。
				tag.textContent += `.hud-note-images{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:2px 0 6px;scrollbar-width:none;overscroll-behavior-x:contain}.hud-note-images::-webkit-scrollbar{height:0;display:none}.hud-note-thumb{position:relative;flex:none;width:64px;height:64px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);overflow:hidden;cursor:zoom-in}.hud-note-thumb img{display:block;width:100%;height:100%;object-fit:cover}.hud-note-thumb:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.hud-note-thumb-remove{position:absolute;top:2px;right:2px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;opacity:0;visibility:hidden;transition:opacity .12s var(--ds-ease-in-out,ease)}.hud-note-thumb:hover .hud-note-thumb-remove,.hud-note-thumb:has(:focus-visible) .hud-note-thumb-remove{opacity:1;visibility:visible}@media(hover:none){.hud-note-thumb-remove{opacity:1;visibility:visible}}.hud-note-thumb-remove .hud-icon{color:#fff}.hud-note-lightbox{position:fixed;inset:0;z-index:2147483007;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}.hud-note-lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.5)}.hud-note-lightbox-close{position:absolute;top:16px;right:16px;border:1px solid rgba(255,255,255,.5);background:rgba(0,0,0,.4);color:#fff;border-radius:999px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer}`;
				// v0.20.0：「HUD 面板样式 → 边栏样式」——不再用圆角卡片与页面区分：
				//   面板透明、无圆角、无外描边，通高贴边；仅在朝向会话正文的一侧画 1px 官方边框色分隔线；
				//   面板内部各模块之间的分隔线改为左右各缩进 14px 的浅色细线（模块内容与样式不变）。
				// v0.20.0：Git commit 弹窗内的「AI 生成提示词」区域（可折叠、可编辑、可恢复默认）。
				tag.textContent += `.hud-commit-modal-body{overflow-y:auto;overscroll-behavior:contain}.hud-commit-prompt{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}.hud-commit-prompt-head{display:flex;align-items:center;gap:6px;width:100%;min-width:0;border:0;background:0 0;padding:2px 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;cursor:pointer;text-align:left}.hud-commit-prompt-title{flex:none;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-commit-prompt-badge{flex:none;border-radius:999px;padding:0 7px;font-size:10.5px;line-height:16px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-secondary)}.hud-commit-prompt-chevron{margin-left:auto;flex:none;color:var(--dsw-alias-label-secondary);transition:transform .15s var(--ds-ease-in-out,ease)}.hud-commit-prompt[data-open=true] .hud-commit-prompt-chevron{transform:rotate(180deg)}.hud-commit-prompt-body{display:flex;flex-direction:column;gap:5px}.hud-commit-prompt-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}.hud-commit-prompt-placeholders{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.hud-commit-prompt-input{width:100%;box-sizing:border-box;min-height:110px;max-height:200px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);padding:7px 9px;font-family:inherit;font-size:12px;line-height:18px}.hud-commit-prompt-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-commit-prompt-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.hud-commit-prompt-note{flex:1 1 auto;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.hud-commit-prompt-note[data-kind=error]{color:var(--dsw-alias-state-error-primary)}.hud-commit-prompt-note[data-kind=warn]{color:var(--dsw-alias-state-warn-primary)}`;
				// v0.20.0：便笺多便笺列表视图 / 编辑视图 / 数字步进器样式。
				tag.textContent += `.hud-note-list-view{display:flex;flex-direction:column;gap:6px}.hud-note-list{display:flex;flex-direction:column;gap:6px}.hud-note-list[data-settling=true] .hud-note-bar{transition:none}.hud-note-bar{position:relative;display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:34px;padding:4px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:10px;--hud-note-bar-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--hud-surface-bg));background:var(--hud-note-bar-bg);transition:transform .16s var(--ds-ease-in-out,ease),border-color .12s var(--ds-ease-in-out,ease)}.hud-note-bar:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}.hud-note-bar[data-dragging=true]{opacity:.55;position:relative;z-index:2;border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);box-shadow:0 6px 18px rgba(0,0,0,.25)}.hud-note-grip{flex:none;width:18px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-note-grip:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-secondary)}.hud-note-grip:active{cursor:grabbing}.hud-note-bar-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-note-bar-actions{position:absolute;top:0;bottom:0;right:6px;display:inline-flex;align-items:center;gap:2px;background:var(--hud-note-bar-bg);opacity:0;visibility:hidden;transition:opacity .12s var(--ds-ease-in-out,ease)}.hud-note-bar-actions::before{content:'';position:absolute;top:0;bottom:0;right:100%;width:16px;pointer-events:none;background:linear-gradient(90deg,transparent 0,var(--hud-note-bar-bg) 16px)}.hud-note-bar:hover .hud-note-bar-actions,.hud-note-bar:focus-within .hud-note-bar-actions,.hud-note-bar:has(:focus-visible) .hud-note-bar-actions{opacity:1;visibility:visible}.hud-note-bar[data-dragging=true] .hud-note-bar-actions{opacity:0;visibility:hidden}.hud-note-empty{padding:10px 2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.hud-note-list-actions{display:flex;gap:6px;min-width:0}.hud-note-list-actions .hud-btn-small{flex:1 1 0;min-width:0;justify-content:center}.hud-note-delete-all{width:100%;box-sizing:border-box;justify-content:center}.hud-note-editor{display:flex;flex-direction:column;gap:6px}.hud-note-editor-head{display:flex;align-items:center;gap:6px;min-width:0}.hud-note-back{flex:none;width:24px;height:24px;border:1px solid transparent;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;font-size:11px;line-height:18px}.hud-note-back:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}.hud-note-back:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.hud-note-title-input{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:4px 9px;font:inherit;font-weight:500;font-size:13px;line-height:19px}.hud-note-title-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-note-title-input::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-note-thumb{cursor:grab;touch-action:none;transition:transform .16s var(--ds-ease-in-out,ease)}.hud-note-thumb:active{cursor:grabbing}.hud-note-thumb[data-dragging=true]{z-index:2;box-shadow:0 6px 18px rgba(0,0,0,.28);opacity:.85}.hud-note-images[data-settling=true] .hud-note-thumb{transition:none}@media(hover:none){.hud-note-bar-title{padding-right:52px}.hud-note-bar-actions{opacity:1;visibility:visible}}.hud-number-stepper{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);padding:1px;box-sizing:border-box}.hud-number-step{flex:none;width:22px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;font-size:13px;line-height:1}.hud-number-step:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}.hud-number-step:disabled{opacity:.4;cursor:not-allowed}.hud-number-input{width:34px;border:0;background:0 0;color:var(--dsw-alias-label-primary);text-align:center;font:inherit;font-size:12.5px;line-height:18px;padding:0;-moz-appearance:textfield}.hud-number-input:focus-visible{outline:none}.hud-number-input::-webkit-outer-spin-button,.hud-number-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}@media(prefers-reduced-motion:reduce){.hud-note-bar,.hud-note-thumb,.hud-note-bar-actions{transition:none}}`;
				// v0.20.0：变更文件行改为「文件名 + 灰色相对目录」（与「产物」模块一致），保留状态徽章与加减行数。
				tag.textContent += `.hud-change-name{flex:none;max-width:60%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--dsw-alias-label-primary)}.hud-change-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}`;
				// v0.20.0：「产物」文件行向右缩进（与模块标题文字对齐）；悬停提示复用 git 的 .hud-file-tip 样式。
				tag.textContent += `.hud-output-section .hud-output-row,.hud-output-section .hud-list-more{padding-left:24px}`;
				tag.textContent += `.hud-panel[data-style=sidebar]{border:0;border-radius:0;background:transparent;max-height:none}.hud-panel[data-style=sidebar][data-side=right]{border-left:1px solid var(--dsw-alias-border-l2)}.hud-panel[data-style=sidebar][data-side=left]{border-right:1px solid var(--dsw-alias-border-l2)}.hud-panel[data-style=sidebar] .hud-panel-body,.hud-panel[data-style=sidebar] .hud-panel-pin,.hud-panel[data-style=sidebar] .hud-panel-body>.hud-section{border-top:0;background-image:linear-gradient(to right,transparent 14px,color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent) 14px,color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent) calc(100% - 14px),transparent calc(100% - 14px));background-repeat:no-repeat;background-size:100% 1px;background-position:left top}.hud-panel[data-style=sidebar] .hud-panel-body>.hud-section:first-child{background-image:none}`;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "dsh-awesome-hud: styles");

			ctx.effect(() => {
				const sync = attachSidebarWatcher(ctx);
				const stop = typeof ctx.on === "function" ? ctx.on("slots/changed", () => sync()) : null;
				return () => { if (stop !== null) stop(); sync.dispose(); };
			}, "dsh-awesome-hud: sidebar watcher");

			// v0.18.2：启动即拉一次设置，让「面板展开位置 / 两处默认开合」在首个面板渲染前
			// 就拿到宿主权威值（localStorage 镜像只负责更早的第一帧）。请求 single-flight，
			// useHudModules 复用同一 promise，不会产生第二次 GET。
			ctx.effect(() => {
				void ensurePanelPrefs();
				return () => {};
			}, "dsh-awesome-hud: panel prefs");

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

			// —— HUD 面板错误边界：组件树异常时显示错误占位而非卸载整个面板；
			//     同时把错误信息呈现出来（toast + 占位），便于定位与恢复 ——
			class HudErrorBoundary extends react.Component {
				constructor(props) {
					super(props);
					this.state = { error: null };
				}
				static getDerivedStateFromError(error) {
					return { error };
				}
				componentDidCatch(error) {
					try { toast(`HUD 渲染异常：${error?.message ?? String(error)}`, "error"); } catch { /* toast 失效时忽略 */ }
				}
				render() {
					if (this.state.error !== null) {
						return react.createElement("div", { className: "hud-graph-error", style: { margin: 12 } },
							`HUD 渲染异常：${this.state.error?.message ?? String(this.state.error)}`);
					}
					return this.props.children;
				}
			}

			// —— 头部按钮：HUD 面板（不可见时图标置灰；可见性 = 展开记忆 && 右侧栏未展开）——
			function HudButton() {
				// 首帧读取目标会话自己的展开记忆，避免切会话瞬间按钮外观错位。
				const [visible, setVisible] = react.useState(() => peekHudOpen(activeHudScopeSessionId(ctx)) && !getSidebarExpanded());
				react.useEffect(() => {
					const stopHud = subscribeHud(() => setVisible(isHudVisible()));
					const stopSidebar = subscribeSidebar(() => setVisible(isHudVisible()));
					return () => { stopHud(); stopSidebar(); };
				}, []);
				return react.createElement("button", {
					type: "button",
					className: "hud-btn",
					"data-open": visible,
					"aria-label": t(visible ? "hudClose" : "hudOpen"),
					title: t("hudLabel"),
					onClick: () => toggleHud(ctx),
				}, react.createElement(Icon, { name: "hud-toggle", size: 15, color: visible ? undefined : "var(--dsw-alias-label-tertiary)" }));
			}

			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "hud-toggle",
				order: 1,
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
					props.extra === undefined ? null : props.extra,
					props.countText === undefined || props.countText === null ? null : react.createElement("span", { className: props.pill === false ? "hud-module-count" : "hud-module-count hud-module-pill" }, props.countText),
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
				// v0.18.2：面板重挂（切页面 / 关开面板 / 右侧栏开合）时先用「最近一次成功读/写的快照」
				// 渲染首帧，避免闪回旧值；随后仍会重新 GET 对账（其它窗口的改动也能看到）。
				const seed = lastSettingsBody;
				const seedModules = seed?.modules ?? null;
				const seedUsage = lastUsageDisplay ?? seed?.usage ?? null;
				const [modules, setModules] = react.useState(seedModules);
				const [usageDisp, setUsageDisp] = react.useState(seedUsage);
				const [contextSettings, setContextSettings] = react.useState(() => (seed === null ? null : normalizeContextSettings(seed.context)));
				// v0.16.0：模块展示顺序（全局生效，跨会话共享）。
				const [order, setOrder] = react.useState(() => (seed === null ? null : normalizeModuleOrder(seed.order)));
				// v0.18.2：面板设置（侧位 + 两处默认开合）；首帧用模块级缓存，宿主返回后对账。
				const [panelSettings, setPanelSettings] = react.useState(() => ({ ...panelPrefs }));
				// v0.20.0：「便笺」模块设置（条数上限）；旧宿主没有该段时保持默认/当前值。
				const [noteSettings, setNoteSettings] = react.useState(() => (seed === null || seed.note === undefined ? defaultNoteSettings() : normalizeNoteSettings(seed.note)));
				const latestRef = react.useRef(seedModules);
				const usageRef = react.useRef(seedUsage);
				const contextRef = react.useRef(seed === null ? null : normalizeContextSettings(seed.context));
				const orderRef = react.useRef(seed === null ? null : normalizeModuleOrder(seed.order));
				const panelRef = react.useRef({ ...panelPrefs });
				const noteRef = react.useRef(noteSettings);
				const editRevisionRef = react.useRef(0);
				const saveQueueRef = react.useRef(Promise.resolve());
				react.useEffect(() => {
					let alive = true;
					const initialRevision = editRevisionRef.current;
					ensurePanelPrefs();
					// 每次挂载都重新读取：面板会随页面切换/关开/右侧栏开合重挂，必须拿到最新设置。
					getSettings().then((body) => {
						// 用户已确认过新设置时，忽略较晚返回的旧初始化快照。
						if (!alive || editRevisionRef.current !== initialRevision) return;
						rememberSettingsBody(body);
						const acceptedUsage = acceptUsageDisplay(body.usage);
						latestRef.current = body.modules ?? null;
						usageRef.current = acceptedUsage;
						contextRef.current = normalizeContextSettings(body.context);
						orderRef.current = normalizeModuleOrder(body.order);
						// 旧宿主没有 panel 段：保持当前缓存（镜像/上次确认的值），不要用默认值覆盖。
						// v0.20.0：旧宿主响应也没有 style 字段 —— 用「当前样式」补齐，避免用户切到边栏后
						// 被宿主的旧 schema 回显打回卡片；未知值交给 normalizePanelSettings 收敛为 card。
						const hostPanelRaw = body.panel;
						if (hostPanelRaw !== null && hostPanelRaw !== undefined && typeof hostPanelRaw === "object") {
							const hostStyle = hostPanelRaw.style === "sidebar" || hostPanelRaw.style === "card"
								? hostPanelRaw.style
								: panelRef.current.style;
							const nextPanel = normalizePanelSettings({ ...hostPanelRaw, style: hostStyle });
							// 宿主为权威值：同步回模块级缓存与首帧镜像（不重推当前开合，避免面板被莫名关掉/打开）。
							applyPanelPrefs(nextPanel);
							panelRef.current = nextPanel;
						}
						setModules(body.modules ?? null);
						setUsageDisp(acceptedUsage);
						setContextSettings(normalizeContextSettings(body.context));
						setOrder(normalizeModuleOrder(body.order));
						setPanelSettings({ ...panelRef.current });
						// v0.20.0：便笺设置——宿主有该段才更新，旧宿主保持当前值。
						if (body.note !== undefined && body.note !== null) {
							const nextNote = normalizeNoteSettings(body.note);
							noteRef.current = nextNote;
							setNoteSettings(nextNote);
						}
					}).catch(() => {
						if (!alive || editRevisionRef.current !== initialRevision) return;
						// 读取失败时保留首帧种子（上次成功读/写的值），不要把已确认的设置重置回默认；
						// 只有本次运行还没有任何成功快照时才回落到默认值。
						if (seed !== null && seed !== undefined) return;
						setModules(null);
						setUsageDisp(null);
						setContextSettings(null);
					});
					return () => { alive = false; };
				}, []);
				const save = react.useCallback((nextModules, nextUsage, nextOrder, nextContext, nextPanel, nextNote) => {
					// 设置按确认顺序串行写入，避免连续确认时旧请求后完成并覆盖新值。
					const operation = saveQueueRef.current
						.catch(() => undefined)
						.then(() => call("settings", { modules: nextModules, usage: nextUsage, context: nextContext, order: nextOrder, panel: nextPanel, note: nextNote }));
					saveQueueRef.current = operation;
					operation.catch((error) => {
						toast(interpolate(t("settingsSaveFailed"), { detail: error?.message ?? String(error) }));
					});
					return operation;
				}, []);
				// v0.16.0：第三个参数是模块顺序（完整排列）；不传则保持当前顺序。
				// 第四个参数是上下文模块设置（分段进度条 / 会话统计 / Token 用量）。
				// v0.18.2：第五个参数是「HUD 面板设置」（侧位 + 两处默认开合）。
				const updateSettings = react.useCallback((modulesPatch, usagePatch, orderPatch, contextPatch, panelPatch, notePatch) => {
					const nextModules = { ...(latestRef.current ?? defaultModules()), ...modulesPatch };
					const nextUsage = acceptUsageDisplay({ ...(usageRef.current ?? defaultUsageDisplay()), ...usagePatch }) ?? defaultUsageDisplay();
					const nextOrder = orderPatch === undefined ? (orderRef.current ?? defaultModuleOrder()) : normalizeModuleOrder(orderPatch);
					const nextContext = contextPatch === undefined ? (contextRef.current ?? defaultContextSettings()) : normalizeContextSettings(contextPatch);
					const nextPanel = normalizePanelSettings(panelPatch === undefined ? panelRef.current : { ...panelRef.current, ...panelPatch });
					const nextNote = normalizeNoteSettings(notePatch === undefined ? noteRef.current : { ...noteRef.current, ...notePatch });
					editRevisionRef.current += 1;
					latestRef.current = nextModules;
					usageRef.current = nextUsage;
					contextRef.current = nextContext;
					orderRef.current = nextOrder;
					// 面板设置立即写入模块级缓存：面板位置与开合默认值要马上生效，不等请求返回。
					applyPanelPrefs(nextPanel);
					panelRef.current = nextPanel;
					noteRef.current = nextNote;
					setModules(nextModules);
					setUsageDisp(nextUsage);
					setContextSettings(nextContext);
					setOrder(nextOrder);
					setPanelSettings(nextPanel);
					setNoteSettings(nextNote);
					const operation = save(nextModules, nextUsage, nextOrder, nextContext, nextPanel, nextNote);
					// 旧宿主不认识 panel：提示一次「重启后生效」，其余设置照常保存。
					operation.then((body) => {
						// 写入成功：刷新「最近一次成功快照」，面板重挂时首帧即为最新值。
						rememberSettingsBody(body);
						if (body !== null && body !== undefined && body.ok === true && body.panel === undefined) toast(t("settingsHostOutdated"), "warn");
					}).catch(() => undefined);
					return operation;
				}, [save]);
				return [modules, usageDisp, updateSettings, order, contextSettings, panelSettings, noteSettings];
			}

			// —— 会话模块（不可折叠；右上角设置按钮）——
			const MODULE_LABELS = {
				context: () => t("contextModule"),
				git: () => t("gitModule"),
				outputs: () => t("outputsModule"),
				subagents: () => t("subagentsModule"),
				tasks: () => t("tasksModule"),
				mcp: () => t("mcpModule"),
				balance: () => t("balanceModule"),
				plans: () => t("plansModule"),
				note: () => t("noteModule"),
				todo: () => t("todoModule"),
			};

			/**
			 * 拖动排序：按指针落点找出目标槽位（槽位取拖动开始时的原始布局，不受预览位移影响）。
			 * 指在最后一张卡片下半部分或列表外时落到最后一位。
			 */
			function moduleDropIndex(tops, step, relY) {
				if (tops.length === 0) return -1;
				const index = tops.findIndex((top) => relY < top + step / 2);
				return index === -1 ? tops.length - 1 : index;
			}

			/**
			 * 拖动排序的预览顺序：把 key 插到目标下标（先移除再插入）。
			 * 目标下标按原始槽位计算，与 key 原来的位置无关。
			 */
			function previewModuleOrder(order, key, index) {
				const from = order.indexOf(key);
				if (from === -1) return order.slice();
				const target = Math.max(0, Math.min(index, order.length - 1));
				const next = order.slice();
				next.splice(from, 1);
				next.splice(target, 0, key);
				return next;
			}

			/** 两个顺序数组是否完全一致（拖动预览去重用）。 */
			function sameOrder(left, right) {
				if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
				return left.every((value, index) => value === right[index]);
			}

			/**
			 * 预览顺序只包含当前可见的模块键；落盘前按完整顺序还原，
			 * 让不可见/不可用而被过滤掉的键（例如未启用的用量模块）保持原位置。
			 */
			function mergePreviewOrder(fullOrder, visibleOrder, previewOrder) {
				const visible = new Set(visibleOrder);
				let cursor = 0;
				return fullOrder.map((key) => (visible.has(key) ? previewOrder[cursor++] : key));
			}

			/**
			 * 行高不一致的列表（待办）拖动落点：按指针在原始条目里的上半/下半区判定目标下标。
			 * tops/heights 必须与当前 DOM 顺序一一对应。
			 */
			function dropIndexAt(tops, heights, relY) {
				if (tops.length === 0) return -1;
				for (let index = 0; index < tops.length; index += 1) {
					if (relY < tops[index] + (heights[index] ?? 0) / 2) return index;
				}
				return tops.length - 1;
			}

			/**
			 * 行高不一致时的拖动预览位移：按预览顺序重新堆叠各条目的高度，
			 * 返回「id → 相对原始位置的 translateY」。这样多行文本的待办也能精确让位。
			 */
			function previewOffsets(order, previewOrder, tops, heights, gap) {
				const heightById = {};
				for (let index = 0; index < order.length; index += 1) heightById[order[index]] = heights[index] ?? 0;
				const targetTop = {};
				let y = tops.length > 0 ? tops[0] : 0;
				for (const id of previewOrder) {
					targetTop[id] = y;
					y += (heightById[id] ?? 0) + gap;
				}
				const offsets = {};
				for (let index = 0; index < order.length; index += 1) {
					const id = order[index];
					offsets[id] = targetTop[id] === undefined ? 0 : targetTop[id] - tops[index];
				}
				return offsets;
			}

			// —— v0.18.2：设置项控件 ——
			// 右栏的启停项改用 DSH 官方 Switch（36×20 轨道 + 16px 圆点，开=brand-primary /
			// 关=border-l3），「左侧/右侧」用官方 SegmentedControl；两者都来自客户端 seed 模块
			// @deepseek-ai/dsh-client-ui-primitives，缺失时回退到同几何、同 token 的本地实现。
			function officialControl(name) {
				if (primitives === null || primitives === undefined) return null;
				const component = primitives[name];
				return component === null || component === undefined ? null : component;
			}
			/** 启停开关：官方 Switch 的受控封装（disabled 时不触发 onChange）。 */
			function HudSwitch(props) {
				const Official = officialControl("Switch");
				const disabled = props.disabled === true;
				// 官方组件的回调只给新值；这里统一拦掉禁用态的误触。
				const change = (next) => { if (!disabled) props.onChange(next === true); };
				if (Official !== null) {
					return react.createElement(Official, {
						checked: props.checked === true,
						disabled,
						label: props.label,
						title: props.title,
						onChange: change,
					});
				}
				const own = {
					role: "switch",
					"aria-checked": props.checked === true,
					"aria-label": props.label,
					disabled,
					className: "hud-official-switch",
					onClick: () => change(props.checked !== true),
				};
				if (props.title !== undefined) own.title = props.title;
				return react.createElement("button", own,
					react.createElement("span", { className: "hud-official-switch-thumb" }));
			}
			/**
			 * 数字步进器（v0.20.0）：「− / 数值 / +」，范围可配；数字可直接键盘输入，
			 * 失焦或回车时收敛到区间内。用于 HUD 设置的「便笺条数上限」。
			 */
			function HudNumberStepper(props) {
				const min = typeof props.min === "number" ? props.min : 1;
				const max = typeof props.max === "number" ? props.max : 99;
				const value = Math.min(max, Math.max(min, Math.round(Number(props.value) || min)));
				const [draft, setDraft] = react.useState(String(value));
				react.useEffect(() => { setDraft(String(value)); }, [value]);
				const commit = (raw) => {
					const parsed = Math.round(Number(raw));
					const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
					setDraft(String(next));
					props.onChange?.(next);
				};
				const step = (delta) => {
					const next = Math.min(max, Math.max(min, value + delta));
					setDraft(String(next));
					props.onChange?.(next);
				};
				return react.createElement("div", { className: "hud-number-stepper" },
					react.createElement("button", {
						type: "button",
						className: "hud-number-step",
						disabled: value <= min,
						"aria-label": props.label === undefined ? undefined : `${props.label} -`,
						onClick: () => step(-1),
					}, "\u2212"),
					react.createElement("input", {
						...IME_INPUT_PROPS,
						className: "hud-number-input",
						type: "number",
						min,
						max,
						step: 1,
						value: draft,
						"aria-label": props.label,
						onChange: (event) => setDraft(event.target.value),
						onBlur: (event) => commit(event.target.value),
						onKeyDown: (event) => {
							if (isImeComposing(event)) return;
							if (event.key !== "Enter") return;
							event.preventDefault();
							commit(event.currentTarget.value);
						},
					}),
					react.createElement("button", {
						type: "button",
						className: "hud-number-step",
						disabled: value >= max,
						"aria-label": props.label === undefined ? undefined : `${props.label} +`,
						onClick: () => step(1),
					}, "+"));
			}

			/** 二选一分段控件：官方 SegmentedControl（左侧/右侧），缺失时回退到等价的本地实现。 */
			function HudSegmented(props) {
				const Official = officialControl("SegmentedControl");
				if (Official !== null) {
					return react.createElement(Official, {
						id: props.id,
						label: props.label,
						value: props.value,
						options: props.options,
						onChange: props.onChange,
					});
				}
				return react.createElement("div", { className: "hud-seg", role: "group", "aria-label": props.label },
					props.options.map((option) => react.createElement("button", {
						key: option.value,
						type: "button",
						role: "radio",
						"aria-checked": option.value === props.value,
						"data-on": option.value === props.value,
						className: "hud-seg-item",
						disabled: option.disabled === true,
						onClick: () => { if (option.value !== props.value) props.onChange(option.value); },
					}, option.label)));
			}
			/**
			 * 右栏设置行：左侧「名称 + 说明」，右侧控件；说明文字同时是置灰原因。
			 * @param props 行配置：label / hint / icon / disabled / children（控件）。
			 */
			function SettingRow(props) {
				const hint = props.hint;
				return react.createElement("div", { className: "hud-setting-row", "data-disabled": props.disabled === true },
					react.createElement("div", { className: "hud-setting-text" },
						react.createElement("span", { className: "hud-setting-name" },
							props.icon === undefined ? null : react.createElement(Icon, { name: props.icon }),
							props.label),
						hint === undefined || hint === null ? null : react.createElement("span", { className: "hud-setting-hint" }, hint)),
					react.createElement("div", { className: "hud-setting-control" }, props.children));
			}

			// —— v0.18.5：设置弹窗「使用说明」页 ——
			/**
			 * 目录高亮判定：取最后一个「已滚过顶部阈值」的小节键。
			 * offsets 与 keys 一一对应（各节相对内容区顶部的偏移），scrollTop 为内容区滚动位置。
			 * 纯函数便于单测；偏移越界与负滚动位置都收敛到首节/末节。
			 */
			function guideActiveKey(keys, offsets, scrollTop, threshold = 16) {
				if (keys.length === 0) return "";
				let active = keys[0];
				for (let index = 0; index < keys.length; index += 1) {
					if ((offsets[index] ?? 0) - threshold <= scrollTop) active = keys[index];
				}
				return active;
			}

			/**
			 * 说明页大纲（固定顺序）：快速上手 → 设置弹窗 → 10 个模块 → 新建会话页差异 → 操作技巧。
			 * icon 同时用于左侧目录与右侧小节标题；title/items 都是 i18n 键（中英成对维护）。
			 */
			const GUIDE_SECTIONS = [
				{ key: "panel", title: "guidePanelTitle", groups: [
					// v0.20.0：新增「面板样式」要点（卡片 / 边栏，默认卡片）。
					{ kind: "act", items: ["guidePanelEntry", "guidePanelSide", "guidePanelStyle", "guidePanelMemory", "guidePanelSidebar", "guidePanelNewSession", "guidePanelFold"] },
					{ kind: "set", items: ["guidePanelSettingsEntry", "guidePanelSettingsLayout", "guidePanelSettingsCards", "guidePanelSettingsSave", "guidePanelSettingsLocked"] },
				] },
				{ key: "session", title: "guideSessionTitle", groups: [
					{ kind: "show", items: ["guideSessionShowNames", "guideSessionShowModel"] },
					{ kind: "act", items: ["guideSessionWorkspaceMenu", "guideSessionSessionMenu", "guideSessionRename", "guideSessionNewPage"] },
				] },
				{ key: "context", title: "guideContextTitle", groups: [
					{ kind: "show", items: ["guideContextShowBar", "guideContextShowRatio", "guideContextShowLines"] },
					{ kind: "act", items: ["guideContextHoverBar", "guideContextHoverLines", "guideContextCompress"] },
				] },
				{ key: "usage", title: "guideUsageTitle", groups: [
					{ kind: "show", items: ["guideUsageShowDeepseek", "guideUsageShowOpencode", "guideUsageShowCodex"] },
					{ kind: "act", items: ["guideUsageClick", "guideUsageJump"] },
				] },
				{ key: "git", title: "guideGitTitle", groups: [
					{ kind: "show", items: ["guideGitShowBranch", "guideGitShowFiles"] },
					{ kind: "act", items: ["guideGitBranch", "guideGitDiff", "guideGitCommit", "guideGitPrompt", "guideGitRevert", "guideGitGraph"] },
				] },
				{ key: "outputs", title: "guideOutputsTitle", groups: [
					{ kind: "show", items: ["guideOutputsShowList", "guideOutputsShowOrder", "guideOutputsHover"] },
					{ kind: "act", items: ["guideOutputsOpen", "guideOutputsScope"] },
				] },
				{ key: "subagents", title: "guideSubagentsTitle", groups: [
					{ kind: "show", items: ["guideSubagentsShowList", "guideSubagentsShowState"] },
					{ kind: "act", items: ["guideSubagentsOpen", "guideSubagentsOnly"] },
				] },
				{ key: "tasks", title: "guideTasksTitle", groups: [
					{ kind: "show", items: ["guideTasksShowList", "guideTasksShowCount"] },
					{ kind: "act", items: ["guideTasksLive", "guideTasksOnly"] },
				] },
				{ key: "plans", title: "guidePlansTitle", groups: [
					{ kind: "show", items: ["guidePlansShowList", "guidePlansShowCount"] },
					{ kind: "act", items: ["guidePlansOpen", "guidePlansOnly"] },
				] },
				{ key: "mcp", title: "guideMcpTitle", groups: [
					{ kind: "show", items: ["guideMcpShowList"] },
					{ kind: "act", items: ["guideMcpToggle", "guideMcpScope"] },
				] },
				{ key: "note", title: "guideNoteTitle", groups: [
					{ kind: "show", items: ["guideNoteShowShared", "guideNoteShowCount", "guideNoteFold"] },
					// v0.20.0：多便笺列表/编辑视图；「从聊天创建/导入」的前置条件单独成条
					{ kind: "act", items: ["guideNoteList", "guideNoteDrag", "guideNoteCreateFromChat", "guideNoteAdd", "guideNoteDeleteAll", "guideNoteEdit", "guideNoteImages", "guideNoteResize", "guideNoteImport", "guideNoteSend", "guideNoteClear", "guideNoteImportEnabled"] },
					{ kind: "set", items: ["guideNoteLimit"] },
				] },
				{ key: "todo", title: "guideTodoTitle", groups: [
					{ kind: "show", items: ["guideTodoShowShared", "guideTodoShowCount"] },
					{ kind: "act", items: ["guideTodoCheck", "guideTodoEdit", "guideTodoDrag", "guideTodoClear", "guideTodoFold"] },
				] },
			];

			/**
			 * HUD 设置弹窗（v0.17.0）：由「会话」模块右上角齿轮打开。
			 * 选项与旧设置菜单一致（模块显隐 + 排列顺序 + 用量模块内容），但改为弹窗呈现：
			 * 每个模块一张卡片，卡片之间用间距与描边区分；「用量模块内容」单独一张卡片；
			 * 底部固定「恢复默认 / 取消 / 确认」。弹窗 portal 到 body，不受面板滚动容器裁剪。
			 */
			function SettingsDialog(props) {
				const [draft, setDraft] = react.useState(() => ({ ...(props.modules ?? defaultModules()) }));
				const [usageDraft, setUsageDraft] = react.useState(() => ({ ...(props.usage ?? defaultUsageDisplay()) }));
				const [contextDraft, setContextDraft] = react.useState(() => normalizeContextSettings(props.context));
				// v0.16.0：模块展示顺序（全局生效），未提供时回落到默认顺序。
				const [orderDraft, setOrderDraft] = react.useState(() => normalizeModuleOrder(props.order));
				// v0.18.2：「HUD 面板设置」草稿（侧位 + 两处默认开合）。
				const [panelDraft, setPanelDraft] = react.useState(() => normalizePanelSettings(props.panel));
				// v0.20.0：「便笺」模块设置草稿（条数上限）。
				const [noteDraft, setNoteDraft] = react.useState(() => normalizeNoteSettings(props.note));
				// v0.18.5：弹窗顶部两个标签——「HUD 设置」与「使用说明」；每次打开都从设置页开始。
				const [tab, setTab] = react.useState("settings");
				// v0.20.0：记录本次打开设置页时的草稿；「保存设置」仅在本次打开后确实改过东西时可点。
				const initialRef = react.useRef({
					modules: { ...draft },
					usage: { ...usageDraft },
					order: [...orderDraft],
					context: { ...contextDraft },
					panel: { ...panelDraft },
					note: { ...noteDraft },
				});
				// 拖动排序的实时预览：只给卡片加 transform 位移，不改变 DOM 顺序；
				// 松手后才把预览顺序写入 orderDraft，避免拖动过程中移动拖动源导致拖拽中断。
				const [dragPreview, setDragPreview] = react.useState(null);
				// 落盘的那一帧要临时关闭 transform 过渡：DOM 重排 + 清空 transform 同时发生，
				// 若仍保留过渡，卡片会按「新布局位置 + 旧位移」再滑一次，出现回跳。
				const [dragSettling, setDragSettling] = react.useState(false);
				const settleTimerRef = react.useRef(null);
				const dragRef = react.useRef(null);
				const listRef = react.useRef(null);
				const cardRef = react.useRef(null);
				// v0.18.7：本次拖动是否已经被 drop 提交过（用于 dragend 兜底，避免重复提交）。
				const droppedRef = react.useRef(false);
				const keys = MODULE_KEYS.filter((key) => key !== "balance" || props.balanceAvailable === true);
				// v0.18.3：当前页面不渲染的模块（如新建会话页的上下文/子代理/任务/计划清单）——
				// 左栏仍按真实状态展示，但置灰且不可点击，避免「本页看不到」被误改成「全局关闭」。
				const lockedModules = new Set(Array.isArray(props.lockedModules) ? props.lockedModules : []);
				// 排序列表：只展示当前可用（含 balance 可用性）的模块，保持 orderDraft 的相对顺序。
				const orderedKeys = orderDraft.filter((key) => keys.includes(key));
				// 补齐 orderDraft 中缺失的可用键（例如历史上没写过的键），保证每一项都能出现且只出现一次。
				for (const key of keys) if (!orderedKeys.includes(key)) orderedKeys.push(key);
				// v0.18.2：三项用量数据恒列出；不可用者置灰（未安装或未配置/未登录），并给出行内原因。
				const usageAvailability = props.usageAvailability ?? { deepseek: true, opencode: false, codex: false };
				const usageReasons = props.usageReasons ?? {};
				const usageKeys = ["deepseek", "opencode", "codex"];
				const usageLabel = (key) => key === "deepseek" ? t("settingsUsageDeepseek") : key === "opencode" ? t("settingsUsageOpencode") : t("settingsUsageCodex");
				// v0.20.0：用量三行的简短说明（可用时展示；不可用时改展示置灰原因）。
				const usageHintKey = (key) => key === "deepseek" ? "settingsUsageDeepseekHint" : key === "opencode" ? "settingsUsageOpencodeHint" : "settingsUsageCodexHint";
				const usageIcon = (key) => key === "deepseek" ? "deepseek" : key === "opencode" ? "icon-opencode" : "ChatGPT";
				// 「恢复默认」仅在当前设置与默认设置不同时激活。
				const dirty = !isDefaultDraft(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, keys);
				// 「保存设置」仅在本次打开后改过草稿时激活（与「恢复默认」的默认值判定不同）。
				const edited = !sameSettingsDraft(initialRef.current, {
					modules: draft, usage: usageDraft, order: orderDraft, context: contextDraft, panel: panelDraft, note: noteDraft,
				});
				/**
				 * v0.20.0：保存设置前校验便笺上限——扫描全部工作区，任一工作区条数超过新上限就
				 * 中止本次保存并用 toast 指出具体工作区（最多列 3 个）。
				 * @returns 是否允许保存。
				 */
				const confirmSettings = () => {
					if (!edited) return;
					// 只在本次真的改动了便笺上限时做「上限低于现有条数」校验；
					// 否则用户只是想保存别的设置，却会被便笺条数卡住（旧实现的问题）。
					const nextMax = normalizeNoteSettings(noteDraft).maxCount;
					const initialMax = normalizeNoteSettings(initialRef.current.note).maxCount;
					if (nextMax !== initialMax) {
						let violations = [];
						try { violations = noteCountViolations(nextMax); } catch { violations = []; }
						if (violations.length > 0) {
							const list = violations.slice(0, 3)
								.map((row) => interpolate(t("noteWorkspaceCount"), { path: row.key, count: String(row.count) }))
								.join(t("noteWorkspaceSeparator"));
							const more = violations.length > 3
								? interpolate(t("noteWorkspaceMore"), { count: String(violations.length - 3) })
								: "";
							toast(interpolate(t("noteCapRejected"), { workspaces: `${list}${more}`, count: String(nextMax) }), "warn");
							return;
						}
					}
					props.onConfirm(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft);
				};
				// v0.18.7：「上下文模块位置固定」的可用性——按草稿里的排序与模块开关实时判定，
				// 左栏拖完排序后该行立刻跟着置灰/恢复，不必等确认。
				const contextPin = contextPinState(orderDraft, draft);
				/** 清空拖动状态（恢复默认等「放弃当前拖动」场景用，不提交预览）。 */
				const cancelDrag = () => {
					dragRef.current = null;
					droppedRef.current = false;
					setDragPreview(null);
				};
				/**
				 * 拖动开始：记录每张卡片的原始槽位与行距。
				 * 拖动期间不重排 DOM，只按槽位计算落点并位移卡片。
				 */
				const startDrag = (event, key) => {
					droppedRef.current = false;
					event.dataTransfer?.setData?.("text/plain", key);
					// 拖动表现为「移动」，光标提示与最终落点行为一致。
					if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.effectAllowed = "move";
					const list = listRef.current;
					let tops = [];
					let step = 0;
					if (list !== null) {
						const listRect = list.getBoundingClientRect();
						const cards = Array.from(list.children);
						tops = cards.map((node) => node.getBoundingClientRect().top - listRect.top);
						if (tops.length > 1) step = tops[1] - tops[0];
						else if (cards.length === 1) step = cards[0].getBoundingClientRect().height + 8;
					}
					step = Math.max(step, 1);
					const order = orderedKeys.slice();
					dragRef.current = { key, step, tops, order };
					setDragPreview({ key, step, order });
					// 原生拖拽幽灵会跟随鼠标，与列表内的虚线占位重复；隐藏它，只保留占位预览。
					suppressNativeDragImage(event);
				};
				/**
				 * 拖动经过：用指针所在的**原始槽位**计算目标下标（不受卡片位移影响，避免来回抖动），
				 * 再生成预览顺序；其他卡片据此 transform 让位，形成排斥效果。
				 * v0.18.7：relY 允许超出列表范围（指针移到列表外/弹窗外），moduleDropIndex 会钳制到
				 * 首位或末位——这样「拖到第一位就把指针甩到列表上方再松手」也能落在首位。
				 */
				const dragOverAt = (event) => {
					const state = dragRef.current;
					const list = listRef.current;
					if (state === null || list === null || state.tops.length === 0) return;
					event.preventDefault();
					if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = "move";
					const relY = event.clientY - list.getBoundingClientRect().top;
					const overIndex = moduleDropIndex(state.tops, state.step, relY);
					if (overIndex === -1) return;
					const next = previewModuleOrder(state.order, state.key, overIndex);
					// 同步到拖动状态，drop 时即使 React 尚未提交最新预览也能拿到正确顺序。
					state.order = next;
					// dragover 触发频率很高：顺序没变时不 setState。
					setDragPreview((prev) => {
						if (prev !== null && prev.order.length === next.length && prev.order.every((value, index) => value === next[index])) return prev;
						return { key: state.key, step: state.step, order: next };
					});
				};
				/** 列表自身的 dragover（保留原有接线；document 上的捕获监听是它的超集）。 */
				const dragOverList = (event) => { dragOverAt(event); };
				/** 落点提交：把预览顺序写入草稿，再清空拖动预览。 */
				const commitDragOrder = () => {
					const state = dragRef.current;
					const previewOrder = state?.order ?? dragPreview?.order ?? null;
					// 预览只覆盖可见键，写回时合并回完整顺序，避免丢失被过滤模块的位置。
					if (previewOrder !== null) {
						setDragSettling(true);
						setOrderDraft(mergePreviewOrder(orderDraft, orderedKeys, previewOrder));
						// 等新布局完成一次绘制后再恢复过渡，避免落盘瞬间二次位移。
						if (typeof window !== "undefined") {
							window.clearTimeout(settleTimerRef.current);
							settleTimerRef.current = window.setTimeout(() => setDragSettling(false), 0);
						}
					}
					dragRef.current = null;
					setDragPreview(null);
				};
				/** 列表自身的 drop（保留原有接线）。 */
				const dropList = (event) => {
					event.preventDefault();
					droppedRef.current = true;
					commitDragOrder();
				};
				/**
				 * 结束拖动：正常 drop 已在 dropList/文档监听里提交；若松手点落在列表外
				 * （甚至落在弹窗或窗口外，列表收不到 drop），这里用最后一次预览兜底提交，
				 * 避免「拖到首位/末位却弹回原位」。
				 */
				const endDrag = () => {
					if (!droppedRef.current) commitDragOrder();
					droppedRef.current = false;
					dragRef.current = null;
					setDragPreview(null);
				};
				// v0.18.7：拖动期间在 document 的捕获阶段接管 dragover/drop ——
				// 指针离开列表或弹窗时仍能更新落点并在松手处提交（原先只有列表自身能收到 drop）。
				react.useEffect(() => {
					if (dragPreview === null) return undefined;
					if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
					const onOver = (event) => { dragOverAt(event); };
					const onDrop = (event) => {
						event.preventDefault();
						droppedRef.current = true;
						commitDragOrder();
					};
					document.addEventListener("dragover", onOver, true);
					document.addEventListener("drop", onDrop, true);
					return () => {
						document.removeEventListener("dragover", onOver, true);
						document.removeEventListener("drop", onDrop, true);
					};
				}, [dragPreview !== null]);
				/** 恢复默认：勾选、用量行、上下文设置、排序一并回到默认值（仍需点「确认」才落盘）。 */
				const resetDefaults = () => {
					setDraft({ ...defaultModules() });
					setUsageDraft({ ...defaultUsageDisplay() });
					setContextDraft(defaultContextSettings());
					setOrderDraft(normalizeModuleOrder(null));
					// v0.18.2：面板设置（侧位 / 两处默认开合）一并回到默认值，仍需点「确认」才落盘。
					setPanelDraft(defaultPanelSettings());
					setNoteDraft(defaultNoteSettings());
					cancelDrag();
				};
				/** v0.18.5：顶部标签的 WAI-ARIA 键盘约定——左右方向键循环、Home/End 跳首末。 */
				const onTabsKeyDown = (event) => {
					if (isImeComposing(event)) return;
					const tabs = ["settings", "guide"];
					const index = tabs.indexOf(tab);
					let next = null;
					if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
					else if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
					else if (event.key === "Home") next = tabs[0];
					else if (event.key === "End") next = tabs[tabs.length - 1];
					if (next === null) return;
					event.preventDefault();
					setTab(next);
					// 焦点跟随到刚激活的标签；测试环境没有 getElementById 时安全跳过。
					const node = typeof document === "undefined" ? undefined : document.getElementById?.(`hud-settings-tab-${next}`);
					node?.focus?.();
				};
				// 打开时把焦点移入弹窗（Tab/Esc 立即可用），关闭时还原到打开前的元素（通常是齿轮按钮）。
				react.useEffect(() => {
					const previous = typeof document !== "undefined" ? document.activeElement : null;
					cardRef.current?.focus?.();
					return () => {
						previous?.focus?.();
						if (typeof window !== "undefined") window.clearTimeout(settleTimerRef.current);
					};
				}, []);
				// Esc 关闭；Tab 在弹窗内循环，避免焦点跑回被遮罩的 HUD 面板。
				react.useEffect(() => {
					const onKeyDown = (event) => {
						if (isImeComposing(event)) return;
						if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
						if (event.key !== "Tab") return;
						// v0.18.5：排除 roving tabindex 的未激活标签（tabindex=-1），Tab 只在当前标签上停靠。
						const nodes = cardRef.current?.querySelectorAll?.('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
						// v0.18.5：说明页打开时设置页只是 visibility:hidden 隐藏（仍占布局以锁定高度），聚焦循环要跳过它。
						const isVisible = (node) => node.offsetParent !== null && (typeof window === "undefined" || window.getComputedStyle?.(node)?.visibility !== "hidden");
						const list = nodes === undefined || nodes === null ? [] : Array.from(nodes).filter(isVisible);
						if (list.length === 0) return;
						const first = list[0];
						const last = list[list.length - 1];
						const active = document.activeElement;
						// 初始焦点在弹窗卡片本身：Shift+Tab 也应回绕到最后一项，而不是跑到遮罩后。
						if (event.shiftKey && (active === first || active === cardRef.current)) { event.preventDefault(); last.focus(); }
						else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
					};
					const doc = typeof document !== "undefined" ? document : null;
					doc?.addEventListener?.("keydown", onKeyDown, true);
					return () => doc?.removeEventListener?.("keydown", onKeyDown, true);
				}, [props.onClose]);
				const dialog = react.createElement("div", {
					className: "hud-modal hud-settings-modal",
					role: "dialog",
					"aria-modal": "true",
					// v0.18.5：标题文字被标签行取代，弹窗可达名改由 aria-label 提供。
					"aria-label": t("settingsTitle"),
					// 只有点在遮罩本身（而不是弹窗卡片）时才关闭。
					onClick: (event) => { if (event.target === event.currentTarget) props.onClose(); },
				},
					react.createElement("div", {
						className: "hud-modal-card hud-settings-modal-card",
						ref: cardRef,
						tabIndex: -1,
						onClick: (event) => event.stopPropagation(),
					},
						// v0.18.5：头部改为「HUD 设置 / 使用说明」两个标签（选中项品牌色下划线），不再单独渲染标题。
						react.createElement("div", { className: "hud-modal-head hud-settings-head" },
							react.createElement("div", { className: "hud-settings-tabs", role: "tablist", "aria-label": t("settingsTitle"), onKeyDown: onTabsKeyDown },
								react.createElement("button", {
									type: "button",
									role: "tab",
									id: "hud-settings-tab-settings",
									className: "hud-settings-tab",
									"aria-selected": tab === "settings",
									"aria-controls": "hud-settings-panel-settings",
									"data-active": tab === "settings",
									tabIndex: tab === "settings" ? 0 : -1,
									onClick: () => setTab("settings"),
								},
									react.createElement(Icon, { name: "settings-outline", size: 14, color: "inherit" }),
									react.createElement("span", null, t("settingsTitle"))),
								react.createElement("button", {
									type: "button",
									role: "tab",
									id: "hud-settings-tab-guide",
									className: "hud-settings-tab",
									"aria-selected": tab === "guide",
									"aria-controls": "hud-settings-panel-guide",
									"data-active": tab === "guide",
									tabIndex: tab === "guide" ? 0 : -1,
									onClick: () => setTab("guide"),
								},
									react.createElement(Icon, { name: "hint", size: 14, color: "inherit" }),
									react.createElement("span", null, t("settingsGuideTab")))),
							react.createElement("button", { type: "button", className: "hud-modal-close", onClick: props.onClose }, t("closeModal"))),
						// v0.18.5：两个标签共享同一高度——设置页分栏始终保持挂载（说明页时仅隐藏），
						// 说明页绝对定位覆盖在同一区域上，因此切换标签不会改变弹窗高度，窗口缩放时也与设置页同步。
						react.createElement("div", { className: "hud-settings-body" },
							react.createElement("div", { role: "tabpanel", id: "hud-settings-panel-settings", "aria-labelledby": "hud-settings-tab-settings", "data-hidden": tab !== "settings", "aria-hidden": tab !== "settings", className: "hud-settings-panes" },
							// —— 左栏：模块启停 + 拖动排序（列宽固定，不跟随右栏滚动）——
							react.createElement("div", { className: "hud-settings-pane hud-settings-pane-modules" },
								react.createElement("div", { className: "hud-settings-section-head" },
									react.createElement("span", { className: "hud-settings-section-title" }, t("settingsModules")),
									react.createElement("span", { className: "hud-settings-section-hint" }, t("settingsDragHint"))),
								react.createElement("div", {
									className: "hud-settings-list",
									ref: listRef,
									"data-settling": dragSettling,
									onDragOver: dragOverList,
									onDrop: dropList,
								},
									orderedKeys.map((key, index) => {
										// 预览下标与原始下标的差值 → 位移距离；拖动时其他卡片据此实时让位。
										const previewIndex = dragPreview === null ? -1 : dragPreview.order.indexOf(key);
										const offset = previewIndex === -1 || previewIndex === index ? 0 : (previewIndex - index) * dragPreview.step;
										const locked = lockedModules.has(key);
										return react.createElement("div", {
											className: "hud-settings-card",
											key,
											"data-off": draft[key] === false,
											"data-locked": locked,
											"data-dragging": dragPreview !== null && dragPreview.key === key,
											style: offset === 0 ? undefined : { transform: `translateY(${offset}px)` },
										},
											// 拖动排序手柄：仅此按钮可拖（整张卡片其余区域仍可点击切换勾选）。
											react.createElement("button", {
												type: "button",
												className: "hud-settings-grip",
												"aria-label": t("settingsDrag"),
												title: t("settingsDrag"),
												draggable: true,
												onDragStart: (event) => startDrag(event, key),
												onDragEnd: endDrag,
											}, react.createElement(Icon, { name: "drag", size: 14 })),
											// 图标 + 名称 + 复选框包在 label 里：点击卡片主体即切换显隐，拖动手柄仍在 label 之外。
											react.createElement("label", {
												className: "hud-settings-card-label",
												title: locked ? t("settingsModuleLocked") : undefined,
											},
												react.createElement(Icon, { name: key, color: "var(--dsw-alias-label-primary)" }),
												react.createElement("span", { className: "hud-settings-card-name" }, MODULE_LABELS[key]()),
												react.createElement("input", {
													type: "checkbox",
													checked: draft[key] !== false,
													// 锁定项禁用：原生 disabled 同时挡掉点击 label 的切换。
													disabled: locked,
													onChange: (event) => { setDraft((prev) => ({ ...prev, [key]: event.target.checked })); },
												})));
									}))),
							// —— 右栏：模块具体设置（内容过多时只滚动这一栏）——
							react.createElement("div", { className: "hud-settings-pane hud-settings-pane-detail" },
								// 1. HUD 面板设置
								react.createElement("div", { className: "hud-settings-section hud-settings-section-card" },
									react.createElement("div", { className: "hud-settings-section-title" }, t("settingsPanelTitle")),
									// v0.20.0：「HUD 面板样式」在「HUD 面板展开位置」上方（卡片 / 边栏，默认卡片）。
									react.createElement(SettingRow, { label: t("settingsPanelStyle"), hint: t("settingsPanelStyleHint") },
										react.createElement(HudSegmented, {
											id: "hud-settings-panel-style",
											label: t("settingsPanelStyle"),
											value: panelDraft.style,
											options: [
												{ value: "card", label: t("settingsPanelStyleCard") },
												{ value: "sidebar", label: t("settingsPanelStyleSidebar") },
											],
											onChange: (next) => setPanelDraft((prev) => ({ ...prev, style: next === "sidebar" ? "sidebar" : "card" })),
										})),
									react.createElement(SettingRow, { label: t("settingsPanelSide"), hint: t("settingsPanelSideHint") },
										react.createElement(HudSegmented, {
											id: "hud-settings-panel-side",
											label: t("settingsPanelSide"),
											value: panelDraft.side,
											options: [
												{ value: "left", label: t("settingsPanelSideLeft") },
												{ value: "right", label: t("settingsPanelSideRight") },
											],
											onChange: (next) => setPanelDraft((prev) => ({ ...prev, side: next === "left" ? "left" : "right" })),
										})),
									react.createElement(SettingRow, { label: t("settingsPanelNewSessionOpen"), hint: t("settingsPanelNewSessionOpenHint") },
										react.createElement(HudSwitch, {
											checked: panelDraft.newSessionOpen === true,
											label: t("settingsPanelNewSessionOpen"),
											onChange: (next) => setPanelDraft((prev) => ({ ...prev, newSessionOpen: next })),
										})),
									react.createElement(SettingRow, { label: t("settingsPanelChatOpen"), hint: t("settingsPanelChatOpenHint") },
										react.createElement(HudSwitch, {
											checked: panelDraft.chatOpen !== false,
											label: t("settingsPanelChatOpen"),
											onChange: (next) => setPanelDraft((prev) => ({ ...prev, chatOpen: next })),
										}))),
								// 2. 「上下文」设置
								react.createElement("div", { className: "hud-settings-section hud-settings-section-card" },
									react.createElement("div", { className: "hud-settings-section-title" }, t("settingsContextTitle")),
									react.createElement(SettingRow, { label: t("settingsContextStats"), hint: t("settingsContextStatsHint") },
										react.createElement(HudSwitch, {
											checked: contextDraft.showStats !== false,
											label: t("settingsContextStats"),
											onChange: (next) => setContextDraft((prev) => ({ ...prev, showStats: next })),
										})),
									react.createElement(SettingRow, { label: t("settingsContextUsage"), hint: t("settingsContextUsageHint") },
										react.createElement(HudSwitch, {
											checked: contextDraft.showUsage !== false,
											label: t("settingsContextUsage"),
											onChange: (next) => setContextDraft((prev) => ({ ...prev, showUsage: next })),
										})),
									// v0.19.2：「始终显示分段进度条」放在「上下文模块位置固定」上方。
									react.createElement(SettingRow, { label: t("settingsContextBarStyle"), hint: t("settingsContextBarStyleHint") },
										react.createElement(HudSwitch, {
											checked: contextDraft.barStyle === "segmented",
											label: t("settingsContextBarStyle"),
											onChange: (next) => setContextDraft((prev) => ({ ...prev, barStyle: next ? "segmented" : "default" })),
										})),
									// v0.18.7：位置固定——仅当上下文是模块排序首位时可开，否则置灰并说明原因。
									react.createElement(SettingRow, {
										label: t("settingsContextPin"),
										// 位置固定：可用时给简短说明；不可用时优先说明原因。
										hint: contextPin.allowed ? t("settingsContextPinHint") : t(contextPin.reason === "hidden" ? "settingsContextPinHidden" : "settingsContextPinOrder"),
										disabled: !contextPin.allowed,
									},
										react.createElement(HudSwitch, {
											checked: contextDraft.pinned === true,
											disabled: !contextPin.allowed,
											label: t("settingsContextPin"),
											onChange: (next) => setContextDraft((prev) => ({ ...prev, pinned: next })),
										}))),
								// 3. 「用量」设置：三行数据恒列出（不可用者置灰），末行为「跳转」按钮开关
								react.createElement("div", { className: "hud-settings-section hud-settings-section-card" },
									react.createElement("div", { className: "hud-settings-section-title" }, t("settingsUsageTitle")),
									usageKeys.map((key) => {
										const disabled = usageAvailability[key] !== true;
										const reason = disabled ? usageReasons[key] : undefined;
										return react.createElement(SettingRow, {
											key: `usage-${key}`,
											label: usageLabel(key),
											icon: usageIcon(key),
											// 可用时给简短说明；不可用时优先展示置灰原因。
											hint: reason ?? t(usageHintKey(key)),
											disabled,
										},
											react.createElement(HudSwitch, {
												checked: usageDraft[key] !== false,
												disabled,
												label: usageLabel(key),
												title: reason,
												onChange: (next) => setUsageDraft((prev) => ({ ...prev, [key]: next })),
											}));
									}),
									react.createElement(SettingRow, { label: t("settingsUsageJump"), hint: t("settingsUsageJumpHint") },
										react.createElement(HudSwitch, {
											checked: usageDraft.showJump !== false,
											label: t("settingsUsageJump"),
											onChange: (next) => setUsageDraft((prev) => ({ ...prev, showJump: next })),
										}))),
								// 4. 「便笺」设置（v0.20.0）：便笺条数上限 5–20，默认 5。
								react.createElement("div", { className: "hud-settings-section hud-settings-section-card" },
									react.createElement("div", { className: "hud-settings-section-title" }, t("settingsNoteTitle")),
									react.createElement(SettingRow, { label: t("settingsNoteMax"), hint: t("settingsNoteMaxHint") },
										react.createElement(HudNumberStepper, {
											value: noteDraft.maxCount,
											min: NOTE_COUNT_MIN,
											max: NOTE_COUNT_MAX,
											label: t("settingsNoteMax"),
											onChange: (next) => setNoteDraft({ maxCount: normalizeNoteMaxCount(next) }),
										}))))), tab === "guide" ? react.createElement(SettingsGuide, { panelId: "hud-settings-panel-guide", labelledBy: "hud-settings-tab-guide" }) : null),
						react.createElement("div", { className: "hud-settings-footer" },
							// 左下角「恢复默认」，仅在设置与默认不同时激活。
							react.createElement("button", {
								type: "button",
								className: "hud-settings-btn",
								"data-kind": "reset",
								disabled: !dirty,
								onClick: resetDefaults,
							}, t("settingsReset")),
							react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "cancel", onClick: props.onClose }, t("settingsCancel")),
							react.createElement("button", {
								type: "button",
								className: "hud-settings-btn",
								"data-kind": "confirm",
								disabled: !edited,
								onClick: confirmSettings,
							}, t("settingsConfirm")))));
				return react_dom.createPortal(dialog, document.body);
			}

			/**
			 * v0.18.5：「使用说明」标签页（与设置页同一弹窗）。
			 * 左侧 240px 目录（与设置页左栏同宽，切标签时分割线不跳位）+ 右侧分节卡片：
			 * 目录点击滚动到对应小节，内容区滚动时高亮当前小节；纯展示，不发任何请求。
			 */
			function SettingsGuide(props) {
				const [active, setActive] = react.useState(() => GUIDE_SECTIONS[0]?.key ?? "");
				const contentRef = react.useRef(null);
				const sectionRefs = react.useRef({});
				const keys = GUIDE_SECTIONS.map((section) => section.key);
				/**
				 * 读取各节相对内容区顶部的偏移；任一节 DOM 尚未就绪时返回 null。
				 * 首帧与测试环境（没有真实 DOM）走这条降级路径，不会因为算不出高亮而报错。
				 */
				const collectOffsets = () => {
					const content = contentRef.current;
					if (content === null || content === undefined) return null;
					const offsets = [];
					for (const section of GUIDE_SECTIONS) {
						const node = sectionRefs.current[section.key];
						if (node === null || node === undefined) return null;
						offsets.push((Number(node.offsetTop) || 0) - (Number(content.offsetTop) || 0));
					}
					return offsets;
				};
				/** 滚动时同步目录高亮：只在目标小节变化时才写 state。 */
				const syncActive = () => {
					const content = contentRef.current;
					const offsets = collectOffsets();
					if (content === null || content === undefined || offsets === null) return;
					const next = guideActiveKey(keys, offsets, Number(content.scrollTop) || 0, 16);
					if (next !== "") setActive(next);
				};
				/** 目录点击：先高亮（即便无法滚动也保留反馈），再平滑滚动到小节标题。 */
				const jumpTo = (key) => {
					setActive(key);
					const node = sectionRefs.current[key];
					if (node !== undefined && node !== null && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start", behavior: "smooth" });
				};
				return react.createElement("div", {
					role: "tabpanel",
					id: props.panelId,
					"aria-labelledby": props.labelledBy,
					className: "hud-settings-guide",
				},
					// —— 左栏：小节目录（独立滚动，不跟随内容区）——
					react.createElement("nav", { className: "hud-guide-toc", "aria-label": t("settingsGuideTab") },
						GUIDE_SECTIONS.map((section) => react.createElement("button", {
							type: "button",
							key: `toc-${section.key}`,
							className: "hud-guide-toc-item",
							"data-active": active === section.key,
							"aria-current": active === section.key ? "true" : undefined,
							onClick: () => jumpTo(section.key),
						},
							react.createElement("span", { className: "hud-guide-toc-label" }, t(section.title))))),
					// —— 右栏：分节卡片（图标 + 标题 + 2~4 条要点）——
					react.createElement("div", { className: "hud-guide-content", ref: contentRef, onScroll: syncActive },
						GUIDE_SECTIONS.map((section) => react.createElement("section", {
							key: section.key,
							id: `hud-guide-section-${section.key}`,
							className: "hud-guide-section",
							ref: (node) => {
								if (node === null || node === undefined) delete sectionRefs.current[section.key];
								else sectionRefs.current[section.key] = node;
							},
						},
							react.createElement("h2", { className: "hud-guide-section-title" },
								react.createElement("span", null, t(section.title))),
							section.groups.map((group) => react.createElement("div", {
								key: `${section.key}-${group.kind}`,
								className: "hud-guide-group",
								"data-kind": group.kind,
							},
								// 分组标签：展示 / 功能 / 设置——每个要点保持简短。
								react.createElement("span", { className: "hud-guide-group-label" }, t(group.kind === "show" ? "guideKindShow" : group.kind === "set" ? "guideKindSet" : "guideKindAct")),
								react.createElement("ul", { className: "hud-guide-list" },
									group.items.map((item) => react.createElement("li", { key: item, className: "hud-guide-item" }, t(item))))))))));
			}

			/**
			 * v0.16.0：比较「草稿设置」与默认设置，用于「恢复默认」按钮的激活态。
			 * 只比较当前实际展示的键（例如未安装 dsh-account-usage 时不存在 usage 行），
			 * 避免因为「界面上看不到的项」让按钮一直亮着。
			 * v0.18.2：纳入「HUD 面板设置」（侧位 + 两处默认开合）与「跳转」按钮开关。
			 */
			/**
			 * v0.20.0：判断「本次打开设置页后是否改过草稿」。
			 * 与 isDefaultDraft 不同：这里比较的是打开时的快照，而不是默认值。
			 */
			function sameSettingsDraft(initial, current) {
				if (initial === null || initial === undefined || current === null || current === undefined) return false;
				for (const key of Object.keys(current.modules ?? {})) {
					if ((initial.modules?.[key] !== false) !== (current.modules[key] !== false)) return false;
				}
				for (const key of USAGE_SETTING_KEYS) {
					if ((initial.usage?.[key] !== false) !== (current.usage?.[key] !== false)) return false;
				}
				if (!sameOrder(normalizeModuleOrder(initial.order), normalizeModuleOrder(current.order))) return false;
				const leftContext = normalizeContextSettings(initial.context);
				const rightContext = normalizeContextSettings(current.context);
				for (const key of Object.keys(rightContext)) if (leftContext[key] !== rightContext[key]) return false;
				const leftPanel = normalizePanelSettings(initial.panel);
				const rightPanel = normalizePanelSettings(current.panel);
				for (const key of Object.keys(rightPanel)) if (leftPanel[key] !== rightPanel[key]) return false;
				return normalizeNoteSettings(initial.note).maxCount === normalizeNoteSettings(current.note).maxCount;
			}

			function isDefaultDraft(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, visibleModuleKeys) {
				const modules = defaultModules();
				const usage = defaultUsageDisplay();
				for (const key of visibleModuleKeys) if ((draft[key] !== false) !== modules[key]) return false;
				// 三行用量数据恒展示；不可用项虽然置灰，草稿值仍算数。
				for (const key of USAGE_SETTING_KEYS) if ((usageDraft[key] !== false) !== usage[key]) return false;
				const defaultContext = defaultContextSettings();
				const context = normalizeContextSettings(contextDraft);
				// v0.18.7：位置固定（pinned）同样参与「恢复默认」的激活判定。
				if (context.barStyle !== defaultContext.barStyle || context.showStats !== defaultContext.showStats || context.showUsage !== defaultContext.showUsage || context.pinned !== defaultContext.pinned) return false;
				const defaultPanel = defaultPanelSettings();
				const panel = normalizePanelSettings(panelDraft);
				if (panel.side !== defaultPanel.side
					|| panel.newSessionOpen !== defaultPanel.newSessionOpen || panel.chatOpen !== defaultPanel.chatOpen) return false;
				// v0.20.0：「便笺」条数上限同样参与「恢复默认」。
				if (normalizeNoteSettings(noteDraft).maxCount !== defaultNoteSettings().maxCount) return false;
				const defaultOrder = normalizeModuleOrder(null).filter((key) => visibleModuleKeys.includes(key));
				const currentOrder = orderDraft.filter((key) => visibleModuleKeys.includes(key));
				if (currentOrder.length !== defaultOrder.length) return false;
				return currentOrder.every((key, index) => key === defaultOrder[index]);
			}

			function SessionModule(props) {
				// v0.17.0：齿轮不再打开设置菜单，而是打开设置弹窗（选项一致，按模块分卡片）。
				const [settingsOpen, setSettingsOpen] = react.useState(false);
				const closeSettings = react.useCallback(() => { setSettingsOpen(false); }, []);
				const settingsDialog = settingsOpen ? react.createElement(SettingsDialog, {
					modules: props.modules,
					usage: props.usage,
					context: props.context,
					order: props.order,
					// v0.18.2：「HUD 面板设置」草稿来源 + 用量行置灰原因。
					panel: props.panel,
					// v0.20.0：「便笺」模块设置（条数上限）。
					note: props.note,
					// v0.18.3：本页不展示的模块在左栏置灰只读（保留真实开关状态）。
					lockedModules: props.lockedModules,
					balanceAvailable: props.balanceAvailable,
					usageAvailability: props.usageAvailability,
					usageReasons: props.usageReasons,
					onClose: closeSettings,
					onConfirm: (draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft) => {
						props.onSettingsChange(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft);
						closeSettings();
					},
				}) : null;
				return react.createElement("div", { className: "hud-section" },
					react.createElement("div", { className: "hud-module-head" },
						react.createElement(Icon, { name: "session" }),
						react.createElement(WorkspaceTitle, {
							workspaceTitle: props.workspaceTitle,
							workspacePath: props.workspacePath,
							canRename: props.canRenameWorkspace,
							renameReason: props.workspaceRenameReason,
							desktopAvailable: props.desktopAvailable,
							fileManager: props.fileManager,
							onRename: props.onRenameWorkspace,
							onReveal: props.onRevealWorkspace,
							onCopyPath: props.onCopyWorkspacePath,
						}),
						react.createElement("button", {
							type: "button",
							className: "hud-settings-btn",
							"aria-label": t("settingsTitle"),
							title: t("settingsTitle"),
							"aria-haspopup": "dialog",
							"aria-expanded": settingsOpen,
							onClick: () => setSettingsOpen(true),
						}, react.createElement(Icon, { name: "settings", color: "var(--dsw-alias-label-primary)" })),
						settingsDialog),
					react.createElement("div", { className: "hud-session-meta" },
						// v0.18.1：新建会话页（无会话/空白会话）不展示会话标题与状态徽标。
						props.hasSession === false ? null : react.createElement("div", { className: "hud-session-name-row" },
							react.createElement(SessionTitleRow, {
								sessionTitle: props.sessionTitle,
								pinned: props.pinned,
								canRename: props.canRenameSession,
								canPin: props.canPin,
								pinReason: props.pinReason,
								canFork: props.canFork,
								canCopy: props.canCopySession,
								canArchive: props.canArchive,
								archived: props.archived,
								onRename: props.onRename,
								onTogglePin: props.onTogglePin,
								onFork: props.onFork,
								onCopyId: props.onCopySessionId,
								onCopyName: props.onCopySessionName,
								onArchive: props.onArchive,
								statusKind: props.statusKind,
								statusText: props.statusText,
							})),
						props.providerLabel === null ? null : react.createElement("div", { className: "hud-model-row" },
							react.createElement("span", { className: "hud-model-dot" }),
							react.createElement("span", null, props.providerLabel ?? ""),
							react.createElement("span", { className: "hud-model-note" }, "")),
						react.createElement("div", { className: "hud-model-chips" },
							props.modelId === null ? null : react.createElement("span", { className: "hud-model-chip" }, props.modelId),
							props.effortLabel === null ? null : react.createElement("span", { className: "hud-model-chip" }, props.effortLabel))));
			}

			/**
			 * 工作区标题（v0.18.1）：hover 灰底；点击在鼠标位置打开菜单；
			 * 重命名时原位变输入框——失焦或 Enter 提交、Esc 取消，不提供取消/确认按钮。
			 */
			function WorkspaceTitle(props) {
				const [menu, setMenu] = react.useState(null);
				const [editing, setEditing] = react.useState(false);
				const [draft, setDraft] = react.useState("");
				const draftRef = react.useRef("");
				const committing = react.useRef(false);
				const inputRef = react.useRef(null);
				const title = props.workspaceTitle ?? "";
				const updateDraft = (value) => { draftRef.current = value; setDraft(value); };
				const stopEdit = () => { committing.current = false; setEditing(false); updateDraft(""); };
				const commitEdit = async () => {
					if (committing.current) return;
					const next = draftRef.current.trim();
					// 空白或未改动：直接退出编辑态，不发请求也不提示。
					if (next === "" || next === title) { stopEdit(); return; }
					committing.current = true;
					try {
						await props.onRename?.(next);
						toast(t("workspaceRenameDone"), "success");
					} catch (error) {
						// 失败按官方弹窗语义退回原名：输入不保留，避免界面与真实工作区名不一致。
						toast(interpolate(t("workspaceRenameFailed"), { detail: error?.message ?? String(error) }), "error");
					} finally {
						stopEdit();
					}
				};
				const startEdit = () => {
					if (props.canRename !== true) return;
					updateDraft(title);
					committing.current = false;
					setEditing(true);
				};
				// 编辑态：自动聚焦并全选，便于直接覆盖输入。
				react.useEffect(() => {
					if (!editing) return undefined;
					const el = inputRef.current;
					if (el === null || el === undefined) return undefined;
					if (typeof el.focus === "function") el.focus();
					if (typeof el.select === "function") el.select();
					return undefined;
				}, [editing]);
				// 点击其他区域即提交：文档级 pointerdown，命中输入框内部则忽略。
				react.useEffect(() => {
					if (!editing) return undefined;
					if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
					const onPointerDown = (event) => {
						const el = inputRef.current;
						const target = event?.target ?? null;
						if (el !== null && el !== undefined && target !== null && typeof el.contains === "function" && el.contains(target)) return;
						commitEdit();
					};
					document.addEventListener("pointerdown", onPointerDown, true);
					return () => document.removeEventListener("pointerdown", onPointerDown, true);
				}, [editing]);
				const openMenu = (event) => {
					if (editing) return;
					event?.preventDefault?.();
					event?.stopPropagation?.();
					const anchor = menuAnchorFrom(event);
					setMenu({ x: anchor.x, y: anchor.y });
				};
				const items = workspaceMenuItems({ ...props, t, onRename: startEdit });
				const menuNode = menu === null ? null : react.createElement(HudMenu, {
					items,
					x: menu.x,
					y: menu.y,
					label: t("workspaceMenuLabel"),
					onClose: () => setMenu(null),
				});
				if (editing) {
					return react.createElement(react.Fragment, null,
						react.createElement("input", {
							...IME_INPUT_PROPS,
							ref: inputRef,
							type: "text",
							className: "hud-workspace-edit",
							value: draft,
							maxLength: 200,
							placeholder: title,
							"aria-label": t("workspaceRenameTitle"),
							onChange: (event) => updateDraft(event.target.value),
							onKeyDown: (event) => {
								if (isImeComposing(event)) return;
								if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
								else if (event.key === "Escape") { event.preventDefault(); stopEdit(); }
							},
						}),
						menuNode);
				}
				return react.createElement(react.Fragment, null,
					react.createElement("button", {
						type: "button",
						className: "hud-module-title hud-workspace-name",
						title,
						"aria-haspopup": "menu",
						"aria-expanded": menu !== null,
						onClick: openMenu,
						onContextMenu: openMenu,
					}, title),
					menuNode);
			}

			/**
			 * 会话名称行（v0.18.1）：名称 hover 灰底，点击在鼠标位置打开菜单；
			 * 右侧为置顶图钉（仅置顶时显示）与状态徽标；编辑态为内联输入框，无取消/确认按钮。
			 */
			function SessionTitleRow(props) {
				const [menu, setMenu] = react.useState(null);
				const [editing, setEditing] = react.useState(false);
				const [draft, setDraft] = react.useState("");
				const draftRef = react.useRef("");
				const committing = react.useRef(false);
				const inputRef = react.useRef(null);
				const title = props.sessionTitle ?? "";
				const updateDraft = (value) => { draftRef.current = value; setDraft(value); };
				const stopEdit = () => { committing.current = false; setEditing(false); updateDraft(""); };
				const commitEdit = async () => {
					if (committing.current) return;
					const next = draftRef.current.trim();
					if (next === "" || next === title) { stopEdit(); return; }
					committing.current = true;
					try {
						await props.onRename?.(next);
						toast(t("sessionRenameDone"), "success");
					} catch (error) {
						toast(interpolate(t("sessionRenameFailed"), { detail: error?.message ?? String(error) }), "error");
					} finally {
						stopEdit();
					}
				};
				const startEdit = () => {
					if (props.canRename !== true) return;
					updateDraft(title);
					committing.current = false;
					setEditing(true);
				};
				react.useEffect(() => {
					if (!editing) return undefined;
					const el = inputRef.current;
					if (el === null || el === undefined) return undefined;
					if (typeof el.focus === "function") el.focus();
					if (typeof el.select === "function") el.select();
					return undefined;
				}, [editing]);
				react.useEffect(() => {
					if (!editing) return undefined;
					if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
					const onPointerDown = (event) => {
						const el = inputRef.current;
						const target = event?.target ?? null;
						if (el !== null && el !== undefined && target !== null && typeof el.contains === "function" && el.contains(target)) return;
						commitEdit();
					};
					document.addEventListener("pointerdown", onPointerDown, true);
					return () => document.removeEventListener("pointerdown", onPointerDown, true);
				}, [editing]);
				const openMenu = (event) => {
					if (editing) return;
					event?.preventDefault?.();
					event?.stopPropagation?.();
					const anchor = menuAnchorFrom(event);
					setMenu({ x: anchor.x, y: anchor.y });
				};
				const items = sessionMenuItems({ ...props, t, onRename: startEdit });
				const menuNode = menu === null ? null : react.createElement(HudMenu, {
					items,
					x: menu.x,
					y: menu.y,
					label: t("sessionMenuLabel"),
					onClose: () => setMenu(null),
				});
				const statusChip = props.statusText === undefined || props.statusText === null
					? null
					: react.createElement("span", { className: "hud-chip", "data-kind": props.statusKind }, props.statusText);
				if (editing) {
					return react.createElement(react.Fragment, null,
						react.createElement("input", {
							...IME_INPUT_PROPS,
							ref: inputRef,
							type: "text",
							className: "hud-session-edit",
							value: draft,
							maxLength: 200,
							placeholder: title,
							"aria-label": t("sessionRename"),
							onChange: (event) => updateDraft(event.target.value),
							onKeyDown: (event) => {
								if (isImeComposing(event)) return;
								if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
								else if (event.key === "Escape") { event.preventDefault(); stopEdit(); }
							},
						}),
						statusChip,
						menuNode);
				}
				return react.createElement(react.Fragment, null,
					react.createElement("button", {
						type: "button",
						className: "hud-session-name",
						title,
						"aria-haspopup": "menu",
						"aria-expanded": menu !== null,
						onClick: openMenu,
						onContextMenu: openMenu,
					}, title),
					props.pinned === true
						? react.createElement("span", { className: "hud-pin-mark", title: t("sessionMenuUnpin") },
							react.createElement(OfficialIcon, { name: "IconPinFillRegular", size: 12, color: "var(--dsw-alias-label-tertiary)" }))
						: null,
					statusChip,
					menuNode);
			}

			/** 当前会话累计输入 token 中，来自缓存读取的比例。 */
			function cacheHitPercent(usage) {
				if (usage === null || typeof usage !== "object") return null;
				const uncached = usage.uncachedInputTokens;
				const cacheRead = usage.cacheReadTokens;
				const cacheWrite = usage.cacheWriteTokens;
				if (![uncached, cacheRead, cacheWrite].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) return null;
				const billedInput = uncached + cacheRead + cacheWrite;
				return billedInput === 0 ? null : (cacheRead / billedInput * 100).toFixed(1);
			}

			// —— 上下文模块（不可折叠）——
			const CONTEXT_PART_ROWS = [
				{ key: "systemTokens", label: "System prompt", color: "var(--dsw-alias-chart-system, #8b95a5)" },
				{ key: "toolsTokens", label: "Tool definitions", color: "var(--dsw-alias-chart-tools, #a78bfa)" },
				{ key: "messageTokens", label: "Messages", color: "var(--dsw-alias-chart-messages, #4d8dff)" },
			];

			/** 上下文占用的紧凑数字：1.2K / 27.6K / 397K / 1M。 */
			function formatCompactTokens(value) {
				if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
				if (value < 1000) return String(Math.round(value));
				const divisor = value < 1_000_000 ? 1000 : 1_000_000;
				const suffix = divisor === 1000 ? "K" : "M";
				const scaled = value / divisor;
				const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
				return `${rounded}${suffix}`;
			}

			/** 精确数字（千分位），用于悬停提示框。 */
			function formatExactTokens(value) {
				if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
				return Math.round(value).toLocaleString("en-US");
			}

			/** 缓存命中率去掉无意义的 .0：99.0 → 99，99.9 → 99.9。 */
			function formatPercentCompact(value) {
				const number = typeof value === "number" ? value : Number(value);
				return Number.isFinite(number) ? String(number) : "—";
			}

			function contextNumber(value) {
				return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
			}

			function formatDurationMs(ms) {
				if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
				const seconds = ms / 1000;
				if (seconds < 60) return interpolate(t("contextDurationSeconds"), { seconds: Math.round(seconds * 10) / 10 });
				const whole = Math.round(seconds);
				return interpolate(t("contextDurationMinutes"), { minutes: Math.floor(whole / 60), seconds: whole % 60 });
			}

			/**
			 * 会话投影值（contextPressure / contextBreakdown / sessionStats / todos …）：
			 * 唯一来源是会话列表快照 `sessions.list.byId[id].projectionValues`——客户端 `sessions`
			 * 服务**没有** `projectionValues(sessionId)` 方法（那是内部 SessionsManager 的私有方法），
			 * 对服务做可选调用只会拿到 undefined，因此一律从快照读取。
			 */
			function projectionValuesOf(summary) {
				if (summary === null || typeof summary !== "object") return {};
				const values = summary.projectionValues;
				return values !== null && typeof values === "object" ? values : {};
			}

			/** breakdown → 有颜色的三段；总量为 0 时不展示分段。 */
			function contextBreakdownParts(breakdown) {
				if (breakdown === null || typeof breakdown !== "object") return [];
				const rows = CONTEXT_PART_ROWS.map((row) => ({ ...row, tokens: contextNumber(breakdown[row.key]) }));
				const total = rows.reduce((sum, row) => sum + row.tokens, 0);
				if (total <= 0) return [];
				return rows.map((row) => ({ ...row, percent: row.tokens / total * 100 }));
			}

			function contextStatsSpeed(stats) {
				if (stats === null || typeof stats !== "object") return null;
				const decodeMs = contextNumber(stats.decodeMs);
				const decodeTokens = contextNumber(stats.decodeTokens);
				return decodeMs > 0 ? decodeTokens / (decodeMs / 1000) : null;
			}

			function contextStatsLine(stats, speed) {
				const turns = contextNumber(stats?.turns);
				const steps = contextNumber(stats?.steps);
				if (speed === null) return interpolate(t("contextStatsCounts"), { turns, steps });
				return interpolate(t("contextStatsCountsSpeed"), { turns, steps, tps: Math.round(speed) });
			}

			function contextStatsRows(stats, speed) {
				const rows = [];
				const llmMs = contextNumber(stats?.llmMs);
				const toolMs = contextNumber(stats?.toolMs);
				const ttftSteps = contextNumber(stats?.ttftSteps);
				const ttftMs = contextNumber(stats?.ttftMs);
				if (llmMs > 0) rows.push({ label: t("contextStatsLlmTime"), value: formatDurationMs(llmMs) });
				if (toolMs > 0) rows.push({ label: t("contextStatsToolTime"), value: formatDurationMs(toolMs) });
				if (ttftSteps > 0) rows.push({ label: t("contextStatsTtft"), value: formatDurationMs(ttftMs / ttftSteps) });
				if (speed !== null) rows.push({ label: t("contextStatsTps"), value: `${Math.round(speed)} tok/s` });
				return rows;
			}

			function contextUsageTotal(usage) {
				if (usage === null || typeof usage !== "object") return 0;
				return contextNumber(usage.uncachedInputTokens) + contextNumber(usage.cacheReadTokens) + contextNumber(usage.cacheWriteTokens) + contextNumber(usage.outputTokens);
			}

			function contextUsageLine(usage, cacheHit) {
				const total = formatCompactTokens(contextUsageTotal(usage));
				if (cacheHit === null) return interpolate(t("contextUsageLineNoCache"), { total });
				return interpolate(t("contextUsageLine"), { total, percent: formatPercentCompact(cacheHit) });
			}

			function contextUsageRows(usage, cacheHit) {
				const rows = [];
				if (cacheHit !== null) rows.push({ label: t("contextUsageCacheHit"), value: `${formatPercentCompact(cacheHit)}%` });
				rows.push({ label: t("contextUsageUncached"), value: `${formatExactTokens(contextNumber(usage?.uncachedInputTokens))} tok` });
				rows.push({ label: t("contextUsageCacheRead"), value: `${formatExactTokens(contextNumber(usage?.cacheReadTokens))} tok` });
				if (contextNumber(usage?.cacheWriteTokens) !== 0) rows.push({ label: t("contextUsageCacheWrite"), value: `${formatExactTokens(contextNumber(usage?.cacheWriteTokens))} tok` });
				rows.push({ label: t("contextUsageOutput"), value: `${formatExactTokens(contextNumber(usage?.outputTokens))} tok` });
				return rows;
			}

			function ContextModule(props) {
				const pressure = props.pressure;
				const cacheHit = cacheHitPercent(props.usage);
				const settings = normalizeContextSettings(props.settings);
				const parts = contextBreakdownParts(props.breakdown);
				const [barHover, setBarHover] = react.useState(false);
				const [tip, setTip] = react.useState(null);
				// 压缩状态按会话独立（Map 键控）：各会话互不影响，切换会话后另一会话不残留「压缩中」。
				const [compactingMap, setCompactingMap] = react.useState({});
				const compacting = compactingMap[props.sessionId] === true;
				const disabled = compacting || props.running;
				const projected = contextNumber(pressure?.projectedTokens);
				const windowSize = contextNumber(pressure?.contextWindow);
				const ratio = pressure === null || projected <= 0 || windowSize <= 0 ? null : Math.min(100, (projected / windowSize) * 100);
				const usedText = pressure !== null && projected > 0 ? formatCompactTokens(projected) : "—";
				const limitText = pressure !== null && windowSize > 0 ? formatCompactTokens(windowSize) : "—";
				const countText = ratio === null ? "—" : interpolate(t("contextOccupancy"), { used: usedText, limit: limitText, percent: ratio.toFixed(1) });
				const barColor = ratio === null ? "color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)"
					: ratio <= 40 ? "var(--dsw-alias-state-success-primary)"
						: ratio <= 90 ? "var(--dsw-alias-state-warn-primary)"
							: "var(--dsw-alias-state-error-primary)";
				const segmented = (settings.barStyle === "segmented" || barHover) && parts.length > 0;
				const speed = contextStatsSpeed(props.stats);
				const showStats = settings.showStats !== false && props.stats !== null && typeof props.stats === "object"
					&& (contextNumber(props.stats.turns) > 0 || contextNumber(props.stats.steps) > 0);
				const statsLine = showStats ? contextStatsLine(props.stats, speed) : null;
				const statsCountsText = showStats ? contextStatsLine(props.stats, null) : null;
				const statsRows = showStats ? contextStatsRows(props.stats, speed) : [];
				const showUsage = settings.showUsage !== false && props.usage !== null && typeof props.usage === "object"
					&& (contextUsageTotal(props.usage) > 0 || cacheHit !== null);
				const usageLine = showUsage ? contextUsageLine(props.usage, cacheHit) : null;
				const usageRows = showUsage ? contextUsageRows(props.usage, cacheHit) : [];
				const onCompact = async () => {
					if (disabled) return;
					setCompactingMap((prev) => ({ ...prev, [props.sessionId]: true }));
					try {
						await call("compact", { sessionId: props.sessionId });
						toast(t("contextCompressed"), "success");
					} catch (error) {
						if (error?.code === "busy") toast(t("contextBusy"));
						else if (error?.code === "unavailable") toast(t("contextUnavailable"));
						else toast(interpolate(t("contextFailed"), { detail: error?.message ?? String(error) }));
					} finally {
						setCompactingMap((prev) => ({ ...prev, [props.sessionId]: false }));
					}
				};
				/**
				 * 在鼠标位置显示固定定位提示框；靠近视口右侧/底部时自动翻转，
				 * 避免被 HUD 面板的 overflow 裁切。提示框用 portal 挂到 body。
				 */
				const showTip = (event, kind) => {
					const x = typeof event.clientX === "number" ? event.clientX : 0;
					const y = typeof event.clientY === "number" ? event.clientY : 0;
					const width = 260;
					const height = kind === "breakdown" ? 112 : kind === "stats" ? 164 : 190;
					const viewportW = globalThis.innerWidth ?? 0;
					const viewportH = globalThis.innerHeight ?? 0;
					const left = viewportW > 0 ? Math.max(8, Math.min(x + 12, viewportW - width - 12)) : x + 12;
					const below = viewportH === 0 || y + height + 16 <= viewportH;
					setTip({ kind, left, top: below ? y + 14 : y - 12, below });
				};
				const hideTip = () => setTip(null);
				const tipOpen = tip !== null;
				react.useEffect(() => {
					if (!tipOpen) return undefined;
					const hide = () => setTip(null);
					globalThis.addEventListener?.("scroll", hide, true);
					return () => globalThis.removeEventListener?.("scroll", hide, true);
				}, [tipOpen]);
				const tipRows = (rows) => react.createElement("div", { className: "hud-context-tip-rows" },
					rows.map((row) => react.createElement("div", { className: "hud-context-tip-row", key: row.label },
						react.createElement("span", { className: "hud-context-tip-label" },
							row.color === undefined ? null : react.createElement("span", { className: "hud-context-swatch", style: { background: row.color } }),
							row.label),
						react.createElement("span", { className: "hud-context-tip-value" }, row.value))));
				let tipNode = null;
				if (tip !== null) {
					let body = null;
					if (tip.kind === "breakdown" && parts.length > 0) {
						body = tipRows(parts.map((part) => ({ label: part.label, color: part.color, value: `~${formatCompactTokens(part.tokens)}` })));
					} else if (tip.kind === "stats" && statsRows.length > 0) {
						body = react.createElement(react.Fragment, null,
							react.createElement("div", { className: "hud-context-tip-head" },
								react.createElement(Icon, { name: "gauge", size: 14 }),
								react.createElement("span", null, t("contextStatsTitle")),
								react.createElement("span", { className: "hud-context-tip-head-value" }, statsCountsText)),
							react.createElement("div", { className: "hud-context-tip-rule" }),
							tipRows(statsRows));
					} else if (tip.kind === "usage" && usageRows.length > 0) {
						body = react.createElement(react.Fragment, null,
							react.createElement("div", { className: "hud-context-tip-head" },
								react.createElement(Icon, { name: "database", size: 14 }),
								react.createElement("span", null, t("contextUsageTitle")),
								react.createElement("span", { className: "hud-context-tip-head-value" }, `${formatExactTokens(contextUsageTotal(props.usage))} tok`)),
							react.createElement("div", { className: "hud-context-tip-rule" }),
							tipRows(usageRows));
					}
					if (body !== null) {
						tipNode = react_dom.createPortal(react.createElement("div", {
							className: "hud-context-tip",
							role: "tooltip",
							"data-below": tip.below,
							style: { left: tip.left, top: tip.top },
						}, body), document.body);
					}
				}
				const statsLineNode = statsLine === null ? null : react.createElement("div", {
					className: "hud-context-stat",
					onMouseEnter: (event) => { if (statsRows.length > 0) showTip(event, "stats"); },
					onMouseMove: (event) => { if (statsRows.length > 0) showTip(event, "stats"); },
					onMouseLeave: hideTip,
				},
					react.createElement(Icon, { name: "gauge", size: 14 }),
					react.createElement("span", { className: "hud-context-stat-text" }, statsLine));
				const usageLineNode = usageLine === null ? null : react.createElement("div", {
					className: "hud-context-stat",
					onMouseEnter: (event) => { if (usageRows.length > 0) showTip(event, "usage"); },
					onMouseMove: (event) => { if (usageRows.length > 0) showTip(event, "usage"); },
					onMouseLeave: hideTip,
				},
					react.createElement(Icon, { name: "database", size: 14 }),
					react.createElement("span", { className: "hud-context-stat-text" }, usageLine));
				return react.createElement(react.Fragment, null,
					react.createElement("div", { className: "hud-section" },
						react.createElement("div", {
							className: "hud-module-head",
							"data-fold": props.fold === true,
							// 与其它模块一致：点标题行任意处都能折叠/展开。
							onClick: () => props.onFoldChange?.(props.fold !== true),
						},
							react.createElement(Icon, { name: "context" }),
							react.createElement("span", { className: "hud-module-title" }, t("contextModule")),
							react.createElement("span", { className: "hud-module-count hud-context-count", title: ratio === null ? undefined : `${formatExactTokens(projected)} / ${formatExactTokens(windowSize)}` }, countText),
							// v0.19.2：上下文模块可折叠，折叠后只保留标题行（占用率仍在标题里）。
							react.createElement("button", {
								type: "button",
								className: "hud-module-fold",
								"data-fold": props.fold === true,
								"aria-label": t(props.fold === true ? "expandModule" : "collapseModule"),
								onClick: (event) => { event.stopPropagation(); props.onFoldChange?.(props.fold !== true); },
							}, "\u25BE")),
						props.fold === true ? null : react.createElement("div", { className: "hud-context-row" },
							react.createElement("div", {
								className: "hud-bar",
								role: "img",
								"aria-label": countText,
								onMouseEnter: (event) => { setBarHover(true); if (parts.length > 0) showTip(event, "breakdown"); },
								onMouseMove: (event) => { if (parts.length > 0) showTip(event, "breakdown"); },
								onMouseLeave: () => { setBarHover(false); hideTip(); },
							},
								react.createElement("div", { className: "hud-bar-track" },
									segmented
										? react.createElement("div", { className: "hud-context-segments", style: { width: `${ratio ?? 0}%` } },
											parts.filter((part) => part.tokens > 0).map((part) => react.createElement("div", {
												key: part.key,
												className: "hud-context-segment",
												style: { width: `${part.percent}%`, background: part.color },
											})))
										: react.createElement("div", { className: "hud-bar-fill", style: { width: `${ratio ?? 0}%`, background: barColor } }))),
							react.createElement("button", {
								type: "button",
								className: "hud-btn-small",
								disabled,
								onClick: onCompact,
							}, compacting ? t("contextCompressing") : t("contextCompress"))),
						props.fold === true || (statsLineNode === null && usageLineNode === null) ? null : react.createElement("div", { className: "hud-context-stats" },
							statsLineNode,
							usageLineNode)),
					tipNode);
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

			/** 读取按会话分键的 localStorage 对象存储（缺失/损坏 → null）。 */
			function loadJsonStorage(key) {
				try {
					const raw = globalThis.localStorage?.getItem(key);
					if (typeof raw !== "string" || raw === "") return null;
					const value = JSON.parse(raw);
					return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
				} catch { return null; }
			}
			/** 写入按会话分键的对象存储：map[sessionId] = value（仅用于无 cwd 的会话级降级路径）。 */
			function persistSessionField(key, sessionId, value) {
				try {
					const map = loadJsonStorage(key) ?? {};
					map[sessionId] = value;
					globalThis.localStorage?.setItem(key, JSON.stringify(map));
				} catch { /* 存储不可用仅内存 */ }
			}

			// —— 工作区级键解析与读写（便笺/待办自 v0.12.0 起按工作区共享）——
			/** 合法的 localStorage 存储对象（非 null 的非数组对象）。 */
			function isStorageRecord(value) {
				return value !== null && typeof value === "object" && !Array.isArray(value);
			}
			/** 读取存储内某个键的原始记录（不校验结构，缺失/损坏 → null）。 */
			function readStorageEntry(storage, key) {
				return isStorageRecord(storage) ? (storage[key] ?? null) : null;
			}
			/** 写入存储内某个键（包含空值，用于标记「此工作区无内容」），返回同一对象。 */
			function writeStorageEntry(storage, key, value) {
				if (isStorageRecord(storage)) storage[key] = value;
				return storage;
			}
			/** 提交存储对象到 localStorage（写失败仅内存）。 */
			function commitStorage(storageKey, storage) {
				try {
					globalThis.localStorage?.setItem(storageKey, JSON.stringify(storage ?? {}));
				} catch { /* 存储不可用仅内存 */ }
			}
			/** 合并待办列表：本地条目优先且顺序不变，只补充对方独有的新增项（按 id 去重）。 */
			function mergeTodoLists(localList, remoteList) {
				const local = Array.isArray(localList) ? localList.filter((item) => item !== null && typeof item === "object" && typeof item.id === "string") : [];
				const seen = new Set(local.map((item) => item.id));
				const merged = local.slice();
				for (const item of Array.isArray(remoteList) ? remoteList : []) {
					if (item === null || typeof item !== "object" || typeof item.id !== "string" || seen.has(item.id)) continue;
					seen.add(item.id);
					merged.push(item);
				}
				return merged;
			}
			/** 待办列表结构校验（与 TodoModule 首次读取同一口径）。 */
			function normalizeTodoList(value) {
				return Array.isArray(value) ? value.filter((item) => item !== null && typeof item === "object" && typeof item.text === "string") : [];
			}
			/**
			 * 首次访问某工作区键时的一次性迁移：把候选会话的旧会话级数据按工作区归并。
			 * 便笺取 updatedAt 最新的一份；待办按条目 id 去重合并（本地优先）。
			 */
			function migrateWorkspaceScope(storage, workspaceKey, candidates) {
				if (!isStorageRecord(storage) || typeof workspaceKey !== "string" || workspaceKey.trim() === "") return { migrated: false };
				const list = Array.isArray(candidates) ? candidates.filter((id) => typeof id === "string" && id !== "") : [];
				const marks = isStorageRecord(storage[WORKSPACE_MIGRATED_KEY]) ? storage[WORKSPACE_MIGRATED_KEY] : {};
				if (marks[workspaceKey] === WORKSPACE_MIGRATED_VERSION) return { migrated: false };
				const notesById = isStorageRecord(storage[NOTES_STORAGE_KEY]) ? storage[NOTES_STORAGE_KEY] : {};
				const todosById = isStorageRecord(storage[TODOS_STORAGE_KEY]) ? storage[TODOS_STORAGE_KEY] : {};
				const stampOf = (entry) => Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
				let best = null;
				for (const id of list) {
					const entry = notesById[id];
					if (!isStorageRecord(entry)) continue;
					// 历史便笺未写 updatedAt：给 0 兜底戳，保证「有戳的记录」优先
					const stamp = stampOf(entry);
					const explicit = Number.isFinite(entry.updatedAt);
					const bestExplicit = best !== null && Number.isFinite(best.entry.updatedAt);
					if (best === null || stamp > best.stamp || (stamp === best.stamp && explicit && !bestExplicit)) {
						best = { stamp, entry };
					}
				}
				let todos = [];
				for (const id of list) {
					const entry = todosById[id];
					if (Array.isArray(entry)) todos = mergeTodoLists(todos, entry);
				}
				const noteValue = best === null ? null : best.entry;
				const mergedNotes = { ...notesById };
				const mergedTodos = { ...todosById };
				if (noteValue !== null) mergedNotes[workspaceKey] = noteValue;
				if (todos.length > 0) mergedTodos[workspaceKey] = todos;
				const next = { ...storage };
				if (noteValue !== null) next[NOTES_STORAGE_KEY] = mergedNotes;
				if (todos.length > 0) next[TODOS_STORAGE_KEY] = mergedTodos;
				next[WORKSPACE_MIGRATED_KEY] = { ...marks, [workspaceKey]: WORKSPACE_MIGRATED_VERSION };
				return { migrated: true, storage: next, note: noteValue, todos };
			}
			/**
			 * 工作区级待办写入（差量语义，避免删除被归并复活）：
			 * 写入前重读最新存储，先按 id 移除本次删除的条目（removed / cleared），
			 * 再按 id 归并本次新增的条目 —— 因此同工作区其它会话/标签页新增的条目
			 * 不会因本会话的旧快照被覆盖，而本会话的删除也不会被存储里的旧内容复活。
			 * @param nextList 本次操作后的列表（调用方内存态）
			 * @param removedIds 本次显式删除的条目 id 集合
			 * @param options.cleared 本次是否为「清空」操作：即使 nextList 为空也要落盘，
			 *        删除存储里的旧条目（否则空列表会被当成未操作而保留旧数据）
			 * @returns 实际落盘的列表（调用方用它同步内存态）
			 */
			function persistWorkspaceTodos(storageKey, workspaceKey, nextList, removedIds, options = {}) {
				if (typeof workspaceKey !== "string" || workspaceKey === "") return nextList;
				const list = Array.isArray(nextList) ? nextList : [];
				const removed = removedIds instanceof Set ? removedIds : new Set(Array.isArray(removedIds) ? removedIds : []);
				if (list.length === 0 && removed.size === 0 && options.cleared !== true) return list;
				const storage = loadJsonStorage(storageKey) ?? {};
				const stored = readStorageEntry(storage, workspaceKey);
				const remote = (Array.isArray(stored) ? stored : []).filter((item) => item !== null && typeof item === "object" && !removed.has(item.id));
				const merged = mergeTodoLists(list, remote);
				writeStorageEntry(storage, workspaceKey, merged);
				commitStorage(storageKey, storage);
				return merged;
			}
			/**
			 * 会话/工作区快照 → 工作区级存储键。
			 * 会话自身 cwd 优先（与宿主 sidebar 的分组口径一致），其次工作区实体 path；
			 * 两者都不可用 → null，调用方降级为会话级隔离（不跨项目共享）。
			 */
			function resolveWorkspaceKey(cwd, workspaceItems) {
				if (typeof cwd === "string" && cwd !== "") return cwd;
				const items = Array.isArray(workspaceItems) ? workspaceItems : [];
				let fallback = null;
				for (const item of items) {
					if (item === null || typeof item !== "object" || typeof item.path !== "string" || item.path === "") continue;
					if (item.path === cwd) return item.path;
					if (fallback === null) fallback = item.path;
				}
				return fallback;
			}
			/** 工作区中存活的会话 id（排除已归档），按最近更新倒序。 */
			function liveSessionsOf(snapshot, workspace, archived) {
				const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : [];
				const rows = [];
				for (const id of ids) {
					if (typeof id !== "string" || id === "" || archived.has(id)) continue;
					const row = snapshot?.byId?.[id];
					if (row === undefined || row === null) continue;
					rows.push({ id, updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : 0 });
				}
				rows.sort((left, right) => right.updatedAt - left.updatedAt);
				return rows.map((row) => row.id);
			}
			/**
			 * 解析「目标工作区」：工作区级存储键 + git 模块与便笺「发送到对话」的代理会话。
			 * current 存在时用其 cwd；新建会话页用最近更新的非空工作区。
			 */
			function resolveTargetWorkspace(snapshot, workspaceItems, current) {
				if (arguments.length < 3) current = snapshot?.current;
				// v0.18.1：额外回传 workspaceId / workspacePath，供工作区标题菜单做重命名与定位。
				const empty = { path: null, candidates: [], gitSessionId: null, sendSessionId: null, workspaceTitle: null, workspaceId: null, workspacePath: null };
				const items = Array.isArray(workspaceItems) ? workspaceItems : [];
				const row = current === undefined || current === null ? null : (snapshot?.byId?.[current] ?? null);
				const archived = new Set(Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : []);
				if (row !== null && typeof row.cwd === "string" && row.cwd !== "") {
					const owner = items.find((item) => item !== null && typeof item === "object" && item.path === row.cwd) ?? null;
					return {
						path: row.cwd,
						candidates: [current, ...liveSessionsOf(snapshot, owner, archived).filter((id) => id !== current)],
						gitSessionId: current,
						sendSessionId: current,
						workspaceTitle: typeof owner?.title === "string" && owner.title !== "" ? owner.title : null,
						workspaceId: typeof owner?.workspaceId === "string" && owner.workspaceId !== "" ? owner.workspaceId : null,
						workspacePath: typeof owner?.path === "string" && owner.path !== "" ? owner.path : null,
					};
				}
				const ordered = items
					.filter((item) => item !== null && typeof item === "object" && typeof item.path === "string" && item.path !== "")
					.map((item) => ({ item, ids: liveSessionsOf(snapshot, item, archived) }))
					.filter((entry) => entry.ids.length > 0)
					.sort((left, right) => {
						const leftStamp = Number.isFinite(left.item.updatedAt) ? left.item.updatedAt : 0;
						const rightStamp = Number.isFinite(right.item.updatedAt) ? right.item.updatedAt : 0;
						return rightStamp - leftStamp;
					});
				const chosen = ordered[0];
				if (chosen === undefined) return empty;
				return {
					path: chosen.item.path,
					candidates: chosen.ids,
					gitSessionId: chosen.ids[0],
					sendSessionId: chosen.ids[0],
					workspaceTitle: typeof chosen.item.title === "string" && chosen.item.title !== "" ? chosen.item.title : null,
					workspaceId: typeof chosen.item.workspaceId === "string" && chosen.item.workspaceId !== "" ? chosen.item.workspaceId : null,
					workspacePath: typeof chosen.item.path === "string" && chosen.item.path !== "" ? chosen.item.path : null,
				};
			}

			// —— 标题菜单项（v0.18.1）——
			// 纯函数构建菜单项：组件只负责定位与渲染，测试可直接断言可用性与回调。
			/** 工作区菜单项：重命名 / 在文件管理器中显示 / 复制路径。 */
			function workspaceMenuItems(props) {
				const t = props.t;
				const revealLabel = props.fileManager === "finder" ? t("workspaceMenuRevealFinder")
					: props.fileManager === "explorer" ? t("workspaceMenuRevealExplorer")
						: t("workspaceMenuRevealFolder");
				const hasPath = typeof props.workspacePath === "string" && props.workspacePath !== "";
				const renameReason = props.canRename === true ? undefined : (props.renameReason ?? t("workspaceRenameServiceDown"));
				const revealReason = props.desktopAvailable !== true ? t("revealUnavailable") : (hasPath ? undefined : t("workspacePathMissing"));
				return [
					{
						key: "rename",
						label: t("workspaceMenuRename"),
						icon: { official: "IconEditOutlineRegular", asset: "rename" },
						disabled: props.canRename !== true,
						reason: renameReason,
						run: () => { props.onRename?.(); },
					},
					{
						key: "reveal",
						label: revealLabel,
						icon: { official: "IconFolderOpenOutlineRegular" },
						disabled: revealReason !== undefined,
						reason: revealReason,
						run: () => { props.onReveal?.(); },
					},
					{
						key: "copy-path",
						label: t("workspaceMenuCopyPath"),
						icon: { official: "IconCopyOutlineRegular", asset: "copy" },
						// v0.18.7：与「重命名 / 在文件管理器中显示」分组，复制类操作前加分割线。
						separatorBefore: true,
						disabled: !hasPath,
						reason: hasPath ? undefined : t("workspacePathMissing"),
						run: () => { props.onCopyPath?.(); },
					},
				];
			}

			/** 会话菜单项：置顶/取消置顶、重命名、分支会话、复制会话 ID、复制会话名称。 */
			function sessionMenuItems(props) {
				const t = props.t;
				const pinned = props.pinned === true;
				const pinReason = props.canPin === true ? undefined : (props.pinReason ?? t("sessionPinUnavailable"));
				return [
					{
						key: "pin",
						label: pinned ? t("sessionMenuUnpin") : t("sessionMenuPin"),
						icon: pinned ? { official: "IconPinFillRegular" } : { official: "IconPinOutlineRegular" },
						disabled: props.canPin !== true,
						reason: pinReason,
						run: () => { props.onTogglePin?.(!pinned); },
					},
					{
						key: "rename",
						label: t("sessionMenuRename"),
						icon: { official: "IconEditOutlineRegular", asset: "rename" },
						disabled: props.canRename !== true,
						reason: props.canRename === true ? undefined : t("sessionRenameUnavailable"),
						run: () => { props.onRename?.(); },
					},
					{
						key: "fork",
						label: t("sessionMenuFork"),
						icon: { official: "IconBranchOutlineRegular", asset: "git-branch" },
						disabled: props.canFork !== true,
						reason: props.canFork === true ? undefined : t("sessionForkUnavailable"),
						run: () => { props.onFork?.(); },
					},
					{
						key: "copy-id",
						label: t("sessionMenuCopyId"),
						icon: { official: "IconCopyOutlineRegular", asset: "copy" },
						separatorBefore: true,
						disabled: props.canCopy !== true,
						run: () => { props.onCopyId?.(); },
					},
					{
						key: "copy-name",
						label: t("sessionMenuCopyName"),
						icon: { official: "IconCopyOutlineRegular", asset: "copy" },
						disabled: props.canCopy !== true,
						run: () => { props.onCopyName?.(); },
					},
					{
						// v0.19.2：最下方新增「归档会话」，与复制类操作之间用分割线分组。
						key: "archive",
						label: t("sessionMenuArchive"),
						icon: { official: "IconArchiveOutlineRegular" },
						separatorBefore: true,
						disabled: props.canArchive !== true,
						reason: props.canArchive === true ? undefined : t(props.archived === true ? "sessionArchiveArchived" : "sessionArchiveUnavailable"),
						run: () => { props.onArchive?.(); },
					},
				];
			}

			/** 新建会话页的面板模块筛选：与用户模块设置取交集，并剔除该页无数据源的模块。
			 *  git 不再按「工作区是否仓库」隐藏：无仓库时模块内提供「初始化仓库」（见 GitModule）。 */
			function panelVisibleModules(settings, newSession) {
				const normalized = settings !== null && typeof settings === "object" ? settings : null;
				const flagOf = (key) => normalized === null ? true : normalized[key] !== false;
				const modules = {};
				for (const key of MODULE_KEYS) {
					modules[key] = newSession
						? flagOf(key) && NEW_SESSION_MODULE_KEYS.includes(key)
						: flagOf(key);
				}
				return modules;
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

			/** 复制指定文本并按类型给出成功/失败提示（v0.18.1 菜单复制项共用）。 */
			async function copyWithToast(text, doneLabel) {
				if (typeof text !== "string" || text === "") {
					toast(interpolate(t("copyFailed"), { detail: t("workspacePathMissing") }), "error");
					return false;
				}
				const ok = await writeClipboard(text);
				if (ok) toast(doneLabel, "success");
				else toast(interpolate(t("copyFailed"), { detail: "clipboard unavailable" }), "error");
				return ok;
			}

			// 拖拽时浏览器默认会生成一张跟随鼠标的元素快照；列表内部已有虚线占位与让位动画，
			// 再叠加原生快照就会出现两个重叠的拖动项。用 1x1 透明图替换快照。
			const TRANSPARENT_DRAG_IMAGE = (() => {
				try {
					if (typeof globalThis.Image !== "function") return null;
					const image = new globalThis.Image();
					image.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
					return image;
				} catch { return null; }
			})();
			/** 隐藏原生拖拽幽灵图；不支持 setDragImage 的环境保持浏览器默认行为。 */
			function suppressNativeDragImage(event) {
				const transfer = event?.dataTransfer;
				if (transfer === null || transfer === undefined || typeof transfer.setDragImage !== "function") return false;
				if (TRANSPARENT_DRAG_IMAGE === null) return false;
				try {
					transfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0);
					return true;
				} catch { return false; }
			}

			/** 图形化 git 提交图：左侧泳道（CSS/SVG 混排）+ 右侧提交行。
			 *  行点击展开文件抽屉（参考 UI），右键打开复制菜单。 */
			const GIT_FILE_H = 26;
			const GIT_DRAWER_PAD = 12;
			const GIT_DRAWER_MAX = 240;
			// AI 生成提交信息的二次确认窗口（3 秒），交互与便笺「清空 → 确认?」一致。
			const GIT_AI_CONFIRM_MS = 3000;
			/** 提交的可见引用（排除 HEAD 符号引用）：本地/远程分支与标签。 */
			function visibleCommitRefs(commit) {
				return Array.isArray(commit?.refs) ? commit.refs.filter((ref) => ref.kind !== "head") : [];
			}
			function GitGraphView(props) {
				const commits = Array.isArray(props.commits) ? props.commits : [];
				const hasMore = props.hasMore === true;
				const loadingMore = props.loadingMore === true;
				const loadError = props.loadError ?? "";
				const onLoadMore = typeof props.onLoadMore === "function" ? props.onLoadMore : null;
				const onMergeCommit = typeof props.onMergeCommit === "function" ? props.onMergeCommit : null;
				const mergeBusy = props.mergeBusy === true;
				const onResetCommit = typeof props.onResetCommit === "function" ? props.onResetCommit : null;
				const onResetStatus = typeof props.onResetStatus === "function" ? props.onResetStatus : null;
				const resetBusy = props.resetBusy === true;
				const onCreateBranch = typeof props.onCreateBranch === "function" ? props.onCreateBranch : null;
				const branchCreateBusy = props.branchCreateBusy === true;
				const currentBranch = typeof props.currentBranch === "string" ? props.currentBranch : null;
				const [atBottom, setAtBottom] = react.useState(false);
				const graphRef = react.useRef(null);
				const colW = 16;
				const headH = 40;
				const dotY = headH / 2;
				const layout = mirrorLayoutGraph(commits);
				const width = layout.cols * colW;
				const [expanded, setExpanded] = react.useState(null);
				const [menu, setMenu] = react.useState(null);
				/**
				 * 归一化「从此处创建分支」输入行状态：菜单初始态或历史状态可能不含 branchCreate 字段，
				 * 统一收敛为 null，杜绝把 undefined 当成「已展开」而读取 .text 抛错。
				 */
				const branchCreate = menu !== null && menu.branchCreate !== null && menu.branchCreate !== undefined ? menu.branchCreate : null;
				const [tip, setTip] = react.useState(null);
				const tipTimer = react.useRef(null);
				const menuRef = react.useRef(null);
				const menuItemRefs = react.useRef([]);
				const headRefs = react.useRef({});
				/** 输入行是否展开：菜单级 Escape 处理器在捕获阶段最先执行，需用 ref 读取最新值而非过期闭包。 */
				const branchCreateOpenRef = react.useRef(false);

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
						if (isImeComposing(event)) return;
						if (event.key !== "Escape") return;
						event.stopPropagation();
						// 输入行展开时 Escape 先取消输入行（等价「取消」按钮），再按一次才关闭整个菜单
						if (branchCreateOpenRef.current === true) { cancelBranchCreate(); return; }
						closeMenu(true);
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
				}, [menu === null ? null : menu.commit.hash]);

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
					const menuW = 238;
					const menuH = 9 * 31 + 48; // 3 项复制 + 合并 + 创建分支 + 3 项 reset + 2 条分隔线
					const x = Math.max(margin, Math.min(event.clientX, globalThis.innerWidth - menuW - margin));
					const y = Math.max(margin, Math.min(event.clientY, globalThis.innerHeight - menuH - margin));
					menuItemRefs.current = [];
					setMenu({ x, y, commit, reset: { allowed: null, code: "checking" }, confirmMode: null, branchCreate: null });
					if (onResetStatus !== null) {
						onResetStatus(commit).then((status) => {
							setMenu((prev) => prev !== null && prev.commit.hash === commit.hash
								? { ...prev, reset: { allowed: status?.allowed === true, code: status?.code ?? null } }
								: prev);
						}).catch(() => {
							setMenu((prev) => prev !== null && prev.commit.hash === commit.hash
								? { ...prev, reset: { allowed: false, code: "check-failed" } }
								: prev);
						});
					}
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

				const resetAvailabilityText = (status) => {
					switch (status?.code) {
						case "current-head": return t("gitResetCurrentHead");
						case "not-current-ancestor": return t("gitResetNotCurrentAncestor");
						case "detached-head": return t("gitResetDetachedHead");
						case "operation-in-progress": return t("gitResetOperationInProgress");
						case "check-failed": return t("gitResetCheckFailed");
						default: return t("gitResetChecking");
					}
				};
				const cancelMenuConfirmation = () => setMenu((prev) => prev === null ? prev : { ...prev, confirmMode: null });
				const renderMenuConfirmation = (kind, onConfirm, disabled, title) => react.createElement("div", {
					className: kind === "merge" ? "hud-git-menu-merge-confirm" : "hud-git-menu-reset-confirm",
					key: kind,
				},
					react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-confirm", disabled, title,
						onClick: onConfirm,
					}, t("gitResetConfirm")),
					react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-cancel", disabled,
						onClick: cancelMenuConfirmation,
					}, t("gitResetCancel")));
				const executeMerge = () => {
					if (menu === null || menu.confirmMode !== "merge" || mergeBusy || resetBusy || onMergeCommit === null) return;
					const target = menu.commit;
					closeMenu(false);
					if (target !== null && target !== undefined && typeof target.hash === "string" && target.hash !== "") onMergeCommit(target);
				};
				const renderMergeItem = () => {
					if (menu === null) return null;
					if (menu.confirmMode === "merge") return renderMenuConfirmation("merge", executeMerge, mergeBusy || resetBusy);
					const disabled = mergeBusy || resetBusy || menu.confirmMode !== null || branchCreate !== null || onMergeCommit === null;
					return react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-item",
						ref: (el) => { menuItemRefs.current[3] = el; }, disabled,
						onClick: () => setMenu((prev) => prev === null ? prev : { ...prev, confirmMode: "merge" }),
					}, react.createElement(Icon, { name: "git-merge", size: 13 }), react.createElement("span", null, t("gitMergeToCurrent")));
				};
				/** 「从此处创建分支」：收起态为普通菜单项，展开态在原位替换为 输入框 + 取消/确认图标按钮。 */
				const cancelBranchCreate = () => {
					setMenu((prev) => prev === null ? prev : { ...prev, branchCreate: null });
					menuItemRefs.current[4]?.focus();
				};
				branchCreateOpenRef.current = branchCreate !== null;
				const createBranchHere = async () => {
					if (menu === null || branchCreate === null || branchCreateBusy || onCreateBranch === null) return;
					const name = branchCreate.text.trim();
					if (name === "") return;
					// 失败时不关闭菜单：输入行保持展开且文本保留，便于改名后重试
					const succeeded = await onCreateBranch(menu.commit, name);
					if (succeeded === true) closeMenu(false);
				};
				const renderBranchCreateItem = () => {
					if (menu === null) return null;
					// 守卫复用菜单打开时已有的 reset-status 预检：Git 续作进行中，或首次检查未返回时置灰
					const blocked = menu.reset?.code === "operation-in-progress" || (onResetStatus !== null && menu.reset?.allowed === null);
					if (branchCreate !== null) {
						const text = branchCreate.text;
						return react.createElement("div", { className: "hud-git-menu-branch-create", key: "branch-create" },
							react.createElement("input", {
								...IME_INPUT_PROPS,
								type: "text",
								className: "hud-branch-add-input",
								value: text,
								autoFocus: true,
								disabled: branchCreateBusy,
								placeholder: t("gitBranchAddPlaceholder"),
								"aria-label": t("gitBranchCreateHere"),
								onChange: (event) => setMenu((prev) => prev === null || prev.branchCreate === null || prev.branchCreate === undefined ? prev : { ...prev, branchCreate: { text: event.target.value } }),
								onKeyDown: (event) => {
									if (isImeComposing(event)) return;
									// Enter 不触发创建（按需求仅由「确认」按钮提交）；Escape 交给菜单级处理器取消输入行
									if (event.key === "Enter") event.preventDefault();
								},
							}),
							react.createElement("button", {
								type: "button", className: "hud-ic-btn", disabled: branchCreateBusy,
								title: t("gitCancel"), "aria-label": t("gitCancel"), onClick: cancelBranchCreate,
							}, react.createElement(Icon, { name: "close", size: 14 })),
							react.createElement("button", {
								type: "button", className: "hud-ic-btn", "data-kind": "confirm",
								title: t("gitBranchAddConfirm"), "aria-label": t("gitBranchAddConfirm"),
								disabled: text.trim() === "" || branchCreateBusy,
								onClick: createBranchHere,
							}, react.createElement(Icon, { name: "check", size: 14 })));
					}
					const disabled = mergeBusy || resetBusy || branchCreateBusy || menu.confirmMode !== null || onCreateBranch === null || blocked;
					return react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-item",
						ref: (el) => { menuItemRefs.current[4] = el; }, disabled,
						title: blocked ? t("gitBranchCreateBlocked") : undefined,
						onClick: () => setMenu((prev) => prev === null ? prev : { ...prev, branchCreate: { text: "" } }),
					}, react.createElement(Icon, { name: "git-branch", size: 13 }), react.createElement("span", null, t("gitBranchCreateHere")));
				};
				const executeReset = async (mode) => {
					if (menu === null || menu.reset?.allowed !== true || menu.confirmMode !== mode || resetBusy || mergeBusy || onResetCommit === null) return;
					const succeeded = await onResetCommit(menu.commit, mode);
					if (succeeded === true) closeMenu(false);
				};
				const renderResetItem = (mode, labelKey) => {
					if (menu === null) return null;
					if (menu.confirmMode === mode) {
						return renderMenuConfirmation(mode, () => executeReset(mode), resetBusy || mergeBusy, mode === "hard" ? t("gitResetHardWarning") : undefined);
					}
					const disabled = resetBusy || mergeBusy || menu.reset?.allowed !== true || menu.confirmMode !== null || branchCreate !== null || onResetCommit === null;
					const title = menu.reset?.allowed === true ? undefined : resetAvailabilityText(menu.reset);
					return react.createElement("button", {
						type: "button", role: "menuitem", className: "hud-git-menu-item", key: mode, disabled, title,
						onClick: () => setMenu((prev) => prev === null ? prev : { ...prev, confirmMode: mode }),
					}, react.createElement(Icon, { name: "revert", size: 13 }), react.createElement("span", null, t(labelKey)));
				};

				const menuOverlay = menu === null ? null : react.createElement("div", { className: "hud-git-menu hud-git-graph-menu", role: "menu", ref: menuRef, style: { left: menu.x, top: menu.y } },
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
					}, react.createElement(Icon, { name: "copy" }), react.createElement("span", null, t("copyMessage"))),
					react.createElement("div", { className: "hud-git-menu-divider" }),
					renderMergeItem(),
					renderBranchCreateItem(),
					react.createElement("div", { className: "hud-git-menu-divider" }),
					renderResetItem("soft", "gitResetSoft"),
					renderResetItem("mixed", "gitResetMixed"),
					renderResetItem("hard", "gitResetHard"));

				/** 滚底判定：滚动容器 .hud-git-graph 距底部 < 16px 视为已滑到底部。 */
				const detectBottom = (el) => {
					if (el === null || el === undefined) return false;
					return el.scrollHeight - el.scrollTop - el.clientHeight < 16;
				};
				// 数据追加/加载态变化后重估「是否已到底部」（首屏不足一屏时直接视为到底）。
				react.useEffect(() => {
					if (graphRef.current === null) return;
					setAtBottom(detectBottom(graphRef.current));
				}, [commits.length, loadingMore, loadError]);
				// 底部区四态：加载更多（滑到底且还有下一页）/ 加载中（禁用）/ 错误+重试 / 已显示全部。
				const bottomArea = commits.length === 0
					? null
					: loadingMore
						? react.createElement("div", { className: "hud-git-more hud-git-more-loading" },
							react.createElement("span", { className: "hud-spinner", "aria-hidden": "true" }),
							react.createElement("span", null, t("graphLoadingMore")))
						: loadError !== ""
							? react.createElement("div", { className: "hud-git-more hud-git-more-error" },
								react.createElement("span", null, loadError),
								onLoadMore === null ? null : react.createElement("button", {
									type: "button", className: "hud-git-more-btn", onClick: onLoadMore,
								}, t("graphRetry")))
							: !hasMore
								? react.createElement("div", { className: "hud-git-more hud-git-more-end" }, t("graphAllLoaded"))
								: atBottom
									? react.createElement("div", { className: "hud-git-more" },
										react.createElement("button", { type: "button", className: "hud-git-more-btn", onClick: onLoadMore }, t("graphLoadMore")))
									: null;
				// 悬停提示里的分支/标签行：与提交行上的引用标签同一套数据与配色。
				const tipRefs = tip === null ? [] : visibleCommitRefs(tip.commit);
				return react.createElement(react.Fragment, null,
					react.createElement("div", {
						className: "hud-git-graph",
						ref: graphRef,
						onScroll: (event) => { closeMenu(false); clearTip(); setAtBottom(detectBottom(event.currentTarget)); },
					},
						react.createElement("div", { className: "hud-git-rows" },
							layout.rows.map((row) => {
								const commit = row.commit;
								const open = commit.hash === expanded;
								const files = Array.isArray(commit.files) ? commit.files : [];
								const drawerH = open ? Math.min((files.length === 0 ? 1 : files.length) * GIT_FILE_H + GIT_DRAWER_PAD, GIT_DRAWER_MAX) : 0;
								const rowH = headH + drawerH;
								const refs = visibleCommitRefs(commit);
								// aria-label 也带上分支/标签，读屏与悬停提示信息一致。
								const tipText = `${commit.subject}${refs.length === 0 ? "" : ` — ${refs.map((ref) => ref.text).join(" · ")}`}（${commit.hash.slice(0, 7)} · ${commit.date}）`;
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
												if (isImeComposing(event)) return;
												if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
													event.preventDefault();
													const rect = event.currentTarget.getBoundingClientRect();
													openMenu({ preventDefault: () => {}, clientX: rect.left + 8, clientY: rect.bottom + 4 }, commit);
												}
											},
										},
											react.createElement("span", { className: "hud-git-subject", "data-open": open }, commit.subject),
											refs.length === 0 ? null : react.createElement("span", { className: "hud-git-refs" },
											refs.map((ref) => react.createElement("span", {
													className: "hud-git-ref",
													"data-kind": ref.kind,
													"data-current": ref.kind === "branch" && ref.text === currentBranch,
													key: `${ref.kind}:${ref.text}`,
													title: ref.text,
												},
													ref.kind === "branch" ? react.createElement(BranchIcon, { size: 11 }) : null,
													ref.text))),
											react.createElement("span", { className: "hud-git-date" }, commit.date)),
										open ? react.createElement("div", { className: "hud-git-drawer", style: { height: drawerH } }, renderFiles(commit)) : null));
							}))),
						bottomArea,
					menuOverlay,
					tip === null ? null : react.createElement("div", {
						className: "hud-git-tip",
						"data-below": tip.below,
						style: { left: tip.left, top: tip.top },
						role: "tooltip",
					},
						react.createElement("div", { className: "hud-git-tip-subject" }, tip.commit.subject),
						tipRefs.length === 0 ? null : react.createElement("div", { className: "hud-git-tip-refs" },
							tipRefs.map((ref) => react.createElement("span", {
								className: "hud-git-ref hud-git-tip-ref",
								"data-kind": ref.kind,
								key: `${ref.kind}:${ref.text}`,
							},
								ref.kind === "branch" ? react.createElement(BranchIcon, { size: 11 }) : null,
								react.createElement("span", { className: "hud-git-tip-ref-text" }, ref.text)))),
						react.createElement("div", { className: "hud-git-tip-meta" },
							`${tip.commit.hash} · ${tip.commit.date}`)));
			}

			/**
			 * v0.17.0：由 git 变更行构造 better-sidebar 的 diff tab seed。
			 *
			 * 左右分栏的 diff 由 better-sidebar 的 `diff` tab 提供，它接受
			 * `{ kind: "worktree", path, staged, untracked? }`。id 必须与
			 * better-sidebar 自己 `diffTabOf()` 的规则一致，否则同一个文件会在
			 * 右侧栏重复开 tab；staged 侧与未暂存侧也分别用 s/u 区分。
			 * @param file 变更文件（HUD git 快照中的一项）。
			 * @param group 所在分组：staged / changes。
			 * @returns betterSidebar.openTab() 的 seed。
			 */
			function buildGitDiffTab(file, group) {
				const staged = group === "staged";
				const name = String(file.path).split("/").pop() || String(file.path);
				return {
					type: "diff",
					id: `diff:w::${staged ? "s" : "u"}:${file.path}`,
					title: name,
					diff: {
						kind: "worktree",
						path: file.path,
						staged,
						...(file.status === "?" || file.intentToAdd === true ? { untracked: true } : {}),
					},
				};
			}
			/**
			 * 在 DSH 右侧栏打开一个文件 diff（better-sidebar 的 diff tab）。
			 * 未安装/未启用 better-sidebar 时返回 false，由调用方给出可读提示；
			 * openTab 自身的异常继续向上抛，由调用方转成 toast。
			 * @param sessionId 变更所属会话（better-sidebar 用它解析 cwd）。
			 * @param file 变更文件。
			 * @param group staged / changes。
			 * @returns 是否已交给 better-sidebar。
			 */
			function openGitFileDiff(sessionId, file, group) {
				const sidebar = ctx.get?.("betterSidebar");
				if (sidebar === null || sidebar === undefined || typeof sidebar.openTab !== "function") return false;
				// 用户在 better-sidebar 侧栏设置里关掉 diff 时 openTab 会静默返回，
				// 这里先探测，避免点击后毫无反馈。
				if (typeof sidebar.isTabEnabled === "function" && !sidebar.isTabEnabled("diff")) return false;
				// 带 cwd 让未跟踪文件的全文件新增兜底能按会话工作区读取；
				// 取不到时省略，better-sidebar 会退回会话头部的 cwd。
				let cwd;
				try {
					const summary = ctx.get?.("sessions")?.list?.getSnapshot?.()?.byId?.[sessionId];
					if (typeof summary?.cwd === "string" && summary.cwd !== "") cwd = summary.cwd;
				} catch { cwd = undefined; }
				sidebar.openTab(buildGitDiffTab(file, group), { sessionId, ...(cwd === undefined ? {} : { cwd }) });
				return true;
			}
			/**
			 * v0.20.0：文件悬停提示的定位（纯函数）——git 变更文件行与「产物」文件行共用同一套算法。
			 * 默认出现在鼠标右下方（+12px / +18px）；靠近视口底部时翻到鼠标上方，靠近右缘时向左收，
			 * 提示宽度按剩余空间收敛（视觉上限由 .hud-file-tip 的 CSS 控制）。
			 * @param x 鼠标 clientX。
			 * @param y 鼠标 clientY。
			 * @param viewportWidth 视口宽度。
			 * @param viewportHeight 视口高度。
			 * @returns {{ left: number, top: number, below: boolean, maxWidth: number }}
			 */
			function fileHoverTipPlacement(x, y, viewportWidth, viewportHeight) {
				const below = y + 18 < viewportHeight - 24;
				const left = Math.round(Math.max(8, Math.min(x + 12, viewportWidth - 208)));
				return {
					left,
					top: Math.round(below ? y + 18 : y - 8),
					below,
					maxWidth: Math.round(Math.max(120, viewportWidth - left - 8)),
				};
			}

			/**
			 * v0.20.0：把工作区相对路径拆成「文件名 + 相对目录」，用于变更文件行与「产物」模块一致的两段式展示
			 * （文件名在前，目录作为右侧灰字）。git 输出统一使用 `/`，这里同时兼容 `\\`。
			 * @param path 相对路径（例如 dsh-awesome-hud/lib/client.js）。
			 * @returns {{ name: string, dir: string }} 无目录（文件在工作区根目录）时 dir 为空字符串。
			 */
			function splitRelativePath(path) {
				const text = typeof path === "string" ? path.replace(/[\\/]+$/, "") : "";
				const slash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
				if (slash < 0) return { name: text, dir: "" };
				return { name: text.slice(slash + 1), dir: text.slice(0, slash) };
			}

			/**
			 * v0.20.0：Git commit 弹窗顶部的「AI 生成提示词」区域（默认折叠）。
			 * 展开后可在输入框中编辑「generate」使用的提示词并保存（写入 profile 设置）；
			 * 「恢复默认」清空自定义内容，重新使用内置默认模板。保存后立即影响下一次 generate。
			 */
			function CommitPromptSection() {
				const [open, setOpen] = react.useState(false);
				const [info, setInfo] = react.useState(null); // { default, custom, persistent }
				const [draft, setDraft] = react.useState("");
				const [saving, setSaving] = react.useState(false);
				const [note, setNote] = react.useState(null); // { kind: "ok" | "error", text }
				react.useEffect(() => {
					let alive = true;
					call("git/prompt", {}).then((body) => {
						if (!alive) return;
						const defaultPrompt = typeof body?.default === "string" ? body.default : "";
						const custom = typeof body?.custom === "string" ? body.custom : "";
						setInfo({ default: defaultPrompt, custom, persistent: body?.persistent !== false });
						setDraft(custom === "" ? defaultPrompt : custom);
					}).catch((error) => {
						if (!alive) return;
						setNote({ kind: "error", text: interpolate(t("gitPromptLoadFailed"), { detail: error?.message ?? String(error) }) });
					});
					return () => { alive = false; };
				}, []);
				const defaultPrompt = info === null ? "" : info.default;
				const savedPrompt = info === null || info.custom === "" ? defaultPrompt : info.custom;
				const dirty = info !== null && draft !== savedPrompt;
				const saveDisabled = saving || info === null || draft.trim() === "" || !dirty;
				/**
				 * 保存提示词：value 为 "" 表示恢复默认；内容与默认模板一致（仅空白差异）时同样按「默认」保存，
				 * 避免留下一条与内置模板等价的自定义提示词。
				 */
				const save = async (value) => {
					if (saving) return;
					const payload = value.trim() === defaultPrompt.trim() ? "" : value.trim();
					setSaving(true);
					setNote(null);
					try {
						const body = await call("git/prompt", { prompt: payload });
						const custom = typeof body?.custom === "string" ? body.custom : "";
						const nextDefault = typeof body?.default === "string" ? body.default : defaultPrompt;
						setInfo({ default: nextDefault, custom, persistent: body?.persistent !== false });
						setDraft(custom === "" ? nextDefault : custom);
						const savedText = payload === "" ? t("gitPromptRestored") : t("gitPromptSaved");
						setNote({ kind: "ok", text: savedText });
						// 额外弹一条 toast：保存结果不只在小字里可见（与 git 其它操作一致）。
						toast(savedText);
					} catch (error) {
						setNote({ kind: "error", text: interpolate(t("gitPromptSaveFailed"), { detail: error?.message ?? String(error) }) });
					} finally {
						setSaving(false);
					}
				};
				return react.createElement("div", { className: "hud-commit-prompt", "data-open": open },
					react.createElement("button", {
						type: "button",
						className: "hud-commit-prompt-head",
						"aria-expanded": open,
						title: t("gitPromptTitle"),
						onClick: () => setOpen((prev) => !prev),
					},
						react.createElement(Icon, { name: "ai-generate", size: 14 }),
						react.createElement("span", { className: "hud-commit-prompt-title" }, t("gitPromptTitle")),
						info !== null && info.custom !== "" ? react.createElement("span", { className: "hud-commit-prompt-badge" }, t("gitPromptCustom")) : null,
						react.createElement("span", { className: "hud-commit-prompt-chevron", "aria-hidden": "true" }, "▾")),
					open ? react.createElement("div", { className: "hud-commit-prompt-body" },
						react.createElement("span", { className: "hud-commit-prompt-hint" }, t("gitPromptHint")),
						react.createElement("span", { className: "hud-commit-prompt-placeholders" }, t("gitPromptPlaceholders")),
						react.createElement("textarea", {
							...IME_INPUT_PROPS,
							className: "hud-commit-prompt-input",
							rows: 6,
							value: draft,
							disabled: info === null,
							"aria-label": t("gitPromptTitle"),
							onChange: (event) => setDraft(event.target.value),
						}),
						react.createElement("div", { className: "hud-commit-prompt-actions" },
							note === null ? null : react.createElement("span", { className: "hud-commit-prompt-note", "data-kind": note.kind }, note.text),
							info !== null && info.persistent === false
								? react.createElement("span", { className: "hud-commit-prompt-note", "data-kind": "warn" }, t("gitPromptNotPersistent"))
								: null,
							react.createElement("button", {
								type: "button",
								className: "hud-btn-small",
								disabled: saving || info === null || info.custom === "",
								onClick: () => void save(""),
							}, t("gitPromptRestore")),
							react.createElement("button", {
								type: "button",
								className: "hud-btn-ai",
								disabled: saveDisabled,
								onClick: () => void save(draft),
							}, t("gitPromptSave")))) : null);
			}

			function GitModule(props) {
				// 非仓库工作区：模块仍展示（标题栏提供「初始化仓库」），但没有分支与变更数据
				const isRepo = props.git?.isRepo === true;
				const gitFiles = Array.isArray(props.git?.files) ? props.git.files : [];
				const [initBusy, setInitBusy] = react.useState(false);
				const [graphOpen, setGraphOpen] = react.useState(false);
				// undefined 表示旧 host 尚未提供 currentBranch，此时回退 HUD 快照；null 则是 host 明确的分离 HEAD。
				const [graphState, setGraphState] = react.useState({ commits: null, currentBranch: undefined, error: "", hasMore: false, loadingMore: false, loadError: "" });
				const [mergeBusy, setMergeBusy] = react.useState(false);
				const [resetBusy, setResetBusy] = react.useState(false);
				const [branchCreateBusy, setBranchCreateBusy] = react.useState(false);
				const openBtnRef = react.useRef(null);
				const closeBtnRef = react.useRef(null);
				/** 分支切换：下拉菜单位置（null=关闭）/ 分支列表（null=加载中）/ 错误 / 切换中的分支名 */
				const [branchMenu, setBranchMenu] = react.useState(null);
				const [branchList, setBranchList] = react.useState(null);
				const [branchError, setBranchError] = react.useState("");
				const [branchBusy, setBranchBusy] = react.useState(null);
				const branchBtnRef = react.useRef(null);
				const branchMenuRef = react.useRef(null);
				const branchAddInputRef = react.useRef(null);
				/** 添加分支：输入框展开 / 输入文本 / 提交中 */
				const [branchAddOpen, setBranchAddOpen] = react.useState(false);
				const [branchAddText, setBranchAddText] = react.useState("");
				const [branchAddBusy, setBranchAddBusy] = react.useState(false);
				const openBranchMenu = (event) => {
					event.stopPropagation(); // 避免触发模块折叠
					// 打开即 hidden（ready=false）：位置由修正 effect 在列表加载完成后一次性算定再显示，杜绝闪现
					const rect = event.currentTarget.getBoundingClientRect();
					setBranchMenu({ top: rect.bottom + 4, left: rect.left, ready: false });
					setBranchList(null);
					setBranchError("");
					call("git/branches", { sessionId: props.sessionId })
						.then((body) => setBranchList(Array.isArray(body?.branches) ? body.branches : []))
						.catch((error) => { setBranchError(error?.message ?? String(error)); setBranchList([]); });
				};
				const toggleBranchMenu = (event) => {
					event.stopPropagation(); // 避免触发模块折叠
					if (branchMenu !== null) { closeBranchMenu(); return; }
					openBranchMenu(event);
				};
				const closeBranchMenu = () => { setBranchMenu(null); setBranchList(null); setBranchError(""); };
				const resetBranchAdd = () => { setBranchAddOpen(false); setBranchAddText(""); setBranchAddBusy(false); };
				const cancelBranchAdd = (event) => { event?.stopPropagation?.(); resetBranchAdd(); };
				const createBranch = async () => {
					const name = branchAddText.trim();
					if (name === "" || branchAddBusy) return;
					setBranchAddBusy(true);
					try {
						const snapshot = await call("git/create-branch", { sessionId: props.sessionId, branch: name });
						props.onGit?.(snapshot);
						toast(interpolate(t("gitBranchCreated"), { branch: name }), "success");
						closeBranchMenu();
						resetBranchAdd();
					} catch (error) {
						toast(interpolate(t("gitBranchCreateFailed"), { detail: error?.message ?? String(error) }), "error");
						setBranchAddBusy(false);
					}
				};
				const switchBranch = async (name) => {
					if (branchBusy !== null) return;
					// 已在该分支：不发请求，但给出明确反馈（此前是静默关闭菜单，容易被当成切换失败）
					if (name === (props.git.branch ?? null)) {
						toast(interpolate(t("gitBranchAlreadyOn"), { branch: name }));
						closeBranchMenu();
						return;
					}
					setBranchBusy(name);
					try {
						const snapshot = await call("git/checkout", { sessionId: props.sessionId, branch: name });
						props.onGit?.(snapshot);
						toast(interpolate(t("gitBranchSwitched"), { branch: name }), "success");
					} catch (error) {
						if (error?.code === "local-changes-conflict") {
							const files = Array.isArray(error.files) ? error.files.join("、") : "";
							toast(interpolate(t("gitBranchConflict"), { files }), "warn");
						} else {
							toast(interpolate(t("gitBranchFailed"), { detail: error?.message ?? String(error) }), "error");
						}
					} finally {
						setBranchBusy(null);
						closeBranchMenu();
					}
				};
				/** 「初始化仓库」：在当前工作区执行 git init；成功后用返回快照切到仓库态（按钮消失）。 */
				const initRepo = async (event) => {
					event?.stopPropagation?.(); // 避免触发模块折叠
					if (initBusy) return;
					setInitBusy(true);
					try {
						const snapshot = await call("git/init", { sessionId: props.sessionId });
						props.onGit?.(snapshot);
						toast(t("gitInitDone"), "success");
					} catch (error) {
						toast(interpolate(t("gitInitFailed"), { detail: error?.message ?? String(error) }), "error");
					} finally {
						setInitBusy(false);
					}
				};
				// 菜单打开期间：点击外部 / Escape 关闭
				react.useEffect(() => {
					if (branchMenu === null) return undefined;
					const onDown = (event) => {
						const target = event.target;
						if (target instanceof Element && target.closest(".hud-branch-menu,.hud-branch-switch") !== null) return;
						closeBranchMenu();
					};
					const onKey = (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") closeBranchMenu(); };
					document.addEventListener("mousedown", onDown);
					document.addEventListener("keydown", onKey);
					return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
				}, [branchMenu]);
				// 菜单位置按视口边界修正：优先按钮下方；底部溢出翻转到按钮上方；水平方向钳制在视口内
				react.useEffect(() => {
					if (branchMenu === null) return undefined;
					const menu = branchMenuRef.current;
					const btn = branchBtnRef.current;
					const viewportW = window.innerWidth;
					const viewportH = window.innerHeight;
					if (menu === null || btn === null || viewportW <= 0) return undefined;
					const m = menu.getBoundingClientRect();
					const b = btn.getBoundingClientRect();
					let top = b.bottom + 4;
					if (top + m.height > viewportH - 8) top = Math.max(8, b.top - m.height - 4);
					const left = Math.min(Math.max(8, b.left), Math.max(8, viewportW - m.width - 8));
					const ready = branchList !== null || branchError !== "";
					setBranchMenu((prev) => {
						if (prev !== null && prev.top === top && prev.left === left && prev.ready === ready) return prev;
						return prev === null ? prev : { ...prev, top, left, ready };
					});
					return undefined;
				}, [branchMenu, branchList, branchError]);
				/** 按 offset 拉取一页（host 每页最多 80 条并返回 hasMore）。 */
				const fetchGraphPage = async (offset) => {
					const body = await call("git/graph", { sessionId: props.sessionId, offset });
					if (!Array.isArray(body.commits)) throw new Error(body.error ?? t("gitGraphFailed"));
					return body;
				};
				const graphBranchOf = (page) => Object.prototype.hasOwnProperty.call(page ?? {}, "currentBranch")
					? (typeof page.currentBranch === "string" ? page.currentBranch : null)
					: undefined;
				const openGraph = async () => {
					setGraphOpen(true);
					setGraphState({ commits: null, currentBranch: undefined, error: "", hasMore: false, loadingMore: false, loadError: "" });
					try {
						const body = await fetchGraphPage(0);
						setGraphState({ commits: body.commits, currentBranch: graphBranchOf(body), error: "", hasMore: body.hasMore === true, loadingMore: false, loadError: "" });
					} catch (error) {
						setGraphState({ commits: null, currentBranch: undefined, error: error?.message ?? String(error), hasMore: false, loadingMore: false, loadError: "" });
					}
				};
				/** 追加下一页：以当前已加载条数为 offset；加载中忽略重复点击；失败就地记录 loadError。 */
				const loadMore = async () => {
					if (graphState.commits === null || graphState.loadingMore) return;
					const offset = graphState.commits.length;
					setGraphState((prev) => ({ ...prev, loadingMore: true, loadError: "" }));
					try {
						const body = await fetchGraphPage(offset);
						const branch = graphBranchOf(body);
						setGraphState((prev) => ({
							...prev,
							currentBranch: branch === undefined ? prev.currentBranch : branch,
							commits: [...(Array.isArray(prev.commits) ? prev.commits : []), ...body.commits],
							hasMore: body.hasMore === true,
							loadingMore: false,
							loadError: "",
						}));
					} catch (error) {
						setGraphState((prev) => ({ ...prev, loadingMore: false, loadError: error?.message ?? String(error) }));
					}
				};
				const closeGraph = () => setGraphOpen(false);
				/** 合并指定提交到当前分支：成功后刷新 git 快照与 graph 首页；冲突/本地修改等 host 结构化错误转友好 toast。 */
				const doMergeCommit = async (commit) => {
					if (mergeBusy) return;
					const hash = commit?.hash ?? "";
					if (hash === "") return;
					setMergeBusy(true);
					try {
						const body = await call("git/merge-commit", { sessionId: props.sessionId, commit: hash });
						props.onGit?.(body);
						if (body.upToDate === true) {
							toast(interpolate(t("gitMergeUpToDate"), { commit: hash.slice(0, 7) }), "warn");
						} else {
							toast(interpolate(t("gitMergeDone"), { commit: hash.slice(0, 7) }), "success");
						}
						// 合并改变了历史：重置 graph 到首页（追加页基于旧 offset 已失效）
						try {
							const page = await fetchGraphPage(0);
							setGraphState({ commits: page.commits, currentBranch: graphBranchOf(page), error: "", hasMore: page.hasMore === true, loadingMore: false, loadError: "" });
						} catch { /* 列表刷新失败不阻断成功提示 */ }
					} catch (error) {
						if (error?.code === "local-changes-conflict") {
							const files = Array.isArray(error.files) ? error.files.join("、") : "";
							toast(interpolate(t("gitMergeLocalChanges"), { files }), "warn");
						} else if (error?.code === "merge-conflict") {
							const files = Array.isArray(error.files) ? error.files.join("、") : "";
							toast(interpolate(t("gitMergeConflict"), { files: files === "" ? "（无法列出冲突文件）" : files }), "warn");
						} else {
							toast(interpolate(t("gitMergeFailed"), { detail: error?.message ?? String(error) }), "error");
						}
					} finally {
						setMergeBusy(false);
					}
				};
				/** 基于所选提交创建分支并切换：成功后刷新 git 快照与 graph 首页；失败返回 false，由右键菜单保持输入行展开。 */
				const doCreateBranchHere = async (commit, name) => {
					if (branchCreateBusy) return false;
					const hash = commit?.hash ?? "";
					if (hash === "" || name === "") return false;
					setBranchCreateBusy(true);
					try {
						const body = await call("git/create-branch", { sessionId: props.sessionId, branch: name, commit: hash });
						props.onGit?.(body);
						toast(interpolate(t("gitBranchCreatedHere"), { branch: name, commit: hash.slice(0, 7) }), "success");
						// 已切到新分支：旧分页偏移失效，图回到首页以显示新的当前分支标签
						try {
							const page = await fetchGraphPage(0);
							setGraphState({ commits: page.commits, currentBranch: graphBranchOf(page), error: "", hasMore: page.hasMore === true, loadingMore: false, loadError: "" });
						} catch { /* 图刷新失败不阻断已完成的创建提示 */ }
						return true;
					} catch (error) {
						if (error?.code === "local-changes-conflict") {
							const files = Array.isArray(error.files) ? error.files.join("、") : "";
							toast(interpolate(t("gitBranchConflict"), { files }), "warn");
						} else {
							toast(interpolate(t("gitBranchCreateFailed"), { detail: error?.message ?? String(error) }), "error");
						}
						return false;
					} finally {
						setBranchCreateBusy(false);
					}
				};
				/** 重置当前本地分支到所选祖先提交；host 在执行前重新校验分支、Git 操作状态和祖先关系。 */
				const doResetCommit = async (commit, mode) => {
					if (resetBusy) return false;
					const hash = commit?.hash ?? "";
					if (hash === "" || !["soft", "mixed", "hard"].includes(mode)) return false;
					setResetBusy(true);
					try {
						const body = await call("git/reset", { sessionId: props.sessionId, commit: hash, mode });
						props.onGit?.(body);
						const notice = mode === "soft" ? t("gitResetSoftDone") : mode === "mixed" ? t("gitResetMixedDone") : t("gitResetHardDone");
						toast(interpolate(notice, { commit: hash.slice(0, 7) }), "success");
						// reset 改写了当前分支历史，旧分页偏移不可复用，统一回到图首页。
						try {
							const page = await fetchGraphPage(0);
							setGraphState({ commits: page.commits, currentBranch: graphBranchOf(page), error: "", hasMore: page.hasMore === true, loadingMore: false, loadError: "" });
						} catch { /* 图刷新失败不阻断已完成的 reset 提示 */ }
						return true;
					} catch (error) {
						toast(interpolate(t("gitResetFailed"), { detail: error?.message ?? String(error) }), "error");
						return false;
					} finally {
						setResetBusy(false);
					}
				};
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
						onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") closeGraph(); },
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
										: graphState.commits.length === 0
											// 仓库还没有任何提交（刚初始化）：空态而非 git log 的原始报错
											? react.createElement("div", { className: "hud-graph-empty" }, t("graphEmpty"))
											: react.createElement(GitGraphView, {
										commits: graphState.commits,
										currentBranch: graphState.currentBranch === undefined ? props.git?.branch ?? null : graphState.currentBranch,
										hasMore: graphState.hasMore,
										loadingMore: graphState.loadingMore,
										loadError: graphState.loadError,
										onLoadMore: () => loadMore(),
										onMergeCommit: (commit) => doMergeCommit(commit),
										mergeBusy,
										onResetStatus: (commit) => call("git/reset-status", { sessionId: props.sessionId, commit: commit.hash }),
										onResetCommit: (commit, mode) => doResetCommit(commit, mode),
										resetBusy,
										onCreateBranch: (commit, name) => doCreateBranchHere(commit, name),
										branchCreateBusy,
									}))));
				}
				const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 };
				for (const file of gitFiles) {
					if (file.status === "?") counts.untracked += 1;
					else if (file.status === "A") counts.added += 1;
					else if (file.status === "D") counts.deleted += 1;
					else counts.modified += 1;
				}
				const summaryText = interpolate(t("gitSummary"), { modified: counts.modified, added: counts.added, deleted: counts.deleted, untracked: counts.untracked });
				// 分组：staged / changes（组名固定英文；无文件的分组不展示）
				const stagedFiles = gitFiles.filter((file) => file.staged === true);
				const changesFiles = gitFiles.filter((file) => file.unstaged === true);
				const stagedCount = props.git.counts?.staged ?? stagedFiles.length;
				// revert 置灰条件：存在任何未暂存变更（含未跟踪新建文件——revert 全部会一并删除它们）
				const revertableCount = props.git.counts?.unstaged ?? changesFiles.length;
				// 文件行菜单 / 撤销确认弹窗 / commit 弹窗
				const [menu, setMenu] = react.useState(null);
				const [confirm, setConfirm] = react.useState(null);
				const [commitOpen, setCommitOpen] = react.useState(false);
				const [commitMessage, setCommitMessage] = react.useState("");
				const [aiBusy, setAiBusy] = react.useState(false);
				const [aiConfirming, setAiConfirming] = react.useState(false);
				const aiConfirmTimerRef = react.useRef(null);
				const aiButtonRef = react.useRef(null);
				const commitInputRef = react.useRef(null);
				const cancelAiConfirmation = react.useCallback(() => {
					if (aiConfirmTimerRef.current !== null) {
						globalThis.clearTimeout?.(aiConfirmTimerRef.current);
						aiConfirmTimerRef.current = null;
					}
					setAiConfirming(false);
				}, []);
				// v0.17.0：文件行悬停 0.5s 的自定义提示（不依赖原生 title 的不可控延时，
				// 也不会被 5s 一次的 git 轮询重渲染打断）。
				const [fileTip, setFileTip] = react.useState(null);
				const fileTipTimerRef = react.useRef(null);
				const fileTipPosRef = react.useRef({ x: 0, y: 0 });
				react.useEffect(() => {
					if (!commitOpen) {
						cancelAiConfirmation();
						return undefined;
					}
					commitInputRef.current?.focus();
					return undefined;
				}, [commitOpen, cancelAiConfirmation]);
				// 首次点击 generate 只展开说明并进入「确认？」；点击别处或按 Escape 取消，
				// 3 秒内不确认则自动复位（取消方式与便笺「清空 → 确认?」一致）。
				react.useEffect(() => {
					if (!aiConfirming) return undefined;
					const onPointerDown = (event) => {
						if (!aiButtonRef.current?.contains?.(event.target)) cancelAiConfirmation();
					};
					const onKeyDown = (event) => {
						if (isImeComposing(event)) return;
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						cancelAiConfirmation();
					};
					globalThis.addEventListener?.("pointerdown", onPointerDown, true);
					globalThis.addEventListener?.("keydown", onKeyDown, true);
					return () => {
						globalThis.removeEventListener?.("pointerdown", onPointerDown, true);
						globalThis.removeEventListener?.("keydown", onKeyDown, true);
					};
				}, [aiConfirming, cancelAiConfirmation]);
				react.useEffect(() => () => cancelAiConfirmation(), [cancelAiConfirmation]);
				react.useEffect(() => () => {
					if (fileTipTimerRef.current !== null) window.clearTimeout(fileTipTimerRef.current);
				}, []);
				/** 取消悬停提示（离开文件行、滚动、右键、点击时调用）。 */
				const cancelFileTip = () => {
					if (fileTipTimerRef.current !== null) {
						window.clearTimeout(fileTipTimerRef.current);
						fileTipTimerRef.current = null;
					}
					setFileTip(null);
				};
				/**
				 * 鼠标进入文件行后 0.5s 在鼠标位置显示完整路径。
				 * 位置在计时结束时读取最后一次 mousemove，避免停住后提示仍停在进入点；
				 * 靠近视口底部时翻到鼠标上方，靠近右缘时向左收，保证不越界。
				 */
				const scheduleFileTip = (event, text) => {
					fileTipPosRef.current = { x: event.clientX, y: event.clientY };
					if (fileTipTimerRef.current !== null) window.clearTimeout(fileTipTimerRef.current);
					if (fileTip !== null) setFileTip(null);
					fileTipTimerRef.current = window.setTimeout(() => {
						fileTipTimerRef.current = null;
						const { x, y } = fileTipPosRef.current;
						// 定位与「产物」文件行共用同一套算法（v0.20.0 抽成 fileHoverTipPlacement）。
						setFileTip({ text, ...fileHoverTipPlacement(x, y, window.innerWidth, window.innerHeight) });
					}, 500);
				};
				react.useEffect(() => {
					if (fileTip === null) return undefined;
					const hide = () => cancelFileTip();
					window.addEventListener("scroll", hide, true);
					window.addEventListener("resize", hide);
					return () => {
						window.removeEventListener("scroll", hide, true);
						window.removeEventListener("resize", hide);
					};
				}, [fileTip]);
				const runWrite = async (method, extra, onOk) => {
					try {
						const body = await call(method, { sessionId: props.sessionId, ...extra });
						props.onGit(body);
						if (onOk !== undefined) onOk(body);
					} catch (error) {
						toast(interpolate(t("gitOperationFailed"), { detail: error?.message ?? String(error) }));
					}
				};
				const openFileMenu = (event, file, group) => {
					cancelFileTip();
					const rect = event.currentTarget.getBoundingClientRect();
					// 右键菜单跟随鼠标；键盘/程序触发的 contextmenu 没有坐标时回退到行位置。
					const pointerX = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : rect.left;
					const pointerY = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : rect.bottom;
					const left = Math.max(8, Math.min(pointerX, window.innerWidth - 210));
					const top = Math.max(8, Math.min(pointerY + 4, window.innerHeight - 96));
					setMenu({ file, group, left, top });
				};
				/**
				 * 左键：在右侧栏打开该文件的 diff；右键才弹「add to stage / revert」菜单。
				 * 首选官方「第 N 轮改动」review tab（与交付物卡片同一页面）；
				 * 最新一轮没有该文件、服务缺失或官方侧栏不可用时，回退到
				 * better-sidebar 的工作树 diff tab（覆盖未纳入本轮历史的未提交改动）。
				 */
				const openFileDiff = async (file, group) => {
					cancelFileTip();
					try {
						const review = await call("git/changes-review", { sessionId: props.sessionId, path: file.path });
						const sidebarRight = ctx.get?.("sidebarRight");
						if (review !== null && typeof review?.address === "string" && typeof sidebarRight?.openResource === "function") {
							sidebarRight.openResource(review.address, { params: { index: review.index } });
							return;
						}
					} catch { /* 最新一轮没有该文件或官方服务不可用：走 better-sidebar 回退 */ }
					try {
						if (!openGitFileDiff(props.sessionId, file, group)) toast(t("gitDiffUnavailable"));
					} catch (error) {
						toast(interpolate(t("gitDiffOpenFailed"), { detail: error?.message ?? String(error) }));
					}
				};
				const doStage = (file) => {
					setMenu(null);
					runWrite("git/stage", { path: file.path }, () => toast(interpolate(t("gitStageDone"), { path: file.path }), "success"));
				};
				const doUnstage = (file) => {
					setMenu(null);
					runWrite("git/unstage", { path: file.path }, () => toast(interpolate(t("gitUnstageDone"), { path: file.path }), "success"));
				};
				const openRevertFileConfirm = (file) => { setMenu(null); setConfirm({ kind: "revert-file", file }); };
				const doStageAll = () => {
					const count = changesFiles.length;
					if (count === 0) return;
					runWrite("git/stage-all", {}, () => toast(interpolate(t("gitStageAllDone"), { count }), "success"));
				};
				const doUnstageAll = () => {
					const count = stagedFiles.length;
					if (count === 0) return;
					runWrite("git/unstage-all", {}, () => toast(interpolate(t("gitUnstageAllDone"), { count }), "success"));
				};
				const openRevertAllConfirm = () => {
					// revert 全部覆盖未暂存区全部文件：已跟踪还原内容、未跟踪（新建）文件删除；
					// 同时记录暂存区数量，确认框与结果提示会明确「暂存区文件不会被撤销」
					const files = props.git.files.filter((item) => item.unstaged === true);
					if (files.length === 0) return;
					setConfirm({ kind: "revert-all", files, stagedCount: props.git.counts?.staged ?? stagedFiles.length });
				};
				const cancelConfirm = () => setConfirm(null);
				const confirmRevert = () => {
					const current = confirm;
					if (current === null) return;
					setConfirm(null);
					if (current.kind === "revert-all") {
						const stagedCount = current.stagedCount ?? 0;
						runWrite("git/revert-all", {}, (body) => {
							const doneKey = stagedCount > 0 ? "gitRevertAllDoneWithStaged" : "gitRevertAllDone";
							toast(interpolate(t(doneKey), { count: current.files.length, staged: stagedCount }), "success");
							// host 会跳过无法删除的条目（如嵌套仓库/子模块目录）并回传清单：明确警告而不是静默
							const skipped = Array.isArray(body?.skippedRevert) ? body.skippedRevert : [];
							if (skipped.length > 0) {
								const paths = skipped.slice(0, 3).join("、") + (skipped.length > 3 ? "…" : "");
								toast(interpolate(t("gitRevertSkipped"), { count: skipped.length, paths }), "warn");
							}
						});
					} else {
						runWrite("git/revert-file", { path: current.file.path }, () => toast(interpolate(t("gitRevertDone"), { path: current.file.path }), "success"));
					}
				};
				const openCommit = () => { setCommitMessage(""); setCommitOpen(true); };
				const closeCommit = () => setCommitOpen(false);
				const doCommit = async () => {
					const text = commitMessage.trim();
					if (text === "") { toast(t("gitCommitEmpty")); return; }
					try {
						const body = await call("git/commit", { sessionId: props.sessionId, message: text });
						props.onGit(body);
						setCommitOpen(false);
						setCommitMessage("");
						toast(t("gitCommitDone"), "success");
					} catch (error) {
						toast(interpolate(t("gitOperationFailed"), { detail: error?.message ?? String(error) }));
					}
				};
				const doAiGenerate = async () => {
					setAiBusy(true);
					try {
						// 固定由 host 使用 DeepSeek 官方 Flash（effort low），客户端不再传当前会话模型。
						const body = await call("git/commit-ai", { sessionId: props.sessionId });
						setCommitMessage((body.message ?? "").trim());
						if (body.warn) toast(t("gitAiVersionWarn"), "warn");
					} catch (error) {
						toast(interpolate(t("gitAiFailed"), { detail: error?.message ?? String(error) }));
					} finally {
						setAiBusy(false);
					}
				};
				const onAiGenerateClick = () => {
					if (aiBusy) return;
					if (aiConfirming) {
						cancelAiConfirmation();
						void doAiGenerate();
						return;
					}
					aiConfirmTimerRef.current = globalThis.setTimeout(() => {
						aiConfirmTimerRef.current = null;
						setAiConfirming(false);
					}, GIT_AI_CONFIRM_MS);
					setAiConfirming(true);
				};
				// 文件行（左键打开右侧 diff；右键弹选项菜单。菜单选项按所在分组决定——staged 组 remove，changes 组 add/revert）
				// v0.20.0：展示方式与「产物」模块一致——状态徽章 + 文件名（主）+ 灰色相对目录 + 加减行数；
				// 目录为空（文件在工作区根目录）时只留一个弹性占位，保证加减行数仍然靠右。
				const renderFileRow = (file, group) => {
					const parts = splitRelativePath(file.path);
					return react.createElement("button", {
						type: "button",
						className: "hud-git-file-btn",
						key: file.path,
						"aria-label": file.path,
						onClick: () => openFileDiff(file, group),
						onContextMenu: (event) => {
							event.preventDefault();
							event.stopPropagation();
							openFileMenu(event, file, group);
						},
						onMouseEnter: (event) => scheduleFileTip(event, file.path),
						onMouseMove: (event) => { fileTipPosRef.current = { x: event.clientX, y: event.clientY }; },
						onMouseLeave: cancelFileTip,
						onPointerDown: cancelFileTip,
						// 键盘可达性：Shift+F10 / 菜单键等价于右键，保留原来的文件操作入口。
						onKeyDown: (event) => {
							if (isImeComposing(event)) return;
							if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
							event.preventDefault();
							event.stopPropagation();
							openFileMenu(event, file, group);
						},
					},
						react.createElement("span", { className: "hud-file-status", "data-kind": file.status }, file.status),
						react.createElement("span", { className: "hud-change-name" }, parts.name),
						react.createElement("span", { className: "hud-change-dir" }, parts.dir),
						react.createElement("span", { className: "hud-file-diff" },
							react.createElement("span", { className: "hud-diff-add" }, `+${file.added ?? "?"}`),
							" ",
							react.createElement("span", { className: "hud-diff-del" }, `-${file.deleted ?? 0}`)));
				};
				// 文件行选项弹窗
				let fileMenu = null;
				if (menu !== null) {
					fileMenu = react.createElement(react.Fragment, null,
						react.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 2147483004, background: "transparent" }, onClick: () => setMenu(null), onContextMenu: (event) => { event.preventDefault(); setMenu(null); } }),
						react.createElement("div", { className: "hud-git-menu", role: "menu", style: { left: menu.left, top: menu.top } },
							menu.group === "staged"
								? react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: (event) => { event.stopPropagation(); doUnstage(menu.file); } },
									react.createElement(Icon, { name: "revert", size: 13 }),
									react.createElement("span", null, t("gitRemoveFromStage")))
								: react.createElement(react.Fragment, null,
									react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: (event) => { event.stopPropagation(); doStage(menu.file); } },
										react.createElement(Icon, { name: "commit" }),
										react.createElement("span", null, t("gitAddToStage"))),
									react.createElement("button", { type: "button", role: "menuitem", className: "hud-git-menu-item", onClick: (event) => { event.stopPropagation(); openRevertFileConfirm(menu.file); } },
										react.createElement(Icon, { name: "revert", size: 13 }),
										react.createElement("span", null, t("gitRevertOption"))))));
				}
				// 撤销二次确认弹窗（含受影响文件清单）
				let confirmModal = null;
				if (confirm !== null) {
					const isAll = confirm.kind === "revert-all";
					const files = isAll ? confirm.files : [confirm.file];
					// 需要「删除文件」的条目：未跟踪（?）与预登记（intent-to-add）；其余为还原内容
					const deletesFile = (item) => item.status === "?" || item.intentToAdd === true;
					const hasUntracked = isAll ? files.some(deletesFile) : deletesFile(confirm.file);
					const note = isAll
						? interpolate(t("gitRevertAllConfirm"), { count: files.length })
						: confirm.file.intentToAdd === true
							? interpolate(t("gitRevertFileIntentToAdd"), { path: confirm.file.path })
							: confirm.file.status === "?"
								? interpolate(t("gitRevertFileUntracked"), { path: confirm.file.path })
								: interpolate(t("gitRevertFileTracked"), { path: confirm.file.path });
					// 补充说明：明确暂存区文件不在撤销范围（避免「撤销后文件还在」的误解）
					const extraNotes = [];
					if (isAll && (confirm.stagedCount ?? 0) > 0) extraNotes.push(interpolate(t("gitRevertAllStagedNote"), { count: confirm.stagedCount }));
					if (!isAll && confirm.file.staged === true && confirm.file.status !== "?" && confirm.file.intentToAdd !== true) extraNotes.push(t("gitRevertFileStagedPartial"));
					confirmModal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": isAll ? t("gitRevertAllTitle") : t("gitRevertFileTitle"),
						onClick: cancelConfirm,
						onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") cancelConfirm(); },
					},
						react.createElement("div", { className: "hud-modal-card", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "revert", size: 13 }),
								react.createElement("span", { className: "hud-modal-title" }, isAll ? t("gitRevertAllTitle") : t("gitRevertFileTitle")),
								react.createElement("button", { type: "button", className: "hud-modal-close", onClick: cancelConfirm }, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								react.createElement("div", { className: "hud-confirm-body" },
									react.createElement("div", { className: hasUntracked ? "hud-confirm-note hud-confirm-note-danger" : "hud-confirm-note" }, note),
									extraNotes.map((text) => react.createElement("div", { className: "hud-confirm-note", key: text }, text)),
									react.createElement("div", { className: "hud-git-group" },
										react.createElement("span", null, t("gitAffectedFiles")),
										react.createElement("span", { className: "hud-git-group-count" }, String(files.length))),
									react.createElement("div", { className: "hud-confirm-list" },
										files.map((file) => react.createElement("div", { key: file.path },
											deletesFile(file) ? `? ${file.path}` : file.path))),
									react.createElement("div", { className: "hud-confirm-actions" },
										react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "cancel", onClick: cancelConfirm }, t("gitCancel")),
										react.createElement("button", {
											type: "button",
											className: "hud-btn-danger",
											onClick: confirmRevert,
										}, isAll ? t("gitConfirmDanger") : deletesFile(confirm.file) ? t("gitConfirmDelete") : t("gitConfirmDanger")))))));
				}
				// commit 弹窗（输入框 + AI 生成 + 提交）
				let commitModal = null;
				if (commitOpen) {
					commitModal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("gitCommitTitle"),
						// 点击外部不关闭：仅「关闭」按钮 / commit 按钮 / Escape 可关闭
						onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") closeCommit(); },
					},
						react.createElement("div", { className: "hud-modal-card", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "commit" }),
								react.createElement("span", { className: "hud-modal-title" }, t("gitCommitTitle")),
								react.createElement("button", { type: "button", className: "hud-modal-close", onClick: closeCommit }, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body hud-commit-modal-body" },
								react.createElement("div", { className: "hud-confirm-body" },
									// v0.20.0：AI 生成提示词区域（默认折叠），位于暂存数量与提交信息输入框上方。
									react.createElement(CommitPromptSection, null),
									react.createElement("div", { className: "hud-commit-note" },
										interpolate(t("gitCommitSummary"), { count: stagedCount })),
									react.createElement("textarea", {
										...IME_INPUT_PROPS,
										ref: commitInputRef,
										className: "hud-commit-input",
										rows: 3,
										placeholder: t("gitCommitPlaceholder"),
										value: commitMessage,
										onChange: (event) => setCommitMessage(event.target.value),
									}),
									react.createElement("div", { className: "hud-commit-actions" },
										aiConfirming ? react.createElement("span", { className: "hud-commit-ai-hint" }, t("gitAiConfirmHint")) : null,
										react.createElement("button", {
											ref: aiButtonRef,
											type: "button",
											className: aiConfirming ? "hud-btn-ai hud-btn-ai-confirm" : "hud-btn-ai",
											disabled: aiBusy,
											title: aiConfirming ? t("gitAiConfirm") : t("gitAiGenerate"),
											"aria-label": aiConfirming ? t("gitAiConfirm") : t("gitAiGenerate"),
											onClick: onAiGenerateClick,
										},
											react.createElement(Icon, { name: "ai-generate", color: "inherit" }),
											aiBusy ? t("gitAiGenerating") : aiConfirming ? t("gitAiConfirm") : t("gitAiGenerate")),
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
							// 标题固定为 git；当前分支名 / 「初始化仓库」移至右侧按钮展示
							title: "git",
							countText: isRepo && props.git.changedCount > 0 ? interpolate(t("gitChangedCount"), { count: props.git.changedCount }) : null,
							fold: props.fold,
							onToggle: () => props.onFoldChange(!props.fold),
							// 仓库：右侧为分支切换按钮；非仓库：右侧为「初始化仓库」（与分支按钮同位置）
							extra: isRepo
								? (props.git.branch === null || props.git.branch === undefined || props.git.branch === ""
									? null
									: react.createElement("button", {
										type: "button",
										ref: branchBtnRef,
										className: "hud-btn-small hud-git-btn hud-branch-switch",
										title: t("gitBranchSwitch"),
										"aria-label": t("gitBranchSwitch"),
										onClick: toggleBranchMenu,
									},
										react.createElement(Icon, { name: "git-branch", size: 13 }),
										react.createElement("span", null, props.git.branch)))
								: react.createElement("button", {
									type: "button",
									className: "hud-btn-small hud-git-btn",
									title: t("gitInitRepoTitle"),
									"aria-label": t("gitInitRepoTitle"),
									disabled: initBusy,
									onClick: initRepo,
								},
									react.createElement(Icon, { name: "plus", size: 13 }),
									t("gitInitRepo")),
						}),
						props.fold ? null : react.createElement("div", { className: "hud-module-body" },
							isRepo
								? react.createElement("div", { className: "hud-git-actions" },
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
									}, react.createElement(Icon, { name: "revert", size: 13 }), "revert"))
								: react.createElement("div", { className: "hud-git-summary" }, t("gitNoRepo")),
							stagedFiles.length === 0 ? null : react.createElement(react.Fragment, null,
								// 组名固定英文（需求指定 staged）；右侧「-」批量取消暂存
								react.createElement("div", { className: "hud-git-group" },
									react.createElement("span", null, "staged"),
									react.createElement("span", { className: "hud-git-group-count" }, String(stagedFiles.length)),
									react.createElement("button", {
										type: "button",
										className: "hud-git-group-btn",
										title: t("gitUnstageAllTitle"),
										"aria-label": t("gitUnstageAllTitle"),
										onClick: doUnstageAll,
									}, "-")),
								stagedFiles.map((file) => renderFileRow(file, "staged")),
								// 常驻说明：暂存区文件不在 revert 范围内（来源：用户反馈「撤销后新增文件仍在」）
								react.createElement("div", { className: "hud-git-summary" }, t("gitStagedHint"))),
							changesFiles.length === 0 ? null : react.createElement(react.Fragment, null,
								// 组名固定英文（需求指定 changes）；右侧「+」批量暂存全部
								react.createElement("div", { className: "hud-git-group" },
									react.createElement("span", null, "changes"),
									react.createElement("span", { className: "hud-git-group-count" }, String(changesFiles.length)),
									react.createElement("button", {
										type: "button",
										className: "hud-git-group-btn",
										title: t("gitStageAllTitle"),
										"aria-label": t("gitStageAllTitle"),
										onClick: doStageAll,
									}, "+")),
								changesFiles.map((file) => renderFileRow(file, "changes"))),
							isRepo ? react.createElement("div", { className: "hud-git-summary" }, summaryText) : null)),
					modal,
					fileMenu,
					confirmModal,
					commitModal,
					// 文件全名提示：portal 到 body，位置随鼠标（固定定位，不受面板 overflow 裁剪）。
					fileTip === null ? null : react_dom.createPortal(
						react.createElement("div", {
							className: "hud-file-tip",
							role: "tooltip",
							style: { left: fileTip.left, top: fileTip.top, maxWidth: fileTip.maxWidth, ...(fileTip.below ? {} : { transform: "translateY(-100%)" }) },
						}, fileTip.text),
						document.body),
					branchMenu === null ? null : react.createElement("div", {
						ref: branchMenuRef,
						className: "hud-branch-menu",
						role: "menu",
						// v0.19.0：分支菜单同样属于「打开期间保持悬停面板展开」的浮层。
						// position/zIndex 内联兜底：任何情况下菜单都是浮层，不占文档流（避免破坏 .hud-section 相邻分隔线）；
						// ready 前隐藏：定位/列表加载完成前不显示，杜绝闪现
						style: { position: "fixed", zIndex: 2147483005, top: branchMenu.top, left: branchMenu.left, visibility: branchMenu.ready ? "visible" : "hidden" },
					},
						// 顶层「添加分支」：点击原地展开输入框（输入 + 取消 + 添加）
						react.createElement("div", { className: "hud-branch-add" },
							branchAddOpen
								? react.createElement(react.Fragment, null,
									react.createElement("input", {
										...IME_INPUT_PROPS,
										ref: branchAddInputRef,
										className: "hud-branch-add-input",
										value: branchAddText,
										autoFocus: true,
										placeholder: t("gitBranchAddPlaceholder"),
										onChange: (event) => setBranchAddText(event.target.value),
										onKeyDown: (event) => {
											if (isImeComposing(event)) return;
											if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); createBranch(); }
											else if (event.key === "Escape") { event.stopPropagation(); cancelBranchAdd(); }
										},
									}),
									react.createElement("button", {
										type: "button",
										className: "hud-ic-btn",
										"aria-label": t("gitCancel"),
										title: t("gitCancel"),
										onClick: cancelBranchAdd,
									}, react.createElement(Icon, { name: "close", size: 14 })),
									react.createElement("button", {
										type: "button",
										className: "hud-ic-btn",
										"data-kind": "confirm",
										"aria-label": t("gitBranchAddConfirm"),
										title: t("gitBranchAddConfirm"),
										disabled: branchAddText.trim() === "" || branchAddBusy,
										onClick: createBranch,
									}, react.createElement(Icon, { name: "plus", size: 14 })))
								: react.createElement("button", {
									type: "button",
									className: "hud-git-menu-item hud-branch-add-btn",
									onClick: (event) => { event.stopPropagation(); setBranchAddOpen(true); },
								},
									react.createElement(Icon, { name: "plus", size: 13 }),
									react.createElement("span", { className: "hud-branch-name" }, t("gitBranchAdd")))),
						react.createElement("div", { className: "hud-branch-divider" }),
						react.createElement("div", { className: "hud-branch-scroll" },
							branchList === null
								? react.createElement("div", { className: "hud-branch-note" }, t("gitBranchLoading"))
								: branchError !== ""
									? react.createElement("div", { className: "hud-branch-note hud-branch-note-error" }, interpolate(t("gitBranchListFailed"), { detail: branchError }))
									: branchList.length === 0
										? react.createElement("div", { className: "hud-branch-note" }, t("gitBranchEmpty"))
										: branchList.map((name) => {
											const current = name === (props.git.branch ?? null);
											return react.createElement("button", {
												type: "button",
												key: name,
												role: "menuitem",
												className: "hud-git-menu-item",
												"data-current": current,
												onClick: (event) => { event.stopPropagation(); switchBranch(name); },
											},
												react.createElement("span", { className: "hud-branch-check" }, current ? "\u2713" : ""),
												react.createElement("span", { className: "hud-branch-name" }, name));
										}))),
				);
			}

			// —— 子代理模块 ——
			function SubagentsModule(props) {
				// v0.19.2：子代理超过 3 个时默认只展示 3 个，与「产物」模块同一套折叠交互。
				const [expanded, setExpanded] = react.useState(false);
				const view = previewListRows(props.entries, expanded);
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "subagents",
						title: t("subagentsModule"),
						countText: String(props.entries.length),
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						view.rows.map((entry) => {
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
						}),
						listMoreButton({
							expanded: view.expanded,
							remaining: view.remaining,
							expandText: interpolate(t("subagentsExpandRest"), { count: String(view.remaining) }),
							onToggle: setExpanded,
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
				// v0.19.2：已完成任务整组移到列表最下方并默认折叠，组内保持原有先后（先完成的在上面）。
				const [doneExpanded, setDoneExpanded] = react.useState(false);
				const view = splitCompleted(props.todos, (item) => item.status === "completed");
				const done = view.completed.length;
				const active = props.todos.filter((item) => item.status === "in_progress").length;
				const pending = props.todos.length - done - active;
				const renderTask = (item, index) => {
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
				};
				const doneToggle = listMoreButton({
					expanded: doneExpanded,
					remaining: view.completed.length,
					expandText: t("tasksExpandDone"),
					onToggle: setDoneExpanded,
				});
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "tasks",
						title: t("tasksModule"),
						countText: `${done}/${props.todos.length}`,
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						view.open.map(renderTask),
						doneExpanded ? view.completed.map(renderTask) : null,
						doneToggle,
						react.createElement("div", { className: "hud-git-summary" },
							interpolate(t("tasksSummary"), { done, active, pending }))));
			}

			// —— 「便笺」模块：按工作区共享（无 cwd 时降级会话级）+ localStorage 持久化；
			//     底部可拖拽调高度的 textarea +「添加至对话」把内容追加进目标会话输入框
			//     （composer draft），不清空便笺 ——
			/** 将文本追加到当前会话输入框（composer draft，空格分隔；同 better-sidebar 的 appendToDraft 语义）。 */
			async function appendToComposer(sessionId, text) {
				if (typeof sessionId !== "string" || sessionId === "" || typeof text !== "string" || text.trim() === "") return false;
				try {
					const sessions = ctx.get("sessions");
					let actx = sessions?.scope?.(sessionId);
					// 新建页选出的最近会话可能尚未绑定；先打开目标，让用户能看到追加的草稿。
					if (actx === undefined && typeof ctx.get("uiWorkspace")?.openSession === "function") {
						await ctx.get("uiWorkspace").openSession(sessionId);
						for (let attempt = 0; attempt < 30 && actx === undefined; attempt += 1) {
							actx = sessions?.scope?.(sessionId);
							if (actx === undefined) await new Promise(resolve => globalThis.setTimeout(resolve, 100));
						}
					}
					if (actx === undefined) return false;
					const conversation = ctx.get("conversation");
					if (conversation === undefined) return false;
					const input = conversation.input?.for?.(actx);
					if (input === undefined || input.state === undefined || typeof input.setDraft !== "function") return false;
					const snapshot = input.state.getSnapshot();
					if (snapshot.phase === "adjudicating" || snapshot.phase === "submitting") return false;
					const draft = String(snapshot.draft ?? "");
					input.setDraft(draft.trim() === "" ? text : `${draft.trim()} ${text}`);
					return true;
				} catch { return false; }
			}

			/** 通过官方右侧栏打开子会话，携带直接父会话与模式；缺少侧栏时显式报错。 */
			async function navigateSubagent(entry) {
				const sidebar = ctx.get("sidebarRight");
				if (typeof sidebar?.openResource !== "function") throw new Error(t("subagentOpenFailed"));
				const query = new URLSearchParams({ parent: entry.parentId, mode: entry.mode });
				const address = `dsh-resource://subagentchat/session/${encodeURIComponent(entry.id)}?${query}`;
				return await sidebar.openResource(address, { kind: "subagentchat", preferNewPane: true });
			}

			// v0.20.0：便笺升级为「多条便笺」。localStorage 按工作区一条作用域记录（标题/文字/高度），
			// IndexedDB 按同一作用域一条记录（图片按便笺 id 分桶）。旧单便笺（v3）首次读取时迁移为「便笺1」。
			const NOTE_STORAGE_VERSION = 4;
			const NOTE_DEFAULT_HEIGHT = 180;
			const NOTE_CLEAR_CONFIRM_MS = 2000;
			const NOTE_CHANGE_EVENT = "dsh-awesome-hud:note-change";
			// 便笺图片持久化：IndexedDB 存原图（localStorage 只存标题/文字/高度），按工作区一条记录。
			const NOTE_IMAGE_DB = "dsh-awesome-hud";
			const NOTE_IMAGE_STORE = "noteImages";
			/** IndexedDB 不可用时的进程内降级（仅本次页面有效）。 */
			const noteImageMemory = new Map();
			let noteImageDbPromise = null;

			/** 便笺持久化作用域：工作区路径可用 → 工作区键；否则降级会话级（不跨项目共享）。 */
			function noteScope(props) {
				return props.workspaceKey === null || props.workspaceKey === undefined || props.workspaceKey === ""
					? { key: props.sessionId, workspace: false }
					: { key: props.workspaceKey, workspace: true };
			}

			/** 默认标题：按当前界面语言生成「便笺n」或「Note n」。 */
			function defaultNoteTitle(number) {
				return interpolate(t("noteDefaultTitle"), { count: String(number) });
			}

			/**
			 * 解析自动标题里的编号（「便笺n」/「Note n」），返回最大编号 + 1。
			 * 自定义标题不参与编号，避免把「会议 2024」这类标题误算成序号。
			 */
			function nextNoteNumber(notes, excludeId = null) {
				const pattern = /^(?:便笺|Note)\s*(\d+)$/i;
				let max = 0;
				for (const note of Array.isArray(notes) ? notes : []) {
					if (note === null || note === undefined || note.id === excludeId) continue;
					const match = pattern.exec(String(note.title ?? "").trim());
					if (match !== null) max = Math.max(max, Number(match[1]));
				}
				return max + 1;
			}

			function newNoteId() {
				return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			}

			/**
			 * 收敛便笺文档：
			 *   v4 { notes: [{ id, title, text, updatedAt }], height }；
			 *   v3 单便笺 { text, height, updatedAt } → 迁移为一条「便笺1」。
			 * @returns {{ notes: Array, height: number, legacy: boolean } | null} legacy=true 表示需要写回 v4。
			 */
			function normalizeNoteDocument(raw) {
				if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;
				const height = typeof raw.height === "number" && raw.height >= 56 && raw.height <= 600 ? raw.height : NOTE_DEFAULT_HEIGHT;
				if (Array.isArray(raw.notes)) {
					const notes = [];
					for (const entry of raw.notes) {
						if (entry === null || entry === undefined || typeof entry !== "object" || Array.isArray(entry)) continue;
						notes.push({
							id: typeof entry.id === "string" && entry.id !== "" ? entry.id : newNoteId(),
							title: typeof entry.title === "string" ? entry.title : "",
							text: typeof entry.text === "string" ? entry.text : "",
							updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
						});
					}
					// 标题编号只增不复用：nextNumber 存在旧值就沿用，否则取现有最大编号 + 1。
					const highest = notes.length === 0 ? 0 : nextNoteNumber(notes) - 1;
					const stored = Number.isFinite(raw.nextNumber) && raw.nextNumber >= 1 ? Math.floor(raw.nextNumber) : 0;
					return { notes, height, legacy: false, nextNumber: Math.max(stored, highest + 1, 1) };
				}
				if (typeof raw.text === "string" || Number.isFinite(raw.updatedAt)) {
					return {
						notes: [{
							id: newNoteId(),
							title: defaultNoteTitle(1),
							text: typeof raw.text === "string" ? raw.text : "",
							updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
						}],
						height,
						legacy: true,
						nextNumber: 2,
					};
				}
				return null;
			}

			/** 读取便笺文档（缺失 → null）。 */
			function readNoteDocument(key) {
				if (typeof key !== "string" || key === "") return null;
				return normalizeNoteDocument(loadJsonStorage(NOTES_STORAGE_KEY)?.[key]);
			}

			/**
			 * 便笺初始化：工作区作用域首次访问时先按候选会话做一次性归并迁移
			 * （旧会话级便笺按 updatedAt 取最新一份），再读取；缺失回空文档。
			 */
			function initialNoteDocument(props) {
				const scope = noteScope(props);
				const empty = { notes: [], height: NOTE_DEFAULT_HEIGHT, legacy: false, nextNumber: 1 };
				if (!scope.workspace) {
					const doc = readNoteDocument(scope.key);
					if (doc === null) return empty;
					if (doc.legacy) persistNoteDocument(scope, doc);
					return doc;
				}
				const storage = loadJsonStorage(NOTES_STORAGE_KEY) ?? {};
				migrateWorkspaceScope(storage, scope.key, props.workspaceCandidates);
				const doc = readNoteDocument(scope.key);
				if (doc === null) return empty;
				// v3 单便笺：首帧即写回 v4（幂等），避免面板在 effect 未执行时仍停留旧结构。
				if (doc.legacy) persistNoteDocument(scope, doc);
				return doc;
			}

			/** 写入便笺文档（v4）；返回 { persisted } 供调用方提示。 */
			function persistNoteDocument(scope, doc) {
				const payload = {
					v: NOTE_STORAGE_VERSION,
					height: typeof doc.height === "number" ? doc.height : NOTE_DEFAULT_HEIGHT,
					notes: Array.isArray(doc.notes) ? doc.notes : [],
					nextNumber: Number.isFinite(doc.nextNumber) && doc.nextNumber >= 1 ? Math.floor(doc.nextNumber) : 1,
				};
				try {
					const storage = globalThis.localStorage;
					if (storage === undefined || storage === null || typeof storage.setItem !== "function") return { persisted: false };
					const map = loadJsonStorage(NOTES_STORAGE_KEY) ?? {};
					map[scope.key] = payload;
					storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(map));
					return { persisted: true };
				} catch { return { persisted: false }; }
			}

			function publishNoteChange(key) {
				if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
				try {
					globalThis.dispatchEvent(new globalThis.CustomEvent(NOTE_CHANGE_EVENT, { detail: { key } }));
				} catch { /* 事件通知不可用不影响当前便笺 */ }
			}

			/**
			 * 清空按钮的三态（纯函数）：
			 *   noop    → 文字与图片都为空（按钮置灰）
			 *   confirm → 第一次点击，进入「确认?」
			 *   clear   → 第二次点击，执行清空
			 * v0.19.0：只有图片也算有内容，此时同样可清空。
			 */
			function noteClearAction(text, confirming, hasImages = false) {
				const hasText = typeof text === "string" && text !== "";
				if (!hasText && hasImages !== true) return "noop";
				return confirming ? "clear" : "confirm";
			}

			/** 图片是否可作为便笺附件（只收图片类型；字节上限交给宿主上传校验）。 */
			function noteImageAcceptable(file) {
				return file !== null && file !== undefined && typeof file.type === "string" && file.type.startsWith("image/");
			}

			/** 从粘贴板 items 里取出图片文件（保持来源顺序）；非图片与目录一律忽略。 */
			function notePasteImageFiles(items) {
				const files = [];
				if (items === null || items === undefined) return files;
				for (const item of Array.from(items)) {
					if (item === null || item === undefined) continue;
					if (item.kind !== "file") continue;
					if (typeof item.type !== "string" || !item.type.startsWith("image/")) continue;
					let file = null;
					try { file = typeof item.getAsFile === "function" ? item.getAsFile() : null; } catch { file = null; }
					if (noteImageAcceptable(file)) files.push(file);
				}
				return files;
			}

			/** 合并图片并截断到上限：返回可加入的图片与被拒绝的数量。 */
			function noteMergeImages(existingCount, incomingCount, max = NOTE_MAX_IMAGES) {
				const room = Math.max(0, max - Math.max(0, existingCount));
				const accepted = Math.min(room, Math.max(0, incomingCount));
				return { accepted, rejected: Math.max(0, incomingCount) - accepted };
			}

			// —— 便笺图片存储（IndexedDB 原图；不可用时降级内存）——
			function openNoteImageDb() {
				if (noteImageDbPromise !== null) return noteImageDbPromise;
				noteImageDbPromise = new Promise((resolve) => {
					try {
						const factory = globalThis.indexedDB;
						if (factory === undefined || factory === null || typeof factory.open !== "function") { resolve(null); return; }
						const request = factory.open(NOTE_IMAGE_DB, 1);
						request.onupgradeneeded = () => {
							try {
								const db = request.result;
								if (typeof db.createObjectStore === "function" && !db.objectStoreNames?.contains?.(NOTE_IMAGE_STORE)) {
									db.createObjectStore(NOTE_IMAGE_STORE, { keyPath: "key" });
								}
							} catch { /* 已存在或不可建 */ }
						};
						request.onsuccess = () => resolve(request.result ?? null);
						request.onerror = () => resolve(null);
						request.onblocked = () => resolve(null);
					} catch { resolve(null); }
				});
				return noteImageDbPromise;
			}
			/** 在一个事务里完成一次读写；任何异常都当作「存储不可用」。 */
			function noteImageRequest(mode, run) {
				return openNoteImageDb().then((db) => new Promise((resolve) => {
					if (db === null) { resolve(null); return; }
					try {
						const tx = db.transaction(NOTE_IMAGE_STORE, mode);
						const store = tx.objectStore(NOTE_IMAGE_STORE);
						const request = run(store);
						request.onsuccess = () => resolve(request.result ?? null);
						request.onerror = () => resolve(null);
						tx.onabort = () => resolve(null);
					} catch { resolve(null); }
				}));
			}
			/**
			 * 读某作用域的图片值：v4 为「便笺 id → 记录数组」的映射；
			 * 旧版为数组（调用方按便笺1 迁移）。缺失/失败 → null。
			 */
			async function readNoteImageValue(key) {
				if (typeof key !== "string" || key === "") return null;
				const record = await noteImageRequest("readonly", (store) => store.get(key));
				if (record === null || record === undefined) return noteImageMemory.get(key) ?? null;
				return record.images ?? noteImageMemory.get(key) ?? null;
			}
			/** 写某作用域的图片映射：IndexedDB 与内存降级同时写，返回是否已持久化。 */
			async function writeNoteImageMap(key, images) {
				if (typeof key !== "string" || key === "") return false;
				const record = { key, updatedAt: Date.now(), images };
				noteImageMemory.set(key, images);
				const written = await noteImageRequest("readwrite", (store) => store.put(record));
				return written !== null;
			}
			/** 删除某作用域的图片记录（清空便笺时调用）。 */
			async function deleteNoteImages(key) {
				if (typeof key !== "string" || key === "") return false;
				noteImageMemory.delete(key);
				const result = await noteImageRequest("readwrite", (store) => store.delete(key));
				return result !== null;
			}

			/** 把 IndexedDB 里的 Blob 记录转成可渲染的内存图片（含 objectURL）。 */
			function hydrateNoteImages(records) {
				if (!Array.isArray(records)) return [];
				const out = [];
				for (const record of records.slice(0, NOTE_MAX_IMAGES)) {
					if (record === null || typeof record !== "object") continue;
					if (record.blob === undefined || record.blob === null) continue;
					let url = "";
					try { url = globalThis.URL?.createObjectURL?.(record.blob) ?? ""; } catch { url = ""; }
					out.push({
						id: typeof record.id === "string" && record.id !== "" ? record.id : `note-image-${out.length}`,
						type: typeof record.type === "string" ? record.type : "image/png",
						name: typeof record.name === "string" && record.name !== "" ? record.name : "image",
						blob: record.blob,
						url,
					});
				}
				return out;
			}
			/** 内存图片 → 可持久化记录（去掉 objectURL）。 */
			function dehydrateNoteImages(images) {
				return (Array.isArray(images) ? images : []).slice(0, NOTE_MAX_IMAGES).map((image) => ({
					id: image.id,
					type: image.type,
					name: image.name,
					blob: image.blob,
				}));
			}
			function releaseNoteImage(image) {
				if (image === null || image === undefined || typeof image.url !== "string" || image.url === "") return;
				try { globalThis.URL?.revokeObjectURL?.(image.url); } catch { /* 释放失败不影响功能 */ }
			}

			/** 便笺图片 → 会话输入框可用的 File（宿主 createDrafts 只接受 File）。 */
			function noteImageFile(image) {
				if (typeof globalThis.File !== "function") return null;
				try { return new globalThis.File([image.blob], image.name, { type: image.type }); } catch { return null; }
			}

			/**
			 * 解析「便笺 ↔ 会话输入框」的目标会话：与「添加至对话」同一套解析规则，
			 * 未绑定时先打开该会话并等待绑定（新建页选出的最近会话可能尚未绑定）。
			 */
			async function resolveComposerTarget(sessionId) {
				if (typeof sessionId !== "string" || sessionId === "") return null;
				try {
					const sessions = ctx.get("sessions");
					let actx = sessions?.scope?.(sessionId);
					if (actx === undefined && typeof ctx.get("uiWorkspace")?.openSession === "function") {
						await ctx.get("uiWorkspace").openSession(sessionId);
						for (let attempt = 0; attempt < 30 && actx === undefined; attempt += 1) {
							actx = sessions?.scope?.(sessionId);
							if (actx === undefined) await new Promise(resolve => globalThis.setTimeout(resolve, 100));
						}
					}
					if (actx === undefined) return null;
					const conversation = ctx.get("conversation");
					if (conversation === undefined || conversation === null) return null;
					const input = conversation.input?.for?.(actx);
					if (input === undefined || input === null || input.state === undefined) return null;
					return { sessionId, sessions, conversation, input, snapshot: input.state.getSnapshot() };
				} catch { return null; }
			}

			/** 提交进行中的阶段：此时编辑草稿会被宿主拒绝，便笺侧提前判断并提示。 */
			function composerBusyPhase(phase) {
				return phase === "adjudicating" || phase === "submitting" || phase === "sending";
			}

			/**
			 * 只读解析某会话的输入框（**不打开会话**，也不会跳页）：用于订阅草稿是否有内容。
			 * 会话尚未绑定 scope 时返回 null，由调用方重试。
			 */
			function readComposerInput(sessionId) {
				if (typeof sessionId !== "string" || sessionId === "") return null;
				try {
					const actx = ctx.get("sessions")?.scope?.(sessionId);
					if (actx === undefined || actx === null) return null;
					const conversation = ctx.get("conversation");
					if (conversation === undefined || conversation === null) return null;
					return conversation.input?.for?.(actx) ?? null;
				} catch { return null; }
			}

			/** 输入框快照里是否有文字或图片——「从聊天导入」的可用条件（纯函数）。 */
			function composerDraftHasContent(snapshot) {
				if (snapshot === null || snapshot === undefined || typeof snapshot !== "object") return false;
				if (String(snapshot.draft ?? "") !== "") return true;
				return Array.isArray(snapshot.attachmentIds) && snapshot.attachmentIds.length > 0;
			}

			/**
			 * 订阅会话输入框「有内容」状态（文字或图片），供「从聊天导入」按钮置灰。
			 * 首帧同步读取（已绑定会话不会先闪一下置灰），之后跟随 input.state 变化；
			 * 尚未绑定 scope 时按 150ms 重试（最多约 6 秒），全程不打开会话、不改变当前页面。
			 */
			function useComposerHasContent(sessionId) {
				const [hasContent, setHasContent] = react.useState(() => composerDraftHasContent(readComposerInput(sessionId)?.state?.getSnapshot?.()));
				react.useEffect(() => {
					let alive = true;
					let timer = null;
					let unsubscribe = null;
					let attempts = 0;
					const read = (store) => {
						if (!alive) return;
						setHasContent(composerDraftHasContent(store.getSnapshot()));
					};
					const attach = () => {
						timer = null;
						if (!alive) return;
						const store = readComposerInput(sessionId)?.state;
						if (store === undefined || store === null || typeof store.getSnapshot !== "function") {
							attempts += 1;
							// 约 6 秒仍拿不到绑定就放弃：会话可能已归档或被回收，按钮保持置灰。
							if (attempts <= 40) timer = globalThis.setTimeout?.(attach, 150) ?? null;
							return;
						}
						read(store);
						if (typeof store.subscribe === "function") unsubscribe = store.subscribe(() => read(store));
					};
					attach();
					return () => {
						alive = false;
						if (timer !== null) globalThis.clearTimeout?.(timer);
						if (typeof unsubscribe === "function") unsubscribe();
					};
				}, [sessionId]);
				return hasContent;
			}

			/**
			 * 清空会话输入框（v0.19.0 修复：写入前必须先清空目标，而不是直接覆盖）。
			 * 顺序：setDraft("") 清掉文字与行内引用 chip → 重新读实时快照拿到当前全部附件 id →
			 * 逐个移除并释放草稿附件（宿主释放时会撤销图片预览 URL 并 abort 上传）。
			 * @param target resolveComposerTarget 的结果。
			 * @returns {{ ok: boolean, hadContent: boolean }}
			 */
			function clearComposerDraft(target) {
				const { conversation, input } = target;
				const before = input.state.getSnapshot();
				const hadText = String(before.draft ?? "") !== "";
				try { input.setDraft(""); } catch { return { ok: false, hadContent: hadText }; }
				// 清文字后重新取一次快照：附件列表与 setDraft 无关，但实时读取可避免用到过期快照。
				const snapshot = input.state.getSnapshot();
				const previousIds = Array.isArray(snapshot.attachmentIds) ? [...snapshot.attachmentIds] : [];
				// 先解析旧草稿对象再释放：resolve 之后 controller 里才有对象可释放（避免 blob URL 泄漏）。
				const previousDrafts = previousIds.length > 0 && typeof conversation.resolveDraftAttachments === "function"
					? conversation.resolveDraftAttachments(previousIds)
					: [];
				for (const id of previousIds) {
					try { input.removeAttachment?.(id); } catch { /* 单个移除失败不影响后续 */ }
				}
				if (previousDrafts.length > 0 && typeof conversation.releaseDraftAttachments === "function") {
					try { conversation.releaseDraftAttachments(previousDrafts); } catch { /* 释放失败仅内存 */ }
				}
				return { ok: true, hadContent: hadText || previousIds.length > 0 };
			}

			/**
			 * 把文字与便笺图片写入会话输入框（清空之后的第二阶段）。
			 * @returns {{ images: number, reason?: string }}
			 *   reason：write-failed（写字失败）/ images-unsupported（宿主不支持图片通道）/ attachments-rejected（附件被拒）
			 */
			function writeComposerDraft(target, text, images) {
				const { conversation, input, sessionId } = target;
				try { input.setDraft(typeof text === "string" ? text : ""); } catch { return { images: 0, reason: "write-failed" }; }
				const list = Array.isArray(images) ? images : [];
				if (list.length === 0) return { images: 0 };
				const files = list.map(noteImageFile).filter((file) => file !== null);
				if (files.length === 0 || typeof conversation.createDrafts !== "function" || typeof input.addAttachments !== "function") {
					return { images: 0, reason: "images-unsupported" };
				}
				const binding = (() => { try { return target.sessions?.binding?.(sessionId); } catch { return undefined; } })();
				let ordinary = false;
				try { ordinary = binding?.session?.getSnapshot?.()?.subagent === null; } catch { ordinary = false; }
				let drafts = [];
				try { drafts = conversation.createDrafts(sessionId, files, ordinary); } catch { drafts = []; }
				const ids = Array.isArray(drafts) ? drafts.map((draft) => draft.id) : [];
				let added = false;
				try { added = input.addAttachments(ids) === true; } catch { added = false; }
				if (!added) {
					if (Array.isArray(drafts) && drafts.length > 0 && typeof conversation.releaseDraftAttachments === "function") {
						try { conversation.releaseDraftAttachments(drafts); } catch { /* 释放失败仅内存 */ }
					}
					return { images: 0, reason: "attachments-rejected" };
				}
				return { images: ids.length };
			}

			/**
			 * 用便笺内容覆盖会话输入框：**先清空**（文字 + 全部旧图片并释放），**再写入**便笺文字与图片。
			 * 清空后写入失败不回滚（已确认的降级语义）：输入框保持已清空 + 已写入的部分并提示。
			 * @param sessionId 目标会话。
			 * @param text 便笺文字。
			 * @param images 便笺图片（内存对象，含 blob）。
			 * @returns {{ ok: boolean, reason?: string, images: number }}
			 */
			async function replaceComposerWithNote(sessionId, text, images) {
				const target = await resolveComposerTarget(sessionId);
				if (target === null) return { ok: false, reason: "no-target", images: 0 };
				if (composerBusyPhase(target.input.state.getSnapshot().phase)) return { ok: false, reason: "busy", images: 0 };
				const cleared = clearComposerDraft(target);
				if (!cleared.ok) return { ok: false, reason: "clear-failed", images: 0 };
				const written = writeComposerDraft(target, text, images);
				try { target.input.focus?.(); } catch { /* 聚焦失败不影响结果 */ }
				if (written.reason === "write-failed") return { ok: false, reason: "write-failed", images: 0 };
				return written.reason === undefined
					? { ok: true, images: written.images }
					: { ok: true, reason: written.reason, images: written.images };
			}

			/**
			 * 便笺覆盖写入（v0.19.0 修复）：先清空便笺（写空文字 → 释放旧图片 → 删除 IndexedDB 记录），
			 * 再写入新内容（文字 → 图片）。写入阶段失败不回滚，调用方按「已清空」同步界面。
			 * @param io { persistText(text) → { persisted, payload }, releaseImages(images), dropImages(), saveImages(images) }
			 * @param current { images } 当前便笺图片（用于释放 objectURL）。
			 * @param next { text, images } 新内容。
			 * @returns {{ ok: boolean, reason?: string, cleared?: boolean, payload?: object, images?: Array }}
			 */
			function overwriteNoteContent(io, current, next) {
				// 1) 先清空：空文字落盘失败就中止，旧内容（含图片）原样保留。
				const emptied = io.persistText("");
				if (emptied === null || emptied === undefined || emptied.persisted !== true) return { ok: false, reason: "storage" };
				io.releaseImages(Array.isArray(current?.images) ? current.images : []);
				io.dropImages();
				// 2) 再写入：文字落盘失败时便笺已被清空（不回滚），返回空文字的 payload 供界面同步。
				const written = io.persistText(typeof next?.text === "string" ? next.text : "");
				if (written === null || written === undefined || written.persisted !== true) {
					return { ok: false, reason: "storage", cleared: true, payload: emptied.payload };
				}
				const images = Array.isArray(next?.images) ? next.images : [];
				io.saveImages(images);
				return { ok: true, payload: written.payload, images };
			}

			/**
			 * 读取会话输入框的文字与图片（「从聊天导入」用）。
			 * @returns null（无目标/服务缺失）或 { text, files, skippedFiles }。
			 */
			async function readComposerForNote(sessionId) {
				const target = await resolveComposerTarget(sessionId);
				if (target === null) return null;
				const { conversation, input } = target;
				const snapshot = input.state.getSnapshot();
				const ids = Array.isArray(snapshot.attachmentIds) ? snapshot.attachmentIds : [];
				const drafts = ids.length > 0 && typeof conversation.resolveDraftAttachments === "function"
					? conversation.resolveDraftAttachments(ids)
					: [];
				const files = [];
				let skippedFiles = 0;
				for (const draft of drafts) {
					if (draft?.kind === "image" && draft.file !== undefined && draft.file !== null) files.push(draft.file);
					else skippedFiles += 1;
				}
				return { text: String(snapshot.draft ?? ""), files, skippedFiles };
			}

			/** 便笺确认弹窗（覆盖输入框 / 覆盖便笺都走它，portal 到 body）。 */
			function NoteConfirmDialog(props) {
				const modal = react.createElement("div", {
					className: "hud-modal hud-settings-modal",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": props.title,
					onClick: props.onClose,
					onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") props.onClose(); },
				},
					react.createElement("div", { className: "hud-modal-card hud-modal-card-sm", onClick: (event) => event.stopPropagation() },
						react.createElement("div", { className: "hud-modal-head" },
							react.createElement(Icon, { name: "note", size: 13 }),
							react.createElement("span", { className: "hud-modal-title" }, props.title),
							react.createElement("button", { type: "button", className: "hud-modal-close", onClick: props.onClose }, t("closeModal"))),
						react.createElement("div", { className: "hud-modal-body" },
							react.createElement("div", { className: "hud-confirm-body" },
								react.createElement("div", { className: "hud-confirm-note" }, props.note)),
							react.createElement("div", { className: "hud-confirm-actions" },
								react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "cancel", onClick: props.onClose }, t("settingsCancel")),
								props.danger === true
								? react.createElement("button", { type: "button", className: "hud-btn-danger", onClick: props.onConfirm }, props.confirmLabel)
								: react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "confirm", onClick: props.onConfirm }, props.confirmLabel)))));
				return react_dom.createPortal(modal, document.body);
			}

			/** 便笺图片大图预览（portal 到 body，Esc / 遮罩 / 关闭按钮退出）。 */
			function NoteImageLightbox(props) {
				react.useEffect(() => {
					const onKeyDown = (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") { event.preventDefault(); props.onClose(); } };
					globalThis.addEventListener?.("keydown", onKeyDown, true);
					return () => globalThis.removeEventListener?.("keydown", onKeyDown, true);
				}, [props]);
				const image = props.image;
				if (image === null || image === undefined) return null;
				const lightbox = react.createElement("div", {
					className: "hud-note-lightbox",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": image.name,
					onClick: props.onClose,
				},
					react.createElement("button", { type: "button", className: "hud-note-lightbox-close", onClick: props.onClose }, t("closeModal")),
					react.createElement("img", { src: image.url, alt: image.name, onClick: (event) => event.stopPropagation() }));
				return react_dom.createPortal(lightbox, document.body);
			}

			function NoteModule(props) {
				const scope = react.useMemo(() => noteScope(props), [props.workspaceKey, props.sessionId]);
				const maxCount = normalizeNoteMaxCount(props.noteMaxCount ?? NOTE_COUNT_DEFAULT);
				const [doc, setDoc] = react.useState(() => initialNoteDocument(props));
				// null = 便笺条列表；{ noteId } = 便笺内容编辑视图
				const [view, setView] = react.useState(null);
				const [images, setImages] = react.useState([]);
				const [preview, setPreview] = react.useState(null);
				// null | { kind: "add"|"import"|"delete"|"deleteAll", noteId? }
				const [confirm, setConfirm] = react.useState(null);
				const [clearConfirming, setClearConfirming] = react.useState(false);
				const [barDrag, setBarDrag] = react.useState(null);
				const [barSettling, setBarSettling] = react.useState(false);
				const [imageDrag, setImageDrag] = react.useState(null);
				const areaRef = react.useRef(null);
				const clearButtonRef = react.useRef(null);
				const clearTimerRef = react.useRef(null);
				const barListRef = react.useRef(null);
				const barDragRef = react.useRef(null);
				const barDropRef = react.useRef(false);
				const barSettleTimerRef = react.useRef(null);
				const imageStripRef = react.useRef(null);
				const imageDragRef = react.useRef(null);
				const imageDragCleanupRef = react.useRef(null);
				// 拖动结束后浏览器仍可能补发一次 click：记录本次是否真的移动过，用来抑制「拖动即放大」。
				const imageDragMovedRef = react.useRef(false);
				const imageDragSuppressClickRef = react.useRef(false);
				const imageWriteQueueRef = react.useRef(Promise.resolve());
				const storageWarnRef = react.useRef(false);
				const docRef = react.useRef(doc);
				docRef.current = doc;
				const viewRef = react.useRef(view);
				viewRef.current = view;
				const imagesRef = react.useRef(images);
				imagesRef.current = images;
				const targetSessionId = props.sendSessionId === null || props.sendSessionId === undefined ? "" : props.sendSessionId;
				const composerHasContent = useComposerHasContent(targetSessionId);
				const openNote = view === null ? null : doc.notes.find((note) => note.id === view.noteId) ?? null;
				const noteTitleOf = (noteId) => {
					const note = doc.notes.find((item) => item.id === noteId);
					return note === undefined || String(note.title ?? "").trim() === "" ? t("noteUntitled") : note.title;
				};
				const cancelClearConfirmation = react.useCallback(() => {
					if (clearTimerRef.current !== null) {
						globalThis.clearTimeout?.(clearTimerRef.current);
						clearTimerRef.current = null;
					}
					setClearConfirming(false);
				}, []);
				/** 本地存储不可用时只提示一次，避免每次按键都弹 toast。 */
				const warnStorageOnce = () => {
					if (storageWarnRef.current) return;
					storageWarnRef.current = true;
					toast(t("noteStorageUnavailable"), "warn");
				};
				const persistDoc = (next) => {
					const result = persistNoteDocument(scope, next);
					if (!result.persisted) warnStorageOnce();
					setDoc(next);
					return result;
				};
				const withNotePatch = (noteId, patch) => ({
					...docRef.current,
					notes: docRef.current.notes.map((note) => (note.id === noteId ? { ...note, ...patch, updatedAt: Date.now() } : note)),
				});
				const updateNote = (noteId, patch) => {
					if (!docRef.current.notes.some((note) => note.id === noteId)) return;
					persistDoc(withNotePatch(noteId, patch));
				};
				/** 空标题自动补「便笺n」：nextNumber 只增不减，删除便笺后编号也不复用。 */
				const assignAutoTitle = (noteId) => {
					const current = docRef.current;
					const nextNumber = Math.max(1, Number.isFinite(current.nextNumber) ? current.nextNumber : nextNoteNumber(current.notes, noteId));
					persistDoc({
						...current,
						nextNumber: nextNumber + 1,
						notes: current.notes.map((note) => (
							note.id === noteId ? { ...note, title: defaultNoteTitle(nextNumber), updatedAt: Date.now() } : note
						)),
					});
				};
				// —— 图片：按便笺 id 分桶写入 IndexedDB ——
				const persistImagesFor = async (noteId, nextImages) => {
					const value = await readNoteImageValue(scope.key);
					const map = value !== null && value !== undefined && !Array.isArray(value) ? { ...value } : {};
					// 旧版数组记录归属便笺1；正常迁移后不会走到这里。
					if (Array.isArray(value)) {
						const firstNoteId = docRef.current.notes[0]?.id;
						if (firstNoteId !== undefined) map[firstNoteId] = value;
					}
					if (nextImages.length === 0) delete map[noteId];
					else map[noteId] = dehydrateNoteImages(nextImages);
					const written = await writeNoteImageMap(scope.key, map);
					if (!written) toast(t("noteImageStorageUnavailable"), "warn");
					return written;
				};
				const queueImageWrite = (noteId, nextImages) => {
					imageWriteQueueRef.current = imageWriteQueueRef.current
						.catch(() => undefined)
						.then(() => persistImagesFor(noteId, nextImages));
				};
				const removeNoteImageEntry = async (noteId) => {
					const value = await readNoteImageValue(scope.key);
					if (value === null || value === undefined || Array.isArray(value) || !(noteId in value)) return;
					const map = { ...value };
					delete map[noteId];
					await writeNoteImageMap(scope.key, map);
				};
				const makeImages = (files) => {
					const stamp = Date.now().toString(36);
					return (Array.isArray(files) ? files : []).slice(0, NOTE_MAX_IMAGES).map((file, index) => {
						let url = "";
						try { url = globalThis.URL?.createObjectURL?.(file) ?? ""; } catch { url = ""; }
						return {
							id: `note-image-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
							type: file.type,
							name: typeof file.name === "string" && file.name !== "" ? file.name : "image",
							blob: file,
							url,
						};
					});
				};
				const releaseImages = (list) => { for (const image of Array.isArray(list) ? list : []) releaseNoteImage(image); };
				// —— 视图切换 ——
				const openEditor = (noteId) => {
					setConfirm(null);
					setPreview(null);
					setClearConfirming(false);
					setView({ noteId });
				};
				const closeEditor = () => {
					const note = openNote;
					if (note !== null && String(note.title ?? "").trim() === "") assignAutoTitle(note.id);
					setView(null);
					setPreview(null);
					setClearConfirming(false);
				};
				/** 新建便笺（标题自动生成）并进入编辑视图；达到上限时只提示不创建。 */
				const createNote = (text, incomingImages) => {
					const current = docRef.current;
					if (current.notes.length >= maxCount) {
						toast(interpolate(t("noteLimitReached"), { count: String(maxCount) }), "warn");
						return null;
					}
					const nextNumber = Math.max(1, Number.isFinite(current.nextNumber) ? current.nextNumber : nextNoteNumber(current.notes));
					const note = {
						id: newNoteId(),
						title: defaultNoteTitle(nextNumber),
						text: typeof text === "string" ? text : "",
						updatedAt: Date.now(),
					};
					persistDoc({ ...current, notes: [...current.notes, note], nextNumber: nextNumber + 1 });
					const fresh = Array.isArray(incomingImages) ? incomingImages : [];
					setImages(fresh);
					if (fresh.length > 0) queueImageWrite(note.id, fresh);
					openEditor(note.id);
					publishNoteChange(scope.key);
					return note;
				};
				/** 「从聊天创建」：只复制输入框内容，不清空输入框；成功后直接进入编辑视图。 */
				const onCreateFromChat = async () => {
					if (targetSessionId === "") { toast(t("noteSendTargetMissing")); return; }
					if (docRef.current.notes.length >= maxCount) {
						toast(interpolate(t("noteLimitReached"), { count: String(maxCount) }), "warn");
						return;
					}
					const content = await readComposerForNote(targetSessionId);
					if (content === null) { toast(t("noteSendFailed")); return; }
					const files = content.files.filter(noteImageAcceptable).slice(0, NOTE_MAX_IMAGES);
					if (content.text === "" && files.length === 0) { toast(t("noteImportEmpty")); return; }
					const incoming = makeImages(files);
					const note = createNote(content.text, incoming);
					if (note === null) { releaseImages(incoming); return; }
					if (content.skippedFiles > 0) toast(interpolate(t("noteImportSkippedFiles"), { count: content.skippedFiles }), "warn");
				};
				// —— 删除（单条 / 全部）——
				const deleteNote = (noteId) => {
					const next = { ...docRef.current, notes: docRef.current.notes.filter((note) => note.id !== noteId) };
					persistDoc(next);
					void removeNoteImageEntry(noteId);
					if (viewRef.current !== null && viewRef.current.noteId === noteId) {
						setView(null);
						setPreview(null);
						releaseImages(imagesRef.current);
						setImages([]);
					}
					publishNoteChange(scope.key);
				};
				const deleteAllNotes = () => {
					persistDoc({ ...docRef.current, notes: [] });
					void deleteNoteImages(scope.key);
					setView(null);
					setPreview(null);
					setClearConfirming(false);
					releaseImages(imagesRef.current);
					setImages([]);
					publishNoteChange(scope.key);
				};
				// —— 图片：粘贴 / 移除 / 拖动排序 ——
				const addImageFiles = (files) => {
					if (openNote === null) return;
					const accepted = Array.isArray(files) ? files.filter(noteImageAcceptable) : [];
					if (accepted.length === 0) return;
					const added = makeImages(accepted);
					// 同步算出合并结果（不能依赖 setImages 的 updater：它在下次渲染才执行，
					// 会把「超出 20 张」的提示漏掉）。
					const room = noteMergeImages(imagesRef.current.length, added.length);
					if (room.accepted === 0) {
						toast(interpolate(t("noteImageLimit"), { count: NOTE_MAX_IMAGES }), "warn");
						return;
					}
					releaseImages(added.slice(room.accepted));
					const next = [...imagesRef.current, ...added.slice(0, room.accepted)];
					setImages(next);
					queueImageWrite(openNote.id, next);
					if (room.rejected > 0) toast(interpolate(t("noteImageLimit"), { count: NOTE_MAX_IMAGES }), "warn");
					publishNoteChange(scope.key);
				};
				const onPaste = (event) => {
					const files = notePasteImageFiles(event?.clipboardData?.items);
					if (files.length === 0) return;
					// 有图片就接管这次粘贴，避免图片被当成文件粘贴路径写进文本。
					event.preventDefault?.();
					addImageFiles(files);
				};
				const removeImage = (id) => {
					const note = openNote;
					if (note === null) return;
					const prev = imagesRef.current;
					const target = prev.find((image) => image.id === id) ?? null;
					if (target === null) return;
					releaseNoteImage(target);
					const next = prev.filter((image) => image.id !== id);
					setImages(next);
					queueImageWrite(note.id, next);
					setPreview((value) => (value === id ? null : value));
					publishNoteChange(scope.key);
				};
				const replaceImages = (next) => {
					if (openNote === null) return;
					setImages(next);
					queueImageWrite(openNote.id, next);
					publishNoteChange(scope.key);
				};
				const startImageDrag = (event, imageId) => {
					if (event === null || event === undefined || event.button !== 0) return;
					// 缩略图右上角的移除按钮不参与拖动排序。
					const removeButton = event.target?.closest?.(".hud-note-thumb-remove");
					if (removeButton !== null && removeButton !== undefined) return;
					const strip = imageStripRef.current;
					if (strip === null) return;
					event.preventDefault?.();
					const startX = Number.isFinite(event.clientX) ? event.clientX : 0;
					imageDragMovedRef.current = false;
					imageDragSuppressClickRef.current = false;
					const rects = Array.from(strip.children).map((node) => node.getBoundingClientRect());
					const stripRect = strip.getBoundingClientRect();
					const order = imagesRef.current.map((image) => image.id);
					const lefts = rects.map((rect) => rect.left - stripRect.left + (strip.scrollLeft ?? 0));
					const widths = rects.map((rect) => rect.width);
					const gap = rects.length > 1 ? Math.max(0, rects[1].left - (rects[0].left + rects[0].width)) : 6;
					imageDragRef.current = { id: imageId, baseOrder: order, order, lefts, widths, gap };
					setImageDrag({ id: imageId, baseOrder: order, order, lefts, widths, gap });
					const onMove = (moveEvent) => {
						if (Number.isFinite(moveEvent.clientX) && Math.abs(moveEvent.clientX - startX) > 3) imageDragMovedRef.current = true;
						const state = imageDragRef.current;
						if (state === null || state.lefts.length === 0) return;
						const relX = moveEvent.clientX - stripRect.left + (strip.scrollLeft ?? 0);
						const overIndex = dropIndexAt(state.lefts, state.widths, relX);
						if (overIndex === -1) return;
						const next = previewModuleOrder(state.order, state.id, overIndex);
						state.order = next;
						setImageDrag((prev) => (prev === null || sameOrder(prev.order, next) ? prev : { ...prev, order: next }));
					};
					const cleanup = () => {
						globalThis.removeEventListener?.("pointermove", onMove);
						globalThis.removeEventListener?.("pointerup", onUp);
						globalThis.removeEventListener?.("pointercancel", onUp);
						imageDragCleanupRef.current = null;
					};
					const onUp = () => {
						cleanup();
						// 只要手指/鼠标移动过，就吃掉拖动后补发的 click，避免自动打开大图。
						imageDragSuppressClickRef.current = imageDragMovedRef.current;
						const state = imageDragRef.current;
						imageDragRef.current = null;
						setImageDrag(null);
						if (state === null || sameOrder(state.baseOrder, state.order)) return;
						const byId = new Map(imagesRef.current.map((image) => [image.id, image]));
						const next = state.order.map((id) => byId.get(id)).filter((image) => image !== undefined);
						if (next.length !== imagesRef.current.length) return;
						replaceImages(next);
					};
					imageDragCleanupRef.current = cleanup;
					globalThis.addEventListener?.("pointermove", onMove);
					globalThis.addEventListener?.("pointerup", onUp);
					globalThis.addEventListener?.("pointercancel", onUp);
				};
				// —— 便笺条竖直拖动排序（复用待办的落点/让位引擎）——
				const startBarDrag = (event, noteId) => {
					if (event === null || event === undefined) return;
					event.stopPropagation?.();
					event.dataTransfer?.setData?.("text/plain", noteId);
					if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.effectAllowed = "move";
					const list = barListRef.current;
					let tops = [];
					let heights = [];
					let gap = 6;
					if (list !== null) {
						const listRect = list.getBoundingClientRect();
						const rects = Array.from(list.children).map((node) => node.getBoundingClientRect());
						tops = rects.map((rect) => rect.top - listRect.top);
						heights = rects.map((rect) => rect.height);
						if (rects.length > 1) gap = Math.max(0, rects[1].top - (rects[0].top + rects[0].height));
					}
					const order = docRef.current.notes.map((note) => note.id);
					barDragRef.current = { id: noteId, baseOrder: order, order, tops, heights, gap };
					setBarDrag({ id: noteId, baseOrder: order, order, tops, heights, gap });
					suppressNativeDragImage(event);
				};
				const dragOverBarList = (event) => {
					const state = barDragRef.current;
					if (state === null || state.tops.length === 0) return;
					event.preventDefault?.();
					if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = "move";
					const list = barListRef.current;
					if (list === null) return;
					const overIndex = dropIndexAt(state.tops, state.heights, event.clientY - list.getBoundingClientRect().top);
					if (overIndex === -1) return;
					const next = previewModuleOrder(state.order, state.id, overIndex);
					state.order = next;
					setBarDrag((prev) => (prev === null || sameOrder(prev.order, next) ? prev : { ...prev, order: next }));
				};
				const commitBarDrag = () => {
					const state = barDragRef.current;
					const order = state?.order ?? null;
					if (order !== null && state !== null && !sameOrder(state.baseOrder, order)) {
						const byId = new Map(docRef.current.notes.map((note) => [note.id, note]));
						const next = order.map((id) => byId.get(id)).filter((note) => note !== undefined);
						if (next.length === docRef.current.notes.length) {
							setBarSettling(true);
							persistDoc({ ...docRef.current, notes: next });
							if (typeof window !== "undefined") {
								window.clearTimeout(barSettleTimerRef.current);
								barSettleTimerRef.current = window.setTimeout(() => setBarSettling(false), 0);
							}
							publishNoteChange(scope.key);
						}
					}
					barDragRef.current = null;
					setBarDrag(null);
				};
				const dropBarList = (event) => {
					event.preventDefault?.();
					barDropRef.current = true;
					commitBarDrag();
				};
				const endBarDrag = () => {
					if (!barDropRef.current) commitBarDrag();
					barDropRef.current = false;
					barDragRef.current = null;
					setBarDrag(null);
				};
				// —— 从聊天导入 / 添加至聊天（沿用原有覆盖与确认语义）——
				const runAddToChat = async () => {
					const note = openNote;
					if (note === null) return;
					if (targetSessionId === "") { toast(t("noteSendTargetMissing")); return; }
					const result = await replaceComposerWithNote(targetSessionId, note.text, images);
					if (!result.ok) {
						toast(result.reason === "busy" ? t("noteSendBusy") : t("noteSendFailed"));
						return;
					}
					if (result.reason === "images-unsupported" || result.reason === "attachments-rejected") toast(t("noteImageUnavailable"), "warn");
				};
				const onAddToChat = async () => {
					const note = openNote;
					if (note === null) return;
					if (note.text === "" && images.length === 0) return;
					if (targetSessionId === "") { toast(t("noteSendTargetMissing")); return; }
					const target = await resolveComposerTarget(targetSessionId);
					const snapshot = target?.input?.state?.getSnapshot?.() ?? null;
					const busy = snapshot !== null && (String(snapshot.draft ?? "") !== "" || (Array.isArray(snapshot.attachmentIds) && snapshot.attachmentIds.length > 0));
					if (busy) { setConfirm({ kind: "add", noteId: note.id }); return; }
					await runAddToChat();
				};
				const runImportFromChat = async () => {
					const note = openNote;
					if (note === null) return;
					if (targetSessionId === "") { toast(t("noteSendTargetMissing")); return; }
					const content = await readComposerForNote(targetSessionId);
					if (content === null) { toast(t("noteSendFailed")); return; }
					const files = content.files.filter(noteImageAcceptable).slice(0, NOTE_MAX_IMAGES);
					if (content.text === "" && files.length === 0) { toast(t("noteImportEmpty")); return; }
					const incoming = makeImages(files);
					// 先清空便笺（文字 + 图片），再写入输入框内容；清空失败则中止且保留旧内容。
					releaseImages(imagesRef.current);
					const emptied = persistDoc(withNotePatch(note.id, { text: "" }));
					setImages([]);
					setPreview(null);
					queueImageWrite(note.id, []);
					if (!emptied.persisted) {
						releaseImages(incoming);
						toast(t("noteClearFailed"));
						return;
					}
					const written = persistDoc(withNotePatch(note.id, { text: content.text }));
					if (!written.persisted) {
						releaseImages(incoming);
						toast(t("noteClearFailed"));
						return;
					}
					setImages(incoming);
					queueImageWrite(note.id, incoming);
					if (content.skippedFiles > 0) toast(interpolate(t("noteImportSkippedFiles"), { count: content.skippedFiles }), "warn");
					publishNoteChange(scope.key);
				};
				const onImportFromChat = async () => {
					const note = openNote;
					if (note === null) return;
					if (targetSessionId === "") { toast(t("noteSendTargetMissing")); return; }
					if (note.text !== "" || images.length > 0) { setConfirm({ kind: "import", noteId: note.id }); return; }
					await runImportFromChat();
				};
				// —— 清空（文字 + 图片）——
				const onClear = () => {
					const note = openNote;
					if (note === null) return;
					const action = noteClearAction(note.text, clearConfirming, images.length > 0);
					if (action === "noop") return;
					if (action === "confirm") {
						clearTimerRef.current = globalThis.setTimeout(() => {
							clearTimerRef.current = null;
							setClearConfirming(false);
						}, NOTE_CLEAR_CONFIRM_MS);
						setClearConfirming(true);
						return;
					}
					releaseImages(imagesRef.current);
					const result = persistDoc(withNotePatch(note.id, { text: "" }));
					setImages([]);
					setPreview(null);
					queueImageWrite(note.id, []);
					cancelClearConfirmation();
					areaRef.current?.focus?.();
					if (!result.persisted) toast(t("noteClearFailed"));
					publishNoteChange(scope.key);
				};
				// 默认高度 = 180px；拖动底部手柄实时写入「所有便笺共用」的高度。
				const startResize = (event) => {
					event.preventDefault();
					const el = areaRef.current;
					if (el === null) return;
					const startY = event.clientY;
					const startH = el.offsetHeight;
					const onMove = (moveEvent) => {
						const next = Math.max(56, Math.min(600, startH + (moveEvent.clientY - startY)));
						if (docRef.current.height === next) return;
						persistDoc({ ...docRef.current, height: next });
					};
					const onUp = () => {
						window.removeEventListener("mousemove", onMove);
						window.removeEventListener("mouseup", onUp);
					};
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
				};
				// —— 挂载：v3 → v4 文档迁移 + 旧图片数组迁移到便笺1 ——
				react.useEffect(() => {
					let alive = true;
					const current = readNoteDocument(scope.key);
					const migrate = async () => {
						if (current !== null && current.legacy === true) {
							persistNoteDocument(scope, current);
							if (alive) setDoc(current);
						}
						const value = await readNoteImageValue(scope.key);
						if (!alive || !Array.isArray(value)) return;
						const noteId = (current ?? docRef.current).notes[0]?.id ?? "";
						if (noteId === "") return;
						await writeNoteImageMap(scope.key, { [noteId]: value });
					};
					void migrate();
					return () => { alive = false; };
				}, [scope.key]);
				// —— 编辑视图：加载当前便笺的图片 ——
				react.useEffect(() => {
					const noteId = view === null ? "" : view.noteId;
					if (noteId === "") {
						setImages((prev) => { releaseImages(prev); return []; });
						return undefined;
					}
					let alive = true;
					void readNoteImageValue(scope.key).then((value) => {
						if (!alive) return;
						const map = Array.isArray(value) ? { [noteId]: value } : (value ?? {});
						const records = Array.isArray(map[noteId]) ? map[noteId] : [];
						setImages((prev) => { releaseImages(prev); return hydrateNoteImages(records); });
					});
					return () => { alive = false; };
				}, [scope.key, view === null ? "" : view.noteId]);
				// 卸载时释放 objectURL 与拖动监听。
				react.useEffect(() => () => {
					releaseImages(imagesRef.current);
					if (imageDragCleanupRef.current !== null) {
						imageDragCleanupRef.current();
						imageDragCleanupRef.current = null;
					}
					if (typeof window !== "undefined") window.clearTimeout(barSettleTimerRef.current);
					if (clearTimerRef.current !== null) globalThis.clearTimeout?.(clearTimerRef.current);
				}, []);
				// 其它标签页/窗口写入时同步文档；storage 事件同时刷新当前便笺的图片。
				react.useEffect(() => {
					const syncDoc = () => {
						const next = readNoteDocument(scope.key);
						if (next === null) return;
						setDoc(next);
						const currentView = viewRef.current;
						if (currentView !== null && !next.notes.some((note) => note.id === currentView.noteId)) setView(null);
					};
					const syncImages = () => {
						const currentView = viewRef.current;
						if (currentView === null) return;
						void readNoteImageValue(scope.key).then((value) => {
							const map = Array.isArray(value) ? {} : (value ?? {});
							const records = Array.isArray(map[currentView.noteId]) ? map[currentView.noteId] : [];
							setImages((prev) => { releaseImages(prev); return hydrateNoteImages(records); });
						});
					};
					const onNoteChange = (event) => { if (event?.detail?.key === scope.key) syncDoc(); };
					const onStorage = (event) => {
						if (event?.key !== NOTES_STORAGE_KEY && event?.key !== null) return;
						syncDoc();
						syncImages();
					};
					globalThis.addEventListener?.(NOTE_CHANGE_EVENT, onNoteChange);
					globalThis.addEventListener?.("storage", onStorage);
					return () => {
						globalThis.removeEventListener?.(NOTE_CHANGE_EVENT, onNoteChange);
						globalThis.removeEventListener?.("storage", onStorage);
					};
				}, [scope.key]);
				// 编辑中的便笺被别处删掉时回到列表。
				react.useEffect(() => {
					if (view !== null && !doc.notes.some((note) => note.id === view.noteId)) setView(null);
				}, [doc, view]);
				// 清空确认：点击外部或 Escape 取消。
				react.useEffect(() => {
					if (!clearConfirming) return undefined;
					const onPointerDown = (event) => {
						if (!clearButtonRef.current?.contains?.(event.target)) cancelClearConfirmation();
					};
					const onKeyDown = (event) => {
						if (isImeComposing(event)) return;
						if (event.key !== "Escape") return;
						event.preventDefault();
						cancelClearConfirmation();
					};
					globalThis.addEventListener?.("pointerdown", onPointerDown, true);
					globalThis.addEventListener?.("keydown", onKeyDown, true);
					return () => {
						globalThis.removeEventListener?.("pointerdown", onPointerDown, true);
						globalThis.removeEventListener?.("keydown", onKeyDown, true);
					};
				}, [clearConfirming, cancelClearConfirmation]);
				// 便笺为空（无文字无图片）时取消「清空」确认态。
				react.useEffect(() => {
					if ((openNote === null || openNote.text === "") && images.length === 0) cancelClearConfirmation();
				}, [openNote, images.length, cancelClearConfirmation]);
				// 便笺条拖动期间在 document 捕获阶段接管落点（指针移出列表也能提交）。
				react.useEffect(() => {
					if (barDrag === null) return undefined;
					if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
					const onOver = (event) => { dragOverBarList(event); };
					const onDrop = (event) => { event.preventDefault(); barDropRef.current = true; commitBarDrag(); };
					document.addEventListener("dragover", onOver, true);
					document.addEventListener("drop", onDrop, true);
					return () => {
						document.removeEventListener("dragover", onOver, true);
						document.removeEventListener("drop", onDrop, true);
					};
				}, [barDrag !== null]);
				// —— 渲染 ——
				const barOffsets = barDrag === null ? null : previewOffsets(barDrag.baseOrder, barDrag.order, barDrag.tops, barDrag.heights, barDrag.gap);
				const imageOffsets = imageDrag === null ? null : previewOffsets(imageDrag.baseOrder, imageDrag.order, imageDrag.lefts, imageDrag.widths, imageDrag.gap);
				const renderBar = (note) => {
					const dragging = barDrag !== null && barDrag.id === note.id;
					// 被拖动项也按预览顺序位移到落点：列表里展示「站位」的便笺条，而不是留出空档。
					const offset = barOffsets === null ? 0 : (barOffsets[note.id] ?? 0);
					const title = String(note.title ?? "").trim() === "" ? t("noteUntitled") : note.title;
					return react.createElement("div", {
						key: note.id,
						className: "hud-note-bar",
						"data-dragging": dragging,
						style: offset === 0 ? undefined : { transform: `translateY(${offset}px)` },
					},
						react.createElement("span", {
							className: "hud-note-grip",
							draggable: true,
							role: "button",
							tabIndex: 0,
							"aria-label": t("noteDrag"),
							title: t("noteDrag"),
							onDragStart: (event) => startBarDrag(event, note.id),
							onDragEnd: endBarDrag,
						}, react.createElement(Icon, { name: "drag", size: 13 })),
						react.createElement("span", { className: "hud-note-bar-title", title }, title),
						react.createElement("span", { className: "hud-note-bar-actions" },
							react.createElement("button", {
								type: "button",
								className: "hud-ic-btn",
								"aria-label": t("noteEdit"),
								title: t("noteEdit"),
								onClick: () => openEditor(note.id),
							}, react.createElement(Icon, { name: "edit", size: 13 })),
							react.createElement("button", {
								type: "button",
								className: "hud-ic-btn",
								"aria-label": t("noteDelete"),
								title: t("noteDelete"),
								onClick: () => setConfirm({ kind: "delete", noteId: note.id }),
							}, react.createElement(Icon, { name: "trash-outline", size: 13 }))));
				};
				const renderList = () => react.createElement("div", { className: "hud-note-list-view" },
					doc.notes.length === 0
						? react.createElement("div", { className: "hud-note-empty" }, t("noteEmpty"))
						: react.createElement("div", {
							className: "hud-note-list",
							ref: barListRef,
							"data-settling": barSettling,
							onDragOver: dragOverBarList,
							onDrop: dropBarList,
						}, doc.notes.map(renderBar)),
					react.createElement("div", { className: "hud-note-list-actions" },
						react.createElement("button", {
							type: "button",
							className: "hud-btn-small",
							disabled: targetSessionId === "" || composerHasContent !== true,
							onClick: () => { void onCreateFromChat(); },
						}, t("noteCreateFromChat")),
						react.createElement("button", {
							type: "button",
							className: "hud-btn-small",
							onClick: () => { createNote("", []); },
						}, t("noteAdd"))),
					react.createElement("button", {
						type: "button",
						className: "hud-btn-small hud-note-delete-all",
						disabled: doc.notes.length === 0,
						onClick: () => setConfirm({ kind: "deleteAll" }),
					}, t("noteDeleteAll")));
				const renderEditor = (note) => react.createElement("div", { className: "hud-note-editor" },
					react.createElement("div", { className: "hud-note-editor-head" },
						react.createElement("button", {
							type: "button",
							className: "hud-note-back",
							"aria-label": t("noteBack"),
							title: t("noteBack"),
							onClick: closeEditor,
						}, "◀"),
						react.createElement("input", {
							...IME_INPUT_PROPS,
							className: "hud-note-title-input",
							value: note.title,
							placeholder: t("noteTitlePlaceholder"),
							"aria-label": t("noteTitlePlaceholder"),
							onChange: (event) => updateNote(note.id, { title: event.target.value }),
							// 标题留空时（失焦/回车）自动补一个「便笺n」，编号取现有最大编号 + 1。
							onBlur: () => {
								const title = String(docRef.current.notes.find((item) => item.id === note.id)?.title ?? "").trim();
								if (title !== "") return;
								assignAutoTitle(note.id);
							},
							onKeyDown: (event) => {
								if (isImeComposing(event)) return;
								if (event.key !== "Enter") return;
								event.preventDefault();
								event.currentTarget.blur();
							},
						})),
					images.length === 0 ? null : react.createElement("div", { className: "hud-note-images", role: "list", ref: imageStripRef },
						images.map((image) => {
							const dragging = imageDrag !== null && imageDrag.id === image.id;
							const offset = imageOffsets === null ? 0 : (imageOffsets[image.id] ?? 0);
							return react.createElement("div", {
								key: image.id,
								role: "listitem",
								className: "hud-note-thumb",
								"data-dragging": dragging,
								// 被拖动的缩略图同样移动到落点，展示「站位」的图片。
								style: offset === 0 ? undefined : { transform: `translateX(${offset}px)` },
								onPointerDown: (event) => startImageDrag(event, image.id),
								// 拖动排序刚结束时浏览器会补发 click；仅真正的点击才打开大图。
								onClick: () => {
									if (imageDragSuppressClickRef.current) { imageDragSuppressClickRef.current = false; return; }
									setPreview(image.id);
								},
							},
								react.createElement("img", {
									src: image.url,
									alt: image.name,
									draggable: false,
								}),
								react.createElement("button", {
									type: "button",
									className: "hud-note-thumb-remove",
									"aria-label": t("noteImageRemove"),
									title: t("noteImageRemove"),
									onPointerDown: (event) => event.stopPropagation(),
									onClick: (event) => { event.stopPropagation(); removeImage(image.id); },
								}, react.createElement(Icon, { name: "close", size: 12 })));
						})),
					react.createElement("div", { className: "hud-note-wrap" },
						react.createElement("textarea", {
							...IME_INPUT_PROPS,
							ref: areaRef,
							className: "hud-note-area",
							style: doc.height === null ? undefined : { height: `${doc.height}px` },
							placeholder: t("notePlaceholder"),
							value: note.text,
							onChange: (event) => updateNote(note.id, { text: event.target.value }),
							onPaste,
						}),
						react.createElement("div", { className: "hud-note-resize", "aria-hidden": "true", onMouseDown: startResize })),
					react.createElement("div", { className: "hud-note-actions" },
						react.createElement("div", { className: "hud-note-buttons", "data-stacked": "", },
							react.createElement("button", {
								ref: clearButtonRef,
								type: "button",
								className: clearConfirming ? "hud-btn-small hud-note-clear hud-note-clear-confirm" : "hud-btn-small hud-note-clear",
								disabled: note.text === "" && images.length === 0,
								"aria-label": t(clearConfirming ? "noteClearConfirm" : "noteClear"),
								onClick: onClear,
							}, t(clearConfirming ? "noteClearConfirm" : "noteClear")),
							react.createElement("button", {
								type: "button",
								className: "hud-btn-small hud-note-import",
								disabled: targetSessionId === "" || composerHasContent !== true,
								onClick: () => { void onImportFromChat(); },
							}, t("noteImportFromChat")),
							react.createElement("button", {
								type: "button",
								className: "hud-btn-small hud-note-send",
								disabled: note.text === "" && images.length === 0,
								onClick: () => { void onAddToChat(); },
							}, t("noteSendToChat")))));
				const previewImage = preview === null ? null : images.find((image) => image.id === preview) ?? null;
				const confirmTitle = confirm === null ? ""
					: confirm.kind === "delete" ? t("noteDeleteTitle")
						: confirm.kind === "deleteAll" ? t("noteDeleteAllTitle")
							: confirm.kind === "add" ? t("noteSendToChat") : t("noteImportFromChat");
				const confirmNote = confirm === null ? ""
					: confirm.kind === "delete" ? interpolate(t("noteDeleteNote"), { title: noteTitleOf(confirm.noteId) })
						: confirm.kind === "deleteAll" ? interpolate(t("noteDeleteAllNote"), { count: String(doc.notes.length) })
							: confirm.kind === "add" ? t("noteAddOverwriteConfirm") : t("noteImportConfirm");
				const confirmNode = confirm === null ? null : react.createElement(NoteConfirmDialog, {
					title: confirmTitle,
					note: confirmNote,
					confirmLabel: confirm.kind === "delete" ? t("noteDeleteConfirm") : confirm.kind === "deleteAll" ? t("noteDeleteAllConfirm") : t("noteConfirmOverwrite"),
					// 「添加至聊天 / 从聊天导入」会清空对侧内容，确认按钮同样用红色危险样式。
					danger: true,
					onConfirm: () => {
						const current = confirm;
						setConfirm(null);
						if (current.kind === "delete") deleteNote(current.noteId);
						else if (current.kind === "deleteAll") deleteAllNotes();
						else if (current.kind === "add") void runAddToChat();
						else void runImportFromChat();
					},
					onClose: () => setConfirm(null),
				});
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "note",
						title: t("noteModule"),
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						openNote === null ? renderList() : renderEditor(openNote),
						confirmNode,
						previewImage === null ? null : react.createElement(NoteImageLightbox, {
							image: previewImage,
							onClose: () => setPreview(null),
						})));
			}

			// —— 「待办」模块：按工作区共享（无 cwd 时降级会话级）+ localStorage 持久化；
			//     添加（按钮/Enter）/ 勾选完成移底+删除线 / 取消勾选移顶 /
			//     行内编辑（Enter 保存）/ 删除直接生效（无二次确认）/ 整列表拖拽排序 ——
			function newTodoId() {
				return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			}

			/** 待办持久化作用域：工作区路径可用 → 工作区键；否则降级会话级。 */
			function todoScope(props) {
				return props.workspaceKey === null || props.workspaceKey === undefined || props.workspaceKey === ""
					? { key: props.sessionId, workspace: false }
					: { key: props.workspaceKey, workspace: true };
			}
			/**
			 * 待办初始化：工作区作用域首次访问时先按候选会话做一次性归并迁移
			 * （旧会话级待办按条目 id 去重合并），再读取结果。
			 */
			function initialTodoList(props) {
				const scope = todoScope(props);
				if (!scope.workspace) {
					const list = loadJsonStorage(TODOS_STORAGE_KEY)?.[scope.key];
					return normalizeTodoList(list);
				}
				const storage = loadJsonStorage(TODOS_STORAGE_KEY) ?? {};
				migrateWorkspaceScope(storage, scope.key, props.workspaceCandidates);
				return normalizeTodoList(storage[scope.key]);
			}

			function TodoModule(props) {
				const sessionId = props.sessionId;
				const scope = react.useMemo(() => todoScope(props), [props.workspaceKey, props.sessionId]);
				const [draft, setDraft] = react.useState("");
				const [todos, setTodos] = react.useState(() => initialTodoList(props));
				const [editingId, setEditingId] = react.useState(null);
				const [editingText, setEditingText] = react.useState("");
				// 拖动排序实时预览：待办行高随文本换行变化，按每行真实高度重排让位。
				const [dragPreview, setDragPreview] = react.useState(null);
				const [dragSettling, setDragSettling] = react.useState(false);
				const settleTimerRef = react.useRef(null);
				const dragRef = react.useRef(null);
				const listRef = react.useRef(null);
				const [clearOpen, setClearOpen] = react.useState(false);
				// v0.19.2：已完成的待办整组移到最下方并默认折叠。
				const [doneExpanded, setDoneExpanded] = react.useState(false);
				/**
				 * @param next 本次操作后的列表
				 * @param removedIds 本次显式删除的条目 id（差量语义，见 persistWorkspaceTodos）
				 * @param cleared 本次是否为「清空已完成」操作
				 */
				const persist = (next, removedIds, cleared) => {
					if (!scope.workspace) {
						setTodos(next);
						persistSessionField(TODOS_STORAGE_KEY, scope.key, next);
						return;
					}
					// 工作区作用域：写入前重读最新存储做差量归并 —— 其它会话/标签页新增的
					// 条目不会丢，本会话删除/清空的条目也不会被存储里的旧内容复活
					setTodos(persistWorkspaceTodos(TODOS_STORAGE_KEY, scope.key, next, removedIds, { cleared: cleared === true }));
				};
				const addTodo = () => {
					const text = draft.trim();
					if (text === "") return;
					// 新添加的待办置顶
					persist([{ id: newTodoId(), text, done: false }, ...todos]);
					setDraft("");
				};
				const toggleTodo = (id) => {
					const item = todos.find((value) => value.id === id);
					if (item === undefined) return;
					const rest = todos.filter((value) => value.id !== id);
					// 完成 → 移至列表最下方；取消完成 → 移至列表最上方
					persist(item.done ? [{ ...item, done: false }, ...rest] : [...rest, { ...item, done: true }]);
				};
				// 删除直接生效（无二次确认弹窗）
				const removeTodo = (id) => persist(todos.filter((value) => value.id !== id), new Set([id]));
				// 清空所有已完成待办（弹窗内点击确认后执行）
				const clearDone = () => {
					persist(todos.filter((value) => !value.done), new Set(todos.filter((value) => value.done).map((value) => value.id)), true);
					setClearOpen(false);
				};
				const startEdit = (item) => { setEditingId(item.id); setEditingText(item.text); };
				const commitEdit = () => {
					const text = editingText.trim();
					if (editingId !== null && text !== "") persist(todos.map((value) => (value.id === editingId ? { ...value, text } : value)));
					setEditingId(null);
				};
				/** 结束拖动：没有落点（松手在列表外）时丢弃预览，顺序保持不变。 */
				const endDrag = () => { dragRef.current = null; setDragPreview(null); };
				/** 拖动开始：记录每行的原始 top/高度与行距（待办行可能因换行而高度不同）。 */
				const startDrag = (event, item) => {
					event.dataTransfer?.setData?.("text/plain", item.id);
					if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.effectAllowed = "move";
					const list = listRef.current;
					let tops = [];
					let heights = [];
					let gap = 6;
					if (list !== null) {
						const listRect = list.getBoundingClientRect();
						// 只统计未完成行：已完成行固定在末尾，不参与拖动落点计算。
						const rects = Array.from(list.children)
							.filter((node) => node.getAttribute?.("data-done") === "false")
							.map((node) => node.getBoundingClientRect());
						tops = rects.map((rect) => rect.top - listRect.top);
						heights = rects.map((rect) => rect.height);
						if (rects.length > 1) gap = Math.max(0, rects[1].top - (rects[0].top + rects[0].height));
					}
					const order = activeTodos.map((value) => value.id);
					dragRef.current = { id: item.id, baseOrder: order, order, tops, heights, gap };
					setDragPreview({ id: item.id, baseOrder: order, order, tops, heights, gap });
					// 原生拖拽幽灵会跟随鼠标，与列表内的虚线占位重复；隐藏它，只保留占位预览。
					suppressNativeDragImage(event);
				};
				/** 拖动经过列表：按指针在原始条目中的位置算落点，其他条目实时让位。 */
				const dragOverList = (event) => {
					const state = dragRef.current;
					if (state === null || state.tops.length === 0) return;
					event.preventDefault();
					if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = "move";
					const list = listRef.current;
					if (list === null) return;
					const overIndex = dropIndexAt(state.tops, state.heights, event.clientY - list.getBoundingClientRect().top);
					if (overIndex === -1) return;
					const next = previewModuleOrder(state.order, state.id, overIndex);
					state.order = next;
					setDragPreview((prev) => {
						if (prev !== null && prev.order.length === next.length && prev.order.every((value, index) => value === next[index])) return prev;
						return { id: state.id, baseOrder: state.baseOrder, order: next, tops: state.tops, heights: state.heights, gap: state.gap };
					});
				};
				/** 落点提交：把预览顺序写回待办列表；拖到列表外则保持原顺序。 */
				const dropTodo = (event) => {
					event.preventDefault();
					const state = dragRef.current;
					const order = state?.order ?? dragPreview?.order ?? null;
					if (order !== null) {
						const byId = new Map(todos.map((item) => [item.id, item]));
						const next = order.map((id) => byId.get(id)).filter((item) => item !== undefined);
						// 拖动只重排未完成条目；已完成条目整组固定在末尾。
						const merged = next.length === activeTodos.length ? next.concat(doneTodos) : [];
						// 顺序没有变化时不做无意义的落盘。
						const changed = state !== null && order.some((id, index) => id !== state.baseOrder[index]);
						if (changed && merged.length === todos.length) {
							setDragSettling(true);
							persist(merged);
							if (typeof window !== "undefined") {
								window.clearTimeout(settleTimerRef.current);
								settleTimerRef.current = window.setTimeout(() => setDragSettling(false), 0);
							}
						}
					}
					dragRef.current = null;
					setDragPreview(null);
				};
				// 卸载时清掉落盘后的过渡恢复计时器。
				react.useEffect(() => () => {
					if (typeof window !== "undefined") window.clearTimeout(settleTimerRef.current);
				}, []);
				// 有待办 → 标题右侧（折叠按钮左侧）展示 已完成/总数
				const doneCount = todos.filter((item) => item.done).length;
				const countText = todos.length === 0 ? undefined : `${doneCount}/${todos.length}`;
				// 清空已完成 → 二次确认弹窗
				let clearModal = null;
				if (clearOpen) {
					clearModal = react.createElement("div", {
						className: "hud-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("todoClearTitle"),
						onClick: () => setClearOpen(false),
						onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") setClearOpen(false); },
					},
						react.createElement("div", { className: "hud-modal-card hud-modal-card-sm", onClick: (event) => event.stopPropagation() },
							react.createElement("div", { className: "hud-modal-head" },
								react.createElement(Icon, { name: "trash-outline", size: 13 }),
								react.createElement("span", { className: "hud-modal-title" }, t("todoClearTitle")),
								react.createElement("button", { type: "button", className: "hud-modal-close", onClick: () => setClearOpen(false) }, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								react.createElement("div", { className: "hud-confirm-body" },
									react.createElement("div", { className: "hud-confirm-note" }, t("todoClearNote")),
									react.createElement("div", { className: "hud-confirm-actions" },
										react.createElement("button", { type: "button", className: "hud-settings-btn", "data-kind": "cancel", onClick: () => setClearOpen(false) }, t("todoCancel")),
										react.createElement("button", { type: "button", className: "hud-btn-danger", onClick: clearDone }, t("todoClearConfirm")))))));
				}
				// 拖动预览位移：按预览顺序与每行真实高度计算，松手前即可看到最终顺序。
				const dragOffsets = dragPreview === null ? null : previewOffsets(dragPreview.baseOrder, dragPreview.order, dragPreview.tops, dragPreview.heights, dragPreview.gap);
				// v0.19.2：已完成的待办统一后置并默认折叠；拖动只在「未完成」区段内重排。
				const doneView = splitCompleted(todos, (item) => item.done);
				const activeTodos = doneView.open;
				const doneTodos = doneView.completed;
				const renderTodos = doneExpanded ? activeTodos.concat(doneTodos) : activeTodos;
				const doneToggle = listMoreButton({
					expanded: doneExpanded,
					remaining: doneTodos.length,
					expandText: t("todoExpandDone"),
					onToggle: setDoneExpanded,
				});
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "todo",
						title: t("todoModule"),
						countText,
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						react.createElement("div", { className: "hud-todo-input-row" },
							react.createElement("input", {
								...IME_INPUT_PROPS,
								className: "hud-todo-input",
								value: draft,
								placeholder: t("todoPlaceholder"),
								onChange: (event) => setDraft(event.target.value),
								onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Enter") { event.preventDefault(); addTodo(); } },
							}),
							react.createElement("button", {
								type: "button",
								className: "hud-ic-btn",
								"data-kind": "confirm",
								"aria-label": t("todoConfirm"),
								title: t("todoConfirm"),
								disabled: draft.trim() === "",
								onClick: addTodo,
							}, react.createElement(Icon, { name: "plus", size: 14 })),
							react.createElement("button", {
								type: "button",
								className: "hud-ic-btn",
								"aria-label": t("todoClear"),
								title: t("todoClear"),
								disabled: doneCount === 0,
								onClick: () => setClearOpen(true),
							}, react.createElement(Icon, { name: "trash-outline", size: 14 }))),
						react.createElement("div", {
							className: "hud-todo-list",
							ref: listRef,
							"data-settling": dragSettling,
							onDragOver: dragOverList,
							onDrop: dropTodo,
						},
							renderTodos.map((item) => {
								if (item.id === editingId) {
									return react.createElement("div", {
										className: "hud-todo-item",
										key: item.id,
										style: dragOffsets === null || (dragOffsets[item.id] ?? 0) === 0 ? undefined : { transform: `translateY(${dragOffsets[item.id]}px)` },
									},
										react.createElement("input", {
											...IME_INPUT_PROPS,
											className: "hud-todo-edit",
											value: editingText,
											autoFocus: true,
											placeholder: t("todoPlaceholder"),
											onChange: (event) => setEditingText(event.target.value),
											onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Enter") { event.preventDefault(); commitEdit(); } },
										}),
										react.createElement("button", {
											type: "button",
											className: "hud-ic-btn",
											"data-kind": "cancel",
											"aria-label": t("todoCancel"),
											title: t("todoCancel"),
											onClick: () => setEditingId(null),
										}, react.createElement(Icon, { name: "close", size: 14 })),
										react.createElement("button", {
											type: "button",
											className: "hud-ic-btn",
											"data-kind": "confirm",
											"aria-label": t("todoConfirm"),
											title: t("todoConfirm"),
											onClick: commitEdit,
										}, react.createElement(Icon, { name: "check", size: 14 })));
								}
								return react.createElement("div", {
									className: "hud-todo-item",
									key: item.id,
									"data-done": item.done,
									"data-dragging": dragPreview !== null && dragPreview.id === item.id,
									style: dragOffsets === null || (dragOffsets[item.id] ?? 0) === 0 ? undefined : { transform: `translateY(${dragOffsets[item.id]}px)` },
								},
									// 已完成的待办位于折叠区，不提供拖动手柄。
									item.done ? null : react.createElement("button", {
										type: "button",
										className: "hud-todo-grip",
										"aria-label": t("todoDrag"),
										title: t("todoDrag"),
										draggable: true,
										onDragStart: (event) => startDrag(event, item),
										onDragEnd: endDrag,
									}, react.createElement(Icon, { name: "drag", size: 14 })),
									react.createElement("button", {
										type: "button",
										className: "hud-todo-check",
										"aria-label": t(item.done ? "todoMarkPending" : "todoMarkDone"),
										title: t(item.done ? "todoMarkPending" : "todoMarkDone"),
										onClick: () => toggleTodo(item.id),
									}, react.createElement(Icon, { name: item.done ? "check-lig" : "check-nor", size: 16 })),
									react.createElement("span", { className: "hud-todo-text" }, item.text),
									// v0.18.5：编辑/删除收进悬浮操作区，默认隐藏，悬浮或键盘聚焦该行时才出现。
									react.createElement("span", { className: "hud-todo-actions" },
										react.createElement("button", {
											type: "button",
											className: "hud-ic-btn",
											"aria-label": t("todoEdit"),
											title: t("todoEdit"),
											onClick: () => startEdit(item),
										}, react.createElement(Icon, { name: "edit", size: 14 })),
										react.createElement("button", {
											type: "button",
											className: "hud-ic-btn",
											"aria-label": t("todoDelete"),
											title: t("todoDelete"),
											onClick: () => removeTodo(item.id),
										}, react.createElement(Icon, { name: "trash", size: 14 }))));
							}),
							doneToggle)),
						clearModal);
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
				// v0.19.2：计划超过 3 条时默认只展示 3 条，与「产物」模块同一套折叠交互。
				const [expanded, setExpanded] = react.useState(false);
				const planView = previewListRows(props.plans, expanded);
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
						onKeyDown: (event) => { if (isImeComposing(event)) return; if (event.key === "Escape") setOpenId(null); },
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
							planView.rows.map((item) => {
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
							listMoreButton({
								expanded: planView.expanded,
								remaining: planView.remaining,
								expandText: interpolate(t("plansExpandRest"), { count: String(planView.remaining) }),
								onToggle: setExpanded,
							}),
							react.createElement("div", { className: "hud-git-summary" },
								interpolate(t("plansSummary"), {
									approved: props.plans.filter((item) => item.status === "approved").length,
									pending: props.plans.filter((item) => item.status === "pending").length,
									discarded: props.plans.filter((item) => item.status === "discarded").length,
								})))),
					modal);
			}

			// —— 「产物」模块（v0.19.1）：本会话所有轮次里、工作区内、指定格式的改动文件，
			//    按最后改动排序最多 10 个、默认先显示 3 个；点击在官方右侧栏打开文件内容 ——
						/** v0.19.2：产物 / 计划清单 / 子代理任务共用的折叠规则——默认先展示 3 条。 */
			const LIST_PREVIEW_COUNT = 3;

			/**
			 * 折叠列表的可见切片（纯函数，便于回归测试）。
			 * @param items 全部条目。
			 * @param expanded 是否已展开全部。
			 * @returns {{ rows: Array, remaining: number, expanded: boolean, total: number }}
			 */
			function previewListRows(items, expanded) {
				const list = Array.isArray(items) ? items : [];
				const remaining = Math.max(list.length - LIST_PREVIEW_COUNT, 0);
				const open = expanded === true || remaining === 0;
				return {
					rows: open ? list : list.slice(0, LIST_PREVIEW_COUNT),
					remaining,
					expanded: open,
					total: list.length,
				};
			}

			/**
			 * 按「已完成」拆分列表：未完成的保持原顺序在前，已完成的整组后置，
			 * 组内同样保持原顺序（先完成的排在前面，后完成的排在后面）。
			 * @param items 全部条目。
			 * @param isDone 判定条目是否已完成。
			 * @returns {{ open: Array, completed: Array, total: number }}
			 */
			function splitCompleted(items, isDone) {
				const list = Array.isArray(items) ? items : [];
				const open = [];
				const completed = [];
				for (const item of list) {
					if (isDone(item)) completed.push(item);
					else open.push(item);
				}
				return { open, completed, total: list.length };
			}

			/**
			 * 折叠列表的「展开其余 n 个 / 收起」按钮；没有隐藏条目时返回 null。
			 * @param options.expanded 当前是否展开。
			 * @param options.remaining 折叠时被隐藏的条数。
			 * @param options.expandText 展开文案（已带入计数）。
			 * @param options.onToggle 点击回调，参数是目标展开态。
			 */
			function listMoreButton(options) {
				if (options.remaining <= 0) return null;
				return react.createElement("button", {
					type: "button",
					className: "hud-list-more",
					onClick: () => options.onToggle(options.expanded === false),
				}, options.expanded ? t("listCollapse") : options.expandText);
			}

			// v0.20.0：产物文件行悬停提示的延迟（与 git 文件行一致：0.5 秒）。
			const OUTPUT_TIP_DELAY_MS = 500;

			function OutputsModule(props) {
				// hooks 必须在条件返回之前调用：文件数在 0 与非 0 之间来回切换时 hooks 数量不能变。
				const [expanded, setExpanded] = react.useState(false);
				// v0.20.0：文件行悬停 0.5s 的自定义提示（替代原生 title，位置跟随鼠标、不被模块重渲染打断）。
				const [tip, setTip] = react.useState(null);
				const tipTimerRef = react.useRef(null);
				const tipPosRef = react.useRef({ x: 0, y: 0 });
				react.useEffect(() => () => {
					if (tipTimerRef.current !== null) window.clearTimeout(tipTimerRef.current);
				}, []);
				react.useEffect(() => {
					if (tip === null) return undefined;
					// 滚动 / 窗口尺寸变化时收起：提示按鼠标位置固定，不跟随内容移动。
					const hide = () => {
						if (tipTimerRef.current !== null) {
							window.clearTimeout(tipTimerRef.current);
							tipTimerRef.current = null;
						}
						setTip(null);
					};
					window.addEventListener("scroll", hide, true);
					window.addEventListener("resize", hide);
					return () => {
						window.removeEventListener("scroll", hide, true);
						window.removeEventListener("resize", hide);
					};
				}, [tip]);
				const files = Array.isArray(props.files) ? props.files : [];
				const limit = Number.isSafeInteger(props.limit) && props.limit > 0 ? props.limit : 10;
				// v0.19.2：没有产物时整个模块不渲染（与子代理 / 任务 / 计划清单一致），有文件后才出现。
				// 旧 DSH 缺少 workspaceChanges 时同样按空处理，避免面板里常驻一条「不支持」提示。
				if (files.length === 0) return null;
				/** 收起悬停提示并取消尚未触发的计时器（离开行、点击、滚动时调用）。 */
				const cancelTip = () => {
					if (tipTimerRef.current !== null) {
						window.clearTimeout(tipTimerRef.current);
						tipTimerRef.current = null;
					}
					setTip(null);
				};
				/**
				 * 鼠标进入文件行：记录最后一次位置，0.5s 后在鼠标位置弹出提示。
				 * 位置在计时结束时才读取，避免用户移动鼠标后提示仍停在进入点。
				 */
				const scheduleTip = (event, file) => {
					tipPosRef.current = { x: event.clientX, y: event.clientY };
					if (tipTimerRef.current !== null) window.clearTimeout(tipTimerRef.current);
					if (tip !== null) setTip(null);
					tipTimerRef.current = window.setTimeout(() => {
						tipTimerRef.current = null;
						const { x, y } = tipPosRef.current;
						// v0.20.0：内容与 git 变更文件行的悬停提示一致——只显示完整相对路径。
						setTip({ text: file.path, ...fileHoverTipPlacement(x, y, window.innerWidth, window.innerHeight) });
					}, OUTPUT_TIP_DELAY_MS);
				};
				const view = previewListRows(files, expanded);
				const rows = view.rows.map((file) => {
					const label = file.display ?? file.path;
					const dir = typeof file.dir === "string" ? file.dir : "";
					return react.createElement("button", {
						type: "button",
						className: "hud-output-row",
						key: file.path,
						"aria-label": label,
						onMouseEnter: (event) => scheduleTip(event, file),
						onMouseMove: (event) => { tipPosRef.current = { x: event.clientX, y: event.clientY }; },
						onMouseLeave: cancelTip,
						onPointerDown: cancelTip,
						onClick: () => { cancelTip(); props.onOpen?.(file); },
					},
						react.createElement("span", { className: "hud-output-name" }, file.name ?? file.path),
						dir === "" ? null : react.createElement("span", { className: "hud-output-dir" }, dir));
				});
				// 折叠态：第 3 个文件下方给「展开其余 n 个文件」；展开态：最后一个文件下方给「收起」。
				const toggle = listMoreButton({
					expanded: view.expanded,
					remaining: view.remaining,
					expandText: interpolate(t("outputsExpandRest"), { count: String(view.remaining) }),
					onToggle: setExpanded,
				});
				// 悬停提示：与 git 变更文件行同一个提示框样式（.hud-file-tip），只显示完整相对路径；
				// portal 到 body，固定定位，不受面板 overflow 裁剪。
				const tipNode = tip === null ? null : react_dom.createPortal(
					react.createElement("div", {
						className: "hud-file-tip",
						role: "tooltip",
						style: { left: tip.left, top: tip.top, maxWidth: tip.maxWidth, ...(tip.below ? {} : { transform: "translateY(-100%)" }) },
					}, tip.text),
					document.body);
				return react.createElement("div", { className: "hud-section hud-output-section" },
					react.createElement(ModuleHead, {
						icon: "outputs",
						title: t("outputsModule"),
						countText: String(files.length),
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						rows,
						toggle,
						props.truncated === true
							? react.createElement("div", { className: "hud-output-hint" }, interpolate(t("outputsLimitHint"), { limit }))
							: null),
					tipNode);
			}

			// —— MCP 模块 ——
			function McpModule(props) {
				const [toggling, setToggling] = react.useState(null);
				const toggle = async (server, enabled) => {
					setToggling(server);
					// 先递增父级的启停序号：早于本次操作发出的 mcp 轮询即使晚到也会被丢弃，避免旧状态回滚开关。
					props.onMutate?.();
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
			const OPENCODE_GO_PAGE_URL = "https://opencode.ai/console/";
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
			const CODEX_FIVE_HOUR_SECONDS = 5 * 60 * 60;
			const CODEX_WEEKLY_SECONDS = 7 * 24 * 60 * 60;
			// 未订阅（免费）账号的 codex 额度只返回一个约 30 天的月度窗口，
			// 该窗口即「codex 免费额度」，与 5h / 周额度互斥展示。
			const CODEX_FREE_QUOTA_SECONDS = 30 * 24 * 60 * 60;
			const CODEX_WINDOW_TOLERANCE = 0.05;
			function codexDisplayablePercent(window) {
				return typeof window?.remainingPercent === "number"
					&& Number.isFinite(window.remainingPercent)
					&& window.remainingPercent >= 0
					&& window.remainingPercent <= 100
					? window.remainingPercent
					: null;
			}
			function codexWindowPercent(windows, expectedSeconds) {
				const candidates = (Array.isArray(windows) ? windows : [])
					.map((window) => ({
						window,
						remainingPercent: codexDisplayablePercent(window),
						distance: typeof window?.windowSeconds === "number" ? Math.abs(window.windowSeconds - expectedSeconds) : Number.POSITIVE_INFINITY,
					}))
					.filter((item) => typeof item.window?.windowSeconds === "number"
						&& Number.isFinite(item.window.windowSeconds)
						&& item.window.windowSeconds > 0
						&& Math.abs(item.window.windowSeconds - expectedSeconds) <= expectedSeconds * CODEX_WINDOW_TOLERANCE
						&& item.remainingPercent !== null)
					.sort((left, right) => left.distance - right.distance);
				return candidates[0]?.remainingPercent ?? null;
			}
			/** 免费额度剩余百分比：优先月度窗口；时长与预期不符时回退首个可用窗口（有数据就不显示 —）。 */
			function codexFreeQuotaPercent(windows) {
				const monthly = codexWindowPercent(windows, CODEX_FREE_QUOTA_SECONDS);
				if (monthly !== null) return monthly;
				const fallback = (Array.isArray(windows) ? windows : [])
					.map((window) => codexDisplayablePercent(window))
					.find((value) => value !== null);
				return fallback ?? null;
			}
			function selectCodexQuotaWindows(usage) {
				const limit = Array.isArray(usage?.rateLimits)
					? usage.rateLimits.find((item) => item !== null && typeof item === "object" && item.id === "codex")
					: null;
				const windows = limit?.windows;
				const fiveHour = codexWindowPercent(windows, CODEX_FIVE_HOUR_SECONDS);
				const weekly = codexWindowPercent(windows, CODEX_WEEKLY_SECONDS);
				// 订阅与否只能按窗口形状判定（订阅插件的 RPC 不暴露套餐字段）：
				// 出现 5h 或周窗口即视为订阅，否则按免费额度展示该额度窗口。
				const subscription = fiveHour !== null || weekly !== null;
				return {
					fiveHour,
					weekly,
					free: subscription ? null : codexFreeQuotaPercent(windows),
					mode: subscription ? "subscription" : "free",
				};
			}
			// gpt-reserve 额度：codex-subscription 把它作为 additional_rate_limits 返回，
			// 其 id 即 metered_feature、显示名取自 limit_name；仅在该额度真实存在时展示。
			// 真实数据形状（/wham/usage → additional_rate_limits → codex-subscription 转发）：
			//   { id: "base_model_inference", name: "gpt-reserve", windows: [{ windowSeconds, remainingPercent }] }
			// 即 gpt-reserve 是**额度名称**（limit_name），不是 id（id 是 metered_feature）。
			// 因此 id 与 name 两侧都要按归一化后匹配；写成精确串比较的另一原因是避免
			// 子串匹配（例如 "gpt-reserve-x" 不应被误判）。
			const CODEX_RESERVE_LIMIT_NAMES = new Set(["gpt-reserve", "gptreserve"]);
			function normalizedLimitName(value) {
				return typeof value === "string" ? value.trim().toLowerCase().replace(/[_\s-]+/g, "") : "";
			}
			function isCodexReserveLimit(limit) {
				if (limit === null || typeof limit !== "object") return false;
				return CODEX_RESERVE_LIMIT_NAMES.has(normalizedLimitName(limit.id))
					|| CODEX_RESERVE_LIMIT_NAMES.has(normalizedLimitName(limit.name));
			}
			/** 该额度的主窗口剩余百分比（窗口顺序即主/次窗口顺序，取第一项）。 */
			function codexReservePrimaryPercent(limit) {
				const windows = (Array.isArray(limit?.windows) ? limit.windows : [])
					.filter((window) => Number.isFinite(window?.remainingPercent) && window.remainingPercent >= 0 && window.remainingPercent <= 100);
				return windows[0]?.remainingPercent ?? null;
			}
			/** 附加展示名：name 与默认文案同义（如 "gpt-reserve"）时返回 null，避免行标题重复。 */
			function codexReserveDisplayName(limit) {
				if (typeof limit?.name !== "string") return null;
				const name = limit.name.trim();
				if (name === "") return null;
				return CODEX_RESERVE_LIMIT_NAMES.has(normalizedLimitName(name)) ? null : name;
			}
			/** 全部 gpt-reserve 额度（可能有多个：多账号/多计量维度）。 */
			function selectCodexReserveLimits(usage) {
				const limits = Array.isArray(usage?.rateLimits) ? usage.rateLimits : [];
				return limits.filter(isCodexReserveLimit).map((limit) => ({
					id: typeof limit.id === "string" && limit.id !== "" ? limit.id : "gpt-reserve",
					name: codexReserveDisplayName(limit),
					remainingPercent: codexReservePrimaryPercent(limit),
				}));
			}
			async function callCodexSubscription(rpc, endpoint, payload) {
				try {
					// Subscription 2.1+ uses the authenticated /api transport.
					return await rpc.call("/api", `codex-subscription/${endpoint}`, payload);
				} catch (error) {
					// Only a missing route warrants trying the pre-2.1 transport.
					// Authentication, network and upstream failures must not fall back.
					if (error?.message !== `transport failure for /api/codex-subscription/${endpoint}: HTTP 404`) throw error;
					return rpc.call("/codex-subscription", endpoint, payload);
				}
			}
			function fmtCodexPercent(value) {
				return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "—";
			}
			// 同一时刻仅执行一次跳转，避免快速重复点击把已打开的设置关掉。
			let settingsNavigation = null;
			/**
			 * v0.16.1：把按钮文字归一化后再匹配。
			 *
			 * 旧实现直接 `pattern.test(textContent.trim())`，而宿主会在按钮里渲染
			 * aria-hidden 的快捷键字形（如「设置⌥⌘,」）与装饰性空节点。此前靠
			 * 「先克隆再移除 aria-hidden」处理，但同名文案只要有一次没被清掉，
			 * 精确全匹配就失败——表现为点余额数值时等待超时并弹出
			 * 「无法打开账户设置」。这里统一做归一化：
			 *   1. 移除 aria-hidden 子树；
			 *   2. 去掉零宽字符、首尾空白，并折叠内部连续空白；
			 *   3. 移除常见的快捷键记号（⌥⌘⇧⌃ + 组合键尾部）。
			 * @param node 目标按钮/菜单项。
			 * @returns 归一化后的可比较文本。
			 */
			function normalizedControlText(node) {
				if (node === null || node === undefined) return "";
				const copy = node.cloneNode?.(true) ?? node;
				if (copy !== node) copy.querySelectorAll?.('[aria-hidden="true"]').forEach(hidden => hidden.remove());
				let text = copy.textContent ?? "";
				// 零宽字符与不换行空格会影响精确匹配。
				text = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ");
				// 快捷键记号（如 ⌥⌘, ⌘K）从尾部剥离。
				text = text.replace(/[\s]*[\u2318\u2325\u21E7\u2303][\u2318\u2325\u21E7\u2303A-Za-z0-9,.\s]*$/u, "");
				return text.replace(/\s+/g, " ").trim();
			}
			function openSettingsAccount(target) {
				if (settingsNavigation !== null) return settingsNavigation;
				settingsNavigation = (async () => {
					const findButton = (scope, pattern) => Array.from(scope?.querySelectorAll("button, [role=menuitem]") ?? [])
						.find(node => pattern.test(normalizedControlText(node))) ?? null;
					/**
					 * v0.16.1：在页面上**所有** [role="menu"] 中查找匹配项。
					 *
					 * 旧实现用 `document.querySelector('[role="menu"]')` 只取第一个菜单，
					 * 而 DSH 里会话右键菜单（置顶会话/重命名/分叉会话/复制 Session ID/归档会话）、
					 * 模型选择菜单、定时任务菜单都带 role="menu"。桌面端只要侧边栏会话菜单
					 * 恰好打开或残留，就会命中那个菜单，在里面找不到「设置」，
					 * 于是等到超时并报「无法打开账户设置 (settings-menu)」——
					 * 截图里同时出现的会话右键菜单正是这个误命中。
					 *
					 * 注意：必须定义在 openSettingsAccount 内部，才能访问上面的 findButton
					 * （曾放在函数外部导致 ReferenceError: findButton is not defined）。
					 * @param pattern 菜单项文案正则（已归一化后比较）。
					 * @returns 命中的菜单项按钮，或 null。
					 */
					const findMenuItemAnywhere = (pattern) => {
						for (const menu of Array.from(document.querySelectorAll('[role="menu"]'))) {
							const hit = findButton(menu, pattern);
							if (hit !== null) return hit;
						}
						return null;
					};
					const settingsDialog = () => document.querySelector('[data-shortcut-modal="settings"]')
						?? Array.from(document.querySelectorAll('[role="dialog"]')).find(node => findButton(node.querySelector("nav"), /^(通用设置|General|General settings)$/i) !== null) ?? null;
					// 按实际挂载状态等待；桌面菜单和设置分区不依赖固定的 140ms/260ms 延时。
					const waitFor = async (read, reason) => {
						for (let attempt = 0; attempt < 60; attempt += 1) {
							const value = read();
							if (value !== null && value !== undefined) return value;
							await new Promise(resolve => globalThis.setTimeout(resolve, 50));
						}
						// v0.16.1：把「卡在哪一步」带上，便于用户反馈时定位，
						// 而不是一律显示同一句无信息量的失败文案。
						throw new Error(`${t("settingsOpenFailed")} (${reason ?? "timeout"})`);
					};
					/** 可选等待：超时返回 null（用于「页签可能不存在」的场景，不把缺页签当失败）。 */
					const waitForOptional = async (read, attempts = 40) => {
						for (let attempt = 0; attempt < attempts; attempt += 1) {
							const value = read();
							if (value !== null && value !== undefined) return value;
							await new Promise(resolve => globalThis.setTimeout(resolve, 50));
						}
						return null;
					};
					/**
					 * v0.16.1：优先通过官方命令直接打开设置，完全绕开 DOM 菜单点击。
					 *
					 * 账号菜单 → 设置 这条路依赖三件事同时成立：账号按钮能被 aria-label 找到、
					 * 点击后菜单立刻挂载、菜单项文案能精确匹配。桌面端只要其中任一环节变化
					 * （会话右键菜单残留、账号按钮结构微调、宿主异步渲染延迟），就会卡在
					 * `settings-menu` 并弹「无法打开账户设置」。而设置页本身由官方
					 * `settings.open` 命令拥有，`ctx.shortcuts` 的注册表提供 invoke()
					 * （原生菜单选择也走它），调用它才是稳定入口。
					 *
					 * 该注册表属于宿主内部实现（公开类型里没有 invoke），因此：
					 *   - 只做能力探测，缺失时返回 false，继续走原来的菜单点击兜底；
					 *   - 已有任何模态框时不调用：settings.open 在 modal 非 settings 时会被
					 *     拦截，若硬传 null 又可能把设置叠到别的对话框上；
					 *   - invoke 是同步的，但设置面板由 React 异步提交，随后仍需等待 dialog。
					 * @returns 是否成功向宿主发出打开设置命令。
					 */
					const invokeSettingsCommand = () => {
						try {
							const service = typeof ctx !== "undefined" ? ctx.get?.("shortcuts") : undefined;
							const registry = service?.registry;
							if (registry === null || registry === undefined || typeof registry.invoke !== "function") return false;
							// 先确认 settings.open 已注册：旧版宿主的 shortcuts 服务可能没有该命令，
							// 此时直接 invoke 不会报错、只会静默失败，白白多等一个渲染周期。
							const catalog = service?.catalog?.getSnapshot?.();
							if (Array.isArray(catalog) && !catalog.some(row => row?.id === "settings.open")) return false;
							// 任何已打开的对话框（登录、审批等）都先让位，避免把设置开在其上。
							if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return false;
							registry.invoke("settings.open", { source: "menu", region: "page", modal: null, target: null });
							return true;
						} catch (error) {
							// 宿主升级后若移除该内部字段，静默降级到账号菜单路径即可。
							console.debug("[dsh-awesome-hud] settings.open shortcut unavailable:", error);
							return false;
						}
					};
					if (settingsDialog() === null && invokeSettingsCommand()) {
						// 命令已发出：等 React 提交设置面板（最多 2s），成功就不再碰菜单。
						await waitForOptional(settingsDialog, 40);
					}
					if (settingsDialog() === null) {
						// 新桌面端入口：账号菜单 → 设置；旧 Web 仍可通过 dialog 按钮进入。
						// v0.16.1：页面上可能同时存在其它菜单（会话右键菜单、模型选择等），
						// 必须遍历全部 [role="menu"] 找真正的账号菜单，不能只取第一个。
						let menuItem = findMenuItemAnywhere(/^(设置|Settings)$/i);
						if (menuItem === null) {
							const trigger = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
								.find(node => /账号|账户|account/i.test(node.getAttribute("aria-label") ?? ""));
							// v0.16.1：先关掉可能残留的其它菜单（如侧边栏会话右键菜单）。
							// 否则点开账号菜单后两个菜单并存，菜单项匹配与后续点击都可能落到错的那个上。
							if (document.querySelectorAll('[role="menu"]').length > 0) {
								document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
								await new Promise(resolve => globalThis.setTimeout(resolve, 80));
							}
							if (trigger !== undefined) trigger.click();
							else {
								// v0.16.1：旧 Web 的设置入口是一个 aria-haspopup="dialog" 的按钮，
								// 但页面上同类按钮很多（上下文用量、统计药丸等），不能取第一个。
								// 只认「设置/Settings」这个可访问名，避免点开无关浮层后干等超时。
								const legacy = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'))
									.find(node => /^(设置|Settings)$/i.test((node.getAttribute("aria-label") ?? "").trim())
										|| /^(设置|Settings)$/i.test(normalizedControlText(node))) ?? null;
								if (legacy === null) throw new Error(`${t("settingsOpenFailed")} (settings-trigger-missing)`);
								legacy.click();
							}
							menuItem = await waitFor(() => settingsDialog() ?? findMenuItemAnywhere(/^(设置|Settings)$/i), "settings-menu");
						}
						// v0.16.1：menuItem 可能为 null（账号菜单里没有「设置」项，例如
						// 桌面端未登录态或菜单项被裁剪）。旧实现直接 .click() 会抛
						// TypeError 并被外层 catch 转成「无法打开账户设置」，掩盖真因。
						if (settingsDialog() === null) {
							if (menuItem === null) throw new Error(`${t("settingsOpenFailed")} (settings-menu-missing)`);
							menuItem.click();
						}
					}
					const dialog = await waitFor(settingsDialog, "settings-dialog");
					// 账户页有两种来源：
					//   1) DSH 0.2.2+ 官方「账号与余额」（zh）/ Account（en）分区，dsh-account-usage
					//      把 deepseek / opencode go 页签嵌在官方页面底部（当前形态）；
					//   2) 官方页面不可用（未登录/旧版）时 dsh-account-usage 的兜底「账户」分区。
					// 两种标题都要能命中；分区间用精确全匹配，避免误选「账号菜单」等其它分区。
					const sectionPattern = target === "codex"
						? /^codex(?:\s*(?:订阅|subscription))?$/i
						: /^(账号与余额|账户|account(?:\s*&\s*balance)?)$/i;
					const section = await waitFor(() => findButton(dialog.querySelector("nav"), sectionPattern), "account-section");
					// v0.16.1：若该分区已经是激活态（例如用户先前就停在账号页），
					// 重复点击可能触发宿主的「关闭/切换」动画而把对话框关掉，
					// 表现为跳出「无法打开账户设置」。此时直接跳过点击。
					if (section.getAttribute?.("aria-current") !== "true") section.click();
					if (target !== "codex") {
						// deepseek / opencode go 页签由 dsh-account-usage 注入；未安装/未启用时页面只有官方账户内容，
						// 此时仍应停留在「账号与余额」（DeepSeek 余额数字的点击依赖该行为），不要因找不到页签而报错。
						const tab = await waitForOptional(() => findButton(dialog, target === "opencode" ? /^opencode\s*go$/i : /^deepseek$/i));
						tab?.click();
					}
				})().catch((error) => {
					// v0.16.1：把真实失败原因带出来。旧实现用 `.catch(() => toast(...))`
					// 把异常整个丢弃，用户只看到一句没有信息量的「无法打开账户设置」，
					// 排查时无从下手——上一版加的「卡在哪一步」也因此完全没被展示过。
					// 现在：toast 显示原因，同时写一条 console.warn 便于抓现场。
					const detail = error instanceof Error ? error.message : String(error);
					console.warn("[dsh-awesome-hud] openSettingsAccount failed:", error);
					toast(detail === "" || detail === t("settingsOpenFailed") ? t("settingsOpenFailed") : detail);
				}).finally(() => { settingsNavigation = null; });
				return settingsNavigation;
			}
			function BalanceModule(props) {
				const balance = props.balance;
				const opencode = props.opencode;
				const codex = props.codex;
				const dsOk = balance !== null && balance.available === true && balance.error === null;
				const ocUsable = opencode !== null && opencode.available === true;
				const codexUsable = codex !== null && codex.available === true;
				const display = props.display ?? null;
				const showDs = display === null || display.deepseek !== false;
				const showOc = display === null || display.opencode !== false;
				const showCodex = display === null || display.codex !== false;
				const jumpDeepseek = () => { window.open(DEEPSEEK_PLATFORM_URL, "_blank", "noopener"); setJumpOpen(false); };
				const jumpOpencode = () => { window.open(OPENCODE_GO_PAGE_URL, "_blank", "noopener"); setJumpOpen(false); };
				const [jumpOpen, setJumpOpen] = react.useState(false);
				const jumpBtnRef = react.useRef(null);
				// DeepSeek 余额 = 充值余额 + 赠送余额（仅 deepseek 可用时展示该行）
				const total = (balance?.data?.toppedUp ?? 0) + (balance?.data?.granted ?? 0);
				const oc = ocUsable ? opencode.usage : null;
				const codexQuota = codexUsable ? codex.usage : null;
				// 未订阅（免费）账号只展示「codex 免费额度」单行；订阅账号展示 5h / 周两行，两者互斥
				const codexFreeMode = codexQuota?.mode === "free";
				// gpt-reserve：codex-subscription 返回该额度时才渲染（样式与 5h/周额度一致）
				const codexReserve = codexUsable ? selectCodexReserveLimits(codex.usage) : [];
				// v0.18.2：「HUD 设置 → 用量设置」可关闭「跳转」按钮；关闭后按钮与其菜单都不渲染。
				const showJump = display === null || display.showJump !== false;
				const jumpBtn = showJump && (dsOk || ocUsable)
					? react.createElement("button", {
						type: "button",
						ref: jumpBtnRef,
						className: "hud-btn-small hud-git-btn",
						onClick: (event) => { event.stopPropagation(); setJumpOpen((v) => !v); },
					}, t("balanceJump"))
					: null;
				let jumpMenu = null;
				if (jumpOpen && showJump) {
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
						// DeepSeek 余额行恒展示（无数据时显示 —）：数据可来自 dsh-account-usage 或官方账户兜底；
						// 点击始终打开「设置 → 账号与余额」，即使没有 dsh-account-usage 注入的页签。
						showDs
							? react.createElement("div", { className: "hud-row hud-usage-row" },
								react.createElement(Icon, { name: "deepseek" }), react.createElement("span", { className: "hud-row-label" }, t("balanceTotal")),
								react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenDeepseek"), onClick: () => openSettingsAccount("deepseek") }, dsOk ? fmtBalanceMoney(total, balance.data?.currency) : "—"))
							: null,
						showDs && !dsOk && typeof balance?.error === "string" && balance.error !== ""
							? react.createElement("div", { className: "hud-git-summary" }, balance.error)
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
							: null,
						codexUsable && showCodex
							? react.createElement(react.Fragment, null,
								codexFreeMode
									? react.createElement("div", { className: "hud-row hud-usage-row" },
										react.createElement(Icon, { name: "ChatGPT" }), react.createElement("span", { className: "hud-row-label" }, t("codexFreeQuota")),
										react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(codexQuota?.free)))
									: react.createElement(react.Fragment, null,
										react.createElement("div", { className: "hud-row hud-usage-row" },
											react.createElement(Icon, { name: "ChatGPT" }), react.createElement("span", { className: "hud-row-label" }, t("codexFiveHour")),
											react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(codexQuota?.fiveHour))),
										react.createElement("div", { className: "hud-row hud-usage-row" },
											react.createElement(Icon, { name: "ChatGPT" }), react.createElement("span", { className: "hud-row-label" }, t("codexWeekly")),
											react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(codexQuota?.weekly)))),
								codexReserve.map((limit, index) => react.createElement("div", { className: "hud-row hud-usage-row", key: `${limit.id}-${index}` },
									react.createElement(Icon, { name: "ChatGPT" }),
									react.createElement("span", { className: "hud-row-label" }, limit.name === null
										? t("codexReserve")
										: interpolate(t("codexReserveNamed"), { name: limit.name })),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(limit.remainingPercent)))))
							: null,
						!dsOk && !ocUsable && !codexUsable
							? react.createElement("div", { className: "hud-git-summary" }, t("usageEmptyHint"))
							: null),
					jumpMenu);
			}

			function loadStoredFolds() {
				const fallback = { context: false, git: false, outputs: false, subagents: false, tasks: false, mcp: false, usage: false, plans: false, note: false, todo: false }; // 默认均展开
				try {
					const raw = globalThis.localStorage?.getItem(FOLDS_STORAGE_KEY);
					if (typeof raw === "string" && raw !== "") {
						const parsed = JSON.parse(raw);
						if (parsed !== null && typeof parsed === "object") {
							return {
								context: typeof parsed.context === "boolean" ? parsed.context : fallback.context,
								git: typeof parsed.git === "boolean" ? parsed.git : fallback.git,
								outputs: typeof parsed.outputs === "boolean" ? parsed.outputs : fallback.outputs,
								subagents: typeof parsed.subagents === "boolean" ? parsed.subagents : fallback.subagents,
								tasks: typeof parsed.tasks === "boolean" ? parsed.tasks : fallback.tasks,
								mcp: typeof parsed.mcp === "boolean" ? parsed.mcp : fallback.mcp,
								usage: typeof parsed.usage === "boolean" ? parsed.usage : fallback.usage,
								plans: typeof parsed.plans === "boolean" ? parsed.plans : fallback.plans,
								note: typeof parsed.note === "boolean" ? parsed.note : fallback.note,
								todo: typeof parsed.todo === "boolean" ? parsed.todo : fallback.todo,
							};
						}
					}
				} catch { /* 损坏数据回退默认 */ }
				return fallback;
			}

			// 跨面板卸载保留成功快照；账号按全局、Git 按目录、会话数据按会话隔离。
			const moduleSnapshots = new Map();
			function useModuleSnapshot(key, fallback) {
				const [local, setLocal] = react.useState(() => ({ key, value: moduleSnapshots.get(key) ?? fallback }));
				const setValue = react.useCallback((update) => {
					const previous = moduleSnapshots.get(key) ?? fallback;
					const value = typeof update === "function" ? update(previous) : update;
					moduleSnapshots.delete(key);
					moduleSnapshots.set(key, value);
					if (moduleSnapshots.size > 200) moduleSnapshots.delete(moduleSnapshots.keys().next().value);
					setLocal({ key, value });
				}, [key]);
				return [local.key === key ? local.value : (moduleSnapshots.get(key) ?? fallback), setValue];
			}
			// 同一路轮询串行执行，避免慢请求堆积和旧快照晚到覆盖新快照。
			function singleFlight(refresh) {
				let busy = false;
				return async () => {
					if (busy) return;
					busy = true;
					try { await refresh(); } finally { busy = false; }
				};
			}

			/**
			 * v0.20.0：新建会话页「顶部 chrome 行」的下沿（纯函数）。
			 * 该页没有会话页眉，右上角只有一行固定控制（插件自己的悬浮「HUD面板」入口与右侧边栏按钮等），
			 * 它们都在 `HUD_FLOAT_INSET` 处、高 `HUD_FLOAT_SLOT_SIZE`。边栏样式要从这一行的下沿起算，
			 * 否则会沿用卡片样式的 52px 基线、在面板上方留下一条空隙。
			 * @param chromeTop Windows 原生标题栏占用的高度（其它平台为 0）。
			 */
			function hudChromeRowBottom(chromeTop) {
				return HUD_FLOAT_INSET + HUD_FLOAT_SLOT_SIZE + chromeTop;
			}
			/**
			 * v0.20.0：面板顶部位置（纯函数，便于单测与两种样式对照）。
			 * 卡片样式 = 页眉下沿 + 8px 间距（没有页眉时用 52px 基线，维持既有悬浮卡片位置）；
			 * 边栏样式 = 页眉下沿（不留间距）；没有页眉（新建会话页）时从顶部 chrome 行下沿起，做到通高无空隙。
			 * @param minimumTop 卡片样式的最小顶部（新建会话页基线）。
			 * @param headerBottom 会话页眉下沿；undefined/非有限数表示没有页眉。
			 * @param style 面板样式（"card" | "sidebar"）。
			 * @param chromeBottom 顶部 chrome 行下沿（边栏样式在没有页眉时使用）。
			 */
			function hudPanelTop(minimumTop, headerBottom, style, chromeBottom = minimumTop) {
				const hasHeader = typeof headerBottom === "number" && Number.isFinite(headerBottom);
				if (style === "sidebar") {
					const base = hasHeader ? headerBottom : chromeBottom;
					return Number.isFinite(base) ? Math.max(0, Math.round(base)) : minimumTop;
				}
				return hasHeader ? Math.max(minimumTop, Math.round(headerBottom + 8)) : minimumTop;
			}
			/**
			 * v0.20.0：面板左侧锚点（纯函数）。
			 * 卡片样式与会话区左缘留 8px；边栏样式直接贴会话区左缘，分隔线画在朝向正文的一侧。
			 * @param anchorLeft 未让位时的会话区左缘。
			 * @param style 面板样式（"card" | "sidebar"）。
			 * @param gap 卡片样式的侧距（默认 8px）。
			 */
			function hudPanelLeft(anchorLeft, style, gap = HUD_PANEL_GAP) {
				return Math.max(0, style === "sidebar" ? anchorLeft : anchorLeft + gap);
			}

			// —— 面板主体 ——
			function HudPanel({ useSessionPendingInteraction = useNoPendingInteraction }) {
				const sessionsService = ctx.get("sessions");
				const sessionsStore = sessionsService?.list;
				const state = useSnapshot(sessionsStore, (s) => s, null);				const binding = useSnapshot(ctx.uiSession?.adapter?.current, (s) => s, null);
				const workspacesStore = ctx.get("workspaces")?.list;
				const workspaceItems = useSnapshot(workspacesStore, (s) => s.items, []);
				// v0.18.1：会话置顶状态（宿主权威置顶集，决定菜单文案与名称右侧图钉）
				const pinnedSessionIds = useSnapshot(workspacesStore, (s) => s.pinnedSessionIds, []);
				// v0.18.1：宿主原生打开能力（决定「在 Finder 中显示」可用性与文案）
				const [hostDesktop, setHostDesktop] = react.useState(() => ({ available: false, fileManager: null }));
				react.useEffect(() => {
					let alive = true;
					readHostDesktop().then((info) => { if (alive) setHostDesktop(info); });
					return () => { alive = false; };
				}, []);
				const current = activeSessionId(binding, state);
				const summary = current === undefined ? undefined : state?.byId?.[current];
				const pending = useSessionPendingInteraction((snapshot) =>
					current === undefined ? undefined : snapshot?.get?.(current)
				);
				const [modules, usageDisp, updateSettings, moduleOrder, contextSettings, panelSettings, noteSettings] = useHudModules();
				// v0.18.2：面板侧位（宿主设置优先；首帧/设置未就绪时用模块级缓存）。
				const panelSide = panelSettings !== null && panelSettings !== undefined && panelSettings.side !== undefined
					? (panelSettings.side === "left" ? "left" : "right")
					: getPanelSide();
				// v0.20.0：面板样式（card 圆角卡片 / sidebar 通高贴边边栏）；未知值回退 card。
				const panelStyle = panelSettings !== null && panelSettings !== undefined && PANEL_STYLES.includes(panelSettings.style)
					? panelSettings.style
					: getPanelStyle();
				// 新建会话页（无会话/空白会话）：面板无会话数据源，且便笺/待办改由工作区代理会话驱动
				const newSessionPage = isNewSessionPage(state, current);
				// 目标工作区：工作区级存储键 + git 模块与便笺「发送到对话」的代理会话
				const target = react.useMemo(() => resolveTargetWorkspace(state, workspaceItems, current), [state, workspaceItems, current]);
				const moduleSessionId = current ?? target.gitSessionId ?? "";
				const gitKey = `git:${summary?.cwd ?? target.path ?? moduleSessionId}`;
				const [git, setGit] = useModuleSnapshot(gitKey, null);
				const gitRevision = react.useRef(0);
				// 启停序号：每次点击 MCP 开关递增，用于丢弃切换前发出的旧轮询响应（防止开关回滚）。
				const mcpMutation = react.useRef(0);
				const [subagents, setSubagents] = useModuleSnapshot(`subagents:${current ?? ""}`, []);
				const [mcp, setMcp] = useModuleSnapshot("mcp", null);
				const [plans, setPlans] = useModuleSnapshot(`plans:${current ?? ""}`, []);
				// v0.19.1：「产物」模块按会话保存快照（切会话重新拉取，避免显示上一会话的文件）
				const [outputs, setOutputs] = useModuleSnapshot(`outputs:${current ?? ""}`, null);
				// 余额模块：调 dsh-account-usage 同源路由（其 host 端有 30s 缓存）；
				// —— deepseek / opencode go 各自独立可用：
				//    deepseek：ok → 有数据；no-token → 未配置；404 → 插件未装。
				//    opencode：ok + keySource → 已配置（订阅中）；no-key → 未配置；
				//    unauthorized → 未订阅/订阅到期；其余失败 → 视为不可用。
				// 模块恒定可见（DeepSeek 行无数据时显示 —）；OpenCode Go / Codex 行按数据可用性渲染。
				// 余额来源：dsh-account-usage 路由 → 失败时回退到 host 的官方 deepseekAccount。
				// 刷新规则与 dsh-account-usage 一致：面板打开时立即 + 每 60s 轮询。
				const [balance, setBalance] = useModuleSnapshot("balance", null);
				const [opencode, setOpencode] = useModuleSnapshot("opencode", null);
				const [codex, setCodex] = useModuleSnapshot("codex", null);
				react.useEffect(() => {
					let alive = true;
					/** 官方账户平台请求头需要的客户端标识（版本取自页面 boot manifest）。 */
					const clientMetadata = () => {
						let version = "";
						try { version = typeof globalThis.__DSH_BOOT__?.release?.version === "string" ? globalThis.__DSH_BOOT__.release.version : ""; } catch { /* 非浏览器环境无 boot manifest */ }
						let locale = "zh-CN";
						try { locale = ctx.locale?.getSnapshot?.().active ?? locale; } catch { /* 语言服务不可用时用默认 */ }
						return { version, locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
					};
					/** 未安装/未启用 dsh-account-usage 时，用 HUD host 的官方 deepseekAccount 余额兜底。 */
					const readHostAccountBalance = async () => {
						try {
							const body = await call("usage/account", clientMetadata());
							return body !== null && body.ok === true ? body : null;
						} catch { return null; }
					};
					const refreshBalance = async () => {
						let response;
						try {
							response = await fetch(`${hostBase()}${ACCOUNT_SUMMARY_URL}`);
						} catch {
							// 暂时请求失败时保留上次快照。
							return;
						}
						let body = null;
						if (response.status !== 404) {
							try { body = await response.json(); } catch { body = null; }
						}
						if (!alive) return;
						if (body !== null && body.ok === true) {
							setBalance({ available: true, data: body.balance ?? null, error: null });
							return;
						}
						// 无插件路由（404）、未配置 token 或路由失败：改用官方账户服务兜底，
						// 这样未安装 dsh-account-usage 时「用量」模块仍能显示 DeepSeek 余额。
						const hostBalance = await readHostAccountBalance();
						if (!alive) return;
						if (hostBalance !== null && hostBalance.available === true) {
							setBalance({ available: true, data: { toppedUp: hostBalance.toppedUp ?? null, granted: hostBalance.granted ?? null, currency: hostBalance.currency ?? null }, error: null });
							return;
						}
						if (body !== null && body.code === "no-token") {
							// 插件已装但未配置 DEEPSEEK_PLATFORM_TOKEN
							setBalance({ available: false, data: null, error: null });
						} else if (response.status === 404) {
							setBalance({ available: false, data: null, error: null });
						} else {
							setBalance(previous => ({ available: previous?.available === true, data: previous?.data ?? null, error: (body !== null && typeof body.message === "string" && body.message !== "") ? body.message : t("balanceLoadFailed") }));
						}
					};
					const refreshOpencode = async () => {
						let response;
						try {
							response = await fetch(`${hostBase()}${ACCOUNT_OPENCODE_URL}`);
						} catch {
							// 暂时请求失败时保留上次快照。
							return;
						}
						if (response.status === 404) { // 未安装 dsh-account-usage
							if (alive) setOpencode({ available: false, missing: true, usage: null });
							return;
						}
						let body = null;
						try { body = await response.json(); } catch { body = null; }
						if (!alive) return;
						// ok + keySource：已配置且订阅有效；no-key/unauthorized/其他失败 → 不可用
						const usable = body !== null && body.ok === true
							&& typeof body.keySource === "string" && body.keySource !== "";
						if (usable) setOpencode({ available: true, usage: body.usage ?? null });
						else if (body?.code === "no-key" || body?.code === "unauthorized") setOpencode({ available: false, missing: false, usage: null });
					};
					const pollBalance = singleFlight(refreshBalance);
					const pollOpencode = singleFlight(refreshOpencode);
					pollBalance(); pollOpencode();
					const timer = window.setInterval(() => { pollBalance(); pollOpencode(); }, 60000);
					return () => { alive = false; window.clearInterval(timer); };
				}, []);
				react.useEffect(() => {
					let alive = true;
					// 降级时保留上一次的展示模式（订阅 / 免费）：订阅账号请求暂时失败仍显示
					// 5h / 周两行，只把数值清空为 —，不会误切换成「codex 免费额度」行。
					const emptyQuota = (mode = null) => ({ fiveHour: null, weekly: null, free: null, mode });
					const setDegradedOrUnavailable = () => {
						if (!alive) return;
						setCodex((previous) => previous?.available === true
							? { available: true, usage: emptyQuota(previous.usage?.mode ?? null), degraded: true }
							: { available: false, usage: null });
					};
					const refreshCodex = async () => {
						const rpc = ctx.get("connection")?.rpc;
						if (rpc === undefined || typeof rpc.call !== "function") {
							if (alive) setCodex({ available: false, usage: null });
							return;
						}
						let status;
						try {
							status = await callCodexSubscription(rpc, "status", {});
						} catch {
							setDegradedOrUnavailable();
							return;
						}
						if (status?.ok !== true || status.value?.authenticated !== true) {
							if (alive) setCodex({ available: false, usage: null });
							return;
						}
						try {
							const response = await callCodexSubscription(rpc, "usage", { force: false });
							if (response?.ok !== true) throw new Error("Codex usage unavailable");
							if (alive) setCodex({ available: true, usage: {
								...selectCodexQuotaWindows(response.value),
								// Keep additional limits for the optional reserve rows; the
								// standard window projection alone discards this information.
								rateLimits: Array.isArray(response.value?.rateLimits) ? response.value.rateLimits : [],
							}, degraded: false });
						} catch {
							setDegradedOrUnavailable();
						}
					};
					const pollCodex = singleFlight(refreshCodex);
					pollCodex();
					const timer = window.setInterval(pollCodex, 60000);
					return () => { alive = false; window.clearInterval(timer); };
				}, []);
				const [folds, setFolds] = react.useState(loadStoredFolds);
				// 折叠/展开状态持久化：变更即写 localStorage，刷新后保持
				react.useEffect(() => {
					try { globalThis.localStorage?.setItem(FOLDS_STORAGE_KEY, JSON.stringify(folds)); } catch { /* 存储不可用仅内存 */ }
				}, [folds]);
				// v0.20.0：首帧顶部按样式起算——边栏样式从顶部 chrome 行下沿起（新建会话页才会用到），
				// 卡片样式仍用 52px 基线；有页眉的会话页由几何 effect 覆盖成页眉下沿。
				const [top, setTop] = react.useState(() => (panelStyle === "sidebar"
					? hudChromeRowBottom(hudChromeTop())
					: HUD_NEW_SESSION_TOP + hudChromeTop()));
				const [limitH, setLimitH] = react.useState(null); // 高度上限（≤ 视口内，留 8px 底部边距）
				// v0.18.2：左侧面板的水平锚点（会话区左缘 + 8px，由几何 effect 测量并缓存）。
				const [left, setLeft] = react.useState(() => lastPanelLeft);
				const bodyRef = react.useRef(null);
				// 布局推挤：可见时写自有变量；卸载（收起/侧栏展开）→ 归零，同一提交内完成。
				useLayoutEffect(() => {
					document.documentElement.style.setProperty("--dsh-awesome-hud-width", `${PANEL_WIDTH}px`);
					return () => document.documentElement.style.setProperty("--dsh-awesome-hud-width", "0px");
				}, []);

				// 面板定位：顶部 = 会话头部（header 元素）底部 + 8px；
				// 高度上限 = 输入框底部 - 面板顶（面板撑满时底部与输入框底部平齐）。
				// rc.1 的标题栏与正文位于同一个会话根节点。HUD 仅收窄标题栏下方的
				// 正文容器，并同步覆盖其内容宽度变量，避免移动宿主标题栏操作按钮。
				// 侧栏展开时面板会卸载，这里用 layout effect 保证留白在同一次提交内清除。
				useLayoutEffect(() => {
					const headerEl = document.querySelector("[data-conversation-header-corner]")?.closest("header")
						?? document.querySelector('[data-slot="conversation.session.header"]')?.closest("header")
						?? null;
					const composerEl = document.querySelector('[data-slot="conversation.composer.bar"]')
						?? document.querySelector('[data-slot="conversation.composer"]');
					const sessionHost = document.querySelector('[data-slot="conversation.session"]');
					// 新建会话页没有 conversation.session 宿主（无会话时不渲染该 slot），
					// 改由会话滚动容器反查根节点，保证该页同样能定位正文并左移让位。
					const sessionRoot = sessionHost?.closest("[data-phase]") ?? null;
					const scrollEl = sessionRoot?.querySelector("[data-conversation-scroll]")
						?? document.querySelector("[data-conversation-scroll]");
					const conversationRoot = sessionRoot ?? scrollEl?.closest("[data-phase]") ?? null;
					// v0.16.1：不再用 parentElement（DSH 0.2.2-rc.2 在滚动容器与正文容器之间插入了包装层）。
					const conversationBody = resolveConversationBody(scrollEl);
					// v0.18.2：本次挂载的让位方向（面板侧位变化会重建这个 effect，见依赖数组）。
					const pushSide = panelSide;
					// v0.20.0：本次挂载的面板样式（样式变化同样重建这个 effect）——
					//   边栏样式下不再把滚动容器向窗口右缘补回：滚动条停在内容区右缘、紧贴分隔线。
					const pushStyle = panelStyle;
					// v0.15.10：原值来自模块级 WeakMap（只记录首次改写前的状态），
					// 不再读「挂载瞬间的当前值」，避免把插件自己写的值当成原值。
					const savedConversationBodyStyles = INLINE_PUSH_PROPS.map((property) => rememberInlineOriginal(conversationBody, property));
					/** 本次挂载真正写过的属性值：节点 → 属性 → 写入值，卸载时据此判断归属。 */
					const pushWrites = new Map();
					const rememberWrite = (target, property, value) => {
						if (target === null) return;
						let writes = pushWrites.get(target);
						if (writes === undefined) {
							writes = new Map();
							pushWrites.set(target, writes);
						}
						writes.set(property, value);
					};
					const turnNavStyles = new Map();
					const turnNavDisplayStyles = new Map();
					const turnNavSlotStyles = new Map();
					const rememberStyle = (styles, node, property) => {
						if (styles.has(node)) return;
						styles.set(node, {
							property,
							value: node.style.getPropertyValue(property),
							priority: node.style.getPropertyPriority(property),
						});
					};
					const restoreStyles = (styles) => {
						for (const [node, saved] of styles) {
							if (saved.value === "") node.style.removeProperty(saved.property);
							else node.style.setProperty(saved.property, saved.value, saved.priority);
						}
						styles.clear();
					};
					const restoreTurnNavigation = () => {
						restoreStyles(turnNavStyles);
						restoreStyles(turnNavDisplayStyles);
						restoreStyles(turnNavSlotStyles);
					};
					const syncTurnNavigation = () => {
						restoreTurnNavigation();
						if (conversationRoot === null || conversationBody === null || conversationBody.getBoundingClientRect().width < TURN_NAVIGATION_MIN_COLUMN_WIDTH) return;
						const bodyRight = conversationBody.getBoundingClientRect().right;
						for (const nav of conversationRoot.querySelectorAll('nav[aria-label="轮次导航"], nav[aria-label="Turn navigation"]')) {
							const slot = nav.parentElement;
							if (slot === null) continue;
							rememberStyle(turnNavStyles, nav, "right");
							rememberStyle(turnNavDisplayStyles, nav, "display");
							rememberStyle(turnNavSlotStyles, slot, "display");
							slot.style.setProperty("display", "block");
							// 宿主在容器宽度 ≤900px 时隐藏导航；HUD 可用宽度 ≥720px 时保持可见。
							nav.style.setProperty("display", "block");
							nav.style.setProperty("right", `${TURN_NAVIGATION_RIGHT_GAP}px`);
							// 宿主导航的定位容器可能仍占满整页；按实际右缘补足偏移，避开 HUD。
							const overflow = nav.getBoundingClientRect().right - (bodyRight - TURN_NAVIGATION_RIGHT_GAP);
							if (overflow > 0) nav.style.setProperty("right", `${TURN_NAVIGATION_RIGHT_GAP + Math.ceil(overflow)}px`);
						}
					};
					const publishConversationBodyWidth = () => {
						if (conversationBody === null) return;
						const columnWidth = conversationBody.getBoundingClientRect().width;
						conversationBody.style.setProperty("--dsh-awesome-hud-column-width", `${Math.round(columnWidth)}px`);
						conversationBody.style.setProperty("--dsh-chat-content-width", HUD_CONTENT_WIDTH);
						conversationBody.style.setProperty("--dsh-composer-card-max-width", "calc(var(--dsh-chat-content-width) + 32px)");
						rememberWrite(conversationBody, "--dsh-awesome-hud-column-width", `${Math.round(columnWidth)}px`);
						rememberWrite(conversationBody, "--dsh-chat-content-width", HUD_CONTENT_WIDTH);
						rememberWrite(conversationBody, "--dsh-composer-card-max-width", "calc(var(--dsh-chat-content-width) + 32px)");
					};
					/**
					 * v0.15.10：宿主会重建会话正文节点（切会话、侧栏开合、整页重渲染），
					 * 旧节点上的预留随节点一起消失，新节点却没人管——旧实现只在挂载时
					 * 查询一次并把它关在闭包里，于是「测一次就再也不算」。这里给出重新反查
					 * 与补写入口，代价只有一次 isConnected 判断。
					 */
					let activeConversationBody = conversationBody;
					let activeScrollEl = scrollEl;
					let activeSessionRoot = sessionRoot;
					/** 重新反查「正文容器 + 滚动容器」：宿主重建节点后两者都要补写。 */
					const resolvePushTargets = () => {
						if (activeScrollEl === null || !activeScrollEl.isConnected) {
							const liveRoot = activeSessionRoot?.isConnected ? activeSessionRoot : null;
							activeScrollEl = liveRoot?.querySelector("[data-conversation-scroll]")
								?? document.querySelector("[data-conversation-scroll]")
								?? null;
						}
						// v0.16.1：节点重建后同样按「最近的 data-conversation-content」反查。
						activeConversationBody = resolveConversationBody(activeScrollEl);
						return { body: activeConversationBody, scroll: activeScrollEl };
					};
					const applyPushTo = (target, side = "right") => {
						if (target === null) return;
						// 先登记原值再改写：反过来会把我们自己写进去的 300px 记成原值。
						for (const property of INLINE_PUSH_PROPS) rememberInlineOriginal(target, property);
						const margin = `${PANEL_WIDTH}px`;
						// v0.18.2：面板在左侧时从左边收窄正文，右侧保持原有 margin-right 行为。
						const prop = side === "left" ? "margin-left" : "margin-right";
						if (target.style.getPropertyValue(prop) !== margin) {
							target.style.setProperty(prop, margin);
						}
						// 先让 margin 生效，再测列宽——否则测到的是「还没让位」的宽度。
						const columnWidth = Math.round(target.getBoundingClientRect().width);
						target.style.setProperty("--dsh-awesome-hud-column-width", `${columnWidth}px`);
						target.style.setProperty("--dsh-chat-content-width", HUD_CONTENT_WIDTH);
						target.style.setProperty("--dsh-composer-card-max-width", "calc(var(--dsh-chat-content-width) + 32px)");
						rememberWrite(target, prop, margin);
						rememberWrite(target, "--dsh-awesome-hud-column-width", `${columnWidth}px`);
						rememberWrite(target, "--dsh-chat-content-width", HUD_CONTENT_WIDTH);
						rememberWrite(target, "--dsh-composer-card-max-width", "calc(var(--dsh-chat-content-width) + 32px)");
					};
					/** 把滚动容器「对侧补回 + 等量 padding」写入并登记（节点重建后同样适用）。 */
					const applyScrollPushTo = (target, side = "right") => {
						if (target === null) return;
						// v0.20.0：边栏样式下滚动条停在内容区右缘（紧贴分隔线），不做「补回窗口右缘」；
						// 切回卡片样式时本 effect 会重建并重新写入，卸载清理会先还原旧值。
						if (pushStyle === "sidebar") return;
						for (const [property, value] of pushScrollContainer(target, side)) rememberWrite(target, property, value);
					};
					/**
					 * v0.15.16：输入框浮层视图（轨迹 / 统计）的座位收窄，含「切回常规对话视图时撤销」。
					 *
					 * 轨迹 ↔ 对话 只是切换视图，座位节点通常被复用：只在「有浮层」时写、
					 * 却不在「浮层消失」时撤销，会让常规对话页的 sticky 座位额外窄 300px（双重收窄）。
					 * 这里每次对账都按当前 DOM 重新判定：有浮层就写，没有就还原成我们首次改写前的值。
					 * @param target 会话滚动容器。
					 */
					const applyComposerPushTo = (target, side = "right") => {
						if (target === null || typeof target.querySelector !== "function") return;
						const writes = pushComposerSeat(target, side);
						if (writes.size > 0) {
							// 写入成功时座位一定存在（pushComposerSeat 已确认），这里只做登记。
							const seat = target.querySelector(COMPOSER_SEAT_SELECTOR);
							for (const [property, value] of writes) rememberWrite(seat, property, value);
							return;
						}
						// 已切回常规对话视图（或浮层消失）：撤销本插件写过的座位收窄。
						const seat = target.querySelector(COMPOSER_SEAT_SELECTOR);
						if (seat === null || seat === undefined) return;
						const previous = pushWrites.get(seat);
						if (previous === undefined) return;
						restoreInlinePush(seat, previous);
						pushWrites.delete(seat);
					};
					/** 只做「节点换了就补预留」这一件轻量事，供 DOM 变动观察器调用。 */
					const reconcilePush = () => {
						const targets = resolvePushTargets();
						if (targets.body !== null) applyPushTo(targets.body, pushSide);
						if (targets.scroll !== null) applyScrollPushTo(targets.scroll, pushSide);
						if (targets.scroll !== null) applyComposerPushTo(targets.scroll, pushSide);
					};
					if (conversationBody !== null) conversationBody.style.setProperty(pushSide === "left" ? "margin-left" : "margin-right", `${PANEL_WIDTH}px`);
					rememberWrite(conversationBody, pushSide === "left" ? "margin-left" : "margin-right", `${PANEL_WIDTH}px`);
					// 让位的同时把滚动容器向对侧补回面板宽度：页面滚动条始终留在窗口右缘。
					applyScrollPushTo(scrollEl, pushSide);
					// 轨迹 / 统计等「输入框浮层」视图：座位是绝对定位，需单独收窄。
					applyComposerPushTo(scrollEl, pushSide);
					const update = () => {
						const headRect = headerEl?.getBoundingClientRect();
						const compRect = composerEl?.getBoundingClientRect();
						// 新建页没有会话页眉；Windows 面板需在原生标题栏及 HUD 入口下方。
						const minimumTop = HUD_NEW_SESSION_TOP + hudChromeTop();
						// v0.20.0：边栏样式下顶部从会话页眉下沿起（不留 8px 顶距），底部由内联 bottom:0 通到视口底部；
						// 新建会话页没有页眉，改用顶部 chrome 行下沿（悬浮「HUD面板」入口与右侧按钮所在行）——
						// 既不会在面板上方留空隙，也不会盖住这些按钮。
						const nextTop = hudPanelTop(minimumTop, headRect?.bottom, pushStyle, hudChromeRowBottom(hudChromeTop()));
						setTop(nextTop);
						// 高度上限只服务于卡片样式（边栏样式通高，maxHeight 已被内联 none 覆盖）。
						if (pushStyle !== "sidebar") {
							// 上限不超过「视口底部 - 8px」，防止面板底超出聊天页可视高度
							const vhLimit = Math.max(120, Math.round(window.innerHeight - nextTop - 8));
							if (compRect !== undefined && compRect.bottom > nextTop + 120) {
								setLimitH(Math.min(Math.round(compRect.bottom - nextTop), vhLimit));
							} else {
								setLimitH(vhLimit);
							}
						}
						// v0.18.2：左侧面板贴「会话区左缘」——用未被让位改写的会话根节点测量，
						// 这样面板落在正文让出来的 300px 空隙里，不会盖住左侧会话列表。
						// v0.20.0：边栏样式下直接贴会话区左缘（不留 8px），分隔线画在面板朝向正文的一侧。
						const anchorLeft = conversationLeftEdge(conversationRoot ?? headerEl);
						if (anchorLeft !== null) {
							lastPanelLeft = hudPanelLeft(anchorLeft, pushStyle);
							setLeft(lastPanelLeft);
						}
						publishConversationBodyWidth();
						syncTurnNavigation();
					};
					update();
					const observer = new ResizeObserver(update);
					if (composerEl !== null) observer.observe(composerEl);
					if (conversationBody !== null) observer.observe(conversationBody);
					const turnNavObserver = typeof MutationObserver === "undefined" || conversationRoot === null
						? null
						: new MutationObserver(syncTurnNavigation);
					turnNavObserver?.observe(conversationRoot, { childList: true, subtree: true });
					window.addEventListener("resize", update);

					// v0.15.10：正文预留的两个补充触发——
					//   1. DOM 变动（debounce 到一帧）时只做「节点换了就补预留」这件轻量事，
					//      避免宿主重建正文后预留凭空消失；
					//   2. 挂载后补两次复查（350ms / 900ms）：面板是在「右侧栏收起动画进行中」
					//      重新挂载的，此时测到的列宽会偏窄，把它当成最终值就会让正文一直窄着。
					let reconcileFrame = null;
					const scheduleReconcile = () => {
						if (reconcileFrame !== null) return;
						reconcileFrame = window.requestAnimationFrame(() => {
							reconcileFrame = null;
							reconcilePush();
						});
					};
					const domObserver = typeof MutationObserver === "undefined"
						? null
						: new MutationObserver(scheduleReconcile);
					domObserver?.observe(document.body, {
						childList: true,
						subtree: true,
						attributes: true,
						// v0.15.16：切换「对话 / 轨迹 / 统计」页签会增删
						// data-conversation-composer-overlay，座位收窄要随之写入或撤销。
						attributeFilter: ["data-sidebar-right-open", "data-sidebar-right-panel", "hidden", "data-conversation-composer-overlay"],
					});
					const settleTimers = [
						window.setTimeout(update, 350),
						window.setTimeout(update, 900),
					];

					return () => {
						observer.disconnect();
						turnNavObserver?.disconnect();
						domObserver?.disconnect();
						window.removeEventListener("resize", update);
						if (reconcileFrame !== null) window.cancelAnimationFrame(reconcileFrame);
						for (const timer of settleTimers) window.clearTimeout(timer);
						restoreTurnNavigation();
						// v0.15.10：按「首次改写前的原值」还原，且只还原当前仍等于我们写入值的属性；
						// 宿主或其它插件已经改过的属性一律不动，避免覆盖别人的布局状态。
						for (const [node, writes] of pushWrites) restoreInlinePush(node, writes);
						pushWrites.clear();
					};
					// 会话切换会重建会话正文 DOM，需重新查询并应用让位；
					// v0.18.2：面板换边时同样重跑（先按原值还原旧侧，再写入新侧）。
					// v0.20.0：面板换样式时同样重跑（边栏样式取消滚动条补偿、改为通高贴边）。
				}, [current, panelSide, panelStyle]);

				const sessionId = current ?? "";
				// MCP 是 profile 全局数据，独立刷新；即使新建页没有任何会话或工作区也能查询与启停。
				react.useEffect(() => {
					let alive = true;
					const refreshMcp = singleFlight(async () => {
						const revision = mcpMutation.current;
						try {
							const body = await call("mcp", {});
							// 请求期间发生过启停：该响应的状态已过时，应用它会覆盖刚生效的开关。
							if (alive && revision === mcpMutation.current) setMcp(body);
						} catch { /* 保留上次成功数据，避免暂时离线被误显示为无 MCP。 */ }
					});
					refreshMcp();
					const timer = window.setInterval(refreshMcp, 5000);
					return () => { alive = false; window.clearInterval(timer); };
				}, []);
				// git / 子代理 / 计划：面板打开时轮询（5s），切会话立即刷新。
				// 新建会话页只轮询目标工作区代理会话的 git，其余会话级模块该页不展示。
				react.useEffect(() => {
					if (newSessionPage) {
						setSubagents([]);
						setPlans([]);
						setOutputs(null);
						if (moduleSessionId === "") { setGit(null); return undefined; }
						let alive = true;
						const pollGit = singleFlight(async () => {
							const revision = gitRevision.current;
							try {
								const body = await call("git", { sessionId: moduleSessionId });
								if (alive && revision === gitRevision.current) setGit(body);
							} catch { /* 非 git 仓库或代理会话不可用：保留上次快照 */ }
						});
						pollGit();
						const timer = window.setInterval(pollGit, 5000);
						return () => { alive = false; window.clearInterval(timer); };
					}
					if (sessionId === "") { setGit(null); setSubagents([]); setPlans([]); return undefined; }
					let alive = true;
					const refreshGit = async () => {
						const revision = gitRevision.current;
						try {
							const body = await call("git", { sessionId });
							if (alive && revision === gitRevision.current) setGit(body);
						} catch { /* 保留快照，避免卸载 GitModule 及其打开的弹窗。 */ }
					};
					const refreshSubagents = async () => {
						try {
							const body = await call("subagents", { sessionId });
							if (alive) setSubagents(body.entries ?? []);
						} catch { /* 保留上次成功数据。 */ }
					};
					const refreshPlans = async () => {
						try {
							const body = await call("plans", { sessionId });
							if (alive) setPlans(Array.isArray(body.plans) ? body.plans : []);
						} catch { /* 保留上次成功数据。 */ }
					};
					// v0.19.1：「产物」模块的数据刷新。
					// v0.19.2：没有产物（含旧宿主能力不可用）时模块整体隐藏，
					// 因此这里只维护列表快照，不再区分「空」与「不可用」两种展示。
					const refreshOutputs = async () => {
						try {
							const body = await call("outputs", { sessionId });
							if (alive) setOutputs({ limit: body.limit, truncated: body.truncated === true, files: Array.isArray(body.files) ? body.files : [] });
						} catch (error) {
							if (!alive) return;
							const code = error?.code;
							const unsupported = code === "unsupported" || code === 404 || code === 405;
							if (unsupported) setOutputs({ limit: 10, truncated: false, files: [] });
							// 其它失败（网络/服务抖动）保留上次成功列表。
						}
					};
					const polls = [refreshGit, refreshSubagents, refreshPlans, refreshOutputs].map(singleFlight);
					const refresh = () => polls.forEach(poll => { poll(); });
					refresh();
					const timer = window.setInterval(refresh, 5000);
					return () => { alive = false; window.clearInterval(timer); };
				}, [sessionId, gitKey, moduleSessionId, newSessionPage]);

				// 切换会话：若面板滚动区已滚动过（不在顶层），复位滚动到顶部
				react.useEffect(() => {
					const el = bodyRef.current;
					if (el !== null && el.scrollTop > 0) el.scrollTop = 0;
				}, [sessionId]);

				const workspaceTitle = target.workspaceTitle ?? resolveWorkspaceTitle(summary?.cwd ?? target.path, workspaceItems);
				// 当前会话的投影值（contextPressure / contextBreakdown / sessionStats / todos …）：
				// 统一取会话列表快照（客户端 sessions 服务没有 projectionValues(sessionId) 方法）。
				const projection = projectionValuesOf(summary);
				const todos = Array.isArray(projection.todos) ? projection.todos.filter((item) => item && typeof item === "object" && typeof item.content === "string") : [];
				const pressure = projection.contextPressure ?? null;
				const breakdown = projection.contextBreakdown ?? null;
				const stats = projection.sessionStats ?? null;
				const subagentActive = subagents.some((entry) => entry.activity === "running");
				const statusKey = deriveSessionStatus({ running: summary?.running ?? false, pendingInteraction: pending?.kind, subagentActive });
				const statusView = sessionStatusView(statusKey);
				const statusKind = statusView.kind;
				const statusText = t(statusView.textKey);

				// 订阅模型目录快照，模型/推理等级切换后立即更新，无需等待会话列表或轮询。
				let modelStore;
				try { modelStore = ctx.get("modelDirectories")?.directoryFor?.(sessionId)?.store; } catch { /* 未绑定的会话无模型目录 */ }
				const modelValue = useSnapshot(modelStore, s => s, null);
				const modelSnapshot = modelStore === undefined ? null : modelValue;
				const selection = modelSnapshot?.current;
				const modelMeta = selection === null || selection === undefined ? { providerLabel: null, modelId: null, effortLabel: null } : {
					providerLabel: resolveProviderLabel(selection, modelSnapshot.groups ?? []) ?? selection.provider,
					modelId: typeof selection.model === "string" ? selection.model : null,
					effortLabel: resolveEffortLabel(selection, modelSnapshot.groups ?? []),
				};

				// v0.18.2：「用量设置」恒列出三项；只有真正取到数据（已安装且已配置/已登录）
				// 的项可切换，其余置灰并在行内给出原因。DeepSeek 走内置官方余额源，恒可切换。
				const usageAvailability = {
					deepseek: true,
					opencode: opencode !== null && opencode.available === true,
					codex: codex !== null && codex.available === true,
				};
				const usageReasons = {
					opencode: opencode?.missing === true ? t("settingsUsageOpencodeMissing") : t("settingsUsageOpencodeUnconfigured"),
					codex: t("settingsUsageCodexMissing"),
				};
				// 「用量」模块恒定展示（除非在 HUD 设置里手动隐藏）：数据源缺失时 DeepSeek 行显示 —
				// 且仍可点击进入「账号与余额」；OpenCode Go / Codex 行仅在数据可用时渲染。
				// 新建会话页：只保留该页有数据源的模块（git 需目标工作区确实是 git 仓库）
				const activeModules = panelVisibleModules(
					modules ?? defaultModules(),
					newSessionPage,
				);
				// v0.18.3：新建会话页不展示的模块只在「HUD 设置」左栏置灰只读——
				// 既不能把「本页不渲染」误当成「用户关闭」，也不能在本页改动它们的全局开关。
				const lockedModuleKeys = newSessionPage
					? MODULE_KEYS.filter((key) => !NEW_SESSION_MODULE_KEYS.includes(key))
					: [];
				// v0.18.7：「上下文模块位置固定」——设置开启且排序允许时，上下文模块移出滚动容器，
				// 渲染在会话模块正下方（与会话模块同一「固定头区」语义）；否则仍按排序留在滚动区里。
				const contextPin = contextPinState(moduleOrder, modules ?? defaultModules());
				const contextPinned = contextSettings?.pinned === true && contextPin.allowed && activeModules.context !== false;
				// 便笺/待办作用域：工作区路径优先，无 cwd 时降级为会话级隔离
				const workspaceKey = target.path ?? resolveWorkspaceKey(summary?.cwd, workspaceItems);
				const scopeProps = {
					sessionId: moduleSessionId,
					workspaceKey,
					workspaceCandidates: target.candidates,
					sendSessionId: current ?? target.sendSessionId ?? null,
				};
				const scopeKey = workspaceKey ?? moduleSessionId;

				/**
				 * v0.19.1：在官方右侧栏打开「产物」里的一行。
				 * 地址由 Host 按 DSH 的 file 资源语法拼好（`dsh-resource://file/session/...`），
				 * 这里只负责转交；服务缺失或打开失败都归一成一句可读提示。
				 */
				const openOutputFile = (file) => {
					const address = typeof file?.address === "string" ? file.address : "";
					const target = address === "" ? undefined : ctx.get?.("sidebarRight");
					if (address === "" || target === undefined || target === null || typeof target.openResource !== "function") {
						toast(t("outputsOpenFailed"), "error");
						return;
					}
					try {
						target.openResource(address);
					} catch {
						toast(t("outputsOpenFailed"), "error");
					}
				};

				const openSubagent = (entry) => {
					void navigateSubagent(entry).catch(() => toast(t("subagentOpenFailed")));
				};

				/** v0.18.7：上下文模块节点（滚动区与固定区共用同一份 props，避免两处走样）。 */
				const contextNode = () => react.createElement(ContextModule, {
					sessionId,
					pressure,
					breakdown,
					stats,
					usage: projection.tokenUsage ?? null,
					settings: contextSettings,
					running: summary?.running ?? false,
					// v0.19.2：上下文模块支持折叠（与其它模块同一份 localStorage 折叠状态）。
					fold: folds.context,
					onFoldChange: (value) => setFolds((prev) => ({ ...prev, context: value })),
				});
				/**
				 * v0.16.0：面板模块渲染表 —— 键 → 「何时渲染 + 如何渲染」。
				 * 顺序不再写死在 JSX 里，而由 moduleOrder（全局设置）决定；
				 * 这里只负责「该模块现在有没有数据 / 是否被隐藏」。
				 * 返回 null 表示该模块当前不渲染（隐藏或无数据），调用方过滤掉。
				 */
				const MODULE_RENDERERS = {
					// v0.18.7：context 的节点构造函数抽出，供「滚动区」与「固定区」共用；
					// 固定生效时滚动区不再渲染它（否则会在面板里出现两块）。
					context: () => activeModules.context === false || contextPinned ? null : contextNode(),
					balance: () => activeModules.balance === false
						? null
						: react.createElement(BalanceModule, { balance, opencode, codex, display: usageDisp, fold: folds.usage, onFoldChange: (value) => setFolds((prev) => ({ ...prev, usage: value })) }),
					git: () => activeModules.git === false || git === null || git === undefined ? null : react.createElement(GitModule, {
						key: `${moduleSessionId}-${target.path ?? ""}`,
						sessionId: moduleSessionId,
						git,
						fold: folds.git,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, git: value })),
						onGit: (snapshot) => { gitRevision.current += 1; setGit(snapshot); },
					}),
					outputs: () => activeModules.outputs === false || outputs === null || (Array.isArray(outputs.files) ? outputs.files.length : 0) === 0 ? null : react.createElement(OutputsModule, {
						files: outputs.files,
						limit: outputs.limit,
						truncated: outputs.truncated === true,
						onOpen: openOutputFile,
						fold: folds.outputs,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, outputs: value })),
					}),
					subagents: () => activeModules.subagents === false || subagents.length === 0 ? null : react.createElement(SubagentsModule, {
						entries: subagents,
						byId: state?.byId ?? {},
						onOpen: openSubagent,
						fold: folds.subagents,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, subagents: value })),
					}),
					tasks: () => activeModules.tasks === false || todos.length === 0 ? null : react.createElement(TasksModule, {
						todos,
						fold: folds.tasks,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, tasks: value })),
					}),
					plans: () => activeModules.plans === false || plans.length === 0 ? null : react.createElement(PlansModule, {
						plans: [...plans].reverse(),
						fold: folds.plans,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, plans: value })),
					}),
					mcp: () => activeModules.mcp === false || mcp === null ? null : react.createElement(McpModule, {
						sessionId,
						servers: mcp.servers,
						enabled: mcp.enabled,
						total: mcp.total,
						fold: folds.mcp,
						onState: (body) => setMcp(body),
						onMutate: () => { mcpMutation.current += 1; },
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, mcp: value })),
					}),
					// 便笺/待办：key 唯一（模块间不得重复——同级重复 key 会使
					// React diff 错乱、每次重渲染累积重复模块）；key 按「工作区键」派生，
					// 同工作区切会话不重挂载（内容共享），跨工作区必重挂载（避免编辑态串数据）。
					// v0.16.0 起这两个模块可被排序，因此 key 前缀保证与其它模块不冲突。
					note: () => activeModules.note === false ? null : react.createElement(NoteModule, {
						key: `note-${scopeKey}`,
						...scopeProps,
						noteMaxCount: normalizeNoteSettings(noteSettings).maxCount,
						fold: folds.note,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, note: value })),
					}),
					todo: () => activeModules.todo === false ? null : react.createElement(TodoModule, {
						key: `todo-${scopeKey}`,
						...scopeProps,
						fold: folds.todo,
						onFoldChange: (value) => setFolds((prev) => ({ ...prev, todo: value })),
					}),
				};
				/**
				 * 按 moduleOrder 输出面板模块。
				 * normalizeModuleOrder 保证顺序是完整排列，因此这里不会漏渲染任何模块；
				 * 返回 null 的项（隐藏 / 无数据）直接过滤，保持既有「按需展示」语义。
				 */
				const renderOrderedModules = () => normalizeModuleOrder(moduleOrder)
					.map((key) => MODULE_RENDERERS[key]?.() ?? null)
					.filter((node) => node !== null);

				// —— v0.18.1：标题菜单动作 ——
				const sessionTitle = summary?.displayTitle ?? summary?.title ?? t("fallbackSession");
				const workspaceId = typeof target.workspaceId === "string" && target.workspaceId !== "" ? target.workspaceId : null;
				const workspacePath = typeof target.workspacePath === "string" && target.workspacePath !== ""
					? target.workspacePath
					: (typeof summary?.cwd === "string" && summary.cwd !== "" ? summary.cwd : null);
				const workspaceApi = ctx.get("workspaces");
				const canRenameWorkspace = workspaceId !== null && typeof workspaceApi?.rename === "function";
				const workspaceRenameReason = workspaceId === null ? t("workspaceRenameUnregistered") : t("workspaceRenameServiceDown");
				const archivedNow = Array.isArray(state?.archivedSessionIds) && state.archivedSessionIds.includes(sessionId);
				const pinnedNow = Array.isArray(pinnedSessionIds) && pinnedSessionIds.includes(sessionId);
				const uiWorkspaceApi = ctx.get("uiWorkspace");
				const hasSessionNow = sessionId !== "";
				const canPinSession = hasSessionNow && !archivedNow && typeof uiWorkspaceApi?.pinSession === "function";
				const canForkSession = hasSessionNow && typeof uiWorkspaceApi?.forkSession === "function";
				// v0.19.2：归档能力——已归档的会话不再提供归档项。
				const canArchiveSession = hasSessionNow && !archivedNow && typeof uiWorkspaceApi?.archiveSession === "function";

				/** 工作区重命名：本地先做重名预检，服务端 name-conflict 再兜底成可读文案。 */
				const doRenameWorkspace = async (nextTitle) => {
					if (!canRenameWorkspace) throw new Error(workspaceRenameReason);
					const duplicated = workspaceItems.some((item) => item !== null && typeof item === "object"
						&& item.workspaceId !== workspaceId && typeof item.title === "string" && item.title === nextTitle);
					if (duplicated) throw new Error(interpolate(t("workspaceRenameConflict"), { name: nextTitle }));
					try {
						await workspaceApi.rename(workspaceId, nextTitle);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						throw new Error(message.includes("workspace/name-conflict")
							? interpolate(t("workspaceRenameConflict"), { name: nextTitle })
							: message);
					}
				};
				/** 在 Finder / 资源管理器中显示工作区目录：原生操作在宿主侧执行。 */
				const doRevealWorkspace = async () => {
					if (workspacePath === null) { toast(t("workspacePathMissing"), "error"); return; }
					try { await call("workspace/reveal", { path: workspacePath }); }
					catch (error) { toast(interpolate(t("revealFailed"), { detail: error?.message ?? String(error) }), "error"); }
				};
				const doCopyWorkspacePath = async () => { await copyWithToast(workspacePath, t("copiedWorkspacePath")); };
				/** 置顶 / 取消置顶：走官方 uiWorkspace，保证与侧栏的顺序 reconcile 一致。 */
				const doTogglePin = async (nextPinned) => {
					const api = ctx.get("uiWorkspace");
					try {
						if (nextPinned) await api.pinSession(sessionId);
						else await api.unpinSession(sessionId);
						toast(t(nextPinned ? "sessionPinDone" : "sessionUnpinDone"), "success");
					} catch (error) {
						toast(interpolate(t("sessionPinFailed"), { detail: error?.message ?? String(error) }), "error");
					}
				};
				/** 分支会话：与官方一致不跳转；需要迁移源会话时给出明确引导。 */
				const doForkSession = async () => {
					const api = ctx.get("uiWorkspace");
					try {
						await api.forkSession(sessionId, undefined, { allowMigration: false });
						toast(t("sessionForkDone"), "success");
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						toast(message.includes("migration-required")
							? t("sessionForkNeedsOpen")
							: interpolate(t("sessionForkFailed"), { detail: message }), "error");
					}
				};
				/** 归档当前会话：走官方 uiWorkspace.archiveSession，成功后侧栏会话列表自动刷新。 */
				const doArchiveSession = async () => {
					const api = ctx.get("uiWorkspace");
					try {
						await api.archiveSession(sessionId);
						toast(t("sessionArchiveDone"), "success");
					} catch (error) {
						toast(interpolate(t("sessionArchiveFailed"), { detail: error?.message ?? String(error) }), "error");
					}
				};
				const doCopySessionId = async () => { await copyWithToast(sessionId, t("copiedSessionId")); };
				const doCopySessionName = async () => { await copyWithToast(sessionTitle, t("copiedSessionName")); };

				/** 重命名当前会话：走 client 会话面 ISession.rename（成功后列表标题自动刷新）。 */
				const doRenameSession = async (title) => {
					if (sessionId === "") throw new Error(t("sessionRenameUnavailable"));
					const sessionsApi = ctx.get("sessions");
					const face = sessionsApi?.binding?.(sessionId)?.session ?? sessionsApi?.sessionOf?.(ctx);
					if (face === undefined || face === null || typeof face.rename !== "function") {
						throw new Error(t("sessionRenameUnavailable"));
					}
					const result = await face.rename(title);
					if (result === null || result === undefined || result.ok !== true) {
						const message = result?.error?.message ?? result?.error?.code ?? t("sessionRenameFailed");
						throw new Error(typeof message === "string" ? message.replace(/\{detail\}/, message) : String(message));
					}
					return result;
				};

				return react.createElement("section", {
					className: "hud-panel",
					// v0.18.2：侧位由设置决定；右侧沿用历史 8px，左侧用测量到的会话区左缘 + 8px。
					"data-side": panelSide,
					// v0.20.0：样式由设置决定——card 保持历史圆角卡片几何；sidebar 通高贴边，
					// 顶部从会话页眉下沿起、底部到视口底部、外侧不留边距，靠 CSS 画朝向内容一侧的分隔线。
					"data-style": panelStyle,
					style: {
						top,
						maxHeight: panelStyle === "sidebar" ? "none" : (limitH === null ? undefined : `${limitH}px`),
						bottom: panelStyle === "sidebar" ? 0 : undefined,
						left: panelSide === "left" ? `${left}px` : "auto",
						right: panelSide === "right" ? (panelStyle === "sidebar" ? "0px" : `${HUD_PANEL_GAP}px`) : "auto",
					},
					"aria-label": t("hudLabel"),
				},
					// 「会话」模块固定在面板顶部（hud-panel 直属头区）：不参与 body 滚动，
					// 面板内容上下滑动时会话信息始终可见；body 仅承载其余可滚动模块
					react.createElement(SessionModule, {
						key: sessionId,
						workspaceTitle,
						workspacePath,
						canRenameWorkspace,
						workspaceRenameReason,
						desktopAvailable: hostDesktop.available,
						fileManager: hostDesktop.fileManager,
						onRenameWorkspace: doRenameWorkspace,
						onRevealWorkspace: doRevealWorkspace,
						onCopyWorkspacePath: doCopyWorkspacePath,
						// v0.18.1：新建会话页不展示会话标题与状态
						hasSession: sessionId !== "" && !newSessionPage,
						sessionTitle,
						pinned: pinnedNow,
						canRenameSession: hasSessionNow,
						canPin: canPinSession,
						pinReason: canPinSession ? undefined : (archivedNow ? t("sessionPinArchived") : t("sessionPinUnavailable")),
						canFork: canForkSession,
						canCopySession: hasSessionNow,
						canArchive: canArchiveSession,
						archived: archivedNow,
						onTogglePin: doTogglePin,
						onFork: doForkSession,
						onArchive: doArchiveSession,
						onCopySessionId: doCopySessionId,
						onCopySessionName: doCopySessionName,
						statusText,
						statusKind,
						onRename: hasSessionNow ? doRenameSession : undefined,
						providerLabel: modelMeta.providerLabel,
						modelId: modelMeta.modelId,
						effortLabel: modelMeta.effortLabel,
						// 设置弹窗读真实设置（不是本页过滤后的 activeModules），否则新建会话页会
						// 把「本页不展示」的模块显示成关闭、并在确认时写成关闭。
						modules: modules ?? defaultModules(),
						lockedModules: lockedModuleKeys,
						usage: usageDisp,
						context: contextSettings,
						order: moduleOrder,
						panel: panelSettings,
						note: noteSettings,
						balanceAvailable: true,
						usageAvailability,
						usageReasons,
						onSettingsChange: updateSettings,
					}),
					// v0.18.7：上下文模块位置固定——与会话模块同属「固定头区」，不参与 body 滚动；
					// 固定区自身限高并可内部滚动（矮窗口下不会把下方滚动区压没）。
					contextPinned
						? react.createElement("div", { className: "hud-panel-pin" }, contextNode())
						: null,
					react.createElement("div", { className: "hud-panel-body", ref: bodyRef },
						renderOrderedModules()));
			}

			function resolveWorkspaceTitle(cwd, items) {
				if (typeof cwd !== "string" || cwd === "" || !Array.isArray(items)) return t("workspaceFallback");
				for (const item of items) {
					if (item !== null && typeof item === "object" && typeof item.path === "string" && item.path === cwd && typeof item.title === "string" && item.title.length > 0) {
						return item.title;
					}
				}
				// 仅标题拆分路径；工作区存储键保留宿主原始路径，避免 Windows 旧数据失联。
				const base = String(cwd).split(/[\\/]/).filter(Boolean).pop();
				return base ?? t("workspaceFallback");
			}

			// —— 新建会话页悬浮入口：该页不渲染 conversation.session.header（无会话 id），
			//     故经 shell.overlay 自带一个固定在视口右上角的按钮（与标题栏按钮同一视觉位置，
			//     只是该页没有标题栏可依附）；开合状态与原按钮共用（新建会话页恒从隐藏开始）——
			function HudFloatingButton() {
				// 与面板同一派生可见性：侧栏展开时面板隐藏，该页入口也整体不展示（不再「移到侧栏左侧」）。
				const [visible, setVisible] = react.useState(() => peekHudOpen(undefined) && !getSidebarExpanded());
				const [sidebarOpen, setSidebarOpen] = react.useState(() => getSidebarExpanded());
				// v0.18.2：面板在左侧时，左侧会话列表抽屉（窄窗口遮罩）展开期间同样整体不展示入口。
				const [drawerOpen, setDrawerOpen] = react.useState(() => getLeftDrawerOpen());
				const [sidebarInset, setSidebarInset] = react.useState(HUD_FLOAT_RIGHT);
				const [previewOpen, setPreviewOpen] = react.useState(() => fullscreenPreviewOpen());
				react.useEffect(() => {
					const sync = () => {
						setSidebarOpen(getSidebarExpanded());
						setDrawerOpen(getLeftDrawerOpen());
						setVisible(isHudVisible());
					};
					const stopHud = subscribeHud(sync);
					const stopSidebar = subscribeSidebar(sync);
					return () => { stopHud(); stopSidebar(); };
				}, []);
				// 位置测量放在 layout 阶段：首帧绘制前即校正，避免初始兜底右偏移与右侧按钮重叠一帧。
				useLayoutEffect(() => watchFloatingHudPosition(ctx, setSidebarInset), []);
				react.useEffect(() => watchFullscreenPreview(setPreviewOpen), []);
				// 大图预览覆盖全屏时让位：HUD 入口层级高于预览，会浮在大图与关闭按钮之上
				if (previewOpen) return null;
				// 官方右侧栏（含 better-sidebar）展开期间不展示入口：避免按钮悬在侧栏左缘，
				// 与「侧栏与 HUD 互斥」保持一致；关闭侧栏后自动恢复并回到该页此前的开合状态。
				if (sidebarOpen) return null;
				// 左侧抽屉展开且面板在左侧时，面板本身已被抽屉挤掉，入口一并隐藏避免悬空。
				if (getPanelSide() === "left" && drawerOpen) return null;
				return react.createElement("button", {
					type: "button",
					className: "hud-btn hud-btn-float",
					"data-hud-float": "",
					"data-open": visible,
					// HUD 面板位于标题栏下方，开合不改变入口位置；仅在官方边栏展开时避让。
					style: { right: `${sidebarInset}px` },
					"aria-label": t(visible ? "hudClose" : "hudNewSessionOpen"),
					title: t("hudLabel"),
					onClick: () => toggleHud(ctx),
				}, react.createElement(Icon, { name: "hud-toggle", size: 15, color: visible ? undefined : "var(--dsw-alias-label-tertiary)" }));
			}

			// —— 会话区水平锚点（固定面板左侧定位用）——
			/**
			 * 会话页 / 新建会话页的会话根节点：左侧面板的水平锚点基准。
			 * 与固定面板同一套选择器链；取 `[data-phase]` 根节点而不是正文容器——它不会被「让位」改写。
			 */
			function resolveConversationRoot() {
				if (typeof document === "undefined") return null;
				const sessionHost = document.querySelector('[data-slot="conversation.session"]');
				const sessionRoot = sessionHost?.closest?.("[data-phase]") ?? null;
				if (sessionRoot !== null) return sessionRoot;
				const scrollEl = document.querySelector("[data-conversation-scroll]");
				return scrollEl?.closest?.("[data-phase]") ?? null;
			}

			/** 会话根节点左缘（像素）；测不到或越界返回 null。 */
			function conversationLeftEdge(root) {
				const target = root ?? resolveConversationRoot();
				if (target === null || target === undefined || typeof target.getBoundingClientRect !== "function") return null;
				let left = NaN;
				try { left = Math.round(target.getBoundingClientRect().left); } catch { return null; }
				return Number.isFinite(left) && left >= 0 ? left : null;
			}

			// —— HUD 面板壳（监听 open 状态，关闭即卸载）——
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "awesome-hud",
				order: 70,
				label: () => t("hudLabel"),
				locale: NS,
			}, function HudPanelRoot({ useSessionPendingInteraction, usePanelInfo }) {
				const conversationActive = usePanelInfo((info) => info.activePanelId === null);
				const blankSessionsStore = ctx.get("sessions")?.list;
				const blankSnap = useSnapshot(blankSessionsStore, (s) => s, null);
				const binding = useSnapshot(ctx.uiSession?.adapter?.current, (s) => s, null);
				const current = activeSessionId(binding, blankSnap);
				const newSession = isNewSessionPage(blankSnap, current);
				const scopeSessionId = newSession ? undefined : current;
				// 首帧用只读 peek 拿到目标会话自己的展开记忆，再叠加右侧栏互斥得到派生可见性，
				// 避免刷新后先闪一下错误值或与已展开的右侧栏重叠。
				const [visible, setVisible] = react.useState(() => peekHudOpen(scopeSessionId) && !getSidebarExpanded());
				react.useEffect(() => {
					const stopHud = subscribeHud(() => setVisible(isHudVisible()));
					const stopSidebar = subscribeSidebar(() => setVisible(isHudVisible()));
					// 侧位会参与 isHudVisible 的左侧抽屉判定，面板设置变化后同步一次可见性。
					const stopPanel = subscribePanelPrefs(() => setVisible(isHudVisible()));
					return () => { stopHud(); stopSidebar(); stopPanel(); };
				}, []);
				// 开合状态按会话独立：会话/页面切换后（在 effect 中，避免渲染期跨根更新）
				// 切换作用域；变更即通知所有订阅者（标题栏按钮 / 悬浮按钮 / 面板本体）。
				// 新建会话页（无会话 / blank：未开始的空会话）语义：
				//   1) 右上角展示固定悬浮入口按钮（该页不渲染 conversation.session.header，原按钮缺失）；
				//   2) 从隐藏开始（该页状态只存内存，不写 localStorage）；
				//   3) 用户在该页手动展开后保持展开，直到离开该页或自行收起。
				// 进入真实会话后加载该会话自己的记忆状态。面板位置与已有会话完全一致（固定贴右侧）。
				react.useEffect(() => {
					activateHudScope(scopeSessionId);
				}, [scopeSessionId]);
				// 新会话页兜底：作用域切换本身已按「新建会话页默认展示/隐藏」初始化，这里再对齐一次，
				// 覆盖「首次判定时 store 尚未就绪」等边角情形（只改内存态，不写 localStorage）。
				react.useEffect(() => {
					if (newSession) setHudOpenTransient(panelPrefs.newSessionOpen);
				}, [newSession]);
				// 插件管理等全局主页面与会话共用 overlay，非会话页不得露出 HUD。
				if (!conversationActive) return null;
				return react.createElement(react.Fragment, null,
					newSession ? react.createElement(HudFloatingButton, null) : null,
					visible
						? react.createElement(HudErrorBoundary, null, react.createElement(HudPanel, {
							useSessionPendingInteraction,
						}))
						: null,
					react.createElement(ToastLayer, null));
			}));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
