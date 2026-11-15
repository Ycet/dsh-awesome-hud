// dsh-awesome-hud — v0.21.0：「git变更」模块设置（列表 / 文件树）
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  GIT_VIEWS, GIT_VIEW_DEFAULT, normalizeGitView, normalizeGitSettings, sanitizeGitPatch, gitSettingsOf,
  defaultSettings, normalizeSettings, isDefaultSettings,
} from "../lib/settings.js";
import { clientSource as source, hudClient } from "./helpers/client-harness.mjs";

test("settings：git.view 只接受 list / tree，默认 list", () => {
  assert.deepEqual([...GIT_VIEWS], ["list", "tree"]);
  assert.equal(GIT_VIEW_DEFAULT, "list");
  assert.equal(normalizeGitView("tree"), "tree");
  assert.equal(normalizeGitView("list"), "list");
  assert.equal(normalizeGitView("grid"), "list");
  assert.equal(normalizeGitView(undefined), "list");
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeGitSettings(null))), { view: "list" });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeGitSettings({ view: "tree" }))), { view: "tree" });
  assert.deepEqual(JSON.parse(JSON.stringify(gitSettingsOf({ git: { view: "tree" } }))), { view: "tree" });
});

test("settings：sanitizeGitPatch 拒绝非法值，合法值只含 view", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeGitPatch({ view: "tree" }))), { patch: { view: "tree" }, changed: false });
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeGitPatch({ view: "list" }))), { patch: { view: "list" }, changed: false });
  assert.equal(sanitizeGitPatch({ view: "grid" }), null);
  assert.equal(sanitizeGitPatch({ view: 1 }), null);
  assert.equal(sanitizeGitPatch({}), null);
  assert.equal(sanitizeGitPatch(null), null);
});

test("settings：默认值与 isDefaultSettings 纳入 git.view", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(defaultSettings().git)), { view: "list" });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeSettings({ git: { view: "tree" } }).git)), { view: "tree" });
  assert.equal(isDefaultSettings(defaultSettings()), true);
  assert.equal(isDefaultSettings({ ...defaultSettings(), git: { view: "tree" } }), false);
  assert.equal(isDefaultSettings({ ...defaultSettings(), git: { view: "bogus" } }), true, "非法值回默认，仍算默认");
});

test("宿主 settings 接口：GET 返回 git，POST 合并并回显", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const settings = await import("../lib/settings.js");
  const context = vm.createContext({
    normalizeSettings: settings.normalizeSettings,
    sanitizeModulesPatch: settings.sanitizeModulesPatch,
    sanitizeUsagePatch: settings.sanitizeUsagePatch,
    sanitizeOrderPatch: settings.sanitizeOrderPatch,
    sanitizeContextPatch: settings.sanitizeContextPatch,
    sanitizePanelPatch: settings.sanitizePanelPatch,
    sanitizeNotePatch: settings.sanitizeNotePatch,
    sanitizeGitPatch: settings.sanitizeGitPatch,
    modulesOf: settings.modulesOf,
    usageDisplayOf: settings.usageDisplayOf,
    contextSettingsOf: settings.contextSettingsOf,
    moduleOrderOf: settings.moduleOrderOf,
    panelSettingsOf: settings.panelSettingsOf,
    noteSettingsOf: settings.noteSettingsOf,
    gitSettingsOf: settings.gitSettingsOf,
    normalizeModuleOrder: settings.normalizeModuleOrder,
    defaultModuleOrder: settings.defaultModuleOrder,
    ctx: { get: () => undefined },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null; let memoryContext = null; let memoryOrder = null; let memoryPanel = null; let memoryNote = null; let memoryGit = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  const initial = await context.handler(true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.git)), { view: "list" });
  const saved = await context.handler(false, { git: { view: "tree" } });
  assert.deepEqual(JSON.parse(JSON.stringify(saved.git)), { view: "tree" });
  const restored = await context.handler(true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.git)), { view: "tree" }, "进程内降级可读回");
  await assert.rejects(context.handler(false, { git: { view: "grid" } }), /缺少合法的设置内容/);
});

test("客户端接线：设置卡片、草稿、恢复默认、渲染器与旧宿主提示", () => {
  assert.match(source, /function defaultGitSettings\(\) \{\n\t+return \{ view: GIT_VIEW_DEFAULT \};/);
  assert.match(source, /function normalizeGitSettings\(raw\) \{/);
  assert.match(source, /const \[gitDraft, setGitDraft\] = react\.useState\(\(\) => normalizeGitSettings\(props\.git\)\);/);
  assert.match(source, /className: "hud-settings-section-title" \}, t\("settingsGitTitle"\)\)/);
  assert.match(source, /id: "hud-settings-git-view"/);
  assert.match(source, /label: t\("settingsGitView"\)/);
  assert.match(source, /setGitDraft\(defaultGitSettings\(\)\);/);
  assert.match(source, /gitView: gitSettings\?\.view === "tree" \? "tree" : "list"/);
  assert.match(source, /body\.git\?\.view === undefined/);
  const { zh, en } = hudClient().dictionaries[0];
  for (const key of ["settingsGitTitle", "settingsGitView", "settingsGitViewHint", "settingsGitViewList", "settingsGitViewTree"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文`);
    assert.equal(typeof en[key], "string", `${key} 需要英文`);
  }
});

test("宿主 settings 作用域读取 git（刷新/重挂后不回退 list）", () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("let settingsScope = null;");
  const end = hostSource.indexOf("\n\n\tctx.effect(() => ctx.webServer.register", start);
  const context = vm.createContext({
    ctx: {
      get: (name) => (name === "settings" ? {
        describe: () => [{ ns: "awesome-hud", revision: 1 }],
        writable: true,
        update: async () => {},
      } : undefined),
      fiber: { entry: { options: { id: "awesome-hud" } } },
    },
    config: {
      modules: { get: () => ({}) },
      usage: { get: () => ({}) },
      context: { get: () => ({}) },
      order: { get: () => [] },
      panel: { get: () => ({}) },
      note: { get: () => ({}) },
      git: { get: () => ({ view: "tree" }) },
      commitPrompt: { get: () => "" },
    },
  });
  vm.runInContext(`${hostSource.slice(start, end)}\nthis.scope = settingsScope;`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.scope.get().git)), { view: "tree" }, "settingsScope.get 必须透出 git，否则每次重新 GET 都回默认 list");
  assert.match(hostSource, /git: config\.git\?\.get\?\.\(\) \?\? \{\}/);
});
