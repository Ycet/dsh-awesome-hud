# dsh-awesome-hud

[![简体中文](https://img.shields.io/badge/简体中文-red?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-blue?style=for-the-badge)](README_en.md)

<div align="center">

# dsh-awesome-hud

A floating HUD panel for the DeepSeek Harness web chat: session state, context usage with one-click compaction, git changes, subagents, tasks, and MCP toggles — all at a glance.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

![HUD panel preview](docs/HUD_preview.png)

</div>

---

> [!NOTE]
> A DSH Web plugin installed through the `dsh.bundle.patch` channel. A new "HUD panel" button appears at the top-right of the chat page; the floating panel cooperates with the [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) right sidebar so the two never overlap.

## 📑 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [🧭 Usage](#-usage)
- [⚙️ Compatibility](#️-compatibility)
- [🔧 Tech Stack](#-tech-stack)
- [🗺️ Roadmap](#️-roadmap)
- [📄 License](#-license)

---

## ✨ Features

| Module | Description |
| --- | --- |
| Session | Current workspace name, session name, session state (Running / Awaiting approval / Idle / Awaiting answer / Waiting for subagents), model provider, model, reasoning effort; the gear at its top-right opens HUD settings |
| Context window | Context occupancy bar (green ≤40% / yellow ≤90% / red >90%), used/limit tokens, one-click "Compact" for the current session |
| git | Current branch, changed-file count, uncommitted files with `+xx/-xx` lines, and a "git graph" popup (all refs, last 80 commits); shown only when the workspace is a git repo |
| Subagents | All descendant subagents of the current session (indented by depth) with Running/Completed states; click to jump to the subagent session page; shown only when subagents exist |
| Tasks | The current session's todo list with Completed/Pending states and a `1/3` style counter, refreshed live; shown only when tasks exist |
| MCP | Every MCP server connected to DSH with per-session enable switches; disabling a server denies that session's calls to its tools |

**Mutual exclusion**: opening the better-sidebar right panel auto-closes the HUD; after manually closing the right panel the HUD reopens automatically. Clicking the "HUD panel" button while the right panel is open closes the sidebar first, then opens the HUD (if the auto-close fails due to version incompatibility, the HUD opens deferred as soon as the sidebar closes).

## 🚀 Quick Start

```bash
# 1. Install (replace <absolute-path-to-plugin> with the absolute path of this source directory)
dsh plugin --profile web add dsh-awesome-hud@link:<absolute-path-to-plugin>

# 2. Restart the DSH web service and refresh the page
```

After installation, the "HUD panel" button appears at the top-right of the chat page, to the left of the "Open workspace" button.

> [!NOTE]
> The HUD panel opens by default; clicking the button again or reloading remembers the last state (localStorage). Module visibility (all modules except Session) is stored in the DSH profile settings and syncs across browsers/devices with the profile.

## 🧭 Usage

- **HUD panel**: floats at the top-right of the chat page, 300px wide, at most 80% of the page height with internal scrolling; chat content and the composer automatically shift left so nothing overlaps.
- **Settings menu**: the gear (dashboard icon) at the top-right of the Session module opens a menu to toggle "Context window / git / Subagents / Tasks / MCP" modules; the Session module is always shown.
- **Context window**: the bar color switches automatically with occupancy; "Compact" is available while the session is idle and disabled with a reason while it runs.
- **git module**: refreshes every 5 seconds while the panel is open; the git graph popup shows the last 80 commits across all refs.
- **MCP module**: switches are remembered per session (persisted with the DSH profile); tools of a disabled server are denied for that session with an explanatory reason.

## ⚙️ Compatibility

| Item | Version / Notes |
| --- | --- |
| DeepSeek Harness | `0.1.1-rc.2` (other rc lines not individually verified; the plugin degrades via optional services + feature detection) |
| dsh-better-sidebar | `0.16.1` (panel state observed via the public `ctx.betterSidebar` service; auto-close relies on its collapse-button DOM feature and falls back to deferred opening on failure — the HUD works standalone regardless) |
| Platforms | macOS verified; Windows/Linux theoretically compatible (same git command behavior) |
| Theme | Follows light/dark themes (`--dsw-alias-*` tokens) |
| Language | 简体中文 / English, follows the DSH locale |

## 🔧 Tech Stack

| Category | Content |
| --- | --- |
| Host | Node.js ESM, `ctx.webServer` prefix routes, `ctx.settings`, `ctx.tools.guard`, `ctx.subagents`, `ctx.compaction`, `ctx.subprocess` |
| Client | Plain JavaScript ModuleLoader bundle, React (`react.createElement`), Cordis Slots (`conversation.session.header.utilities` / `shell.overlay`), CSS theme variables |
| Data | Client session projections (`ctx.sessions.list` / `workspaces` / `modelDirectories`) + dedicated host API (git / MCP / subagents / compaction) |
| Tests | `node --test` (git parsing, MCP parsing, status derivation, settings normalization, trust fence; in `test/`) |

## 🗺️ Roadmap

- [x] "HUD panel" header button and panel toggle
- [x] Session / Context window / git / Subagents / Tasks / MCP modules
- [x] Mutual exclusion with the dsh-better-sidebar right panel
- [x] HUD settings menu (persisted in host settings)
- [x] Light/dark themes and bilingual zh/en UI
- [ ] Draggable panel width (planned: fixed 300px for now)

## 📄 License

[MIT](LICENSE)
