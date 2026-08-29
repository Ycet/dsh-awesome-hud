# dsh-awesome-hud

[![简体中文](https://img.shields.io/badge/简体中文-red?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-blue?style=for-the-badge)](README_en.md)

<div align="center">

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
- [🗺️ Roadmap](#️-roadmap)
- [📄 License](#-license)

---

## ✨ Features

| Module         | Description                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session        | Current workspace name, session name, session state (Running / Awaiting approval / Idle / Awaiting answer / Waiting for subagents), model provider, model, reasoning effort; the gear at its top-right opens HUD settings                                                                                                                                                                                       |
| Context window | Context occupancy bar (green ≤40% / yellow ≤90% / red >90%), used/limit tokens, one-click "Compact" for the current session                                                                                                                                                                                                                                                                                   |
| git            | Current branch, changed-file count, uncommitted files with`+xx/-xx` lines, and a "git graph" popup (all refs, last 80 commits); shown only when the workspace is a git repo                                                                                                                                                                                                                                   |
| Subagents      | All descendant subagents of the current session (indented by depth) with Running/Completed states; click to jump to the subagent session page; shown only when subagents exist                                                                                                                                                                                                                                  |
| Tasks          | The current session's todo list with Completed/Pending states and a`1/3` style counter, refreshed live; shown only when tasks exist                                                                                                                                                                                                                                                                           |
| MCP            | Every MCP server of DSH with its**global** enabled state; the switch toggles the server globally (writes the profile's `cordis.patch.yml`) and the page refreshes afterwards                                                                                                                                                                                                                            |
| Usage          | DeepSeek balance (top-up + granted) and OpenCode Go usage percents for the three windows (oc-go 5h/1w/1m usage, percentages only, reusing dsh-account-usage data; "Open" jumps to the open platform); DeepSeek and OpenCode Go are shown independently — only DeepSeek shows the balance row, only an active OpenCode subscription shows the three usage rows, and the module hides when neither is configured |

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

- **HUD panel**: floats at the top-right of the chat page, 300px wide; its height is capped at the composer's bottom edge (when fully extended the panel bottom aligns with the composer bottom, never exceeding the visible chat-page height — an 8px bottom margin is kept) and scrolls internally when content overflows (the scrollbar appears only while scrolling and fades out 2s after scrolling stops); chat content and the composer automatically shift left so nothing overlaps.
- **Settings menu**: the gear (dashboard icon) at the top-right of the Session module opens a menu to toggle "Context window / Usage / git / Subagents / Tasks / MCP" modules (Usage is listed only when available), with "Cancel / Confirm" buttons at the bottom to discard or save the selection; the Session module is always shown. When Usage is available, the menu also shows a "Usage module content" group to independently show/hide the DeepSeek balance and OpenCode Go usage row groups.
- **Context window**: the bar color switches automatically with occupancy; "Compact" is available while the session is idle and disabled with a reason while it runs.
- **git module**: refreshes every 5 seconds while the panel is open; the git graph popup shows the last 80 commits across all refs; the HEAD commit is marked with an enlarged white-filled, blue-stroked dot (the former "HEAD" badge is removed).
- **MCP module**: switches toggle DSH's **global** MCP server state (stored in the `dsh-awesome-hud mcp states` block of the profile's `cordis.patch.yml`); the page auto-refreshes after the change; the module is expanded by default. It stays visible with an empty state when no MCP server exists.
- **Usage module**: sits below the Context window module. It reuses the dsh-account-usage routes (30s/60s host-side caches); loads immediately when the panel opens and polls every 60 seconds; the four rows are indented, each led by a DeepSeek / OpenCode Go icon; the module is collapsible and expanded by default (fold state persists in localStorage).
  - **DeepSeek balance**: shows the total (top-up + granted); the "Open" button pops up a menu to jump to the deepseek open platform or the opencode go usage page; **clicking the balance figure** opens the deepseek tab of the settings Account page directly; this row appears only when `DEEPSEEK_PLATFORM_TOKEN` is configured.
  - **OpenCode Go usage**: three rows showing the **percentage** of the oc-go 5h / 1w / 1m windows; **clicking a percentage** opens the opencode go tab of the settings Account page directly; shown only with a configured OpenCode Go Key and an active subscription (the `/api/account-usage/opencode` route returns `ok + keySource`); hidden for a missing Key (`no-key`) or an expired/subscription-less state (`unauthorized`).
  - **Module visibility**: DeepSeek and OpenCode Go are independent — only DeepSeek shows the balance row, only an active OpenCode subscription shows the three rows, and the module (plus its settings row) hides when neither is configured.
  - **Configurable content**: the "Usage module content" group in the HUD settings menu toggles showing/hiding the "DeepSeek balance" and "OpenCode Go usage" rows independently (both shown by default; persisted in host settings and synced with the profile).
- **git module**: the status letter at the left of each changed file is colored by type — modified `M` yellow, added `A` blue, deleted `D` red, untracked `?` gray (renamed `R` / copied `C` blue).
- **Icons**: settings-menu icons use the full-opacity theme color; in dark mode every icon is inverted with the theme.
- **Fold state**: each module's collapsed/expanded state survives page refreshes (localStorage); the Session module uses the DSH favicon.
- **Blank session page**: the HUD is hidden by default on a new/blank session page; it restores when you enter a real session (without overwriting your saved state).

## 🖼️ Screenshots

<p align="center">
  <img src="docs/hud-settings.png" alt="HUD settings menu" width="46%" />
</p>

**Settings menu**: the gear button opens the module visibility menu, and the "Usage module content" group independently toggles the DeepSeek balance and OpenCode Go usage rows.

<p align="center">
  <img src="docs/module-session.png" alt="Session module" width="46%" />
  <img src="docs/module-context.png" alt="Context window module" width="46%" />
</p>

<p align="center">
  <img src="docs/module-usage.png" alt="Usage module" width="46%" />
  <img src="docs/module-git.png" alt="git changes module" width="46%" />
</p>

<p align="center">
  <img src="docs/module-subagents.png" alt="Subagents module" width="46%" />
  <img src="docs/module-tasks.png" alt="Tasks module" width="46%" />
</p>

<p align="center">
  <img src="docs/module-mcp.png" alt="MCP module" width="46%" />
  <img src="docs/git-graph.png" alt="git graph interface" width="46%" />
</p>

## ⚙️ Compatibility

| Item               | Version / Notes                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek Harness   | `0.1.1-rc.2` (other rc lines not individually verified; the plugin degrades via optional services + feature detection)                                                                                                  |
| dsh-better-sidebar | `0.16.1` (panel state observed via the public `ctx.betterSidebar` service; auto-close relies on its collapse-button DOM feature and falls back to deferred opening on failure — the HUD works standalone regardless) |
| Platforms          | macOS verified; Windows/Linux theoretically compatible (same git command behavior)                                                                                                                                        |
| Theme              | Follows light/dark themes (`--dsw-alias-*` tokens)                                                                                                                                                                      |
| Language           | 简体中文 / English, follows the DSH locale                                                                                                                                                                                |

## 🔧 Tech Stack

| Category | Content                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host     | Node.js ESM,`ctx.webServer` prefix routes, `ctx.settings`, `ctx.tools.guard`, `ctx.subagents`, `ctx.compaction`, `ctx.subprocess`                                                       |
| Client   | Plain JavaScript ModuleLoader bundle, React (`react.createElement`), Cordis Slots (`conversation.session.header.utilities` / `shell.overlay`), CSS theme variables                            |
| Data     | Client session projections (`ctx.sessions.list` / `workspaces` / `modelDirectories`) + dedicated host API (git / MCP / subagents / compaction) + the dsh-account-usage balance route (reused) |
| Tests    | `node --test` (git parsing, MCP parsing, status derivation, settings normalization, trust fence; in `test/`)                                                                                    |

## 🗺️ Roadmap

- [X] "HUD panel" header button and panel toggle
- [X] Session / Context window / git / Subagents / Tasks / MCP / Usage modules
- [X] Mutual exclusion with the dsh-better-sidebar right panel
- [X] HUD settings menu (persisted in host settings)
- [X] Light/dark themes and bilingual zh/en UI

## 📄 License

[MIT](LICENSE)
