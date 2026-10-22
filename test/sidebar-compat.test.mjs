import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
// v0.15.3：互斥改为派生可见性（可见 = 展开记忆 && 右侧栏未展开），
// 侧栏开合不再改写会话记忆，因此这里只抽取可见性/打开/监视相关实现。
const coordination = source.slice(
  source.indexOf("let sidebarExpanded ="),
  source.indexOf("// —— 样式"),
);

function setup({ hud = true, official = false, legacy = false, officialStuck = false } = {}) {
  const observers = new Set();
  const listeners = new Set();
  let open = hud;
  const services = {
    sidebarRight: {
      isExpanded: () => official,
      toggleExpanded: () => { if (officialStuck) return; official = !official; notify(); },
    },
    betterSidebar: {
      getSnapshot: () => ({ state: { panelOpen: legacy } }),
      subscribeState: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    },
  };
  function notify() { for (const fn of [...observers, ...listeners]) fn(); }
  const context = vm.createContext({
    getHudOpen: () => open,
    setHudOpen: value => { open = value; },
    window: { innerWidth: 1200 },
    document: {
      body: {},
      querySelectorAll: () => official ? [{
        closest: () => null,
        getBoundingClientRect: () => ({ left: 900, right: 1200, width: 300 }),
      }] : [],
      querySelector: selector => selector === "[data-dsh-toggle-cluster]"
        ? { querySelectorAll: () => [{ click() { legacy = false; notify(); } }] }
        : { getAttribute: () => official ? "true" : null },
    },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() { observers.add(this.fn); }
      disconnect() { observers.delete(this.fn); }
    },
  });
  vm.runInContext(coordination, context);
  const ctx = { get: key => services[key] };
  const watcher = context.attachSidebarWatcher(ctx);
  return {
    get open() { return open; },
    get visible() { return context.isHudVisible(); },
    get sidebarExpanded() { return context.getSidebarExpanded(); },
    get legacyOpen() { return legacy; },
    services, watcher,
    official(value) { official = value; notify(); },
    legacy(value) { legacy = value; notify(); },
    openHud: () => context.openHud(ctx),
    toggleHud: () => context.toggleHud(ctx),
    get subscriptions() { return observers.size + listeners.size; },
  };
}

test("官方侧栏展开时 HUD 派生隐藏，关闭后恢复且不改写展开记忆", () => {
  const state = setup();
  assert.equal(state.visible, true);
  state.official(true);
  assert.equal(state.visible, false);
  assert.equal(state.open, true, "侧栏开合不得改写会话展开记忆");
  state.official(false);
  assert.equal(state.visible, true);
  state.watcher.dispose();
});

test("官方与 better-sidebar 同时展开时保持隐藏，两者都关闭后才恢复", () => {
  const state = setup({ official: true, legacy: true });
  assert.equal(state.visible, false);
  state.official(false);
  assert.equal(state.visible, false);
  state.legacy(false);
  assert.equal(state.visible, true);
  state.watcher.dispose();
});

test("手动收起 HUD 后反复开关侧栏保持隐藏", () => {
  const state = setup({ hud: false });
  state.official(true);
  state.official(false);
  assert.equal(state.visible, false);
  state.watcher.dispose();
});

test("点击 HUD 按钮优先收起侧栏：侧栏关闭后再展示面板", () => {
  const state = setup({ hud: false, official: true, legacy: true });
  assert.equal(state.visible, false);
  state.openHud();
  // 记录展开意图，并同时主动收起官方与 better-sidebar
  assert.equal(state.open, true);
  assert.equal(state.services.sidebarRight.isExpanded(), false);
  assert.equal(state.legacyOpen, false);
  assert.equal(state.visible, true);
  // 可见时再次点击 = 收起（写入收起记忆）
  state.toggleHud();
  assert.equal(state.open, false);
  assert.equal(state.visible, false);
  state.watcher.dispose();
});

test("侧栏自动收起失败时保持隐藏，侧栏真正关闭后自动恢复", () => {
  // 官方侧栏无法自动收起（版本兼容性降级路径）→ 意图保留，可见性仍由侧栏决定
  const state = setup({ official: true, officialStuck: true });
  assert.equal(state.visible, false);
  state.openHud();
  assert.equal(state.open, true);
  assert.equal(state.visible, false, "侧栏仍在时不得展示 HUD");
  state.official(false);
  assert.equal(state.visible, true);
  state.watcher.dispose();
});

test("晚到服务重挂后订阅不泄漏且可见性仍然正确", () => {
  const state = setup();
  state.watcher();
  state.watcher();
  assert.equal(state.subscriptions, 2);
  // 官方服务缺席时仍按 DOM 标记/第三方服务判定
  delete state.services.sidebarRight;
  state.official(true);
  assert.equal(state.visible, false);
  state.official(false);
  assert.equal(state.visible, true);
  state.watcher.dispose();
  assert.equal(state.subscriptions, 0);
});
