import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch,
  modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, normalizeModuleOrder, defaultModuleOrder,
  isDefaultSettings, DEFAULT_MODULE_ORDER, defaultContextSettings, normalizeContextSettings,
  defaultPanelSettings, normalizePanelSettings, defaultUsageDisplay,
} from "../lib/settings.js";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadUseHudModules(options = {}) {
  const states = [];
  const refs = [];
  let stateCursor = 0;
  let refCursor = 0;
  const calls = [];
  const initial = options.initial ?? {
    modules: { context: true, git: true },
    usage: defaultUsageDisplay(),
    context: defaultContextSettings(),
    panel: defaultPanelSettings(),
  };
  let resolveInitial;
  const initialPromise = options.deferInitial
    ? new Promise(resolve => { resolveInitial = resolve; })
    : Promise.resolve(initial);
  const react = {
    useState(value) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof value === "function" ? value() : value;
      return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useRef(value) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    useEffect(effect) { effect(); },
    useCallback(fn) { return fn; },
  };
  const context = vm.createContext({
    react,
    // v0.18.2：hook 每次挂载都会重新 GET；首帧种子来自模块级「最近一次成功快照」。
    getSettings: () => initialPromise,
    lastSettingsBody: null,
    rememberSettingsBody: () => {},
    lastUsageDisplay: null,
    acceptUsageDisplay: raw => (raw ?? null),
    call: async (method, payload) => { calls.push({ method, payload }); return { ok: true, ...payload }; },
    defaultModules: () => ({ context: true, git: true }),
    defaultUsageDisplay,
    defaultContextSettings,
    normalizeContextSettings,
    defaultModuleOrder,
    normalizeModuleOrder,
    // v0.18.2：hook 还会读面板设置的模块级缓存 / 对账入口。
    PANEL_SIDES: ["left", "right"],
    panelPrefs: defaultPanelSettings(),
    defaultPanelSettings,
    normalizePanelSettings,
    ensurePanelPrefs: () => Promise.resolve(defaultPanelSettings()),
    applyPanelPrefs: () => {},
    MODULE_KEYS: ["context", "git", "subagents", "tasks", "mcp", "balance", "plans", "note", "todo"],
    toast() {}, interpolate: value => value, t: value => value,
  });
  const start = source.indexOf("function useHudModules()");
  const end = source.indexOf("// —— 会话模块", start);
  vm.runInContext(`${source.slice(start, end)}; this.hook = useHudModules;`, context);
  const result = context.hook();
  return { result, states, calls, resolveInitial };
}

test("一次确认只发送一个同时包含模块与用量的设置请求", async () => {
  const harness = loadUseHudModules();
  await new Promise(resolve => setImmediate(resolve));
  const saveSettings = harness.result[2];
  saveSettings({ git: false }, { codex: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls)), [{
    method: "settings",
    payload: {
      modules: { context: true, git: false },
      usage: { ...defaultUsageDisplay(), codex: false },
      context: defaultContextSettings(),
      // v0.16.0：确认时同时下发模块顺序（未改动即为默认顺序）
      order: defaultModuleOrder(),
      // v0.18.2：面板设置随同一次请求落盘
      panel: defaultPanelSettings(),
    },
  }]);
});

test("settings 服务缺失时，进程内降级设置可被后续读取", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const context = vm.createContext({
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch,
    modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, normalizeModuleOrder, defaultModuleOrder,
    ctx: { get: () => undefined },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null; let memoryContext = null; let memoryOrder = null; let memoryPanel = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  await context.handler(false, { modules: { git: false }, usage: { codex: false }, context: { barStyle: "segmented", showStats: false }, panel: { side: "left", newSessionOpen: true } });
  const restored = await context.handler(true, null);
  assert.equal(restored.modules.git, false);
  assert.equal(restored.usage.codex, false);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.context)), { barStyle: "segmented", showStats: false, showUsage: true });
  // v0.18.2：面板设置在进程内降级快照里同样可读回。
  assert.deepEqual(JSON.parse(JSON.stringify(restored.panel)), { side: "left", newSessionOpen: true, chatOpen: true });
});

test("profile 运行时设置服务缺失不得伪装为保存成功", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const context = vm.createContext({
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, sanitizeOrderPatch, sanitizeContextPatch, sanitizePanelPatch,
    modulesOf, usageDisplayOf, contextSettingsOf, moduleOrderOf, panelSettingsOf, normalizeModuleOrder, defaultModuleOrder,
    ctx: { get: () => ({ name: "test-profile" }) },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null; let memoryContext = null; let memoryOrder = null; let memoryPanel = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  await assert.rejects(context.handler(false, { modules: { git: false } }), /未保存偏好/);
});

test("较晚返回的初始化读取不会覆盖用户刚确认的设置", async () => {
  const harness = loadUseHudModules({ deferInitial: true });
  const saveSettings = harness.result[2];
  saveSettings({ git: false }, { codex: false });
  harness.resolveInitial({
    modules: { context: true, git: true },
    usage: defaultUsageDisplay(),
    panel: defaultPanelSettings(),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.states[0].git, false);
  assert.equal(harness.states[1].codex, false);
});

test("普通会话与新建会话页共用同一个原子设置确认入口", () => {
  assert.match(source, /props\.onSettingsChange\(draft, usageDraft, orderDraft, contextDraft, panelDraft\)/);
  assert.doesNotMatch(source, /props\.onModulesChange\(draft\).*props\.onUsageChange/s);
  assert.match(source, /onSettingsChange: updateSettings/);
});
