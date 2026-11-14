// dsh-awesome-hud — v0.18.2「HUD 面板设置」收敛与「用量跳转」开关（host + client 纯函数）
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  PANEL_SIDES, PANEL_SETTING_KEYS, USAGE_DISPLAY_KEYS,
  defaultPanelSettings, normalizePanelSettings, sanitizePanelPatch, panelSettingsOf,
  defaultUsageDisplay, defaultSettings, normalizeSettings, isDefaultSettings, sanitizeUsagePatch,
} from "../lib/settings.js";
import { extractFunction, clientSource as readSource } from "./helpers/client-harness.mjs";

/** 在独立沙箱里加载客户端的两个纯函数，验证「客户端与 host 同规则」而不是只匹配源码。 */
function loadClientPanelHelpers() {
  const context = vm.createContext({ PANEL_SIDES: [...PANEL_SIDES] });
  vm.runInContext(
    `${extractFunction("defaultPanelSettings")}\n${extractFunction("normalizePanelSettings")}`,
    context,
  );
  return context;
}

test("面板设置默认值：右侧展开、新建会话页隐藏、聊天会话页展示", () => {
  assert.deepEqual([...PANEL_SIDES], ["left", "right"]);
  assert.deepEqual([...PANEL_SETTING_KEYS], ["side", "newSessionOpen", "chatOpen"]);
  assert.deepEqual(defaultPanelSettings(), { side: "right", newSessionOpen: false, chatOpen: true });
  // 返回的是副本：调用方改动不会污染后续读取。
  const copy = defaultPanelSettings();
  copy.side = "left";
  assert.equal(defaultPanelSettings().side, "right");
  assert.deepEqual(defaultSettings().panel, defaultPanelSettings());
});

test("normalizePanelSettings 收敛坏输入：未知侧位/展示方式、非布尔值回到默认", () => {
  for (const bad of [null, undefined, 0, "left", ["left"], true]) {
    assert.deepEqual(normalizePanelSettings(bad), defaultPanelSettings());
  }
  assert.deepEqual(normalizePanelSettings({}), defaultPanelSettings());
  assert.deepEqual(normalizePanelSettings({ side: "up" }), defaultPanelSettings());
  assert.deepEqual(normalizePanelSettings({ newSessionOpen: "yes", chatOpen: 0 }), defaultPanelSettings());
  // 合法值原样保留，缺失字段补默认
  assert.deepEqual(normalizePanelSettings({ side: "left" }), { side: "left", newSessionOpen: false, chatOpen: true });
  assert.deepEqual(
    normalizePanelSettings({ side: "left", newSessionOpen: true, chatOpen: false }),
    { side: "left", newSessionOpen: true, chatOpen: false },
  );
  // 已移除的 displayMode 字段不再被回写（旧 profile 里残留也直接丢弃）。
  assert.deepEqual(normalizePanelSettings({ displayMode: "hover" }), defaultPanelSettings());
  // 旧 profile（完全没有 panel 段）升级后即为默认值
  assert.deepEqual(normalizeSettings({ modules: { git: false } }).panel, defaultPanelSettings());
  assert.deepEqual(panelSettingsOf({}), defaultPanelSettings());
  assert.deepEqual(panelSettingsOf({ panel: { side: "left" } }), { side: "left", newSessionOpen: false, chatOpen: true });
});

test("sanitizePanelPatch：只接受白名单字段与合法取值，坏输入整包拒绝", () => {
  assert.deepEqual(sanitizePanelPatch({ side: "left" }), { patch: { side: "left" }, changed: false });
  assert.deepEqual(sanitizePanelPatch({ newSessionOpen: true, chatOpen: false }), { patch: { newSessionOpen: true, chatOpen: false }, changed: false });
  assert.equal(sanitizePanelPatch({ displayMode: "hover" }), null, "displayMode 已移除，不再是合法 patch");
  assert.equal(sanitizePanelPatch({ side: "up" }), null);
  assert.equal(sanitizePanelPatch({ side: 1 }), null);
  assert.equal(sanitizePanelPatch({ newSessionOpen: "yes" }), null);
  assert.equal(sanitizePanelPatch({ other: true }), null, "白名单外键不算有效 patch");
  assert.equal(sanitizePanelPatch({}), null);
  assert.equal(sanitizePanelPatch(null), null);
  // 混入非法字段时整体拒绝，避免「一半写进去、一半被忽略」
  assert.equal(sanitizePanelPatch({ side: "left", chatOpen: "no" }), null);
});

test("面板设置参与 isDefaultSettings 判定", () => {
  assert.equal(isDefaultSettings(defaultSettings()), true);
  assert.deepEqual(defaultSettings().panel, defaultPanelSettings());
  assert.equal(isDefaultSettings({ ...defaultSettings(), panel: { side: "left", newSessionOpen: false, chatOpen: true } }), false);
  assert.equal(isDefaultSettings({ ...defaultSettings(), panel: { side: "right", newSessionOpen: true, chatOpen: true } }), false);
  assert.equal(isDefaultSettings({ ...defaultSettings(), panel: { side: "right", newSessionOpen: false, chatOpen: false } }), false);
});

test("「跳转」开关并入「用量设置」：默认启用且参与收敛/白名单/默认判定", () => {
  assert.ok(USAGE_DISPLAY_KEYS.includes("showJump"));
  assert.equal(defaultUsageDisplay().showJump, true);
  assert.deepEqual(normalizeSettings({ usage: { showJump: false } }).usage, { deepseek: true, opencode: true, codex: true, showJump: false });
  assert.deepEqual(normalizeSettings({ usage: { showJump: "no" } }).usage, defaultUsageDisplay());
  assert.deepEqual(sanitizeUsagePatch({ showJump: false }), { patch: { showJump: false }, changed: false });
  assert.equal(sanitizeUsagePatch({ showJump: "no" }), null);
  assert.equal(isDefaultSettings({ ...defaultSettings(), usage: { ...defaultUsageDisplay(), showJump: false } }), false);
});

test("客户端与 host 的面板默认值/收敛规则完全一致", () => {
  const client = loadClientPanelHelpers();
  assert.deepEqual(JSON.parse(JSON.stringify(client.defaultPanelSettings())), defaultPanelSettings());
  // 同一批坏输入必须收敛到同一结果，避免升级后两端互相覆盖。
  const samples = [
    null, {}, { side: "left" }, { side: "up" }, { side: "left", newSessionOpen: true, chatOpen: false },
    { newSessionOpen: "yes" }, { side: "right", chatOpen: 0 },
    { displayMode: "hover" }, { side: "left", side2: "x" },
  ];
  for (const sample of samples) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(client.normalizePanelSettings(sample))),
      normalizePanelSettings(sample),
      `客户端与 host 对 ${JSON.stringify(sample)} 的收敛结果必须一致`,
    );
  }
});

test("客户端「用量」默认值包含 showJump，与 host 保持一致", () => {
  const source = readSource;
  assert.match(source, /const USAGE_SETTING_KEYS = \["deepseek", "opencode", "codex", "showJump"\];/);
  assert.match(source, /return \{ deepseek: true, opencode: true, codex: true, showJump: true \};/);
});
