import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, modulesOf, usageDisplayOf } from "../lib/settings.js";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadUseHudModules(options = {}) {
  const calls = [];
  const initial = options.initial ?? {
    modules: { context: true, git: true },
    usage: { deepseek: true, opencode: true, codex: true },
  };
  let resolveInitial;
  const initialPromise = options.deferInitial
    ? new Promise(resolve => { resolveInitial = resolve; })
    : Promise.resolve(initial);
  const react = {
    useEffect(effect) { effect(); },
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
  };
  const context = vm.createContext({
    react,
    getSettings: () => initialPromise,
    call: async (method, payload) => { calls.push({ method, payload }); return { ok: true, ...payload }; },
    defaultModules: () => ({ context: true, git: true }),
    defaultUsageDisplay: () => ({ deepseek: true, opencode: true, codex: true }),
    toast() {}, interpolate: value => value, t: value => value,
  });
  const start = source.indexOf("function useHudModules()");
  const end = source.indexOf("// —— 会话模块", start);
  vm.runInContext(source.slice(source.indexOf('function useSnapshot'), source.indexOf('/** 镜像 lib/graph.js')), context);
  vm.runInContext(source.slice(source.indexOf('const moduleSnapshots ='), source.indexOf('// —— 面板主体 ——')), context);
  vm.runInContext(`${source.slice(start, end)}; this.hook = useHudModules;`, context);
  const result = context.hook();
  return { result, calls, resolveInitial, settings: () => vm.runInContext('moduleSnapshots.get("settings")', context) };
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
      usage: { deepseek: true, opencode: true, codex: false },
    },
  }]);
});

test("settings 服务缺失时，进程内降级设置可被后续读取", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const context = vm.createContext({
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, modulesOf, usageDisplayOf,
    ctx: { get: () => undefined },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  await context.handler(false, { modules: { git: false }, usage: { codex: false } });
  const restored = await context.handler(true, null);
  assert.equal(restored.modules.git, false);
  assert.equal(restored.usage.codex, false);
});

test("profile 运行时设置服务缺失不得伪装为保存成功", async () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = hostSource.indexOf("const settingsHandler =");
  const end = hostSource.indexOf("\n\n\tctx.effect", start);
  const context = vm.createContext({
    normalizeSettings, sanitizeModulesPatch, sanitizeUsagePatch, modulesOf, usageDisplayOf,
    ctx: { get: () => ({ name: "test-profile" }) },
  });
  vm.runInContext(`let settingsScope = null; let memoryModules = null; let memoryUsage = null;\n${hostSource.slice(start, end)}\nthis.handler = settingsHandler;`, context);
  await assert.rejects(context.handler(false, { modules: { git: false } }), /未保存偏好/);
});

test("较晚返回的初始化读取不会覆盖用户刚确认的设置", async () => {
  const harness = loadUseHudModules({ deferInitial: true });
  const saveSettings = harness.result[2];
  saveSettings({ git: false }, { codex: false });
  harness.resolveInitial({
    modules: { context: true, git: true },
    usage: { deepseek: true, opencode: true, codex: true },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.settings().modules.git, false);
  assert.equal(harness.settings().usage.codex, false);
});

test("普通会话与新建会话页共用同一个原子设置确认入口", () => {
  assert.match(source, /props\.onSettingsChange\(draft, usageDraft\)/);
  assert.doesNotMatch(source, /props\.onModulesChange\(draft\).*props\.onUsageChange/s);
  assert.match(source, /onSettingsChange: updateSettings/);
});
