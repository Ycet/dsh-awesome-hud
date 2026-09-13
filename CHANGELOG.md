# 变更记录 / Changelog

本文件记录 dsh-awesome-hud 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

- 本文件于 2026-09-11 依据本仓库 git 提交历史回填；版本号与日期取自本目录 `package.json` 的 `version` 与实际提交时间。
- 上游仓库：[Ycet/dsh-awesome-hud](https://github.com/Ycet/dsh-awesome-hud)。
- **版本口径**：本插件历史上存在「提交信息版本标签」与「`package.json` 实际版本」错位的情况（例如标为 `v0.7.0` / `v0.7.1` / `v0.6.2` 的提交，`package.json` 仍为 `0.6.0`）。本文件统一按 **实际 `package.json` 版本**归并，提交信息中的标签在条目内注明；`package.json` 中未出现的版本号（`0.2.3` – `0.2.8`、`0.6.1`、`0.6.5`、`0.6.8`、`0.6.9`、`0.10.20`、`0.11.1` – `0.11.4`、`0.12.1`、`0.12.2`、`0.13.0`、`0.13.2` 等）不单独成节。
- **记录粒度**：`v0.10.0` 及以后逐版本详细记录；早期 `v0.1.0` – `v0.9.3`（2026-08-29 – 09-05 的高频迭代）以版本时间线汇总，细节可查 git 历史。
- 条目末尾的短哈希（如 `3268b01`）为对应提交，便于追溯。

## [0.14.0] - 2026-09-12

### 新增 / Added

- **git graph 右键菜单新增「从此处创建分支」**：位于「合并至当前分支」下方同一分组内；点击后**该菜单项原位**展开为输入框 + 「取消」/「确认」图标按钮（图标复用插件既有的 `close` / `check` 资产）。
  - 输入框为空（`trim()` 后）时「确认」按钮置灰；确认后以被右键的提交为起点执行 `git checkout -b <名称> <提交>` 并切换到新分支，成功 toast 后菜单关闭、git 快照与 graph 首页刷新，新分支标签随即显示为蓝色当前分支。
  - `git/create-branch` 新增可选 `commit` 参数：未传时保持「从当前 HEAD 创建」的既有行为，旧客户端不受影响；传入但非法（非 40 位十六进制）直接报错。
  - 重名分支沿用 Host 预检并提示，**输入内容保留**便于改名重试；切换被本地修改阻塞时复用 `parseCheckoutConflict` 结构化错误，toast 列出受影响文件，不自动 stash、不强制切换。
  - 键盘：`Enter` 不触发创建；`Escape` 先取消输入行并恢复为原菜单项（再按一次才关闭整个菜单），菜单级 Escape 处理器改为读取 `branchCreateOpenRef` 以规避闭包过期。
  - Git 续作状态（merge / rebase / cherry-pick / revert）守卫复用菜单打开时已有的 `git/reset-status` 结果（`operation-in-progress`），零新增 Host 调用。
- 新增中英文字案（`gitBranchCreateHere` / `gitBranchCreatedHere` / `gitBranchCreateBlocked`）与 `.hud-git-menu-branch-create` 行内布局样式；菜单位置估算同步扩充一项。
- 测试：新增 `test/graph-branch-create.test.mjs`（9 个用例，覆盖 Host 可选 commit、原位输入行、置灰语义、键盘行为、成功/失败路径、菜单顺序与几何、双语文案）；`test/client-pending.test.mjs` 版本断言更新为 `0.14.0`。全量 `npm test` 155 个用例通过。

### English

- Added **Create branch here** to the git graph commit context menu, directly below "Merge into current branch" in the same group. Clicking it replaces the item in place with a text input plus Cancel / Confirm icon buttons (reusing the plugin's existing `close` / `check` icon assets).
  - The confirm button is disabled while the input is empty after trimming. Confirming runs `git checkout -b <name> <commit>` from the right-clicked commit, switches to the new branch, and on success shows a toast, closes the menu, and refreshes both the git snapshot and the graph so the new branch label turns into the blue current branch.
  - `git/create-branch` now accepts an optional `commit` argument; omitting it keeps the previous HEAD-based behaviour, so older clients are unaffected.
  - Duplicate branch names keep the typed name for retry, and a checkout blocked by local changes reuses the structured `parseCheckoutConflict` error to list the affected files — nothing is stashed and no forced checkout is performed.
  - Enter never submits, Escape cancels the input first, and the entry is disabled while another Git operation is in progress, reusing the existing `git/reset-status` pre-check.

## [0.13.4] - 2026-09-11

### 新增 / Added

- **「便笺」模块新增「清空」按钮**：按钮位于「添加至对话」左侧；输入框为空时置灰，有内容时首次点击进入红色二次确认态，再次点击后清空当前工作区便笺。
- 确认态支持点击其他区域、Escape 或 2 秒超时取消；清空成功后焦点回到输入框，并通过工作区存储与事件同步到其他已打开会话。
- 新增中英文文案、深浅主题适配、禁用语义和持久化失败提示；补充便笺清空交互回归测试。

### English

- Added a **Clear** button to the Notes module, placed to the left of Add to chat. It is disabled for empty notes; with content, the first click enters a red confirmation state and the second click clears the workspace-shared note.
- Clicking elsewhere, pressing Escape or waiting 2 seconds cancels confirmation. Successful clears focus the textarea and synchronize with other open sessions in the same workspace; storage failures preserve the original content and show an error toast.

## [0.13.3] - 2026-09-11

### 新增 / Added

- **「用量」模块追加 `codex gpt-reserve额度` 行**（`3268b01`，提交信息标为 v0.12.2）：当 `dsh-codex-subscription` 返回 `gpt-reserve` 额度时，在「周额度」下方追加一行，样式、图标与交互与 5h / 周额度完全一致，取该额度的主窗口剩余百分比；额度带名称时显示为「codex gpt-reserve额度（名称）」。
  - 数据来源与匹配：`/wham/usage` 的 `additional_rate_limits` → `rateLimits` 中 `id` 为 `base_model_inference`、`limit_name` / `name` 为 `gpt-reserve` 的条目；插件按 **id 或 name** 归一化匹配（忽略大小写、下划线、连字符与空格）。
  - 降级行为：额度不存在时**不展示该行**；存在但窗口数据异常时保留行并显示 `—`。
- 测试：新增 `test/codex-reserve.test.mjs`（约 162 行）、`test/codex-reserve-layout.test.mjs`，并扩充 `codex-transport` / `workspace-scope` / `new-session-entry` 用例；双语 README 同步。
- English: The usage module now renders an extra `codex gpt-reserve额度` row whenever `dsh-codex-subscription` reports a `gpt-reserve` limit, matched by normalized id or name, with the same styling, icons and click-through behaviour as the 5h / weekly rows. The row is hidden when the limit is absent and shows `—` when its window data is malformed.

## [0.13.1] - 2026-09-10

### 变更 / Changed

- 优化新建会话页中 HUD 面板的位置（`bc1fc98`，提交信息标为 v0.12.1）：面板位置与真实会话保持一致（固定贴页面右侧、宽 300px），展开时悬浮按钮同步左移让位。

## [0.12.0] - 2026-09-10

### 新增 / Added

- **新建会话页新增右上角 HUD 悬浮入口**（`5f64e34`）：该页没有标题栏，由悬浮按钮提供入口；每次进入都从收起状态开始（只改内存态、不写 localStorage），点击展开后输入框与页面内容整体左移约 300px 让位；该页只展示有数据源的模块（会话 / 用量 / 便笺 / 待办 / MCP，以及目标工作区确为 git 仓库时的 git）。

### 变更 / Changed

- **「便笺」「待办」由会话级改为工作区级共享**（同一工作区目录下所有会话共用一份内容与顺序）：升级后首次在某工作区打开面板时执行一次性自动归并迁移——便笺取候选会话中 `updatedAt` 最新的一份，待办按条目 id 去重合并（同 id 以先出现的为准）并保持稳定顺序；迁移结果写入工作区键并记录 `dsh-awesome-hud:workspace-migrated` 标记，同一工作区只迁移一次；**旧的会话级键保留不删除**，回滚旧版本仍可读到迁移前数据。无 `cwd` 的会话降级为会话级隔离。

## [0.11.5] - 2026-09-10

### 新增 / Added

- 「用量」模块增加 **Codex 额度**展示：`codex 5h额度` 与 `codex 周额度` 两条剩余额度百分比，使用 ChatGPT 图标，点击数值打开「设置：Codex 订阅」页；仅当安装并登录 `dsh-codex-subscription` 时展示，已登录但额度请求失败时保留行并显示 `—`（`08573b8`，提交信息标为 v0.11.5）。

### 修复 / Fixed

- 修复 HUD 面板与 DSH 新版官方右侧边栏的兼容性问题（`08573b8`）。
- 修复 HUD 面板「用量」「git」「计划清单」模块显示异常的问题（`eadfad0`，提交信息标为 v0.11.6）。
- 修复「用量」模块无法正常展示 Codex 额度的问题（`ca2b59f`，提交信息标为 v0.11.7）。

## [0.11.0] - 2026-09-08

### 新增 / Added

- **Git Graph 重置功能**：提交行右键菜单可执行 soft / mixed / hard reset（仅可选择当前本地分支历史中早于 HEAD 的提交，均带行内二次确认）（`1780c52`）。

### 变更 / Changed

- git graph 右键菜单「合并至当前分支」增加二次确认逻辑（`d18cd14`，提交信息标为 v0.11.1）。
- git commit 弹窗按 Enter 不再直接提交，只换行——需点击 commit 按钮提交（`d18cd14`）。
- 调整「上下文窗口」模块底部信息展示样式（`d18cd14`）；调整部分按钮样式（`96b8c4e`，标为 v0.11.3）。
- 调整「便笺」模块输入框默认高度（`6c88f4b`，标为 v0.11.4）；README 文档调整（`78c5356`，标为 v0.11.2）。

## [0.10.22] - 2026-09-07

### 新增 / Added

- 「上下文窗口」模块增加**缓存命中率**展示：底部按「已用 n · 上限 n · 缓存命中 n%」呈现，命中率固定保留一位小数，无可用统计时显示 `—`（`b57dc0d`，提交信息标为 v0.10.23）。

### 修复 / Fixed

- 修复 HUD 展开时标题栏按钮位移的问题（`7abd6a8`）。

## [0.10.21] - 2026-09-07

### 修复 / Fixed

- 兼容 DSH `0.1.2-rc.1` 的会话布局与待处理交互（`c319660`）。

## [0.10.19] - 2026-09-06

### 变更 / Changed

- 会话名称过长时以省略号截断；重命名按钮默认隐藏，仅在悬浮会话名称行时展示（键盘聚焦可唤起）（`5b6b25d`）。

## [0.10.18] - 2026-09-06

### 变更 / Changed

- 「会话」模块固定于面板顶部并移出滚动区域，优化面板布局（`ce94e64`）。

## [0.10.17] - 2026-09-06

### 变更 / Changed

- README 补充 `v0.10.7` – `v0.10.16` 新增功能（会话重命名、git 分支切换 / 创建、git graph 右键菜单、便笺与待办说明），中英文同步（`efae3f8`）。

## [0.10.16] - 2026-09-06

### 变更 / Changed

- 会话重命名按钮图标改为按钮内居中（`e2aae2c`）。

## [0.10.15] - 2026-09-06

### 变更 / Changed

- 会话重命名按钮移至名称右侧、状态徽标左侧，并调整与名称、徽标的间距（`edee2fa`）。

## [0.10.14] - 2026-09-06

### 变更 / Changed

- 会话重命名按钮与模块头鲸鱼图标左对齐，与名称间距收紧（`131fc74`）。

## [0.10.13] - 2026-09-06

### 新增 / Added

- **会话重命名**：会话名称右侧铅笔按钮进入编辑态（输入框 + 取消 / 确认图标按钮，Enter 提交、Esc 取消，输入为空时确认置灰），确认后经客户端会话面 `ISession.rename` 保存并 toast，会话列表标题自动更新（`4abb68e`）。

## [0.10.12] - 2026-09-06

### 新增 / Added

- git graph 右键新增**「合并至当前分支」**：执行 `git merge --no-edit`，已包含该提交时提示「无需合并」，本地修改阻塞时给出受影响文件清单，合并冲突自动 `git merge --abort` 回滚并列出冲突文件（`d701667`）。

## [0.10.11] - 2026-09-06

### 变更 / Changed

- 分支菜单最小宽度固定为「添加分支」选项激活时的宽度（`min-width` 170px → 210px），折叠 / 展开 / 长名称三态宽度不再跳变，中英文一致（`b43709f`）。

## [0.10.10] - 2026-09-06

### 新增 / Added

- 分支菜单新增**添加分支**：输入框 + 取消 / 添加按钮，创建并自动切换，无内容时按钮置灰；同时新增添加行与列表间的分隔线与分支列表内部滚动（`67f720a`）。

## [0.10.9] - 2026-09-06

### 修复 / Fixed

- 修复分支菜单闪现（`ready` 前隐藏，定位与加载完成后再显示）（`d3fb292`）。
- 修复分支菜单导致模块分隔线消失：根因是相邻兄弟选择器被浮层插入破坏，改为子选择器自身上边框。

## [0.10.8] - 2026-09-06

### 修复 / Fixed

- 分支菜单打开即按按钮上方 / 下方定位（估算高度初判 + 渲染后精确修正），菜单内联 `fixed` 防止破坏模块分隔线（`2fef28d`）。

## [0.10.7] - 2026-09-06

### 变更 / Changed

- 切换分支成功的 toast 改为绿色（`success` 样式，含边框与文字）（`fd28507`）。

## [0.10.6] - 2026-09-06

### 新增 / Added

- 切换分支的覆盖冲突友好提示：解析冲突文件清单并给出中文指引（`ad6e7d3`）。

### 变更 / Changed

- README 文档更新。

## [0.10.5] - 2026-09-06

### 修复 / Fixed

- 分支菜单视口边界修正，防止溢出屏幕（`59e5836`）。
- 便笺 / 待办折叠状态持久化修复。

### 变更 / Changed

- 再次点击分支按钮可关闭菜单。

## [0.10.4] - 2026-09-05

### 变更 / Changed

- 分支按钮移至 git 文字右侧并缩小间距（`9f4237d`）。

## [0.10.3] - 2026-09-05

### 变更 / Changed

- git 模块分支按钮样式改为与「用例」模块跳转按钮一致（`hud-btn-small`）（`f5338cf`）。

## [0.10.2] - 2026-09-05

### 变更 / Changed

- git 模块分支切换按钮居中放置于标题栏中间（`81bccfa`）。

## [0.10.1] - 2026-09-05

### 变更 / Changed

- 面板关闭时右上角 HUD 按钮图标置灰（`bcd57d8`）。
- 切换会话时面板滚动区复位到顶部。

## [0.10.0] - 2026-09-05

### 新增 / Added

- git 模块标题固定为 `git`，并在右侧新增**分支切换按钮**（下拉列表 + 切换分支，新增 `git/checkout` 宿主 API）（`1f049f3`）。

---

## 版本时间线（v0.1.0 – v0.9.3）

早期版本的迭代粒度较细，逐条提交信息见 `git log -- dsh-awesome-hud`；此处按 `package.json` 版本汇总每次发布的主题。

| 版本 | 日期 | 主要变更 |
| --- | --- | --- |
| 0.9.3 | 2026-09-05 | 待办拖动时整行作为拖拽幽灵图跟随鼠标；清空按钮在无已完成事项时置灰 |
| 0.9.2 | 2026-09-05 | 待办行拖动手柄移至行内最左侧（勾选框之前） |
| 0.9.1 | 2026-09-05 | 待办清空确认弹窗宽度调小为 360px |
| 0.9.0 | 2026-09-05 | 待办新增置顶、「清空已完成」（二次确认、空列表置灰、垃圾桶图标）与行尾拖拽手柄排序 |
| 0.8.3 | 2026-09-05 | 便笺输入框取消右下角拖拽角，改为拖动底部边框手柄调整高度（实时持久化） |
| 0.8.2 | 2026-09-05 | 修复便笺输入框默认 1:1 高度失效（折叠 / 未布局挂载卡 `auto` 高度 + 旧数据作废迁移）；拖拽角放大 |
| 0.8.1 | 2026-09-05 | 撤回便笺模块标题栏的浅蓝内容圆点指示 |
| 0.8.0 | 2026-09-05 | 待办删除直接生效免确认、输入行改为加号图标、展示完成计数；便笺输入框默认 1:1 高度、5000 字上限与计数、内容圆点指示 |
| 0.7.1 | 2026-09-05 | 修复便笺 / 待办模块与会话模块同级重复 key 导致面板模块雪崩式累积 |
| 0.7.0 | 2026-09-05 | 新增「便笺」与「待办」模块（当时为会话隔离 + 本地持久化 + 拖拽排序 + 添加至对话） |
| 0.6.10 | 2026-09-05 | 修复新会话发起时与 better-sidebar 互斥失效导致的空白占位、关闭侧边栏后 HUD 不恢复 |
| 0.6.7 | 2026-09-04 | git graph 分页展示仓库全部提交（每页最多 80 条 + 「加载更多」）；更换「任务」模块图标；修复 HUD 设置面板与「压缩」按钮跨会话不刷新 |
| 0.6.6 | 2026-08-31 | `package.json` 版本号对齐至 0.6.6 |
| 0.6.4 | 2026-08-31 | 修复点击弹窗外部误关闭；新增程序化版本递增兜底与日期强制同步（保证 AI 生成提交信息时版本确定性更新） |
| 0.6.3 | 2026-08-30 | `package.json` 版本号对齐；AI 生成提交信息新增参考仓库最近 10 条历史提交标题（4KB 截断，失败静默降级） |
| 0.6.2 | 2026-08-30 | `package.json` 版本号对齐；修复 AI generate 版本号未递增（增加自动校验重试与警告提示） |
| 0.6.0 | 2026-08-30 | git 模块新增分组 / 暂存 / 撤销 / 提交与 AI 生成提交信息（staged 与 changes 分组、文件行操作菜单、二次确认、commit 弹窗、AGENTS 规范注入）；一键暂存 / 取消暂存全部文件、revert 支持删除未跟踪文件、AI 生成接入会话上下文；README 截图更新并新增 git commit 截图 |
| 0.5.5 | 2026-08-30 | README 截图区重构（各模块预览 / 其他界面分组），新增「计划清单」模块与内容截图 |
| 0.5.4 | 2026-08-30 | 修复进行中任务动画图标全黑（SVG 缺失 `fill="none"`） |
| 0.5.3 | 2026-08-30 | 任务 / 计划模块底部三态计数文案调整；计划弹窗新增 GFM 表格渲染 |
| 0.5.2 | 2026-08-30 | 设置菜单中计划清单移至任务下方；执行中任务动画图标（官方同款旋转环）；任务模块底部三态计数（含 0 恒显） |
| 0.5.1 | 2026-08-30 | 修复计划清单状态推导：`tool/result` 配对键改为 `message.content[0].toolCallId`，审批通过的计划不再误判为已废弃 |
| 0.5.0 | 2026-08-30 | 新增「计划清单」模块（plan 模式计划列表、三态状态、详情弹窗、双语） |
| 0.4.5 | 2026-08-30 | README 快速开始新增「从 GitHub 远程安装」方式，本地源码安装改为方式二 |
| 0.4.4 | 2026-08-30 | README 图片改用 Markdown 原生语法并加名称标注，表格列对齐格式化 |
| 0.4.3 | 2026-08-30 | 删除两份 README 的路线图章节 |
| 0.4.2 | 2026-08-30 | 依据 README 生成规范重新撰写双语 README（11 张截图配名称标注） |
| 0.4.1 | 2026-08-30 | README 排版重构（移除居中头部区块与徽章、表格列对齐） |
| 0.4.0 | 2026-08-30 | 用量模块点击具体数值直达设置面板「账户」分区对应标签页；README 顶部预览换浅 / 深主题真实截图并新增「界面截图」章节（共 11 图） |
| 0.3.0 | 2026-08-30 | HUD 设置菜单新增「用量模块内容」分组，可分别展示 / 隐藏 DeepSeek 余额与 OpenCode Go 用量（host settings 持久化，随 profile 同步）；settings 校验与白名单扩展 `usage` 字段 |
| 0.2.9 | 2026-08-30 | 用量模块新增 OpenCode Go 三窗口用量百分比、更名为「用量」并支持折叠与双选跳转菜单；git 变更状态四色区分；git graph 移除 HEAD 徽章改为白底蓝边放大圆点标记 |
| 0.2.2 | 2026-08-30 | 新开会话页面（空白会话 / 无会话）默认不展示 HUD，临时收起不覆盖记忆状态，进入真实会话后自动恢复 |
| 0.2.1 | 2026-08-29 | 修复 MCP 图标深色下发黑（资产响应改 `no-cache`）；会话模块图标换为 DSH favicon；各模块折叠状态刷新后保持；面板滚动条停止 2s 后渐隐；MCP 模块默认展开 |
| 0.2.0 | 2026-08-29 | 新增余额模块（DeepSeek 余额 = 充值 + 赠送合计，仅安装 dsh-account-usage 且配置令牌时展示）；设置菜单图标全不透明度并新增取消 / 确认按钮；深色模式图标反转；面板限高不超聊天页、滚动条仅滚动时显示 |
| 0.1.11 | 2026-08-29 | HUD 面板宽度收窄至 300px、最大高度提高，撑满时底部与输入框底部平齐（96vh 兜底） |
| 0.1.10 | 2026-08-29 | MCP 模块启用状态改为 DSH 全局启停（读取 Loader 条目全局 `enabled`，开关写入 profile `cordis.patch.yml` 托管块，经 HMR 生效） |
| 0.1.9 | 2026-08-29 | MCP 模块在无任何 MCP 服务时也常显（空状态「未接入 MCP 服务」） |
| 0.1.8 | 2026-08-29 | git 模块汇总增加删除文件计数（修改 · 新增 · 删除 · 未跟踪） |
| 0.1.7 | 2026-08-29 | git graph 默认折叠所有版本；悬停 0.5 秒显示完整提交信息（自定义 tooltip，离开 / 点击 / 滚动即取消，顶部自动翻转） |
| 0.1.6 | 2026-08-29 | git graph 弹窗按参考图重构 UI（泳道线 + 圆点、选中行高亮、分支药丸、文件抽屉），`git log` 增加 `--name-status` 逐提交文件解析；新增右键菜单复制短哈希 / 完整哈希 / 提交信息 |
| 0.1.5 | 2026-08-29 | git graph 弹窗改为图形化提交图（结构化解析提交列表、泳道 DAG 布局、SVG 渲染、HEAD / tag / 分支引用药丸与相对时间），新增 `lib/graph.js` 与 6 项单测 |
| 0.1.4 | 2026-08-29 | 修复 HUD 设置弹层被面板裁剪与背景透明（弹层 portal 到 body）；会话状态徽章按状态分色；任务模块样式调整（已完成任务名删除线置灰） |
| 0.1.3 | 2026-08-29 | 修复压缩服务不可用（压缩按钮改经 agent 命令注册表执行 `/compact`）；面板浅 / 深主题背景对齐设计稿 |
| 0.1.2 | 2026-08-29 | 修复 HUD 面板位置与让位（面板落于会话头部下方、输入框上方，正文容器内联推挤避免重叠与双重挤压）；修复 git 计数徽章文案 |
| 0.1.1 | 2026-08-29 | 按设计稿重构 HUD 面板 UI（单卡片分区样式、状态徽章 / 计数药丸 / 彩色差分 / 开关配色） |
| 0.1.0 | 2026-08-29 | 首个版本：DSH 聊天页 HUD 悬浮面板（会话 / 上下文窗口与压缩 / git / 子代理 / 任务 / MCP 六模块、better-sidebar 互斥协作、设置持久化、双语 README） |

---

> 本文件覆盖 `package.json` 中实际出现过的版本号；更细的提交级改动可通过 `git log -- dsh-awesome-hud` 查询。
