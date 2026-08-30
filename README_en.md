# dsh-awesome-hud

[![简体中文](https://img.shields.io/badge/简体中文-red?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-blue?style=for-the-badge)](README_en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

A floating HUD panel for the DeepSeek Harness web chat: session state, context usage with one-click compaction, git changes, subagents, tasks, and MCP toggles — all at a glance.

HUD in DSH (light theme)

![alt text](docs/hud-light.png)

HUD in DSH (dark theme)

![alt text](docs/hud-dark.png)

---

> [!NOTE]
> A DSH Web plugin installed through the `dsh.bundle.patch` channel. A new "HUD panel" button appears at the top-right of the chat page; the floating panel cooperates with the [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) right sidebar so the two never overlap.

## 📑 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [🧭 Usage](#-usage)
- [🖼️ Screenshots](#️-screenshots)
- [⚙️ Compatibility](#️-compatibility)
- [🔧 Tech Stack](#-tech-stack)
- [📄 License](#-license)

---

## ✨ Features

| Module | Description |
| --- | --- |
| Session | Current workspace name, session name, session state (Running / Awaiting approval / Idle / Awaiting answer / Waiting for subagents), model provider, model, reasoning effort; the gear at its top-right opens HUD settings |
| Context window | Context occupancy bar (0–40% green / 40–90% yellow / >90% red), used/limit tokens, one-click "Compact" for the current session |
| Usage | DeepSeek balance (top-up + grant total) and OpenCode Go percentage usage for the 5h/1w/1m windows, led by icons and indented; clicking a figure opens the matching tab of the settings Account page; DeepSeek and OpenCode Go each render independently per configuration |
| git | Current branch, changed-file counts, uncommitted files with `+xx/-xx` diffs, and the "git graph" popup (last 80 commits across all refs); shown only within a git repository |
| Subagents | All descendant subagents of the session (indented by depth) with running (yellow) / done (green) states; clicking an entry opens the subagent session; shown only when subagents exist |
| Tasks | To-do list of the current session with done/pending states and a counter (e.g. `1/3`), refreshing live; in-progress tasks show a spinning animated icon and the bottom row shows the completed / in progress / pending counts (all three shown even at zero); shown only when tasks exist |
| Plan list | Every plan produced by plan mode (`exit_plan_mode`) in the current session, with three-state badges — pending review (yellow) / approved (green) / discarded (gray, struck-through dimmed text) — the header shows the total count, and clicking a row opens the full plan; shown only when plans exist |
| MCP | All connected MCP servers with their DSH-global enabled state; the switch toggles DSH-global MCP servers (written to the `cordis.patch.yml` block), refreshing the page after the change |

**Mutual exclusion**: opening the better-sidebar right sidebar closes the HUD; closing the sidebar restores it. Clicking the "HUD panel" button while the sidebar is open closes the sidebar first, then opens the HUD (if the auto-close fails due to version compatibility, the HUD opens as soon as the sidebar is closed).

## 🚀 Quick Start

**Option 1: install from GitHub remotely (recommended)**

```bash
# 1. Install (requires git access to GitHub on this machine)
dsh plugin --profile web add github:Ycet/dsh-awesome-hud

# 2. Restart the DSH Web service and refresh the page
```

**Option 2: install from local source (development)**

```bash
# 1. Install (replace <absolute-path-to-plugin> with your local source directory)
dsh plugin --profile web add dsh-awesome-hud@link:<absolute-path-to-plugin>

# 2. Restart the DSH Web service and refresh the page
```

After installation, a "HUD panel" button appears at the top-right of the chat page (left of the "Open workspace" button); click it to toggle the panel.

> [!NOTE]
> The HUD panel is expanded by default; clicking the button again or reloading remembers the last state (localStorage). Module visibility is stored in the DSH profile settings and syncs across browsers/devices with the profile.

## 🧭 Usage

- **HUD panel**: floats at the top-right of the chat page, 300px wide; its height is capped at the composer's bottom edge (with an 8px bottom margin) and scrolls internally when content overflows (the scrollbar appears only while scrolling and fades out 2s after scrolling stops); chat content and the composer automatically shift left so nothing overlaps.
- **Settings menu**: the gear at the top-right of the Session module opens a menu to toggle "Context window / Usage / git / Subagents / Tasks / Plan list / MCP" modules (Usage is listed only when available), with "Cancel / Confirm" buttons at the bottom; the Session module is always shown. When Usage is available, the menu also shows a "Usage module content" group to independently show/hide the DeepSeek balance and OpenCode Go usage row groups.
- **Context window**: the bar color switches automatically with occupancy; "Compact" is available while the session is idle and disabled with a reason while it runs.
- **Usage module**: sits below the Context window module. It reuses the dsh-account-usage routes (30s/60s host-side caches); loads immediately when the panel opens and polls every 60 seconds; the four rows are indented, each led by a DeepSeek / OpenCode Go icon; the module is collapsible and expanded by default (fold state persists in localStorage).
  - **DeepSeek balance**: shows the total (top-up + granted); the "Open" button pops up a menu to jump to the deepseek open platform or the opencode go usage page; **clicking the balance figure** opens the deepseek tab of the settings Account page directly; this row appears only when `DEEPSEEK_PLATFORM_TOKEN` is configured.
  - **OpenCode Go usage**: three rows showing the **percentage** of the oc-go 5h / 1w / 1m windows; **clicking a percentage** opens the opencode go tab of the settings Account page directly; shown only with a configured OpenCode Go Key and an active subscription (the `/api/account-usage/opencode` route returns `ok + keySource`).
  - **Module visibility & configurability**: DeepSeek and OpenCode Go are independent — only DeepSeek shows the balance row, only an active OpenCode subscription shows the three rows, and the module (plus its settings row) hides when neither is configured; the displayed content can be toggled independently in the "Usage module content" group (persisted in host settings, synced with the profile).
- **git module**: refreshes every 5 seconds while the panel is open; the "git graph" popup shows the last 80 commits across all refs; the HEAD commit is marked with an enlarged white-filled, blue-stroked dot; changed files are listed in the panel with status letters colored by type — modified `M` yellow, added `A` blue, deleted `D` red, untracked `?` gray (renamed `R` / copied `C` blue).
- **Subagents module**: lists every descendant subagent indented by depth; running entries show a **yellow** badge and done entries green; clicking an entry opens the corresponding subagent session.
- **Tasks module**: lists the current session's pending tasks; in-progress tasks show the official DSH spinning ring icon (1s/rev, brand blue), while completed/pending keep the check and to-do icons; the bottom of the module shows "x completed · x in progress · x pending" counts (all three always shown, including zeros), and the header keeps the "completed/total" counter.
- **Plan list module**: sits below the Tasks module and lists every plan produced by plan mode in the current session (newest first); it appears only when plans exist and refreshes every 5 seconds while the panel is open. States are derived automatically from the session log:
  - **Pending review** (yellow badge): the plan was just produced and the user has not approved it yet;
  - **Approved** (green badge): the user approved it in the plan review (`exit_plan_mode` succeeded);
  - **Discarded** (gray badge, struck-through dimmed text): the user rejected it / asked for changes / interrupted the review, or the plan received no approval outcome while plan mode was later exited (e.g. `/plan off`);
  - The row label is the plan's first Markdown heading, falling back to an excerpt of the body; clicking any row opens a modal with the plan's title, state, creation time and body (lightweight Markdown rendering). The module is collapsible and expanded by default.
- **MCP module**: toggles DSH-global MCP server state; the page auto-refreshes after the change; the module is expanded by default and stays visible with an empty state when no MCP server exists.
- **Fold state**: each module's collapsed/expanded state survives page refreshes (localStorage); the Session module uses the DSH favicon.
- **Blank session page**: the HUD is hidden by default on a new/blank session page; it restores when you enter a real session (without overwriting your saved state).

## 🖼️ Screenshots

### HUD Settings

![alt text](docs/hud-settings.png)

### Session module

![alt text](docs/module-session.png)

### Context window module

![alt text](docs/module-context.png)

### Usage module

![alt text](docs/module-usage.png)

### git changes module

![alt text](docs/module-git.png)
  
### Subagents module

![alt text](docs/module-subagents.png)

### Tasks module

![alt text](docs/module-tasks.png)

### MCP module

![alt text](docs/module-mcp.png)

### git graph interface

![alt text](docs/git-graph.png)

## ⚙️ Compatibility

| Item | Version / Notes |
| --- | --- |
| DeepSeek Harness | `0.1.1-rc.2` (other rc lines not individually verified; the plugin degrades gracefully via optional services + feature detection) |
| dsh-plan-mode | Data source of the Plan list: `exit_plan_mode` tool calls in the session log (`tool/call` / `tool/result` / `plan/mode` events); re-check the state derivation if the upstream review semantics change |
| dsh-better-sidebar | `0.16.1` (listens to the panel state through the public `ctx.betterSidebar` service; auto-closing relies on the collapse button's DOM marker and falls back to a delayed open — the HUD works standalone regardless) |
| Platform | macOS verified; Windows/Linux theoretically compatible (identical git command behavior) |
| Theme | Follows light/dark themes (uses `--dsw-alias-*` theme tokens) |
| Language | Simplified Chinese / English, follows the DSH locale |

## 🔧 Tech Stack

| Category | Content |
| --- | --- |
| Host | Node.js ESM, `ctx.webServer` prefix routes, `ctx.settings`, `ctx.tools.guard`, `ctx.subagents`, `ctx.compaction`, `ctx.subprocess` |
| Client | Native JavaScript ModuleLoader bundle, React (`react.createElement`), Cordis Slots (`conversation.session.header.utilities` / `shell.overlay`), CSS theme variables |
| Data sources | Client-side session projection (`ctx.sessions.list` / `workspaces` / `modelDirectories`) + own host APIs (git / MCP / subagents / plan list / compaction) + reused dsh-account-usage balance/usage routes |
| Tests | `node --test` (git parsing, MCP parsing, status derivation, plan-list derivation, settings normalization, trust fence; in `test/`) |

## 📄 License

[MIT](LICENSE)