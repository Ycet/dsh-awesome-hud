// dsh-awesome-hud — v0.20.0「便笺」模块设置（条数上限）回归
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  NOTE_COUNT_MIN, NOTE_COUNT_MAX, NOTE_COUNT_DEFAULT, NOTE_POPUP_EDIT_DEFAULT, NOTE_SETTING_KEYS,
  normalizeNoteMaxCount, normalizeNoteSettings, sanitizeNotePatch, noteSettingsOf,
  defaultSettings, normalizeSettings, isDefaultSettings,
} from "../lib/settings.js";
import { Config } from "../lib/index.js";
import { clientSource as source, extractConst } from "./helpers/client-harness.mjs";

test("设置模型：便笺上限默认 5、区间 5–20，弹窗编辑默认关闭，字段白名单稳定", () => {
  // v0.21.0：追加 popupEdit（默认 false）。
  assert.deepEqual([...NOTE_SETTING_KEYS], ["maxCount", "popupEdit"]);
  assert.equal(NOTE_COUNT_DEFAULT, 5);
  assert.equal(NOTE_POPUP_EDIT_DEFAULT, false);
  assert.deepEqual(JSON.parse(JSON.stringify(defaultSettings().note)), { maxCount: 5, popupEdit: false });
  assert.equal(normalizeNoteMaxCount(3), 5);
  assert.equal(normalizeNoteMaxCount(21), 20);
  assert.equal(normalizeNoteMaxCount("7"), 7);
  assert.equal(normalizeNoteMaxCount(undefined), 5);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeNoteSettings(null))), { maxCount: 5, popupEdit: false });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeNoteSettings({ maxCount: 99 }))), { maxCount: 20, popupEdit: false });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeNoteSettings({ maxCount: 7, popupEdit: true }))), { maxCount: 7, popupEdit: true });
  // 非布尔一律回 false（坏数据不会打开弹窗）。
  assert.equal(normalizeNoteSettings({ popupEdit: 1 }).popupEdit, false);
  assert.equal(normalizeNoteSettings({ popupEdit: "true" }).popupEdit, false);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeSettings({ note: { maxCount: 12, popupEdit: true } }).note)), { maxCount: 12, popupEdit: true });
  assert.equal(noteSettingsOf({ note: { maxCount: 8, popupEdit: true } }).popupEdit, true);
  // 恢复默认的判定包含 maxCount 与 popupEdit。
  assert.equal(isDefaultSettings(defaultSettings()), true);
  assert.equal(isDefaultSettings({ ...defaultSettings(), note: { maxCount: 9, popupEdit: false } }), false);
  assert.equal(isDefaultSettings({ ...defaultSettings(), note: { maxCount: 5, popupEdit: true } }), false);
});

test("宿主 schema：note.maxCount 默认 5、popupEdit 默认 false，白名单 patch 逐字段校验", () => {
  assert.equal(Config.dict.note.dict.maxCount.meta.default, 5);
  assert.equal(Config.dict.note.dict.popupEdit.meta.default, false);
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeNotePatch({ maxCount: 8 }))), { patch: { maxCount: 8 }, changed: false });
  // v0.21.0：popupEdit 可单独下发。
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeNotePatch({ popupEdit: true }))), { patch: { popupEdit: true }, changed: false });
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeNotePatch({ maxCount: 6, popupEdit: false }))), { patch: { maxCount: 6, popupEdit: false }, changed: false });
  assert.equal(sanitizeNotePatch({ maxCount: 4 }), null);
  assert.equal(sanitizeNotePatch({ maxCount: 21 }), null);
  assert.equal(sanitizeNotePatch({ maxCount: 7.5 }), null);
  assert.equal(sanitizeNotePatch({ maxCount: "8" }), null);
  assert.equal(sanitizeNotePatch({ popupEdit: 1 }), null);
  assert.equal(sanitizeNotePatch({ popupEdit: "true" }), null);
  // 同时提供合法与非法字段时整包拒绝（不做半截写入）。
  assert.equal(sanitizeNotePatch({ maxCount: 8, popupEdit: "yes" }), null);
  assert.equal(sanitizeNotePatch({}), null);
  assert.equal(sanitizeNotePatch(null), null);
});

test("宿主设置接口：GET 返回 note，POST 合并 note 并回显", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const {
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch, sanitizeNotePatch, sanitizeGitPatch,
    modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, noteSettingsOf, gitSettingsOf, normalizeModuleOrder, defaultModuleOrder,
  } = await import("../lib/settings.js");
  const context = vm.createContext({
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch, sanitizeNotePatch, sanitizeGitPatch,
    modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, noteSettingsOf, gitSettingsOf, normalizeModuleOrder, defaultModuleOrder,
    ctx: { get: () => undefined },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null; let memoryContext = null; let memoryOrder = null; let memoryPanel = null; let memoryNote = null; let memoryGit = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  const initial = await context.handler(true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.note)), { maxCount: NOTE_COUNT_DEFAULT, popupEdit: false }, "默认 GET 返回 maxCount=5 与 popupEdit=false");
  const saved = await context.handler(false, { note: { maxCount: 9, popupEdit: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(saved.note)), { maxCount: 9, popupEdit: true }, "POST 保存并回显");
  const restored = await context.handler(true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.note)), { maxCount: 9, popupEdit: true }, "进程内降级可读回");
  // 只改 popupEdit 也是合法 patch（未提供的 maxCount 保持现状）。
  const toggled = await context.handler(false, { note: { popupEdit: false } });
  assert.deepEqual(JSON.parse(JSON.stringify(toggled.note)), { maxCount: 9, popupEdit: false }, "单独下发 popupEdit 只改该字段");
  await assert.rejects(context.handler(false, { note: { maxCount: 3 } }), /缺少合法的设置内容/, "非法上限整体拒绝");
  await assert.rejects(context.handler(false, { note: { popupEdit: "yes" } }), /缺少合法的设置内容/, "非法开关整体拒绝");
});

test("客户端接线：设置卡片、数字步进器、确认前校验与恢复默认", () => {
  assert.match(source, /function HudNumberStepper\(props\) \{/);
  assert.match(source, /className: "hud-number-stepper"/);
  assert.match(source, /className: "hud-number-input",\n\t+\s*type: "number",/);
  assert.match(source, /const \[noteDraft, setNoteDraft\] = react\.useState\(\(\) => normalizeNoteSettings\(props\.note\)\);/);
  assert.match(source, /className: "hud-settings-section hud-settings-section-card" \},\n\t+react\.createElement\("div", \{ className: "hud-settings-section-title" \}, t\("settingsNoteTitle"\)\)/);
  assert.match(source, /value: noteDraft\.maxCount,/);
  assert.match(source, /min: NOTE_COUNT_MIN,/);
  assert.match(source, /max: NOTE_COUNT_MAX,/);
  // v0.21.0：新增「在弹窗页面中进行便笺内容编辑」开关（默认关闭），改动时保留其它便笺字段。
  assert.match(source, /checked: noteDraft\.popupEdit === true,/);
  assert.match(source, /setNoteDraft\(\(prev\) => \(\{ \.\.\.prev, popupEdit: next === true \}\)\)/);
  assert.match(source, /settingsNotePopup: "在弹窗页面中进行便笺内容编辑",/);
  assert.match(source, /settingsNotePopup: "Edit note content in a dialog",/);
  assert.match(source, /disabled: !edited,\n\t+onClick: confirmSettings,/);
  assert.match(source, /t\("settingsConfirm"\)/);
  // v0.21.0：恢复默认改为三项菜单；右栏范围包含便笺设置。
  assert.match(source, /const resetFeatureSettings = \(\) => \{/);
  const resetStart = source.indexOf("const resetFeatureSettings = () => {");
  assert.match(source.slice(resetStart, resetStart + 600), /setNoteDraft\(defaultNoteSettings\(\)\);/);
  assert.match(source, /const resetAllSettings = \(\) => \{/);
  // 面板设置菜单把草稿一并提交给 updateSettings。
  assert.match(source, /props\.onSettingsChange\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, gitDraft\);/);
  // 说明页与 README 用同一套 5–20 文案依据。
  assert.match(source, /guideNoteLimit: "在 HUD 设置 → 便笺 中可调整便笺条数上限，范围为 5–20，默认 5。上限调低后仍可保存。已有条数超过上限的工作区保持现状，但不能再新建便笺。"/);
  // v0.20.1：保存时不再因工作区超限而拒绝（只保留新建时的上限检查）。
  const confirmStart = source.indexOf("const confirmSettings = () => {");
  const confirmBody = source.slice(confirmStart, source.indexOf("};", confirmStart));
  assert.doesNotMatch(confirmBody, /noteCountViolations|noteCapRejected/, "保存不再做超限校验");
  assert.match(source, /if \(current\.notes\.length >= maxCount\)/);
  assert.match(source, /settingsNoteMaxHint: "5–20，默认 5"/);
  assert.match(source, /settingsNoteMaxHint: "5–20, default 5"/);
});
