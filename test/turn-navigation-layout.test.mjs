import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** 抽取 HUD 面板布局 effect 中的真实回调，避免只测替代实现。 */
function extractArrow(name) {
  const start = source.indexOf(`const ${name} = (`);
  assert.ok(start >= 0);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function style() {
  const values = new Map();
  return {
    getPropertyValue: name => values.get(name) ?? "",
    getPropertyPriority: () => "",
    setProperty: (name, value) => values.set(name, String(value)),
    removeProperty: name => values.delete(name),
  };
}

test("HUD 展开后轮次导航须位于正文可见区域，而非被右侧面板遮住", () => {
  const viewportRight = 2048;
  const bodyRight = 1500;
  const slot = {
    style: style(),
    getBoundingClientRect() {
      return { right: viewportRight - Number.parseFloat(this.style.getPropertyValue("right") || "0") };
    },
  };
  const nav = {
    parentElement: slot,
    style: style(),
    getBoundingClientRect() {
      return { right: slot.getBoundingClientRect().right - Number.parseFloat(this.style.getPropertyValue("right") || "12") };
    },
  };
  const context = vm.createContext({
    conversationRoot: { querySelectorAll: () => [nav] },
    conversationBody: { getBoundingClientRect: () => ({ right: bodyRight, width: bodyRight }) },
    TURN_NAVIGATION_MIN_COLUMN_WIDTH: 720,
    TURN_NAVIGATION_RIGHT_GAP: 12,
    restoreTurnNavigation: () => {},
    rememberStyle: () => {},
    turnNavStyles: new Map(),
    turnNavDisplayStyles: new Map(),
    turnNavSlotStyles: new Map(),
    Math,
  });
  vm.runInContext(`${extractArrow("syncTurnNavigation")}; syncTurnNavigation();`, context);
  assert.ok(nav.getBoundingClientRect().right <= bodyRight - 12,
    `导航右缘 ${nav.getBoundingClientRect().right} 应在 HUD 左侧 ${bodyRight - 12} 以内`);

  // 宿主若已把导航容器收窄到正文内，重新同步时不能再多左移一次。
  slot.style.setProperty("right", `${viewportRight - bodyRight}px`);
  vm.runInContext("syncTurnNavigation();", context);
  assert.equal(nav.style.getPropertyValue("right"), "12px");
  assert.equal(nav.getBoundingClientRect().right, bodyRight - 12);
});

test("HUD 收窄正文至 900px 以下时，仍应覆盖宿主容器查询的导航隐藏规则", () => {
  const bodyWidth = 800;
  const slot = { style: style() };
  const nav = {
    parentElement: slot,
    style: style(),
    getBoundingClientRect() {
      // DSH 宿主规则：@container (width<=900px) 使导航 display:none。
      const visible = bodyWidth > 900 || this.style.getPropertyValue("display") === "block";
      return { right: visible ? bodyWidth - Number.parseFloat(this.style.getPropertyValue("right") || "12") : 0 };
    },
  };
  const context = vm.createContext({
    conversationRoot: { querySelectorAll: () => [nav] },
    conversationBody: { getBoundingClientRect: () => ({ right: bodyWidth, width: bodyWidth }) },
    TURN_NAVIGATION_MIN_COLUMN_WIDTH: 720,
    TURN_NAVIGATION_RIGHT_GAP: 12,
    turnNavStyles: new Map(),
    turnNavSlotStyles: new Map(),
    turnNavDisplayStyles: new Map(),
    Math,
  });
  vm.runInContext([
    extractArrow("rememberStyle"),
    extractArrow("restoreStyles"),
    extractArrow("restoreTurnNavigation"),
    extractArrow("syncTurnNavigation"),
    "syncTurnNavigation();",
  ].join("\n"), context);
  assert.equal(nav.style.getPropertyValue("display"), "block", "宿主在 900px 以下默认隐藏导航，HUD 应使其可见");
  assert.equal(nav.getBoundingClientRect().right, bodyWidth - 12);
  vm.runInContext("restoreTurnNavigation();", context);
  assert.equal(nav.style.getPropertyValue("display"), "", "HUD 收起后应恢复宿主控制的显示规则");
  assert.equal(nav.style.getPropertyValue("right"), "", "HUD 收起后应恢复宿主定位");
});
