// dsh-awesome-hud — browser half（ModuleLoader bundle）
//
// 功能：
//   1. 会话头部「HUD面板」按钮（conversation.session.header.utilities，order -11，
//      位于 dsh-session-plus 的 open-workspace(order -10) 左侧）。
//   2. 新建会话页（无会话 / 空白会话过渡态）：该页不渲染 session header，故经
//      shell.overlay 在视口右上角（标题栏按钮的同一视觉位置）提供悬浮「HUD面板」按钮；
//      该页恒从隐藏开始（内存态、不写 localStorage），点击后展开并让输入框等内容左移让位，
//      面板位置与已有会话完全一致（固定贴页面右侧）。
//   3. 悬浮 HUD 面板（shell.overlay）：单卡片分区样式（与实际设计稿一致：
//      整卡 + 细分隔线分区、实心色调徽章/芯片、灰底药丸计数、绿色开关）；
//      新建会话页只展示该页有数据源的模块（会话 / 用量 / 便笺 / 待办 / MCP，
//      以及目标工作区确为 git 仓库时的 git）。
//   4. HUD 设置菜单（会话模块右上角）：模块可见性勾选，写入 host settings。
//   5. 「便笺」「待办」按工作区共享（v0.12.0 起）：同一工作区目录下的所有会话共用
//      一份内容（含便笺高度与待办顺序）；无 cwd 的会话降级为会话级隔离；
//      升级时按工作区做一次性归并迁移（旧会话级键保留，便于回滚）。
//   6. 面板开合状态按会话独立（v0.13.0 起）：各会话各自记忆，互不影响；
//      新建会话页恒从隐藏开始（只存内存态、不持久化）。
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
		// 新建会话页几何：面板与已有会话完全一致（固定贴视口右侧、宽度 300、顶部同标题栏下沿）；
		// 按钮落在标题栏按钮的同一视觉位置（顶部 12px / 右侧 28px），面板顶距 52 紧贴其下 8px。
		const HUD_NEW_SESSION_TOP = 52;
		const HUD_FLOAT_INSET = 12;
		const HUD_FLOAT_RIGHT = 28;
		// 面板展开时按钮让位到面板左侧（面板 300px + 面板右贴 8px + 间隙 8px）
		const HUD_FLOAT_PANEL_GAP = PANEL_WIDTH + 16;
		// 新建会话页可展示的模块白名单（其余模块在该页没有数据源，不占位）
		const NEW_SESSION_MODULE_KEYS = ["balance", "git", "mcp", "note", "todo"];
		const TURN_NAVIGATION_RIGHT_GAP = 12;
		const TURN_NAVIGATION_MIN_COLUMN_WIDTH = 720;
		// Mirrors rc.1 ConversationRoot's width resolver, but uses the HUD-reserved
		// body width so the host's drag preference remains valid while the panel is open.
		const HUD_CONTENT_WIDTH = "min(var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-awesome-hud-column-width) * .64), 920px)), max(640px, calc(var(--dsh-awesome-hud-column-width) - 176px)))";
		// 菜单可隐藏的模块（会话模块恒展示）
		const MODULE_KEYS = ["context", "balance", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"];

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
			contextModule: "上下文窗口",
			contextCompress: "压缩",
			contextUsed: "已用 {tokens}",
			contextLimit: "上限 {tokens}",
			contextCacheHit: "缓存命中 {percent}",
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
			sessionRenameCancel: "取消",
			sessionRenameConfirm: "确认",
			sessionRenameDone: "已重命名",
			sessionRenameFailed: "重命名失败：{detail}",
			sessionRenameUnavailable: "会话服务不可用，无法重命名",
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
			settingsUsageCodex: "codex额度",
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
			valueOpenCodex: "打开设置：Codex 订阅",
			codexFiveHour: "codex 5h额度",
			codexWeekly: "codex 周额度",
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
			gitStageAllTitle: "暂存全部未暂存文件",
			gitStageAllDone: "已暂存 {count} 个文件",
			gitUnstageAllTitle: "取消暂存全部暂存文件",
			gitUnstageAllDone: "已取消暂存 {count} 个文件",
			gitUnstageDone: "已取消暂存「{path}」",
			gitRevertDone: "已撤销「{path}」的变更",
			gitRevertAllDone: "已撤销 {count} 个文件的未暂存变更",
			gitCommitDone: "提交成功",
			gitOperationFailed: "操作失败：{detail}",
			gitAiFailed: "提交信息生成失败：{detail}",
			gitAiVersionWarn: "已生成并填入提交信息，但版本号可能未按规范递增，请核对后手动调整",
			gitBranchSwitch: "切换分支",
			gitBranchLoading: "加载中…",
			gitBranchEmpty: "当前仓库暂无本地分支",
			gitBranchListFailed: "获取分支列表失败：{detail}",
			gitBranchSwitched: "已切换到分支「{branch}」",
			gitBranchFailed: "切换分支失败：{detail}",
			gitBranchConflict: "切换分支失败：以下文件的本地变更会阻止切换：{files}。请先处理这些变更（提交/暂存/移动或删除）后再试。",
			gitBranchAdd: "添加分支",
			gitBranchAddPlaceholder: "新分支名称…",
			gitBranchAddConfirm: "添加",
			gitBranchCreated: "已创建并切换到分支「{branch}」",
			gitBranchCreateFailed: "添加分支失败：{detail}",
			noteModule: "便笺",
			notePlaceholder: "在这里随手记录…",
			noteClear: "清空",
			noteClearConfirm: "确认?",
			noteClearFailed: "清空失败：无法保存便笺",
			noteSendToChat: "添加至对话",
			noteSendFailed: "添加失败：无法访问当前会话输入框",
			noteSendTargetMissing: "添加失败：当前工作区没有可用的会话",
			todoModule: "待办",
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
			contextModule: "Context window",
			contextCompress: "Compact",
			contextUsed: "{tokens} used",
			contextLimit: "limit {tokens}",
			contextCacheHit: "cache hit {percent}",
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
			sessionRenameCancel: "Cancel",
			sessionRenameConfirm: "Confirm",
			sessionRenameDone: "Session renamed",
			sessionRenameFailed: "Rename failed: {detail}",
			sessionRenameUnavailable: "Session service unavailable; cannot rename",
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
			settingsUsageCodex: "Codex quota",
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
			valueOpenCodex: "Open Settings → Codex subscription",
			codexFiveHour: "Codex 5h quota",
			codexWeekly: "Codex weekly quota",
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
			gitStageAllTitle: "Stage all unstaged files",
			gitStageAllDone: "Staged {count} file(s)",
			gitUnstageAllTitle: "Unstage all staged files",
			gitUnstageAllDone: "Unstaged {count} file(s)",
			gitUnstageDone: "Unstaged 「{path}」",
			gitRevertDone: "Reverted 「{path}」",
			gitRevertAllDone: "Discarded unstaged changes in {count} file(s)",
			gitCommitDone: "Committed successfully",
			gitOperationFailed: "Operation failed: {detail}",
			gitAiFailed: "Commit message generation failed: {detail}",
			gitAiVersionWarn: "Message filled in, but the version number may not follow the increment rule — please verify and adjust manually",
			gitBranchSwitch: "Switch branch",
			gitBranchLoading: "Loading…",
			gitBranchEmpty: "No local branches",
			gitBranchListFailed: "Failed to load branches: {detail}",
			gitBranchSwitched: "Switched to branch \"{branch}\"",
			gitBranchFailed: "Failed to switch branch: {detail}",
			gitBranchConflict: "Failed to switch branch: local changes in these files block the switch: {files}. Commit, stash, move or delete them first.",
			gitBranchAdd: "Add branch",
			gitBranchAddPlaceholder: "New branch name…",
			gitBranchAddConfirm: "Add",
			gitBranchCreated: "Created and switched to branch \"{branch}\"",
			gitBranchCreateFailed: "Failed to create branch: {detail}",
			noteModule: "Notes",
			notePlaceholder: "Jot something down…",
			noteClear: "Clear",
			noteClearConfirm: "Confirm?",
			noteClearFailed: "Clear failed: unable to save the note",
			noteSendToChat: "Add to chat",
			noteSendFailed: "Failed: cannot access the current session input",
			noteSendTargetMissing: "Failed: no session available in this workspace",
			todoModule: "Todo",
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

		// —— HUD 开合状态（模块级 store，localStorage 持久化；无记录默认展开）——
		//     开合状态按会话独立保存：`NEW_SESSION_SCOPE` 为新建会话页的临时态，
		//     从不持久化，故每次新建会话都是隐藏状态；真实会话各写各的键。
		//     旧版本（≤ v0.12.0）把单一布尔值直接存在 HUD_OPEN_KEY 下，首次激活时迁移为
		//     「会话 id → 状态」的对象存储（默认仅作用于该次会话，不扩散到其它会话）。
		const NEW_SESSION_SCOPE = "\u0000new-session";
		const hudPersisted = new Map();
		// 初始作用域即「新建会话页」：面板从隐藏开始，避免刷新后先闪一下展开态
		let hudOpenState = false;
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
				hudOpenState = false;
			} else if (hudPersisted.has("\u0000legacy")) {
				// 旧版本没有会话维度：把上次记忆交给首个会话，之后不再复用
				hudOpenState = hudPersisted.get("\u0000legacy");
				hudPersisted.delete("\u0000legacy");
				hudPersisted.set(next, hudOpenState);
				saveHudStorage();
			} else {
				hudOpenState = hudPersisted.has(next) ? hudPersisted.get(next) : true;
			}
			publishHud();
		}
		/** 渲染期安全版：只读取目标作用域的状态，不切换、不广播（供 useState 初始化）。 */
		function peekHudOpen(sessionId) {
			const next = typeof sessionId === "string" && sessionId !== "" ? sessionId : NEW_SESSION_SCOPE;
			if (next === hudScopeKey) return hudOpenState;
			if (next === NEW_SESSION_SCOPE) return false;
			loadHudStorage();
			if (hudPersisted.has(next)) return hudPersisted.get(next);
			if (hudPersisted.has("\u0000legacy")) return hudPersisted.get("\u0000legacy");
			return true;
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

		// —— 官方 sidebarRight 与 better-sidebar 共用的互斥状态 ——
		let hudBeforeSidebar = false; // 侧边栏打开时被动的 HUD，待侧边栏关闭后恢复
		let pendingOpen = false;      // 打开 HUD 时自动关侧边栏失败 → 延迟打开（Q10）

		/** 官方侧栏没有公开订阅接口；观察其渲染标记，服务负责主动收起。 */
		function sidebarBridge(ctx) {
			return {
				getSnapshot() {
					const official = ctx.get("sidebarRight");
					// 服务绑定在 React useEffect 中更新，比 DOM 提交晚；优先读取已渲染状态。
					const panel = typeof document === "undefined" ? null : document.querySelector("[data-sidebar-right-panel]");
					const officialOpen = panel !== null ? panel.getAttribute("data-sidebar-right-open") === "true" : (official?.isExpanded?.() ?? false);
					return { state: { panelOpen: officialOpen || (ctx.get("betterSidebar")?.getSnapshot().state?.panelOpen ?? false) } };
				},
				subscribeState(listener) {
					const stop = ctx.get("betterSidebar")?.subscribeState(listener);
					const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(listener);
					if (typeof document !== "undefined" && document.body) {
						observer?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-sidebar-right-open"] });
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
		/** 等待右侧面板关闭（timeoutMs 超时）。 */
		function waitSidebarClosed(sidebar, timeoutMs) {
			return new Promise((resolve) => {
				if (!(sidebar.getSnapshot().state?.panelOpen ?? false)) { resolve(true); return; }
				let done = false;
				let unsubscribe = () => {};
				let timer;
				const finish = (ok) => {
					if (done) return;
					done = true;
					window.clearTimeout(timer);
					unsubscribe();
					resolve(ok);
				};
				unsubscribe = sidebar.subscribeState(() => {
					if (!(sidebar.getSnapshot().state?.panelOpen ?? false)) finish(true);
				});
				timer = window.setTimeout(() => finish(false), timeoutMs);
			});
		}
		/** 打开 HUD；若 better-sidebar 面板开着：先尝试自动关闭，失败则记 pendingOpen。 */
		function openHud(ctx) {
			const sidebar = sidebarBridge(ctx);
			if (sidebar !== undefined && (sidebar.getSnapshot().state?.panelOpen ?? false)) {
				const attempted = collapseSidebars(ctx);
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
			/** 当前是否落在新建会话页（面板默认收起、悬浮入口显示）。 */
			const atNewSessionPage = () => {
				try {
					const store = ctx.get("sessions")?.list;
					return store === undefined ? false : isNewSessionPage(store.getSnapshot());
				} catch { return false; }
			};
			const sync = () => {
				const sidebar = sidebarBridge(ctx);
				if (sidebar === undefined) {
					if (unsubscribe !== null) { unsubscribe(); unsubscribe = null; }
					return;
				}
				if (unsubscribe !== null) unsubscribe();
				prevOpen = sidebar.getSnapshot().state?.panelOpen ?? false;
				// 附着时对账：页面加载时侧边栏已处于打开（按会话持久化恢复）且 HUD 记忆为开 →
				// 先让 HUD 让位（与变化事件分支同一语义），避免「HUD 开 + 侧边栏开」共存
				// （面板被遮挡 + 正文 300px 空白推挤）；之后关闭侧边栏经 hudBeforeSidebar 恢复打开。
				if (prevOpen && getHudOpen()) {
					hudBeforeSidebar = true;
					setHudOpen(false);
				}
				unsubscribe = sidebar.subscribeState(() => {
					const open = sidebar.getSnapshot().state?.panelOpen ?? false;
					if (open && !prevOpen) {
						// 侧边栏被打开 → 若 HUD 开启则自动关闭并记住恢复
						if (getHudOpen()) {
							hudBeforeSidebar = true;
							setHudOpen(false);
						}
					} else if (!open && prevOpen) {
						// 侧边栏被关闭 → 恢复被动的 HUD 或延迟打开的 HUD。
						// 新建会话页例外：该页恒从隐藏开始（只存内存态），
						// 若在此恢复会把面板重新拉起、与「每次进入都隐藏」冲突。
						if (hudBeforeSidebar || pendingOpen) {
							hudBeforeSidebar = false;
							pendingOpen = false;
							if (!atNewSessionPage()) setHudOpen(true);
						}
					}
					prevOpen = open;
				});
			};
			sync();
			sync.dispose = () => { unsubscribe?.(); unsubscribe = null; };
			return sync;
		}

		// —— 样式（完全对照 HUD_preview 设计稿：单卡片 + 分隔线分区；
		//     颜色全部经 --dsw-alias-* token / color-mix，支持浅深主题）——
		const css = ".hud-btn{border:1px solid var(--dsw-alias-border-l2);width:32px;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:0;font-size:13px;line-height:20px;display:inline-flex}.hud-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.hud-icon{color:var(--dsw-alias-label-primary)}.hud-panel{position:fixed;right:8px;width:300px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;background:var(--hud-surface-bg,var(--dsw-static-neutral-bluish-00));border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border-radius:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;user-select:none;box-shadow:0 10px 30px rgba(0,0,0,.16)}.hud-panel-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;scrollbar-width:none;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-panel-body::-webkit-scrollbar{width:6px;height:6px}.hud-panel-body::-webkit-scrollbar-thumb{background:transparent;border-radius:999px}.hud-panel-body::-webkit-scrollbar-track{background:transparent}.hud-panel-body[data-scrolling='1']{scrollbar-width:thin}.hud-panel-body[data-scrolling='1']::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2)}.hud-panel-body[data-scrolling='1']::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2)}.hud-panel-body[data-fading='1']{scrollbar-width:thin}.hud-panel-body[data-fading='1']::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-scrollbar-bg-l2) 45%,transparent)}.hud-section{flex:none;border:0;background:0 0}.hud-panel-body>.hud-section{border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-panel-body>.hud-section:first-child{border-top:0}.hud-module-head{display:flex;align-items:center;gap:8px;padding:10px 14px;min-height:20px;cursor:default;position:relative}.hud-module-head[data-fold=true]{cursor:pointer}.hud-module-title{font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}.hud-module-count{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-module-pill{flex:none;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-radius:999px;padding:1px 9px;font-size:11px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary);border:0}.hud-module-fold{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;padding:0;display:inline-flex;align-items:center;justify-content:center;transition:transform .15s var(--ds-ease-in-out,ease)}.hud-module-fold[data-fold=true]{transform:rotate(-90deg)}.hud-module-body{padding:2px 14px 12px;display:flex;flex-direction:column;gap:6px}.hud-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;min-width:0}.hud-row-label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-chip{flex:none;border-radius:999px;padding:1px 9px;font-size:11px;line-height:18px;font-weight:500;border:0}.hud-chip[data-kind=busy]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}.hud-chip[data-kind=done]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent)}.hud-chip[data-kind=warn]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-chip[data-kind=pending]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}.hud-chip[data-kind=idle]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-session-meta{display:flex;flex-direction:column;gap:6px;padding:2px 14px 12px}.hud-session-name-row{display:flex;align-items:center;gap:8px}.hud-session-name{font-weight:500;font-size:13px;line-height:20px;min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-session-rename-btn{flex:none;width:22px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;margin-left:-4px;opacity:0;pointer-events:none;transition:opacity .12s var(--ds-ease-in-out,ease)}.hud-session-rename-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}.hud-session-name-row:hover .hud-session-rename-btn,.hud-session-rename-btn:focus-visible{opacity:1;pointer-events:auto}.hud-session-rename-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.hud-session-edit{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:3px 9px;font-size:13px;line-height:19px;font-family:inherit}.hud-session-edit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-session-edit::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-session-name-row .hud-ic-btn{flex:none}.hud-model-row{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;min-width:0}.hud-model-row .hud-model-note{color:var(--dsw-alias-label-secondary)}.hud-model-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;display:inline-block}.hud-model-chips{display:flex;align-items:center;gap:6px}.hud-model-chip{border-radius:999px;padding:2px 10px;font-size:11px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary);border:0;flex:none}.hud-context-row{display:flex;align-items:center;gap:10px;padding:2px 14px 8px}.hud-bar{flex:1 1 auto;height:8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);overflow:hidden}.hud-bar-fill{height:100%;border-radius:999px;transition:width .3s var(--ds-ease-in-out,ease)}.hud-breakdown{display:flex;align-items:baseline;justify-content:space-between;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:0 14px 12px}.hud-breakdown .hud-used{color:var(--dsw-alias-label-primary)}.hud-btn-small{flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.hud-btn-small:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-btn-small:disabled{opacity:.55;cursor:not-allowed}.hud-file-row{display:flex;align-items:center;gap:8px;font-size:13px;line-height:24px;min-width:0}.hud-file-status{flex:none;border-radius:6px;padding:0 6px;min-width:18px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:11px;line-height:18px;border:1px solid transparent}.hud-file-status[data-kind=M]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 15%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent)}.hud-file-status[data-kind=A]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}.hud-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}.hud-file-status[data-kind=?]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent)}.hud-file-status[data-kind=R]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-status[data-kind=C]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}.hud-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-file-diff{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:18px}.hud-diff-add{color:var(--dsw-alias-state-success-primary)}.hud-diff-del{color:var(--dsw-alias-state-error-primary)}.hud-git-btn{align-self:flex-start}.hud-git-summary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding-top:2px}.hud-balance-value{flex:none;font-weight:600;color:var(--dsw-alias-label-primary)}.hud-click{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}.hud-click:hover{color:var(--dsw-alias-state-business-primary)}.hud-usage-row{padding-left:24px;align-items:center}.hud-subagent-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-subagent-row:hover .hud-subagent-name{color:var(--dsw-alias-brand-primary)}.hud-subagent-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-subagent-arrow{flex:none;color:var(--dsw-alias-label-secondary)}.hud-task-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-task-icon{flex:none;width:16px;height:16px;display:inline-flex}.hud-task-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.hud-task-row[data-done=true] .hud-task-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-mcp-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}.hud-mcp-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.hud-mcp-row[data-off=true] .hud-mcp-name{color:var(--dsw-alias-label-secondary)}.hud-switch{flex:none;width:30px;height:18px;border-radius:999px;border:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);position:relative;cursor:pointer;padding:0;transition:background .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]{background:var(--dsw-alias-state-success-primary)}.hud-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s var(--ds-ease-in-out,ease)}.hud-switch[data-on=true]::after{left:14px}.hud-settings-btn{flex:none;border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px;display:inline-flex;border-radius:6px}.hud-settings-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-settings-pop{position:fixed;z-index:2147483000;width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px;display:flex;flex-direction:column;gap:2px}.hud-settings-title{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);padding:2px 6px}.hud-settings-title-gap{margin-top:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-settings-item{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:13px;line-height:19px}.hud-settings-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-item input{accent-color:var(--dsw-alias-brand-primary)}.hud-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:6px 0 2px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);margin-top:4px}.hud-settings-btn{flex:none;border-radius:8px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-settings-btn[data-kind=cancel]{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.hud-settings-btn[data-kind=cancel]:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-settings-btn[data-kind=confirm]{border:1px solid transparent;background:var(--dsw-alias-state-business-primary);color:#fff}.hud-settings-btn[data-kind=confirm]:hover{filter:brightness(1.06)}.hud-modal{position:fixed;inset:0;z-index:2147483001;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}.hud-modal-card{width:min(680px,calc(100vw - 40px));max-height:min(70vh,calc(100vh - 48px));display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary);box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;animation:hud-modal-in .16s var(--ds-ease-in-out,ease)}.hud-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}.hud-modal-title{flex:1 1 auto;min-width:0;font-weight:600;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-modal-close{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;flex:none}.hud-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover)}.hud-modal-close:focus-visible,.hud-git-btn:focus-visible,.hud-btn:focus-visible,.hud-git-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.hud-modal-body{min-height:0;padding:12px 14px 14px;display:flex;flex-direction:column}.hud-git-graph{flex:1 1 auto;min-height:120px;overflow:auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-rows{display:flex;flex-direction:column;gap:2px;min-width:0;padding-bottom:2px}.hud-git-item{display:flex;align-items:stretch;min-width:0;border-radius:8px;box-sizing:border-box;background:transparent;transition:background .12s var(--ds-ease-in-out,ease)}.hud-git-item[data-open=true]{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}.hud-git-lane{position:relative;flex:none;border-radius:8px 0 0 8px;min-height:40px}.hud-git-lane-svg{position:absolute;left:0;top:0;display:block;pointer-events:none}.hud-git-content{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}.hud-git-head{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:40px;padding:0 14px 0 10px;box-sizing:border-box;border:0;background:0 0;border-radius:8px;cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary);font:inherit}.hud-git-head:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}.hud-git-head[data-open=true]{border-radius:8px 8px 0 0}.hud-git-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:19px;font-weight:500;color:var(--dsw-alias-label-primary)}.hud-git-subject[data-open=true]{font-weight:600}.hud-git-refs{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:40%;overflow:hidden}.hud-git-ref{flex:none;display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:1px 7px;font-size:10px;line-height:16px;border:1px solid transparent;white-space:nowrap}.hud-git-ref[data-kind=branch]{color:#fff;background:var(--dsw-alias-state-business-primary);border-color:transparent;font-weight:500}.hud-git-ref[data-kind=head]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent)}.hud-git-ref[data-kind=tag]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}.hud-git-date{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.hud-git-drawer{min-height:0;overflow:auto;box-sizing:border-box;padding:0 14px 10px 18px;display:flex;flex-direction:column;justify-content:flex-start;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-git-file{display:flex;align-items:center;gap:8px;height:26px;min-width:0;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei')}.hud-git-file-badge{flex:none;width:32px;font-size:11px;line-height:16px;font-weight:700;color:var(--dsw-alias-label-secondary)}.hud-git-file-badge[data-kind=js]{color:#f3b020}.hud-git-file-badge[data-kind=ts]{color:var(--dsw-alias-state-business-primary)}.hud-git-file-badge[data-kind=svg]{color:#22c55e}.hud-git-file-name{flex:none;max-width:56%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-git-file-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);padding-right:8px}.hud-git-file-status{flex:none;width:18px;text-align:right;font-size:12px;line-height:19px;font-weight:700}.hud-git-file-status[data-kind=M]{color:var(--dsw-alias-state-warn-primary)}.hud-git-file-status[data-kind=A]{color:var(--dsw-alias-state-success-primary)}.hud-git-file-status[data-kind=D]{color:var(--dsw-alias-state-error-primary)}.hud-git-file-status[data-kind=R],.hud-git-file-status[data-kind=C]{color:var(--dsw-alias-state-business-primary)}.hud-git-file-status[data-kind='?']{color:var(--dsw-alias-state-error-primary)}.hud-git-file-empty{display:flex;align-items:center;height:26px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-git-menu{position:fixed;z-index:2147483005;width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 10px 34px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}.hud-git-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;cursor:pointer;text-align:left}.hud-git-menu-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-git-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-git-menu-item .hud-icon{color:var(--dsw-alias-label-secondary)}.hud-git-tip{position:fixed;z-index:2147483006;max-width:460px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--hud-surface-bg);box-shadow:0 8px 26px rgba(0,0,0,.2);padding:7px 10px;pointer-events:none;animation:hud-tip-in .12s var(--ds-ease-in-out,ease);display:flex;flex-direction:column;gap:2px}.hud-git-tip[data-below=false]{transform:translateY(-100%)}.hud-git-tip-subject{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.hud-git-tip-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');word-break:break-all}@keyframes hud-tip-in{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.hud-git-tip{animation:none}}.hud-graph-loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:120px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:4px 2px}.hud-spinner{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);border-top-color:var(--dsw-alias-state-business-primary);animation:hud-spin .7s linear infinite}.hud-graph-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:6px 2px}@keyframes hud-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}@keyframes hud-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.hud-modal-card{animation:none}.hud-spinner{animation-duration:1.4s}}.hud-toasts{position:fixed;bottom:12px;right:12px;z-index:2147483002;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}.hud-toast{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:9px;padding:8px 12px;font-size:13px;line-height:19px;box-shadow:0 4px 16px rgba(0,0,0,.16)}.hud-toast[data-kind=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-error-primary)}.hud-toast[data-kind=success]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-success-primary)}.hud-toast[data-kind=warn]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-warn-primary)}body{--hud-surface-bg:var(--dsw-static-neutral-bluish-00);--hud-lane-0:#4176e6;--hud-lane-1:#22c55e;--hud-lane-2:#f59e0b;--hud-lane-3:#f25a5a;--hud-lane-4:#60a5fa;--hud-lane-5:#7c3aed}body[data-ds-dark-theme]{--hud-surface-bg:var(--dsw-static-neutral-bluish-900);--hud-lane-0:#679efe;--hud-lane-1:#4ed17e;--hud-lane-2:#f7ad31;--hud-lane-3:#f25a5a;--hud-lane-4:#93c5fd;--hud-lane-5:#a78bfa}.hud-plan-row{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0;cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-primary);width:100%;text-align:left;font-size:13px;line-height:20px;border-radius:6px}.hud-plan-row:hover .hud-plan-name{color:var(--dsw-alias-brand-primary)}.hud-plan-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-plan-row[data-state=discarded] .hud-plan-name,.hud-plan-row[data-state=approved] .hud-plan-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-plan-meta{display:flex;align-items:center;gap:8px;padding:0 0 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.hud-plan-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 2px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-plan-body h1{font-size:17px;line-height:24px;font-weight:700;margin:10px 0 6px}.hud-plan-body h1:first-child{margin-top:0}.hud-plan-body h2{font-size:15px;line-height:22px;font-weight:700;margin:10px 0 6px}.hud-plan-body h3{font-size:14px;line-height:20px;font-weight:700;margin:8px 0 5px}.hud-plan-body h4,.hud-plan-body h5,.hud-plan-body h6{font-size:13px;line-height:19px;font-weight:700;margin:8px 0 5px}.hud-plan-body p{margin:5px 0}.hud-plan-body ul,.hud-plan-body ol{margin:5px 0;padding-left:22px}.hud-plan-body li{margin:2px 0}.hud-plan-body code{font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);border-radius:4px;padding:1px 5px}.hud-plan-body pre{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:8px;padding:8px 10px;overflow:auto;margin:6px 0}.hud-plan-body pre code{background:0 0;padding:0;font-size:12px;line-height:18px;white-space:pre}.hud-plan-body a{color:var(--dsw-alias-state-business-primary);text-decoration:underline;text-underline-offset:3px}.hud-plan-body blockquote{margin:6px 0;padding:2px 12px;border-left:3px solid color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);color:var(--dsw-alias-label-secondary)}.hud-plan-body hr{border:0;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:8px 0}.hud-task-progress{color:var(--dsw-alias-state-business-primary);fill:none;display:block;animation:1s linear infinite hud-task-spin}@keyframes hud-task-spin{to{transform:rotate(360deg)}}.hud-plan-body .hud-plan-table-wrap{max-width:100%;overflow-x:auto;margin:6px 0}.hud-plan-body table{border-collapse:collapse;font-size:12.5px;line-height:19px;min-width:100%}.hud-plan-body th,.hud-plan-body td{border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);padding:4px 8px;text-align:left;vertical-align:top}.hud-plan-body th{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);font-weight:600}.hud-plan-body table code{font-size:11.5px}.hud-git-actions{display:flex;align-items:center;gap:4px;flex-wrap:nowrap;padding-bottom:2px}.hud-git-actions .hud-btn-small{flex:none;white-space:nowrap;gap:4px;padding:4px 9px}.hud-icon[data-size] svg{width:13px!important;height:13px!important}.hud-icon[data-size='14'] svg{width:14px!important;height:14px!important}.hud-git-group{flex:none;display:flex;align-items:baseline;gap:7px;padding:8px 0 2px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}.hud-git-group-count{flex:none;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary)}.hud-git-group-btn{flex:none;width:18px;height:18px;margin-left:auto;padding:0;border:0;border-radius:99px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-git-group-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}.hud-git-group-btn:disabled{opacity:.4;cursor:not-allowed}.hud-git-file-btn{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:2px 4px;box-sizing:border-box;border:0;border-radius:6px;background:0 0;cursor:pointer;text-align:left;font-size:13px;line-height:24px;color:var(--dsw-alias-label-primary)}.hud-git-file-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}.hud-git-file-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.hud-git-file-btn .hud-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-confirm-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px}.hud-confirm-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}.hud-confirm-note-danger{color:var(--dsw-alias-state-error-primary)}.hud-confirm-list{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:8px;padding:6px 10px;display:flex;flex-direction:column;gap:2px;font-family:var(--ds-font-family-code,ui-monospace,'SF Mono','JetBrains Mono','Fira Code',Consolas,'Liberation Mono',Menlo,Courier,'PingFang SC','Microsoft YaHei');font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.hud-confirm-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);padding-top:10px}.hud-btn-danger{flex:none;border:1px solid transparent;background:var(--dsw-alias-state-error-primary);color:#fff;border-radius:8px;padding:3px 12px;font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.hud-btn-danger:hover{filter:brightness(1.06)}.hud-btn-danger:disabled{opacity:.55;cursor:not-allowed}.hud-commit-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}.hud-commit-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:7px 10px;font-size:13px;line-height:19px}.hud-commit-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-commit-input::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-commit-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);padding-top:10px}.hud-btn-ai{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer}.hud-btn-ai:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}.hud-btn-ai:disabled{opacity:.55;cursor:not-allowed}.hud-git-more{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 2px 4px}.hud-git-more-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 16px;font-size:12px;line-height:18px;cursor:pointer}.hud-git-more-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.hud-git-more-btn:disabled{opacity:.55;cursor:not-allowed}.hud-git-more-loading{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.hud-git-more-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;text-align:center;flex-wrap:wrap}.hud-git-more-end{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:8px 2px 4px}.hud-note-area{box-sizing:border-box;width:100%;min-height:56px;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:8px 10px;font-size:13px;line-height:19px;font-family:inherit}.hud-note-area:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-note-area::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-note-wrap{position:relative}.hud-note-resize{position:absolute;left:0;right:0;bottom:0;height:8px;cursor:ns-resize;touch-action:none;z-index:1;display:flex;align-items:flex-end;justify-content:center}.hud-note-resize::after{content:'';position:absolute;left:8px;right:8px;bottom:2px;height:2px;border-radius:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);transition:background .12s var(--ds-ease-in-out,ease)}.hud-note-resize:hover::after,.hud-note-resize:active::after{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent)}.hud-note-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.hud-note-actions{display:flex;align-items:center;justify-content:space-between;gap:6px}.hud-note-buttons{display:flex;align-items:center;gap:6px}.hud-todo-input-row{display:flex;align-items:center;gap:6px}.hud-todo-input{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:6px 9px;font-size:13px;line-height:18px;font-family:inherit}.hud-todo-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-todo-input::placeholder{color:var(--dsw-alias-label-tertiary)}.hud-ic-btn{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-ic-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}.hud-ic-btn:disabled{opacity:.45;cursor:not-allowed}.hud-ic-btn[data-kind=confirm]:hover:not(:disabled){color:var(--dsw-alias-state-success-primary)}.hud-todo-list{display:flex;flex-direction:column;gap:2px}.hud-todo-item{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:8px;min-width:0}.hud-todo-item[data-dragging=true]{opacity:.45}.hud-todo-item[data-over=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}.hud-todo-check{flex:none;width:20px;height:20px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-todo-check:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-todo-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}.hud-todo-item[data-done=true] .hud-todo-text{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.hud-todo-edit{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:3px 8px;font-size:13px;line-height:18px;font-family:inherit}.hud-todo-edit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-todo-grip{flex:none;width:22px;height:24px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;display:inline-flex;align-items:center;justify-content:center;padding:0}.hud-todo-grip:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-secondary)}.hud-todo-grip:active{cursor:grabbing}.hud-modal-card-sm{width:min(360px,calc(100vw - 40px))}.hud-branch-switch{max-width:150px}.hud-branch-switch .hud-icon{color:inherit}.hud-branch-switch span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-branch-menu{position:fixed;z-index:2147483005;min-width:210px;max-width:280px;max-height:min(320px,50vh);overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--hud-surface-bg);box-shadow:0 10px 34px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}.hud-branch-add{flex:none;display:flex;align-items:center;gap:4px;padding:1px 2px}.hud-branch-add-input{box-sizing:border-box;flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-primary);padding:4px 8px;font-size:12px;line-height:18px;font-family:inherit}.hud-branch-add-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.hud-branch-divider{flex:none;height:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:2px 4px}.hud-branch-scroll{overflow-y:auto;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;gap:2px}.hud-branch-menu .hud-git-menu-item[data-current=true]{color:var(--dsw-alias-state-business-primary);font-weight:600}.hud-branch-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.hud-branch-check{flex:none;width:14px;text-align:center}.hud-branch-note{padding:5px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.hud-branch-note-error{color:var(--dsw-alias-state-error-primary)}.hud-git-menu-divider{flex:none;height:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:3px 4px}.hud-git-menu-item:disabled{opacity:.55;cursor:not-allowed}.hud-git-menu-item:disabled:hover{background:0 0}.hud-btn[data-open=false]{color:var(--dsw-alias-label-tertiary)}.hud-btn[data-open=false]:hover{color:var(--dsw-alias-label-secondary)}.hud-module-head .hud-branch-switch{margin-left:-4px}";

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
			return { context: true, git: true, subagents: true, tasks: true, mcp: true, balance: true, plans: true, note: true, todo: true };
		}
		function defaultUsageDisplay() {
			return { deepseek: true, opencode: true, codex: true };
		}

		const inject = ["slots", "locale"];

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
				tag.textContent += ".hud-btn-ai{background:var(--hud-surface-bg)}.hud-btn-ai:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}.hud-btn-danger,.hud-git-menu-confirm{border:1px solid var(--dsw-alias-state-error-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-state-error-primary)}.hud-btn-danger:hover:not(:disabled),.hud-git-menu-confirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--hud-surface-bg));filter:none}.hud-note-clear-confirm{border:1px solid var(--dsw-alias-state-error-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-state-error-primary)}.hud-note-clear-confirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--hud-surface-bg));filter:none}";
				tag.textContent += ".hud-git-menu-cancel{border:1px solid var(--dsw-alias-label-primary);background:var(--hud-surface-bg);color:var(--dsw-alias-label-primary)}.hud-git-menu-cancel:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--hud-surface-bg))}.hud-git-menu-branch-create{display:flex;align-items:center;gap:4px;padding:1px 2px}";
				// 新建会话页悬浮入口：固定贴视口右上角（与标题栏按钮同一视觉位置）
				tag.textContent += `.hud-btn-float{position:fixed;top:${HUD_FLOAT_INSET}px;z-index:2147482000}`;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "dsh-awesome-hud: styles");

			ctx.effect(() => {
				const sync = attachSidebarWatcher(ctx);
				const stop = typeof ctx.on === "function" ? ctx.on("slots/changed", () => sync()) : null;
				return () => { if (stop !== null) stop(); sync.dispose(); };
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

			// —— 头部按钮：HUD 面板（面板关闭时图标置灰）——
			function HudButton() {
				const [open, setOpen] = react.useState(getHudOpen());
				react.useEffect(() => subscribeHud(() => setOpen(getHudOpen())), []);
				return react.createElement("button", {
					type: "button",
					className: "hud-btn",
					"data-open": open,
					"aria-label": t(open ? "hudClose" : "hudOpen"),
					title: t("hudLabel"),
					onClick: () => toggleHud(ctx),
				}, react.createElement(Icon, { name: "hud-toggle", color: open ? undefined : "var(--dsw-alias-label-tertiary)" }));
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
				note: () => t("noteModule"),
				todo: () => t("todoModule"),
			};

			function SettingsMenu(props) {
				const [draft, setDraft] = react.useState(() => ({ ...(props.modules ?? defaultModules()) }));
				const [usageDraft, setUsageDraft] = react.useState(() => ({ ...(props.usage ?? defaultUsageDisplay()) }));
				const keys = MODULE_KEYS.filter((key) => key !== "balance" || props.balanceAvailable === true);
				const usageAvailability = props.usageAvailability ?? {
					deepseek: props.balanceAvailable === true,
					opencode: props.balanceAvailable === true,
					codex: false,
				};
				const usageKeys = ["deepseek", "opencode", "codex"].filter((key) => usageAvailability[key] === true);
				const usageLabel = (key) => key === "deepseek" ? t("settingsUsageDeepseek") : key === "opencode" ? t("settingsUsageOpencode") : t("settingsUsageCodex");
				const usageIcon = (key) => key === "deepseek" ? "deepseek" : key === "opencode" ? "icon-opencode" : "ChatGPT";
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
					usageKeys.length === 0 ? null : react.createElement(react.Fragment, null,
						react.createElement("div", { className: "hud-settings-title hud-settings-title-gap" }, t("settingsUsageTitle")),
						usageKeys.map((key) => react.createElement("label", { className: "hud-settings-item", key: `usage-${key}` },
							react.createElement("input", {
								type: "checkbox",
								checked: usageDraft[key] !== false,
								onChange: (event) => { setUsageDraft((prev) => ({ ...prev, [key]: event.target.checked })); },
							}),
							react.createElement(Icon, { name: usageIcon(key), color: "var(--dsw-alias-label-primary)" }),
							react.createElement("span", null, usageLabel(key))))),
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
						react.createElement(SettingsMenu, { modules: props.modules, usage: props.usage, balanceAvailable: props.balanceAvailable, usageAvailability: props.usageAvailability, onConfirm: (draft, usageDraft) => { props.onModulesChange(draft); props.onUsageChange?.(usageDraft); setMenuOpen(false); }, onCancel: () => setMenuOpen(false), style }),
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
							react.createElement(RenameSessionName, { sessionTitle: props.sessionTitle, onRename: props.onRename, statusKind: props.statusKind, statusText: props.statusText })),
						react.createElement("div", { className: "hud-model-row" },
							react.createElement("span", { className: "hud-model-dot" }),
							react.createElement("span", null, props.providerLabel ?? ""),
							react.createElement("span", { className: "hud-model-note" }, "")),
						react.createElement("div", { className: "hud-model-chips" },
							props.modelId === null ? null : react.createElement("span", { className: "hud-model-chip" }, props.modelId),
							props.effortLabel === null ? null : react.createElement("span", { className: "hud-model-chip" }, props.effortLabel))));
			}

			/** 会话名称行：默认显示「重命名」按钮 + 名称 + 状态徽标；编辑态为输入框 + 取消/确认。 */
			function RenameSessionName(props) {
				const [editing, setEditing] = react.useState(false);
				const [draft, setDraft] = react.useState("");
				const [saving, setSaving] = react.useState(false);
				const inputRef = react.useRef(null);
				const startEdit = () => {
					setDraft(props.sessionTitle ?? "");
					setEditing(true);
				};
				const cancelEdit = () => { setEditing(false); setDraft(""); };
				const confirmEdit = async () => {
					const text = draft.trim();
					if (text === "" || saving) return;
					setSaving(true);
					try {
						await props.onRename?.(text);
						setEditing(false);
						setDraft("");
						toast(t("sessionRenameDone"), "success");
					} catch (error) {
						toast(interpolate(t("sessionRenameFailed"), { detail: error?.message ?? String(error) }), "error");
					} finally {
						setSaving(false);
					}
				};
				react.useEffect(() => {
					if (!editing) return undefined;
					const el = inputRef.current;
					if (el === null || el === undefined) return undefined;
					el.focus();
					el.select();
					return undefined;
				}, [editing]);
				if (editing) {
					return react.createElement(react.Fragment, null,
						react.createElement("input", {
							ref: inputRef,
							type: "text",
							className: "hud-session-edit",
							value: draft,
							maxLength: 200,
							placeholder: props.sessionTitle ?? "",
							disabled: saving,
							"aria-label": t("sessionRename"),
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter") { event.preventDefault(); confirmEdit(); }
								else if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
							},
						}),
						react.createElement("button", {
							type: "button",
							className: "hud-ic-btn",
							disabled: saving,
							title: t("sessionRenameCancel"),
							"aria-label": t("sessionRenameCancel"),
							onClick: cancelEdit,
						}, react.createElement(Icon, { name: "close", size: 13 })),
						react.createElement("button", {
							type: "button",
							className: "hud-ic-btn",
							"data-kind": "confirm",
							disabled: saving || draft.trim() === "",
							title: t("sessionRenameConfirm"),
							"aria-label": t("sessionRenameConfirm"),
							onClick: confirmEdit,
						}, react.createElement(Icon, { name: "check", size: 14 })));
				}
				return react.createElement(react.Fragment, null,
					react.createElement("div", { className: "hud-session-name", title: props.sessionTitle }, props.sessionTitle),
					react.createElement("button", {
						type: "button",
						className: "hud-session-rename-btn",
						title: t("sessionRename"),
						"aria-label": t("sessionRename"),
						onClick: startEdit,
					}, react.createElement(Icon, { name: "rename", size: 13 })),
					react.createElement("span", { className: "hud-chip", "data-kind": props.statusKind }, props.statusText));
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

			// —— 上下文窗口模块（不可折叠）——
			function ContextModule(props) {
				const pressure = props.pressure;
				const cacheHit = cacheHitPercent(props.usage);
				// 压缩状态按会话独立（Map 键控）：各会话互不影响，切换会话后另一会话不残留「压缩中」。
				const [compactingMap, setCompactingMap] = react.useState({});
				const compacting = compactingMap[props.sessionId] === true;
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
						react.createElement("span", { className: "hud-breakdown-item hud-used" }, interpolate(t("contextUsed"), {
							tokens: pressure !== null && pressure.projectedTokens !== undefined ? formatTokens(pressure.projectedTokens) : "—",
						})),
						react.createElement("span", { className: "hud-breakdown-sep", "aria-hidden": true }, "·"),
						react.createElement("span", { className: "hud-breakdown-item" }, interpolate(t("contextLimit"), {
							tokens: pressure !== null && pressure.contextWindow !== undefined ? formatTokens(pressure.contextWindow) : "—",
						})),
						react.createElement("span", { className: "hud-breakdown-sep", "aria-hidden": true }, "·"),
						react.createElement("span", { className: "hud-breakdown-item" }, interpolate(t("contextCacheHit"), {
							percent: cacheHit === null ? "—" : `${cacheHit}%`,
						}))));
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
			/**
			 * 新建会话页 + 空白会话过渡态（无会话 id，或当前会话仍为 blank）：
			 * 悬浮入口、面板几何、侧边栏恢复守卫共用同一判定。
			 */
			function isNewSessionPage(snapshot) {
				if (snapshot === null || snapshot === undefined) return false;
				const current = snapshot.current;
				if (current === undefined || current === null) return true;
				return (snapshot.byId?.[current]?.blank ?? false) === true;
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
			function resolveTargetWorkspace(snapshot, workspaceItems) {
				const empty = { path: null, candidates: [], gitSessionId: null, sendSessionId: null, workspaceTitle: null };
				const items = Array.isArray(workspaceItems) ? workspaceItems : [];
				const current = snapshot?.current;
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
				};
			}
			/** 新建会话页的面板模块筛选：与用户模块设置取交集，并剔除该页无数据源的模块。 */
			function panelVisibleModules(settings, gitAvailable, newSession) {
				const normalized = settings !== null && typeof settings === "object" ? settings : null;
				const flagOf = (key) => normalized === null ? true : normalized[key] !== false;
				const modules = {};
				for (const key of MODULE_KEYS) {
					modules[key] = newSession
						? flagOf(key) && (key !== "git" || gitAvailable === true) && NEW_SESSION_MODULE_KEYS.includes(key)
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

			/** 图形化 git 提交图：左侧泳道（CSS/SVG 混排）+ 右侧提交行。
			 *  行点击展开文件抽屉（参考 UI），右键打开复制菜单。 */
			const GIT_FILE_H = 26;
			const GIT_DRAWER_PAD = 12;
			const GIT_DRAWER_MAX = 240;
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
					setMenu({ x, y, commit, reset: { allowed: null, code: "checking" }, confirmMode: null });
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
					const disabled = mergeBusy || resetBusy || menu.confirmMode !== null || menu.branchCreate !== null || onMergeCommit === null;
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
				branchCreateOpenRef.current = menu !== null && menu.branchCreate !== null;
				const createBranchHere = async () => {
					if (menu === null || menu.branchCreate === null || branchCreateBusy || onCreateBranch === null) return;
					const name = menu.branchCreate.text.trim();
					if (name === "") return;
					// 失败时不关闭菜单：输入行保持展开且文本保留，便于改名后重试
					const succeeded = await onCreateBranch(menu.commit, name);
					if (succeeded === true) closeMenu(false);
				};
				const renderBranchCreateItem = () => {
					if (menu === null) return null;
					// 守卫复用菜单打开时已有的 reset-status 预检：Git 续作进行中，或首次检查未返回时置灰
					const blocked = menu.reset?.code === "operation-in-progress" || (onResetStatus !== null && menu.reset?.allowed === null);
					if (menu.branchCreate !== null) {
						const text = menu.branchCreate.text;
						return react.createElement("div", { className: "hud-git-menu-branch-create", key: "branch-create" },
							react.createElement("input", {
								type: "text",
								className: "hud-branch-add-input",
								value: text,
								autoFocus: true,
								disabled: branchCreateBusy,
								placeholder: t("gitBranchAddPlaceholder"),
								"aria-label": t("gitBranchCreateHere"),
								onChange: (event) => setMenu((prev) => prev === null || prev.branchCreate === null ? prev : { ...prev, branchCreate: { text: event.target.value } }),
								onKeyDown: (event) => {
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
					const disabled = resetBusy || mergeBusy || menu.reset?.allowed !== true || menu.confirmMode !== null || menu.branchCreate !== null || onResetCommit === null;
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
						react.createElement("div", { className: "hud-git-tip-meta" },
							`${tip.commit.hash} · ${tip.commit.date}`)));
			}

			function GitModule(props) {
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
					if (name === (props.git.branch ?? null)) { closeBranchMenu(); return; }
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
				// 菜单打开期间：点击外部 / Escape 关闭
				react.useEffect(() => {
					if (branchMenu === null) return undefined;
					const onDown = (event) => {
						const target = event.target;
						if (target instanceof Element && target.closest(".hud-branch-menu,.hud-branch-switch") !== null) return;
						closeBranchMenu();
					};
					const onKey = (event) => { if (event.key === "Escape") closeBranchMenu(); };
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
				// revert 置灰条件：存在任何未暂存变更（含未跟踪新建文件——revert 全部会一并删除它们）
				const revertableCount = props.git.counts?.unstaged ?? changesFiles.length;
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
						props.onGit(body);
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
					// revert 全部覆盖未暂存区全部文件：已跟踪还原内容、未跟踪（新建）文件删除
					const files = props.git.files.filter((item) => item.unstaged === true);
					if (files.length === 0) return;
					setConfirm({ kind: "revert-all", files });
				};
				const cancelConfirm = () => setConfirm(null);
				const confirmRevert = () => {
					const current = confirm;
					if (current === null) return;
					setConfirm(null);
					if (current.kind === "revert-all") {
						runWrite("git/revert-all", {}, () => toast(interpolate(t("gitRevertAllDone"), { count: current.files.length }), "success"));
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
						if (body.warn) toast(t("gitAiVersionWarn"), "warn");
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
					const hasUntracked = files.some((item) => item.status === "?");
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
								react.createElement(Icon, { name: "revert", size: 13 }),
								react.createElement("span", { className: "hud-modal-title" }, isAll ? t("gitRevertAllTitle") : t("gitRevertFileTitle")),
								react.createElement("button", { type: "button", className: "hud-modal-close", onClick: cancelConfirm }, t("closeModal"))),
							react.createElement("div", { className: "hud-modal-body" },
								react.createElement("div", { className: "hud-confirm-body" },
									react.createElement("div", { className: hasUntracked || confirm.file?.status === "?" ? "hud-confirm-note hud-confirm-note-danger" : "hud-confirm-note" }, note),
									react.createElement("div", { className: "hud-git-group" },
										react.createElement("span", null, t("gitAffectedFiles")),
										react.createElement("span", { className: "hud-git-group-count" }, String(files.length))),
									react.createElement("div", { className: "hud-confirm-list" },
										files.map((file) => react.createElement("div", { key: file.path },
											file.status === "?" ? `? ${file.path}` : file.path))),
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
						// 点击外部不关闭：仅「关闭」按钮 / commit 按钮 / Escape 可关闭
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
									react.createElement("textarea", {
										ref: commitInputRef,
										className: "hud-commit-input",
										rows: 3,
										placeholder: t("gitCommitPlaceholder"),
										value: commitMessage,
										onChange: (event) => setCommitMessage(event.target.value),
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
							// 标题固定为 git；当前分支名移至右侧切换按钮展示
							title: "git",
							countText: props.git.changedCount > 0 ? interpolate(t("gitChangedCount"), { count: props.git.changedCount }) : null,
							fold: props.fold,
							onToggle: () => props.onFoldChange(!props.fold),
							extra: props.git.branch === null || props.git.branch === undefined || props.git.branch === ""
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
									react.createElement("span", null, props.git.branch)),
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
								}, react.createElement(Icon, { name: "revert", size: 13 }), "revert")),
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
								stagedFiles.map((file) => renderFileRow(file, "staged"))),
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
							react.createElement("div", { className: "hud-git-summary" }, summaryText))),
					modal,
					fileMenu,
					confirmModal,
					commitModal,
					branchMenu === null ? null : react.createElement("div", {
						ref: branchMenuRef,
						className: "hud-branch-menu",
						role: "menu",
						// position/zIndex 内联兜底：任何情况下菜单都是浮层，不占文档流（避免破坏 .hud-section 相邻分隔线）；
						// ready 前隐藏：定位/列表加载完成前不显示，杜绝闪现
						style: { position: "fixed", zIndex: 2147483005, top: branchMenu.top, left: branchMenu.left, visibility: branchMenu.ready ? "visible" : "hidden" },
					},
						// 顶层「添加分支」：点击原地展开输入框（输入 + 取消 + 添加）
						react.createElement("div", { className: "hud-branch-add" },
							branchAddOpen
								? react.createElement(react.Fragment, null,
									react.createElement("input", {
										ref: branchAddInputRef,
										className: "hud-branch-add-input",
										value: branchAddText,
										autoFocus: true,
										placeholder: t("gitBranchAddPlaceholder"),
										onChange: (event) => setBranchAddText(event.target.value),
										onKeyDown: (event) => {
											if (event.key === "Enter") { event.stopPropagation(); createBranch(); }
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

			// —— 「便笺」模块：按工作区共享（无 cwd 时降级会话级）+ localStorage 持久化；
			//     底部可拖拽调高度的 textarea +「添加至对话」把内容追加进目标会话输入框
			//     （composer draft），不清空便笺 ——
			/** 将文本追加到当前会话输入框（composer draft，空格分隔；同 better-sidebar 的 appendToDraft 语义）。 */
			function appendToComposer(sessionId, text) {
				if (sessionId === "" || typeof text !== "string" || text.trim() === "") return false;
				try {
					const actx = ctx.get("sessions")?.scope?.(sessionId);
					if (actx === undefined) return false;
					const conversation = ctx.get("conversation");
					if (conversation === undefined) return false;
					const input = conversation.input?.for?.(actx);
					if (input === undefined || input.state === undefined || typeof input.setDraft !== "function") return false;
					const draft = String(input.state.getSnapshot().draft ?? "");
					input.setDraft(draft.trim() === "" ? text : `${draft.trim()} ${text}`);
					return true;
				} catch { return false; }
			}

			const NOTE_MAX_LEN = 5000;
			const NOTE_STORAGE_VERSION = 3;
			const NOTE_DEFAULT_HEIGHT = 180;
			const NOTE_CLEAR_CONFIRM_MS = 2000;
			const NOTE_CHANGE_EVENT = "dsh-awesome-hud:note-change";

			/** 便笺持久化作用域：工作区路径可用 → 工作区键；否则降级会话级（不跨项目共享）。 */
			function noteScope(props) {
				return props.workspaceKey === null || props.workspaceKey === undefined || props.workspaceKey === ""
					? { key: props.sessionId, workspace: false }
					: { key: props.workspaceKey, workspace: true };
			}
			/** 读取便笺（按作用域键）：缺失 → null，调用方回落到默认值。 */
			function readNoteEntry(key) {
				if (typeof key !== "string" || key === "") return null;
				const entry = loadJsonStorage(NOTES_STORAGE_KEY)?.[key] ?? null;
				if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
				return {
					text: typeof entry.text === "string" ? entry.text : "",
					// 仅 v3 数据继续使用持久化高度；v2 及更早记录重置为 180px 默认值
					height: entry.v === NOTE_STORAGE_VERSION && typeof entry.height === "number" && entry.height >= 56 ? entry.height : NOTE_DEFAULT_HEIGHT,
					updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
				};
			}
			/**
			 * 便笺初始化：工作区作用域首次访问时先按候选会话做一次性归并迁移
			 * （取 updatedAt 最新的旧会话级便笺），再读取结果。
			 */
			function initialNoteEntry(props) {
				const scope = noteScope(props);
				if (!scope.workspace) return readNoteEntry(scope.key) ?? { text: "", height: NOTE_DEFAULT_HEIGHT, updatedAt: 0 };
				const storage = loadJsonStorage(NOTES_STORAGE_KEY) ?? {};
				migrateWorkspaceScope(storage, scope.key, props.workspaceCandidates);
				return readNoteEntry(scope.key) ?? { text: "", height: NOTE_DEFAULT_HEIGHT, updatedAt: 0 };
			}
			/** 便笺写入（带 updatedAt，供后续迁移判定「最新一份」）。 */
			function persistNoteEntry(scope, value) {
				const payload = { text: value.text, height: value.height, updatedAt: Date.now(), v: NOTE_STORAGE_VERSION };
				try {
					const storage = globalThis.localStorage;
					if (storage === undefined || storage === null || typeof storage.setItem !== "function") return { payload, persisted: false };
					const map = loadJsonStorage(NOTES_STORAGE_KEY) ?? {};
					map[scope.key] = payload;
					storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(map));
					return { payload, persisted: true };
				} catch { /* 存储不可用仅内存 */
					return { payload, persisted: false };
				}
			}

			function publishNoteChange(key) {
				if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
				try {
					globalThis.dispatchEvent(new globalThis.CustomEvent(NOTE_CHANGE_EVENT, { detail: { key } }));
				} catch { /* 事件通知不可用不影响当前便笺 */ }
			}

			function noteClearAction(text, confirming) {
				if (typeof text !== "string" || text === "") return "noop";
				return confirming ? "clear" : "confirm";
			}

			function NoteModule(props) {
				const scope = react.useMemo(() => noteScope(props), [props.workspaceKey, props.sessionId]);
				const [note, setNote] = react.useState(() => initialNoteEntry(props));
				const [clearConfirming, setClearConfirming] = react.useState(false);
				const areaRef = react.useRef(null);
				const clearButtonRef = react.useRef(null);
				const clearTimerRef = react.useRef(null);
				const cancelClearConfirmation = react.useCallback(() => {
					if (clearTimerRef.current !== null) {
						globalThis.clearTimeout?.(clearTimerRef.current);
						clearTimerRef.current = null;
					}
					setClearConfirming(false);
				}, []);
				const patchNote = (patch) => {
					setNote((prev) => {
						const next = { ...prev, ...patch };
						const result = persistNoteEntry(scope, next);
						const payload = result.payload;
						return { text: payload.text, height: payload.height, updatedAt: payload.updatedAt };
					});
				};
				react.useEffect(() => {
					const sync = (key) => {
						if (key !== scope.key) return;
						const next = readNoteEntry(scope.key);
						if (next !== null) setNote(next);
					};
					const onNoteChange = (event) => sync(event?.detail?.key);
					const onStorage = (event) => {
						if (event?.key !== NOTES_STORAGE_KEY && event?.key !== null) return;
						sync(scope.key);
					};
					globalThis.addEventListener?.(NOTE_CHANGE_EVENT, onNoteChange);
					globalThis.addEventListener?.("storage", onStorage);
					return () => {
						globalThis.removeEventListener?.(NOTE_CHANGE_EVENT, onNoteChange);
						globalThis.removeEventListener?.("storage", onStorage);
					};
				}, [scope.key]);
				react.useEffect(() => {
					if (note.text === "") cancelClearConfirmation();
				}, [note.text, cancelClearConfirmation]);
				react.useEffect(() => () => cancelClearConfirmation(), [scope.key, cancelClearConfirmation]);
				react.useEffect(() => {
					if (!clearConfirming) return undefined;
					const onPointerDown = (event) => {
						if (!clearButtonRef.current?.contains?.(event.target)) cancelClearConfirmation();
					};
					const onKeyDown = (event) => {
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
				// 默认高度 = 180px（根据最新参考图调整）；v3 持久化高度继续恢复用户上次调整的高度；
				// 高度调整仍由底部手柄驱动，拖拽中实时按会话持久化
				const startResize = (event) => {
					event.preventDefault();
					const el = areaRef.current;
					if (el === null) return;
					const startY = event.clientY;
					const startH = el.offsetHeight;
					const onMove = (moveEvent) => {
						const next = Math.max(56, Math.min(600, startH + (moveEvent.clientY - startY)));
						setNote((prev) => {
							if (prev.height === next) return prev;
							const result = persistNoteEntry(scope, { ...prev, height: next });
							const payload = result.payload;
							return { text: payload.text, height: payload.height, updatedAt: payload.updatedAt };
						});
					};
					const onUp = () => {
						window.removeEventListener("mousemove", onMove);
						window.removeEventListener("mouseup", onUp);
					};
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
				};
				const onClear = () => {
					const action = noteClearAction(note.text, clearConfirming);
					if (action === "noop") return;
					if (action === "confirm") {
						clearTimerRef.current = globalThis.setTimeout(() => {
							clearTimerRef.current = null;
							setClearConfirming(false);
						}, NOTE_CLEAR_CONFIRM_MS);
						setClearConfirming(true);
						return;
					}
					const result = persistNoteEntry(scope, { ...note, text: "" });
					if (!result.persisted) {
						cancelClearConfirmation();
						toast(t("noteClearFailed"));
						return;
					}
					setNote({ text: result.payload.text, height: result.payload.height, updatedAt: result.payload.updatedAt });
					cancelClearConfirmation();
					publishNoteChange(scope.key);
					areaRef.current?.focus?.();
				};
				const onSend = () => {
					const text = note.text.trim();
					if (text === "") return;
					const target = props.sendSessionId === null || props.sendSessionId === undefined ? "" : props.sendSessionId;
					if (target === "") { toast(t("noteSendTargetMissing")); return; }
					if (!appendToComposer(target, text)) toast(t("noteSendFailed"));
				};
				return react.createElement("div", { className: "hud-section" },
					react.createElement(ModuleHead, {
						icon: "note",
						title: t("noteModule"),
						fold: props.fold,
						onToggle: () => props.onFoldChange(!props.fold),
					}),
					props.fold ? null : react.createElement("div", { className: "hud-module-body" },
						react.createElement("div", { className: "hud-note-wrap" },
							react.createElement("textarea", {
								ref: areaRef,
								className: "hud-note-area",
								style: note.height === null ? undefined : { height: `${note.height}px` },
								maxLength: NOTE_MAX_LEN,
								placeholder: t("notePlaceholder"),
								value: note.text,
								onChange: (event) => patchNote({ text: event.target.value.slice(0, NOTE_MAX_LEN) }),
							}),
							react.createElement("div", { className: "hud-note-resize", "aria-hidden": "true", onMouseDown: startResize })),
						react.createElement("div", { className: "hud-note-actions" },
							react.createElement("span", { className: "hud-note-count" }, `${note.text.length}/${NOTE_MAX_LEN}`),
							react.createElement("div", { className: "hud-note-buttons" },
								react.createElement("button", {
									ref: clearButtonRef,
									type: "button",
									className: clearConfirming ? "hud-btn-small hud-note-clear-confirm" : "hud-btn-small",
									disabled: note.text === "",
									"aria-label": t(clearConfirming ? "noteClearConfirm" : "noteClear"),
									onClick: onClear,
								}, t(clearConfirming ? "noteClearConfirm" : "noteClear")),
								react.createElement("button", { type: "button", className: "hud-btn-small", onClick: onSend }, t("noteSendToChat"))))));
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
				const [dragId, setDragId] = react.useState(null);
				const [overId, setOverId] = react.useState(null);
				const [clearOpen, setClearOpen] = react.useState(false);
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
				const cancelDrag = () => { setDragId(null); setOverId(null); };
				const dropTodo = (targetId) => {
					if (dragId !== null && dragId !== targetId) {
						const from = todos.findIndex((value) => value.id === dragId);
						const to = todos.findIndex((value) => value.id === targetId);
						if (from !== -1 && to !== -1) {
							const next = todos.slice();
							const [moved] = next.splice(from, 1);
							next.splice(to, 0, moved);
							persist(next);
						}
					}
					cancelDrag();
				};
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
						onKeyDown: (event) => { if (event.key === "Escape") setClearOpen(false); },
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
								className: "hud-todo-input",
								value: draft,
								placeholder: t("todoPlaceholder"),
								onChange: (event) => setDraft(event.target.value),
								onKeyDown: (event) => { if (event.key === "Enter") addTodo(); },
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
						react.createElement("div", { className: "hud-todo-list" },
							todos.map((item) => {
								if (item.id === editingId) {
									return react.createElement("div", { className: "hud-todo-item", key: item.id },
										react.createElement("input", {
											className: "hud-todo-edit",
											value: editingText,
											autoFocus: true,
											placeholder: t("todoPlaceholder"),
											onChange: (event) => setEditingText(event.target.value),
											onKeyDown: (event) => { if (event.key === "Enter") commitEdit(); },
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
									"data-dragging": dragId === item.id,
									"data-over": overId === item.id,
									onDragOver: (event) => { event.preventDefault(); setOverId(item.id); },
									onDragLeave: () => setOverId((value) => (value === item.id ? null : value)),
									onDrop: (event) => { event.preventDefault(); dropTodo(item.id); },
								},
									react.createElement("button", {
										type: "button",
										className: "hud-todo-grip",
										"aria-label": t("todoDrag"),
										title: t("todoDrag"),
										draggable: true,
										onDragStart: (event) => {
											event.dataTransfer?.setData?.("text/plain", item.id);
											// 整行（拖动手柄+勾选框+文本+编辑+删除）作为拖拽幽灵图跟随鼠标：
											// 快照行容器，并按鼠标在行内的位置对齐
											const row = event.currentTarget.parentElement;
											if (row !== null) {
												const rect = row.getBoundingClientRect();
												event.dataTransfer?.setDragImage?.(row, event.clientX - rect.left, event.clientY - rect.top);
											}
											setDragId(item.id);
										},
										onDragEnd: cancelDrag,
									}, react.createElement(Icon, { name: "drag", size: 14 })),
									react.createElement("button", {
										type: "button",
										className: "hud-todo-check",
										"aria-label": t(item.done ? "todoMarkPending" : "todoMarkDone"),
										title: t(item.done ? "todoMarkPending" : "todoMarkDone"),
										onClick: () => toggleTodo(item.id),
									}, react.createElement(Icon, { name: item.done ? "check-lig" : "check-nor", size: 16 })),
									react.createElement("span", { className: "hud-todo-text" }, item.text),
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
									}, react.createElement(Icon, { name: "trash", size: 14 })));
							}))),
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
			const CODEX_FIVE_HOUR_SECONDS = 5 * 60 * 60;
			const CODEX_WEEKLY_SECONDS = 7 * 24 * 60 * 60;
			const CODEX_WINDOW_TOLERANCE = 0.05;
			function codexWindowPercent(windows, expectedSeconds) {
				const candidates = (Array.isArray(windows) ? windows : [])
					.map((window) => ({
						window,
						remainingPercent: typeof window?.remainingPercent === "number" && Number.isFinite(window.remainingPercent) && window.remainingPercent >= 0 && window.remainingPercent <= 100 ? window.remainingPercent : null,
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
			function selectCodexQuotaWindows(usage) {
				const limit = Array.isArray(usage?.rateLimits)
					? usage.rateLimits.find((item) => item !== null && typeof item === "object" && item.id === "codex")
					: null;
				const windows = limit?.windows;
				return {
					fiveHour: codexWindowPercent(windows, CODEX_FIVE_HOUR_SECONDS),
					weekly: codexWindowPercent(windows, CODEX_WEEKLY_SECONDS),
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
			/**
			 * 打开 DSH 设置面板「账户」分区并切换到指定 tab（deepseek | opencode）。
			 * DSH 设置壳（ui-settings-general SettingsRoot）的打开状态是组件本地 state，
			 * 无公开 API；此处模拟点击路径：侧栏底部触发按钮（aria-haspopup="dialog"）
			 * → 面板导航「账户/Account」→ 页内 tab（deepseek / opencode go）。
			 */
			function openSettingsAccount(target) {
				const isCodex = target === "codex";
				const isOpencode = target === "opencode";
				const findButton = (scope, pattern) => {
					const nodes = Array.from(scope.querySelectorAll("button"));
					return nodes.find((node) => pattern.test((node.textContent ?? "").trim())) ?? null;
				};
				const codexPattern = /codex\s*(?:订阅|subscription)/i;
				const step = (delay, action) => { globalThis.setTimeout(action, delay); };
				step(0, () => {
					const trigger = document.querySelector('button[aria-haspopup="dialog"]');
					if (trigger !== null) trigger.click();
				});
				const clickDestination = () => {
					const dialog = document.querySelector('[role="dialog"]');
					if (dialog === null) return;
					const button = isCodex
						? findButton(dialog, codexPattern)
						: findButton(dialog, isOpencode ? /opencode\s*go/i : /^deepseek$/i);
					if (button !== null) button.click();
				};
				step(140, () => {
					const dialog = document.querySelector('[role="dialog"]');
					if (dialog === null) return;
					if (isCodex) {
						clickDestination();
						return;
					}
					const nav = findButton(dialog, /账户|^Account$/i);
					if (nav !== null) nav.click();
				});
				step(260, clickDestination);
				step(520, clickDestination); // 二次尝试（分区内容异步挂载较慢时兜底）
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
				// gpt-reserve：codex-subscription 返回该额度时才渲染（样式与 5h/周额度一致）
				const codexReserve = codexUsable ? selectCodexReserveLimits(codex.usage) : [];
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
							: null,
						codexUsable && showCodex
							? react.createElement(react.Fragment, null,
								react.createElement("div", { className: "hud-row hud-usage-row" },
									react.createElement(Icon, { name: "ChatGPT" }), react.createElement("span", { className: "hud-row-label" }, t("codexFiveHour")),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(codexQuota?.fiveHour))),
								react.createElement("div", { className: "hud-row hud-usage-row" },
									react.createElement(Icon, { name: "ChatGPT" }), react.createElement("span", { className: "hud-row-label" }, t("codexWeekly")),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(codexQuota?.weekly))),
								codexReserve.map((limit, index) => react.createElement("div", { className: "hud-row hud-usage-row", key: `${limit.id}-${index}` },
									react.createElement(Icon, { name: "ChatGPT" }),
									react.createElement("span", { className: "hud-row-label" }, limit.name === null
										? t("codexReserve")
										: interpolate(t("codexReserveNamed"), { name: limit.name })),
									react.createElement("span", { className: "hud-balance-value hud-click", title: t("valueOpenCodex"), onClick: () => openSettingsAccount("codex") }, fmtCodexPercent(limit.remainingPercent)))))
							: null),
					jumpMenu);
			}

			function loadStoredFolds() {
				const fallback = { git: false, subagents: false, tasks: false, mcp: false, usage: false, plans: false, note: false, todo: false }; // 默认均展开
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

			// —— 面板主体 ——
			function HudPanel({ useSessionPendingInteraction = useNoPendingInteraction }) {
				const sessionsStore = ctx.get("sessions")?.list;
				const state = useSnapshot(sessionsStore, (s) => s, null);
				const workspacesStore = ctx.get("workspaces")?.list;
				const workspaceItems = useSnapshot(workspacesStore, (s) => s.items, []);
				const current = state?.current ?? undefined;
				const summary = current === undefined ? undefined : state?.byId?.[current];
				const pending = useSessionPendingInteraction((snapshot) =>
					current === undefined ? undefined : snapshot?.get?.(current)
				);
				const [modules, updateModules, usageDisp, updateUsage] = useHudModules();
				// 新建会话页（无会话/空白会话）：面板无会话数据源，且便笺/待办改由工作区代理会话驱动
				const newSessionPage = isNewSessionPage(state);
				// 目标工作区：工作区级存储键 + git 模块与便笺「发送到对话」的代理会话
				const target = react.useMemo(() => resolveTargetWorkspace(state, workspaceItems), [state, workspaceItems]);
				const moduleSessionId = current ?? target.gitSessionId ?? "";
				const gitKey = `git:${summary?.cwd ?? target.path ?? moduleSessionId}`;
				const [git, setGit] = useModuleSnapshot(gitKey, null);
				const gitRevision = react.useRef(0);
				const [subagents, setSubagents] = useModuleSnapshot(`subagents:${current ?? ""}`, []);
				const [mcp, setMcp] = useModuleSnapshot("mcp", null);
				const [plans, setPlans] = useModuleSnapshot(`plans:${current ?? ""}`, []);
				// 余额模块：调 dsh-account-usage 同源路由（其 host 端有 30s 缓存）；
				// —— deepseek / opencode go 各自独立可用：
				//    deepseek：ok → 有数据；no-token → 未配置；404 → 插件未装。
				//    opencode：ok + keySource → 已配置（订阅中）；no-key → 未配置；
				//    unauthorized → 未订阅/订阅到期；其余失败 → 视为不可用。
				// 模块与设置行可见性 = deepseek 可用 ∪ opencode 可用；
				// 刷新规则与 dsh-account-usage 一致：面板打开时立即 + 每 60s 轮询。
				const [balance, setBalance] = useModuleSnapshot("balance", null);
				const [opencode, setOpencode] = useModuleSnapshot("opencode", null);
				const [codex, setCodex] = useModuleSnapshot("codex", null);
				react.useEffect(() => {
					let alive = true;
					const refreshBalance = async () => {
						let response;
						try {
							response = await fetch(`${hostBase()}${ACCOUNT_SUMMARY_URL}`);
						} catch {
							// 暂时请求失败时保留上次快照。
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
							setBalance(previous => ({ available: true, data: previous?.data ?? null, error: (body !== null && typeof body.message === "string" && body.message !== "") ? body.message : t("balanceLoadFailed") }));
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
							if (alive) setOpencode({ available: false, usage: null });
							return;
						}
						let body = null;
						try { body = await response.json(); } catch { body = null; }
						if (!alive) return;
						// ok + keySource：已配置且订阅有效；no-key/unauthorized/其他失败 → 不可用
						const usable = body !== null && body.ok === true
							&& typeof body.keySource === "string" && body.keySource !== "";
						if (usable) setOpencode({ available: true, usage: body.usage ?? null });
						else if (body?.code === "no-key" || body?.code === "unauthorized") setOpencode({ available: false, usage: null });
					};
					const pollBalance = singleFlight(refreshBalance);
					const pollOpencode = singleFlight(refreshOpencode);
					pollBalance(); pollOpencode();
					const timer = window.setInterval(() => { pollBalance(); pollOpencode(); }, 60000);
					return () => { alive = false; window.clearInterval(timer); };
				}, []);
				react.useEffect(() => {
					let alive = true;
					const emptyQuota = () => ({ fiveHour: null, weekly: null });
					const setDegradedOrUnavailable = () => {
						if (!alive) return;
						setCodex((previous) => previous?.available === true
							? { available: true, usage: emptyQuota(), degraded: true }
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
				// 高度上限 = 输入框底部 - 面板顶（面板撑满时底部与输入框底部平齐）。
				// rc.1 的标题栏与正文位于同一个会话根节点。HUD 仅收窄标题栏下方的
				// 正文容器，并同步覆盖其内容宽度变量，避免移动宿主标题栏操作按钮。
				react.useEffect(() => {
					const headerWrapper = document.querySelector('[data-slot="conversation.session.header"]');
					const headerEl = headerWrapper !== null
						? (headerWrapper.querySelector(":scope > header") ?? headerWrapper)
						: null;
					const composerEl = document.querySelector('[data-slot="conversation.composer.bar"]')
						?? document.querySelector('[data-slot="conversation.composer"]');
					const sessionHost = document.querySelector('[data-slot="conversation.session"]');
					// 新建会话页没有 conversation.session 宿主（无会话时不渲染该 slot），
					// 改由会话滚动容器反查根节点，保证该页同样能定位正文并左移让位。
					const sessionRoot = sessionHost?.closest("[data-phase]") ?? null;
					const scrollEl = sessionRoot?.querySelector("[data-conversation-scroll]")
						?? document.querySelector("[data-conversation-scroll]");
					const conversationRoot = sessionRoot ?? scrollEl?.closest("[data-phase]") ?? null;
					const conversationBody = scrollEl?.parentElement ?? null;
					const savedConversationBodyStyles = conversationBody === null ? [] : [
						"margin-right",
						"--dsh-awesome-hud-column-width",
						"--dsh-chat-content-width",
						"--dsh-composer-card-max-width",
					].map((property) => ({
						property,
						value: conversationBody.style.getPropertyValue(property),
						priority: conversationBody.style.getPropertyPriority(property),
					}));
					const turnNavStyles = new Map();
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
						restoreStyles(turnNavSlotStyles);
					};
					const syncTurnNavigation = () => {
						restoreTurnNavigation();
						if (conversationRoot === null || conversationBody === null || conversationBody.getBoundingClientRect().width < TURN_NAVIGATION_MIN_COLUMN_WIDTH) return;
						for (const nav of conversationRoot.querySelectorAll('nav[aria-label="轮次导航"], nav[aria-label="Turn navigation"]')) {
							const slot = nav.parentElement;
							if (slot === null) continue;
							rememberStyle(turnNavStyles, nav, "right");
							rememberStyle(turnNavSlotStyles, slot, "display");
							slot.style.setProperty("display", "block");
							nav.style.setProperty("right", `${TURN_NAVIGATION_RIGHT_GAP}px`);
						}
					};
					const publishConversationBodyWidth = () => {
						if (conversationBody === null) return;
						const columnWidth = conversationBody.getBoundingClientRect().width;
						conversationBody.style.setProperty("--dsh-awesome-hud-column-width", `${Math.round(columnWidth)}px`);
						conversationBody.style.setProperty("--dsh-chat-content-width", HUD_CONTENT_WIDTH);
						conversationBody.style.setProperty("--dsh-composer-card-max-width", "calc(var(--dsh-chat-content-width) + 32px)");
					};
					if (conversationBody !== null) conversationBody.style.setProperty("margin-right", `${PANEL_WIDTH}px`);
					const update = () => {
						const headRect = headerEl?.getBoundingClientRect();
						const compRect = composerEl?.getBoundingClientRect();
						// 新建会话页没有标题栏：用与标题栏底部同高的常量，保证与已有会话视觉一致
						const nextTop = headRect === undefined
							? HUD_NEW_SESSION_TOP
							: Math.max(8, Math.round(headRect.bottom + 8));
						setTop(nextTop);
						// 上限不超过「视口底部 - 8px」，防止面板底超出聊天页可视高度
						const vhLimit = Math.max(120, Math.round(window.innerHeight - nextTop - 8));
						if (compRect !== undefined && compRect.bottom > nextTop + 120) {
							setLimitH(Math.min(Math.round(compRect.bottom - nextTop), vhLimit));
						} else {
							setLimitH(vhLimit);
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
					return () => {
						observer.disconnect();
						turnNavObserver?.disconnect();
						window.removeEventListener("resize", update);
						restoreTurnNavigation();
						if (conversationBody !== null) for (const saved of savedConversationBodyStyles) {
							if (saved.value === "") conversationBody.style.removeProperty(saved.property);
							else conversationBody.style.setProperty(saved.property, saved.value, saved.priority);
						}
					};
					// 会话切换会重建会话正文 DOM，需重新查询并应用让位
				}, [current]);

				const sessionId = current ?? "";
				// git / 子代理 / MCP / 计划：面板打开时轮询（5s），切会话立即刷新。
				// 新建会话页只轮询 git（用目标工作区的代理会话）与全局 MCP，其余模块该页不展示。
				react.useEffect(() => {
					if (newSessionPage) {
						setSubagents([]);
						setPlans([]);
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
					if (sessionId === "") { setGit(null); setSubagents([]); setMcp(null); setPlans([]); return undefined; }
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
					const refreshMcp = async () => {
						try {
							const body = await call("mcp", { sessionId });
							if (alive) setMcp(body);
						} catch { /* 保留上次成功数据。 */ }
					};
					const refreshPlans = async () => {
						try {
							const body = await call("plans", { sessionId });
							if (alive) setPlans(Array.isArray(body.plans) ? body.plans : []);
						} catch { /* 保留上次成功数据。 */ }
					};
					const polls = [refreshGit, refreshSubagents, refreshMcp, refreshPlans].map(singleFlight);
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

				const workspaceTitle = resolveWorkspaceTitle(summary?.cwd, workspaceItems);
				const projection = summary?.projectionValues ?? {};
				const todos = Array.isArray(projection.todos) ? projection.todos.filter((item) => item && typeof item === "object" && typeof item.content === "string") : [];
				const pressure = projection.contextPressure ?? null;
				const subagentActive = subagents.some((entry) => entry.activity === "running");
				const statusKey = deriveSessionStatus({ running: summary?.running ?? false, pendingInteraction: pending?.kind, subagentActive });
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

				const usageAvailability = {
					deepseek: balance !== null && balance.available === true,
					opencode: opencode !== null && opencode.available === true,
					codex: codex !== null && codex.available === true,
				};
				const usageAvailable = Object.values(usageAvailability).some(Boolean);
				// 新建会话页：只保留该页有数据源的模块（git 需目标工作区确实是 git 仓库）
				const activeModules = panelVisibleModules(
					modules ?? defaultModules(),
					git !== null && git !== undefined && git.isRepo === true,
					newSessionPage,
				);
				// 便笺/待办作用域：工作区路径优先，无 cwd 时降级为会话级隔离
				const workspaceKey = resolveWorkspaceKey(summary?.cwd, workspaceItems);
				const scopeProps = {
					sessionId: moduleSessionId,
					workspaceKey,
					workspaceCandidates: target.candidates,
					sendSessionId: current ?? target.sendSessionId ?? null,
				};
				const scopeKey = workspaceKey ?? moduleSessionId;

				const openSubagent = (entry) => {
					try {
						ctx.get("sessions")?.openSubagent({ parentSessionId: entry.parentId, childSessionId: entry.id, mode: entry.mode });
					} catch (error) {
						toast(t("subagentOpenFailed"));
						void error;
					}
				};

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
					style: { top, maxHeight: limitH === null ? undefined : `${limitH}px` },
					"aria-label": t("hudLabel"),
				},
					// 「会话」模块固定在面板顶部（hud-panel 直属头区）：不参与 body 滚动，
					// 面板内容上下滑动时会话信息始终可见；body 仅承载其余可滚动模块
					react.createElement(SessionModule, {
						key: sessionId,
						workspaceTitle,
						sessionTitle: summary?.title ?? summary?.displayTitle ?? t("fallbackSession"),
						statusText,
						statusKind,
						onRename: doRenameSession,
						providerLabel: modelMeta.providerLabel,
						modelId: modelMeta.modelId,
						effortLabel: modelMeta.effortLabel,
						modules: activeModules,
						usage: usageDisp,
						balanceAvailable: usageAvailable,
						usageAvailability,
						onModulesChange: updateModules,
						onUsageChange: updateUsage,
					}),
					react.createElement("div", { className: "hud-panel-body", ref: bodyRef, onScroll: onPanelScroll },
						activeModules.context === false ? null : react.createElement(ContextModule, {
							sessionId,
							pressure,
							usage: projection.tokenUsage ?? null,
							running: summary?.running ?? false,
						}),
						activeModules.balance === false || !usageAvailable
							? null
							: react.createElement(BalanceModule, { balance, opencode, codex, display: usageDisp, fold: folds.usage, onFoldChange: (value) => setFolds((prev) => ({ ...prev, usage: value })) }),
						activeModules.git === false || git === null || git === undefined || git.isRepo !== true ? null : react.createElement(GitModule, {
							key: `${moduleSessionId}-${target.path ?? ""}`,
							sessionId: moduleSessionId,
							git,
							fold: folds.git,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, git: value })),
							onGit: (snapshot) => { gitRevision.current += 1; setGit(snapshot); },
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
						}),
						// 便笺/待办：key 唯一（模块间不得重复——同级重复 key 会使
						// React diff 错乱、每次重渲染累积重复模块）；key 按「工作区键」派生，
						// 同工作区切会话不重挂载（内容共享），跨工作区必重挂载（避免编辑态串数据）
						activeModules.note === false ? null : react.createElement(NoteModule, {
							key: `note-${scopeKey}`,
							...scopeProps,
							fold: folds.note,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, note: value })),
						}),
						activeModules.todo === false ? null : react.createElement(TodoModule, {
							key: `todo-${scopeKey}`,
							...scopeProps,
							fold: folds.todo,
							onFoldChange: (value) => setFolds((prev) => ({ ...prev, todo: value })),
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

			// —— 新建会话页悬浮入口：该页不渲染 conversation.session.header（无会话 id），
			//     故经 shell.overlay 自带一个固定在视口右上角的按钮（与标题栏按钮同一视觉位置，
			//     只是该页没有标题栏可依附）；开合状态与原按钮共用（新建会话页恒从隐藏开始）——
			function HudFloatingButton() {
				const [open, setOpen] = react.useState(() => peekHudOpen(undefined));
				react.useEffect(() => subscribeHud(() => setOpen(getHudOpen())), []);
				return react.createElement("button", {
					type: "button",
					className: "hud-btn hud-btn-float",
					"data-hud-float": "",
					"data-open": open,
					// 面板展开时按钮向左让位到面板左侧，避免与面板重叠
					style: { right: open ? `${HUD_FLOAT_RIGHT + HUD_FLOAT_PANEL_GAP}px` : `${HUD_FLOAT_RIGHT}px` },
					"aria-label": t(open ? "hudClose" : "hudNewSessionOpen"),
					title: t("hudLabel"),
					onClick: () => toggleHud(ctx),
				}, react.createElement(Icon, { name: "hud-toggle", color: open ? undefined : "var(--dsw-alias-label-tertiary)" }));
			}

			// —— HUD 面板壳（监听 open 状态，关闭即卸载）——
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "awesome-hud",
				order: 70,
				label: () => t("hudLabel"),
				locale: NS,
			}, function HudPanelRoot({ useSessionPendingInteraction }) {
				const blankSessionsStore = ctx.get("sessions")?.list;
				const blankSnap = useSnapshot(blankSessionsStore, (s) => s, null);
				const newSession = isNewSessionPage(blankSnap);
				const scopeSessionId = newSession ? undefined : blankSnap?.current;
				// 首帧用只读 peek 拿到目标会话自己的状态，避免刷新后闪一下错误值
				const [open, setOpen] = react.useState(() => peekHudOpen(scopeSessionId));
				react.useEffect(() => subscribeHud(() => setOpen(getHudOpen())), []);
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
				// 新会话页兜底：作用域切换本身已让它从隐藏开始，这里再强制一次，
				// 覆盖「首次判定时 store 尚未就绪」等边角情形（只改内存态，不写 localStorage）。
				react.useEffect(() => {
					if (newSession && getHudOpen()) setHudOpenTransient(false);
				}, [newSession]);
				return react.createElement(react.Fragment, null,
					newSession ? react.createElement(HudFloatingButton, null) : null,
					open
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
