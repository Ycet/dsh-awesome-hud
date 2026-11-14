// dsh-awesome-hud — v0.20.0「便笺」模块设置（条数上限）回归
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  NOTE_COUNT_MIN, NOTE_COUNT_MAX, NOTE_COUNT_DEFAULT, NOTE_SETTING_KEYS,
  normalizeNoteMaxCount, normalizeNoteSettings, sanitizeNotePatch, noteSettingsOf,
  defaultSettings, normalizeSettings, isDefaultSettings,
} from "../lib/settings.js";
import { Config } from "../lib/index.js";
import { clientSource as source, extractConst } from "./helpers/client-harness.mjs";

test("设置模型：便笺上限默认 5、区间 5–20，字段白名单稳定", () => {
  assert.deepEqual([...NOTE_SETTING_KEYS], ["maxCount"]);
  assert.equal(NOTE_COUNT_DEFAULT, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(defaultSettings().note)), { maxCount: 5 });
  assert.equal(normalizeNoteMaxCount(3), 5);
  assert.equal(normalizeNoteMaxCount(21), 20);
  assert.equal(normalizeNoteMaxCount("7"), 7);
  assert.equal(normalizeNoteMaxCount(undefined), 5);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeNoteSettings(null))), { maxCount: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeNoteSettings({ maxCount: 99 }))), { maxCount: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeSettings({ note: { maxCount: 12 } }).note)), { maxCount: 12 });
  assert.equal(noteSettingsOf({ note: { maxCount: 8 } }).maxCount, 8);
  // 恢复默认的判定包含 maxCount。
  assert.equal(isDefaultSettings(defaultSettings()), true);
  assert.equal(isDefaultSettings({ ...defaultSettings(), note: { maxCount: 9 } }), false);
});

test("宿主 schema：note.maxCount 默认 5，白名单 patch 只接受 5–20 的整数", () => {
  assert.equal(Config.dict.note.dict.maxCount.meta.default, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeNotePatch({ maxCount: 8 }))), { patch: { maxCount: 8 }, changed: false });
  assert.equal(sanitizeNotePatch({ maxCount: 4 }), null);
  assert.equal(sanitizeNotePatch({ maxCount: 21 }), null);
  assert.equal(sanitizeNotePatch({ maxCount: 7.5 }), null);
  assert.equal(sanitizeNotePatch({ maxCount: "8" }), null);
  assert.equal(sanitizeNotePatch({}), null);
  assert.equal(sanitizeNotePatch(null), null);
});

test("宿主设置接口：GET 返回 note，POST 合并 note 并回显", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const {
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch, sanitizeNotePatch,
    modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, noteSettingsOf, normalizeModuleOrder, defaultModuleOrder,
  } = await import("../lib/settings.js");
  const context = vm.createContext({
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch, sanitizeNotePatch,
    modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, noteSettingsOf, normalizeModuleOrder, defaultModuleOrder,
    ctx: { get: () => undefined },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null; let memoryContext = null; let memoryOrder = null; let memoryPanel = null; let memoryNote = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  const initial = await context.handler(true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.note)), { maxCount: NOTE_COUNT_DEFAULT }, "默认 GET 返回 maxCount=5");
  const saved = await context.handler(false, { note: { maxCount: 9 } });
  assert.deepEqual(JSON.parse(JSON.stringify(saved.note)), { maxCount: 9 }, "POST 保存并回显");
  const restored = await context.handler(true, null);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.note)), { maxCount: 9 }, "进程内降级可读回");
  await assert.rejects(context.handler(false, { note: { maxCount: 3 } }), /缺少合法的设置内容/, "非法上限整体拒绝");
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
  assert.match(source, /disabled: !edited,\n\t+onClick: confirmSettings,/);
  assert.match(source, /t\("settingsConfirm"\)/);
  const resetStart = source.indexOf("const resetDefaults = () => {");
  assert.match(source.slice(resetStart, resetStart + 600), /setNoteDraft\(defaultNoteSettings\(\)\);/);
  // 面板设置菜单把草稿一并提交给 updateSettings。
  assert.match(source, /props\.onSettingsChange\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft\);/);
  // 说明页与 README 用同一套 5–20 文案依据。
  assert.match(source, /guideNoteLimit: "在 HUD 设置 → 便笺 中可调整便笺条数上限。范围为 5–20，默认 5。"/);
  assert.match(source, /settingsNoteMaxHint: "5–20，默认 5"/);
  assert.match(source, /settingsNoteMaxHint: "5–20, default 5"/);
});
