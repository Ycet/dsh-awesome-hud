// dsh-awesome-hud — v0.21.1：无变更文件时 commit 按钮仍可打开弹窗
//  1) 模块里的 commit 按钮不再因 stagedCount === 0 置灰
//  2) 弹窗内 AI generate / commit 在无暂存变更时置灰，并显示空态提示行
//  3) 动作函数自带兜底（回车或程序化触发也不会提交/生成）
//  4) 中英文案成对
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { clientSource as source, hudClient } from "./helpers/client-harness.mjs";

const ZERO_HINT = "gitCommitEmptyStaged";

/** 取 [from, to) 之间的源码片段。 */
const slice = (from, to, name) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start > 0 && end > start, `定位不到${name}`);
  return source.slice(start, end);
};

test("模块动作区：commit 按钮不再按暂存数量置灰，仍绑定 openCommit", () => {
  const actions = slice('react.createElement("div", { className: "hud-git-actions" }', 'stagedFiles.length === 0', "动作区");
  const commitStart = actions.indexOf('title: t("gitCommitTitle")');
  assert.ok(commitStart > 0, "动作区里应有 commit 按钮");
  const commitButton = actions.slice(Math.max(0, commitStart - 400), commitStart + 200);
  assert.match(commitButton, /onClick: openCommit/);
  assert.doesNotMatch(commitButton, /disabled: stagedCount === 0/, "commit 按钮不得再因无暂存而置灰");
  // git graph / revert 的置灰规则保持原样
  assert.match(actions, /disabled: revertableCount === 0,/);
});

test("commit 弹窗：无暂存变更时两个按钮置灰，并显示空态提示行", () => {
  const modal = slice('className: "hud-modal-body hud-commit-modal-body"', "return react.createElement(react.Fragment, null,", "commit 弹窗");
  // AI generate
  assert.match(modal, /disabled: aiBusy \|\| stagedCount === 0,/);
  // commit
  assert.match(modal, /disabled: commitMessage\.trim\(\) === "" \|\| aiBusy \|\| stagedCount === 0,/);
  // 空态提示替换统计行
  assert.match(modal, /stagedCount === 0\s*\n\s*\? t\("gitCommitEmptyStaged"\)\s*\n\s*: interpolate\(t\("gitCommitSummary"\), \{ count: stagedCount \}\)\),/);
  // 提示词区域仍在统计行之上，保持可查看/可修改
  const promptIndex = modal.indexOf("react.createElement(CommitPromptSection, null)");
  const noteIndex = modal.indexOf('className: "hud-commit-note"');
  assert.ok(promptIndex > 0 && noteIndex > promptIndex, "提示词区域必须仍可访问");
});

test("动作函数自带兜底：无暂存变更时不提交、不调用模型", () => {
  const doCommit = slice("const doCommit = async () => {", "const doAiGenerate", "doCommit");
  assert.match(doCommit, /if \(stagedCount === 0\) \{ toast\(t\("gitCommitEmptyStaged"\)\); return; \}/);
  const doAi = slice("const doAiGenerate = async () => {", "const onAiGenerateClick", "doAiGenerate");
  assert.match(doAi, /if \(stagedCount === 0\) \{ toast\(t\("gitCommitEmptyStaged"\)\); return; \}/);
  // 兜底必须发生在真正调用 host 之前
  assert.ok(doAi.indexOf("stagedCount === 0") < doAi.indexOf('call("git/commit-ai"'), "无暂存时不得发起生成");
  assert.ok(doCommit.indexOf("stagedCount === 0") < doCommit.indexOf('call("git/commit"'), "无暂存时不得提交");
});

test("中英文案：空态提示键成对存在且措辞明确", () => {
  const { zh, en } = hudClient().dictionaries[0];
  assert.equal(typeof zh[ZERO_HINT], "string");
  assert.equal(typeof en[ZERO_HINT], "string");
  assert.match(zh[ZERO_HINT], /暂存/);
  assert.match(en[ZERO_HINT], /staged/i);
});

test("宿主侧同样拒绝空提交（回归保护）", () => {
  const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  assert.match(host, /if \(before\.counts\.staged === 0\) throw Object\.assign\(new Error\("暂存区没有可提交的变更"\), \{ status: 400 \}\);/);
});
