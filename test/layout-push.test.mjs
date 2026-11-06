import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { extractFunction } from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function clientSource() {
  return readFile(join(root, "lib/client.js"), "utf8");
}

test("正文让位：原值只记录一次，且不再把「挂载瞬间的当前值」当原值（v0.15.11）", async () => {
  const source = await clientSource();

  // 模块级 WeakMap 跨面板挂载周期保留首次改写前的原值。
  assert.match(source, /const INLINE_PUSH_PROPS = \["margin-right", "--dsh-awesome-hud-column-width", "--dsh-chat-content-width", "--dsh-composer-card-max-width"\];/);
  assert.match(source, /const inlinePushOriginals = new WeakMap\(\);/);
  assert.match(source, /function rememberInlineOriginal\(node, property\) \{/);
  assert.match(source, /if \(known !== undefined\) return known;/);

  // 挂载路径必须走 WeakMap；旧的「读当前值当原值」写法一旦回退，
  // 就会把插件自己写的 300px 认成原值，正文永久变窄。
  assert.match(source, /const savedConversationBodyStyles = INLINE_PUSH_PROPS\.map\(\(property\) => rememberInlineOriginal\(conversationBody, property\)\);/);
  assert.doesNotMatch(source, /value: conversationBody\.style\.getPropertyValue\(property\)/);
  assert.doesNotMatch(source, /priority: conversationBody\.style\.getPropertyPriority\(property\)/);
});

test("正文让位：卸载只还原「当前值仍是我们写入值」的属性", async () => {
  const source = await clientSource();

  assert.match(source, /function restoreInlinePush\(node, writes\) \{/);
  // 关键守卫：值已经被宿主或其它插件改过时一律不动，避免覆盖别人的布局状态。
  assert.match(source, /for \(const \[property, value\] of writes\) \{/);
  assert.match(source, /if \(node\.style\.getPropertyValue\(property\) !== value\) continue;/);
  assert.match(source, /const saved = rememberInlineOriginal\(node, property\);/);
  assert.match(source, /for \(const \[node, writes\] of pushWrites\) restoreInlinePush\(node, writes\);/);
  // 改写前先登记原值：反过来会把我们写进去的 300px 记成原值。
  assert.match(source, /for \(const property of INLINE_PUSH_PROPS\) rememberInlineOriginal\(target, property\);/);
});

test("正文让位：宿主重建正文节点与侧栏开合后都会重新对账", async () => {
  const source = await clientSource();

  // 重新反查正文节点与滚动容器并补写预留，避免「测一次就再也不算」。
  assert.match(source, /const resolvePushTargets = \(\) => \{/);
  assert.match(source, /if \(activeScrollEl === null \|\| !activeScrollEl\.isConnected\) \{/);
  assert.match(source, /if \(targets\.body !== null\) applyPushTo\(targets\.body\);/);
  assert.match(source, /if \(targets\.scroll !== null\) applyScrollPushTo\(targets\.scroll\);/);

  // 侧栏开合（属性变化）与 DOM 重建都会排一次对账（debounce 到一帧）。
  assert.match(source, /attributeFilter: \["data-sidebar-right-open", "data-sidebar-right-panel", "hidden"\]/);
  assert.match(source, /reconcileFrame = window\.requestAnimationFrame\(\(\) => \{/);

  // 面板是在右侧栏收起动画进行中重新挂载的：补两次复查，避免把偏窄的测量值当最终值。
  assert.match(source, /window\.setTimeout\(update, 350\)/);
  assert.match(source, /window\.setTimeout\(update, 900\)/);
});

test("正文让位：仍然只收窄正文容器，且各触发在卸载时全部释放", async () => {
  const source = await clientSource();

  // 既有边界不得回退：只改正文容器，不动会话根节点。
  assert.match(source, /conversationBody\.style\.setProperty\("margin-right", `\$\{PANEL_WIDTH\}px`\);/);
  assert.doesNotMatch(source, /conversationRoot\.style\.setProperty\("margin-right"/);

  // 新增的观察器、帧回调与定时器都要在 cleanup 里释放。
  assert.match(source, /domObserver\?\.disconnect\(\);/);
  assert.match(source, /if \(reconcileFrame !== null\) window\.cancelAnimationFrame\(reconcileFrame\);/);
  assert.match(source, /for \(const timer of settleTimers\) window\.clearTimeout\(timer\);/);
});

test("页面滚动条留在窗口最右缘：滚动容器右缘补回面板宽度、内容宽度不变（v0.15.13）", async () => {
  const source = await clientSource();

  // 只为滚动容器补「右缘 + 等量 padding」，不改正文容器的既有变量与测量，
  // 因此会话页右缘的「轮次导航」指示条仍按正文右缘定位（保持原位）。
  assert.match(source, /const SCROLL_PUSH_PROPS = \["margin-right", "padding-right"\];/);
  assert.match(source, /function pushScrollContainer\(scrollEl\) \{/);
  assert.match(source, /const margin = `\$\{-PANEL_WIDTH\}px`;/);
  assert.match(source, /const padding = `\$\{PANEL_WIDTH\}px`;/);
  assert.match(source, /scrollEl\.style\.setProperty\("margin-right", margin\)/);
  assert.match(source, /scrollEl\.style\.setProperty\("padding-right", padding\)/);
  assert.match(source, /applyScrollPushTo\(scrollEl\);/);
  assert.match(source, /const savedConversationBodyStyles = INLINE_PUSH_PROPS\.map\(\(property\) => rememberInlineOriginal\(conversationBody, property\)\);/);
});

test("滚动容器让位写入与还原：原值只记录一次、当前值被改过则不覆盖", () => {
  const context = vm.createContext({
    WeakMap, Map,
    PANEL_WIDTH: 300,
    INLINE_PUSH_PROPS: ["margin-right", "--dsh-awesome-hud-column-width", "--dsh-chat-content-width", "--dsh-composer-card-max-width"],
    SCROLL_PUSH_PROPS: ["margin-right", "padding-right"],
  });
  vm.runInContext(`const inlinePushOriginals = new WeakMap();\n${extractFunction("rememberInlineOriginal")}\n${extractFunction("restoreInlinePush")}\n${extractFunction("pushScrollContainer")}`, context);

  const createStyle = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return {
      getPropertyValue: (property) => values.get(property) ?? "",
      getPropertyPriority: () => "",
      setProperty: (property, value) => { values.set(property, String(value)); },
      removeProperty: (property) => { values.delete(property); },
      peek: (property) => values.get(property) ?? "",
    };
  };

  // 宿主滚动容器原有 margin-right: 2px（CSS 类），进入时按「改写前」登记。
  const scrollEl = { style: createStyle({ "margin-right": "2px" }) };
  const writes = context.pushScrollContainer(scrollEl);
  assert.deepEqual([...writes.entries()], [["margin-right", "-300px"], ["padding-right", "300px"]]);
  assert.equal(scrollEl.style.peek("margin-right"), "-300px", "向右补回面板宽度，滚动条贴窗口右缘");
  assert.equal(scrollEl.style.peek("padding-right"), "300px", "等量 padding 守住正文/输入框内容宽度");

  // 重复写入幂等，且首次登记的原值仍是宿主的 2px（不会被自己的 -300px 顶替）。
  context.pushScrollContainer(scrollEl);
  context.restoreInlinePush(scrollEl, writes);
  assert.equal(scrollEl.style.peek("margin-right"), "2px", "卸载后恢复宿主的 margin-right");
  assert.equal(scrollEl.style.getPropertyValue("padding-right"), "", "padding-right 原本不存在，应移除");

  // 是否被他人改过：当前值不再等于我们写入值时一律不动。
  const changed = { style: createStyle({ "margin-right": "2px" }) };
  const changedWrites = context.pushScrollContainer(changed);
  changed.style.setProperty("padding-right", "0px");
  context.restoreInlinePush(changed, changedWrites);
  assert.equal(changed.style.peek("margin-right"), "2px", "未被动过的属性照常还原");
  assert.equal(changed.style.peek("padding-right"), "0px", "已被他人改过的属性保持他人值");
});
