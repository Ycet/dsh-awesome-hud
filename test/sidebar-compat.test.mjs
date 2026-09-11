import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const coordination = source.slice(source.indexOf("let hudBeforeSidebar ="), source.indexOf("// —— 样式"));

function setup({ hud = true, official = false, legacy = false, officialStuck = false } = {}) {
  const pendingTimers = [];
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
    getHudOpen: () => open, setHudOpen: value => { open = value; },
    window: {
      setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length; },
      clearTimeout: (id) => { pendingTimers[id - 1] = null; },
    },
    document: { body: {}, querySelector: selector => selector === "[data-dsh-toggle-cluster]"
      ? { querySelectorAll: () => [{ click() { legacy = false; notify(); } }] }
      : { getAttribute: () => official ? "true" : null } },
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
    get open() { return open; }, services, watcher,
    official(value) { official = value; notify(); },
    legacy(value) { legacy = value; notify(); },
    openHud: () => context.openHud(ctx),
    flushTimers: () => { for (const fn of pendingTimers.splice(0)) if (typeof fn === "function") fn(); },
    get subscriptions() { return observers.size + listeners.size; },
  };
}

test("official sidebar hides HUD and restores it only once both sidebars close", () => {
  const state = setup();
  state.official(true);
  assert.equal(state.open, false);
  state.legacy(true);
  state.official(false);
  assert.equal(state.open, false);
  state.legacy(false);
  assert.equal(state.open, true);
  state.watcher.dispose();
  assert.equal(state.subscriptions, 0);
});

test("initial expanded sidebar and deferred HUD restoration respect mutual exclusion", async () => {
  const state = setup({ official: true });
  // 附着时对账：初始已展开的侧边栏让 HUD 让位
  assert.equal(state.open, false);
  // 侧边栏开着时请求打开：先收起侧边栏，待其关闭后再打开 HUD
  state.openHud();
  await Promise.resolve();
  state.flushTimers();
  await Promise.resolve();
  assert.equal(state.services.sidebarRight.isExpanded(), false);
  assert.equal(state.open, true);
  state.watcher.dispose();
});

test("stuck sidebar defers the HUD open until the sidebar actually closes", () => {
  // 官方侧边栏无法自动收起（版本兼容性降级路径）→ 记 pendingOpen，关闭后才打开
  const state = setup({ official: true, officialStuck: true });
  assert.equal(state.open, false);
  state.openHud();
  assert.equal(state.open, false);
  state.official(false);
  assert.equal(state.open, true);
  state.watcher.dispose();
});

test("manually hidden HUD stays hidden after sidebar cycle", () => {
  const state = setup({ hud: false });
  state.official(true);
  state.official(false);
  assert.equal(state.open, false);
  state.watcher.dispose();
});

test("opening HUD collapses official and legacy sidebars", async () => {
  const state = setup({ official: true, legacy: true });
  state.openHud();
  await Promise.resolve();
  assert.equal(state.services.sidebarRight.isExpanded(), false);
  assert.equal(state.services.betterSidebar.getSnapshot().state.panelOpen, false);
  assert.equal(state.open, true);
  state.watcher.dispose();
});

test("late service attachment refreshes subscriptions without leaking observers", () => {
  const state = setup();
  state.watcher();
  state.watcher();
  assert.equal(state.subscriptions, 2);
  delete state.services.sidebarRight;
  state.official(true);
  assert.equal(state.open, false);
  state.official(false);
  assert.equal(state.open, true);
  state.watcher.dispose();
});
