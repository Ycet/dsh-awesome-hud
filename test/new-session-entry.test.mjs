import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const packageMeta = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("主视图会话绑定优先于过期的列表 current，确保模块与新建页判定一致", () => {
  const context = vm.createContext({});
  vm.runInContext(`${extractFunction("activeSessionId")}\n${extractFunction("isNewSessionPage")}`, context);
  const list = { current: undefined, byId: { A: { blank: false } } };
  const active = context.activeSessionId({ key: "A" }, list);
  assert.equal(active, "A");
  assert.equal(context.isNewSessionPage(list, active), false);
  const blank = context.activeSessionId({ key: undefined }, list);
  assert.equal(context.isNewSessionPage(list, blank), true);
  assert.equal(context.isNewSessionPage({ current: "B", byId: { B: { blank: true } } }, "B"), true);
});

const clip = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
/** 按「函数声明 + 平衡大括号」精确抽取一个函数。 */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `function ${name} must exist in lib/client.js`);
  // 先跳过参数列表（默认值里可能含 `{}`），再对函数体做平衡括号扫描
  let index = source.indexOf("(", start);
  let parens = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    else if (source[index] === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  index = source.indexOf("{", index);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const SCOPE_FUNCTIONS = ["loadHudStorage", "saveHudStorage", "activateHudScope", "getHudOpen", "subscribeHud", "publishHud", "setHudOpen", "setHudOpenTransient"];
// 开合状态 store：常量 + HUD_OPEN_KEY + 全部作用域函数
const scopeStore = clip('const HUD_OPEN_KEY = "dsh-awesome-hud:open";', "// —— 右侧栏可见性与 HUD 互斥")
  + SCOPE_FUNCTIONS.map(extractFunction).join("\n");

/** 内存版 localStorage（记录写入次数，便于断言「不持久化」）。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  let writes = 0;
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { writes += 1; map.set(key, String(value)); },
    raw: key => (map.has(key) ? map.get(key) : null),
    get writes() { return writes; },
  };
}

function createScope(storage) {
  const emitted = [];
  const context = vm.createContext({
    globalThis: { localStorage: storage },
    Map, Set, Object, Array, JSON, String, Boolean, Number, isNaN,
  });
  vm.runInContext(scopeStore, context);
  context.subscribeHud(() => emitted.push(context.getHudOpen()));
  return { context, emitted };
}

test("activateHudScope 让每个会话各自持有开合状态", () => {
  const storage = memoryStorage();
  const { context } = createScope(storage);

  // 新会话页：无会话 id → 从隐藏开始
  context.activateHudScope(undefined);
  assert.equal(context.getHudOpen(), false);
  // 会话 A：无记录 → 默认展开
  context.activateHudScope("A");
  assert.equal(context.getHudOpen(), true);
  // 在 A 中收起 → 写入 A 自己的记录
  context.setHudOpen(false);
  assert.equal(JSON.parse(storage.raw("dsh-awesome-hud:open")).A, "0");

  // 切到会话 B：默认展开，不受 A 影响
  context.activateHudScope("B");
  assert.equal(context.getHudOpen(), true);
  context.setHudOpen(false);
  assert.equal(JSON.parse(storage.raw("dsh-awesome-hud:open")).B, "0");

  // 回到 A / B：各自记忆互不干扰
  context.activateHudScope("A");
  assert.equal(context.getHudOpen(), false);
  context.activateHudScope("B");
  assert.equal(context.getHudOpen(), false);
});

test("新建会话页的状态从不持久化，且每次进入都是隐藏", () => {
  const storage = memoryStorage();
  const { context } = createScope(storage);

  // 会话 A：展开 → 收起（产生一次持久化写入）
  context.activateHudScope("A");
  assert.equal(context.getHudOpen(), true);
  context.setHudOpen(false);
  const writesAfterSession = storage.writes;
  assert.equal(writesAfterSession, 1);

  // 新会话页：从隐藏开始；手动展开 → 不得写 localStorage
  context.activateHudScope(undefined);
  assert.equal(context.getHudOpen(), false);
  context.setHudOpen(true);
  assert.equal(context.getHudOpen(), true);
  assert.equal(storage.writes, writesAfterSession, "blank-session toggles must not persist");

  // 离开再回到新建会话页：又是隐藏（不是记住上次在该页手动展开的状态）
  context.activateHudScope("A");
  assert.equal(context.getHudOpen(), false, "session A keeps its own stored state");
  context.activateHudScope(undefined);
  assert.equal(context.getHudOpen(), false);

  // 会话 A 的记忆没有被新会话页污染
  const persisted = JSON.parse(storage.raw("dsh-awesome-hud:open"));
  assert.equal(persisted.A, "0");
  assert.equal(Object.keys(persisted).includes("\u0000new-session"), false);
});

test("旧版单一布尔值迁移到首个会话，不扩散到其它会话", () => {
  const storage = memoryStorage({ "dsh-awesome-hud:open": "0" });
  const { context, emitted } = createScope(storage);

  // 首次激活正是那个「上次记忆」所属的会话
  context.activateHudScope("A");
  assert.equal(context.getHudOpen(), false);
  assert.equal(JSON.parse(storage.raw("dsh-awesome-hud:open")).A, "0");

  // 其它会话不受旧值影响
  context.activateHudScope("B");
  assert.equal(context.getHudOpen(), true);

  // 已迁移后回到 A 仍是它自己的记忆
  context.activateHudScope("A");
  assert.equal(context.getHudOpen(), false);
  assert.deepEqual(emitted, [false, true, false]);
});

test("作用域无变化时不重复广播（避免无意义的重复渲染）", () => {
  const storage = memoryStorage();
  const { context, emitted } = createScope(storage);

  context.activateHudScope("A");
  context.activateHudScope("A");
  context.activateHudScope("A");
  assert.equal(emitted.length, 1);
});

test("面板顶部跟随真实标题栏，侧位由设置决定（v0.18.2）", () => {
  // 入口按钮不按页面测量；面板侧位只有一处全局设置（不再按页面各测一套坐标）。
  assert.doesNotMatch(source, /data-side": floating/);
  assert.doesNotMatch(source, /floatingOffsets/);
  assert.doesNotMatch(source, /floatButtonStyle/);
  // v0.18.2：面板根节点带 data-side，位置由 top + 侧位（left 测量值 / 右侧 8px）决定。
  assert.match(source, /"data-side": panelSide,/);
  assert.match(source, /left: panelSide === "left" \? `\$\{left\}px` : "auto",/);
  assert.match(source, /right: panelSide === "right" \? `\$\{HUD_PANEL_GAP\}px` : "auto",/);
  assert.match(source, /maxHeight: limitH === null \? undefined : `\$\{limitH\}px`,/);
  // 有会话页眉时跟随下沿；新建页的最低位置额外避开 Windows 原生标题栏。
  assert.match(source, /document\.querySelector\("\[data-conversation-header-corner\]"\)\?\.closest\("header"\)/);
  assert.match(source, /const minimumTop = HUD_NEW_SESSION_TOP \+ hudChromeTop\(\);/);
  assert.match(source, /: Math\.max\(minimumTop, Math\.round\(headRect\.bottom \+ 8\)\);/);
  // 按钮固定贴视口右上角（标题栏按钮的视觉位置）
  assert.match(source, /\.hud-btn-float\{position:fixed;top:\$\{HUD_FLOAT_INSET\}px;z-index:2147482000;-webkit-app-region:no-drag\}/);
  assert.match(source, /const HUD_FLOAT_INSET = 12;/);
  assert.match(source, /const HUD_FLOAT_RIGHT = 72;/);
  // 让位逻辑保留（新建会话页同样收窄正文，方向跟随面板侧位）
  assert.match(source, /conversationBody\.style\.setProperty\(pushSide === "left" \? "margin-left" : "margin-right", `\$\{PANEL_WIDTH\}px`\);/);
  // 推挤/留白必须在同一提交内应用与清理（侧栏展开→面板卸载→同步移除空白）
  assert.match(source, /const useLayoutEffect = typeof react\.useLayoutEffect === "function" \? react\.useLayoutEffect : react\.useEffect;/);
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*\n\s*const headerEl = document\.querySelector/);
});

test("主 HUD 面板使用主题描边并移除外投影", () => {
  const panelRule = source.match(/\.hud-panel\{[^}]*\}/)?.[0];
  assert.ok(panelRule, "the .hud-panel CSS rule must exist");
  assert.match(panelRule, /border:0\.5px solid var\(--dsw-alias-border-l2\)/);
  assert.doesNotMatch(panelRule, /box-shadow:/);
});

test("新建页按钮保持在页眉原位，官方边栏展开时移到可见面板左侧", () => {
  // HUD 开合不再影响按钮横坐标；只有官方边栏占用右侧时才需要避让。
  assert.match(source, /style: \{ right: `\$\{sidebarInset\}px` \},/);
  assert.doesNotMatch(source, /HUD_FLOAT_PANEL_GAP/);
  assert.match(source, /window\.innerWidth - panel\.getBoundingClientRect\(\)\.left \+ 12/);
  assert.match(source, /sidebarBridge\(ctx\)\.subscribeState\(scheduleSync\)/);
  assert.match(source, /const \{ element, inset, kind \} = floatingHudTarget\(ctx\);/);
  // v0.18.2：左侧抽屉的展开/收起也参与派生可见性，观察器需同时盯这两个属性。
  assert.match(source, /attributeFilter: \["data-sidebar-right-open", "hidden", "data-sidebar-drawer", "data-sidebar-collapsed"\]/);
  // 新建页入口与聊天页同序：预留 better-sidebar 兜底切换按钮的宽度与间距
  assert.match(source, /const HUD_FLOAT_GAP = 8;/);
  assert.match(source, /floatingHudReserve\(rect, ctx\)/);
  // 首帧定位在 layout 阶段完成，避免绘制出错误位置后再跳回
  assert.match(source, /useLayoutEffect\(\(\) => watchFloatingHudPosition\(ctx, setSidebarInset\), \[\]\);/);
  assert.match(source, /document\.querySelector\("\[data-dsh-dock-fallback\]"\)/);
});

test("边栏定位只选当前可见且已展开的面板", () => {
  const context = vm.createContext({
    document: { querySelectorAll: () => [
      { closest: () => ({}), getBoundingClientRect: () => ({ left: 100, right: 600, width: 500 }) },
      { closest: () => null, getBoundingClientRect: () => ({ left: 900, right: 1200, width: 300 }) },
    ] },
    window: { innerWidth: 1200 },
  });
  vm.runInContext(extractFunction("visibleOfficialSidebarPanel"), context);
  assert.equal(context.visibleOfficialSidebarPanel().getBoundingClientRect().left, 900);
});

test("新建页优先紧贴可见的官方边栏按钮，展开边栏后才退到面板左侧", () => {
  let expandVisible = true;
  let panelVisible = true;
  const expand = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 1144, right: 1172, width: 28 }),
  };
  const panel = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 700, right: 1200, width: 500 }),
  };
  const context = vm.createContext({
    document: {
      querySelectorAll: selector => selector === "[data-sidebar-right-expand]"
        ? (expandVisible ? [expand] : [])
        : (panelVisible ? [panel] : []),
    },
    window: { innerWidth: 1200 },
  });
  vm.runInContext(`const HUD_FLOAT_RIGHT = 72;\nconst HUD_FLOAT_GAP = 8;\nconst HUD_FLOAT_SLOT_SIZE = 28;\n${extractFunction("visibleOfficialSidebarPanel")}\n${extractFunction("visibleOfficialSidebarExpandButton")}\n${extractFunction("floatingHudReserve")}\n${extractFunction("floatingHudTarget")}`, context);
  assert.equal(context.floatingHudTarget().inset, 64, "收起状态应距官方按钮 8px，即使保留了已展开的边栏节点");
  expandVisible = false;
  assert.equal(context.floatingHudTarget().inset, 512, "展开边栏后应移到面板左侧");
  panelVisible = false;
  assert.equal(context.floatingHudTarget().inset, 72, "没有锚点时使用原兜底位置");
});

test("新建页入口预留 better-sidebar 兜底按钮的位置，与聊天页顺序一致", () => {
  const anchor = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 1144, right: 1172, width: 28, top: 6, bottom: 34, height: 28 }),
  };
  let fallbackRect = { left: 1108, right: 1136, width: 28, top: 6, bottom: 34, height: 28 };
  const context = vm.createContext({
    document: {
      querySelectorAll: selector => (selector === "[data-sidebar-right-expand]" ? [anchor] : []),
      querySelector: selector => (selector === "[data-dsh-dock-fallback]" && fallbackRect !== null
        ? { getBoundingClientRect: () => fallbackRect }
        : null),
    },
    window: { innerWidth: 1200 },
  });
  vm.runInContext(`const HUD_FLOAT_RIGHT = 72;\nconst HUD_FLOAT_GAP = 8;\nconst HUD_FLOAT_SLOT_SIZE = 28;\n${extractFunction("visibleOfficialSidebarPanel")}\n${extractFunction("visibleOfficialSidebarExpandButton")}\n${extractFunction("floatingHudReserve")}\n${extractFunction("floatingHudTarget")}`, context);
  // 兜底切换按钮 28px + 间距 8px：入口右缘排在它左侧，间距与聊天页 utilities 一致
  assert.equal(context.floatingHudTarget().inset, 100);
  // 同一行之外的节点不参与预留
  fallbackRect = { left: 1108, right: 1136, width: 28, top: 300, bottom: 328, height: 28 };
  assert.equal(context.floatingHudTarget().inset, 64);
  // 尚未渲染出宽高的节点不预留
  fallbackRect = { left: 1108, right: 1108, width: 0, top: 6, bottom: 34, height: 28 };
  assert.equal(context.floatingHudTarget().inset, 64);
});

test("兜底按钮尚未挂载时按 better-sidebar 服务预留槽位，首帧不与其重叠", () => {
  const anchor = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 1144, right: 1172, width: 28, top: 6, bottom: 34, height: 28 }),
  };
  const context = vm.createContext({
    document: {
      querySelectorAll: selector => (selector === "[data-sidebar-right-expand]" ? [anchor] : []),
      // 首帧兜底按钮还没 portal 进 DOM
      querySelector: () => null,
    },
    window: { innerWidth: 1200 },
  });
  vm.runInContext(`const HUD_FLOAT_RIGHT = 72;\nconst HUD_FLOAT_GAP = 8;\nconst HUD_FLOAT_SLOT_SIZE = 28;\n${extractFunction("visibleOfficialSidebarPanel")}\n${extractFunction("visibleOfficialSidebarExpandButton")}\n${extractFunction("floatingHudReserve")}\n${extractFunction("floatingHudTarget")}`, context);
  // better-sidebar 已激活：按 28px 按钮 + 8px 间距提前预留，入口右缘排在兜底按钮左侧
  assert.equal(context.floatingHudTarget({ get: () => ({}) }).inset, 100);
  // 未安装 / 未激活时不预留，仍紧贴右侧栏按钮
  assert.equal(context.floatingHudTarget({ get: () => undefined }).inset, 64);
  // 服务读取抛错时按未安装处理，不影响定位
  assert.equal(context.floatingHudTarget({ get: () => { throw new Error("not ready"); } }).inset, 64);
});

test("侧栏展开与收起过渡期间保持打开前的位置，关闭瞬间不再闪到侧栏左缘", () => {
  let buttonVisible = true;
  let panelVisible = false;
  let sidebarExpanded = false;
  let mutationListener;
  let nextFrameId = 0;
  let nextTimerId = 0;
  const frames = new Map();
  const timers = new Map();
  const insets = [];
  const button = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 1144, right: 1172, width: 28 }),
  };
  const panel = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 700, right: 1200, width: 500 }),
  };
  const runFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const runTimers = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  const context = vm.createContext({
    document: {
      body: {},
      querySelectorAll: selector => selector === "[data-sidebar-right-expand]"
        ? (buttonVisible ? [button] : [])
        : (panelVisible ? [panel] : []),
    },
    window: {
      innerWidth: 1200,
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: fn => { const id = ++nextFrameId; frames.set(id, fn); return id; },
      cancelAnimationFrame: id => frames.delete(id),
      setTimeout: fn => { const id = ++nextTimerId; timers.set(id, fn); return id; },
      clearTimeout: id => timers.delete(id),
    },
    // 侧栏开合状态（与官方 DOM 标记同步更新，模拟 bridge 的派生结果）
    getSidebarExpanded: () => sidebarExpanded,
    subscribeHud: () => () => {},
    MutationObserver: class {
      constructor(fn) { mutationListener = fn; }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  vm.runInContext(`const HUD_FLOAT_RIGHT = 72;\nconst HUD_FLOAT_GAP = 8;\nconst HUD_FLOAT_SLOT_SIZE = 28;\n${extractFunction("visibleOfficialSidebarPanel")}\n${extractFunction("visibleOfficialSidebarExpandButton")}\n${extractFunction("floatingHudReserve")}\n${extractFunction("floatingHudTarget")}\n${extractFunction("sidebarBridge")}\n${extractFunction("watchFloatingHudPosition")}`, context);
  const stop = context.watchFloatingHudPosition({ get: () => undefined }, inset => insets.push(inset));
  assert.equal(insets.at(-1), 64, "收起态：入口位于官方展开按钮左侧");

  // 展开右侧栏：入口本身隐藏（v0.15.10），此时测到的面板位置属于展开态布局，不得写入。
  buttonVisible = false;
  panelVisible = true;
  sidebarExpanded = true;
  mutationListener();
  assert.equal(insets.at(-1), 64, "展开期间保留打开前的位置，不得改写成面板位置");
  runFrames(); runTimers();
  assert.equal(insets.at(-1), 64);

  // 关闭右侧栏：关闭通知先到、官方面板节点稍后才卸完——此时更不能把入口拉到旧面板左缘。
  sidebarExpanded = false;
  mutationListener();
  assert.equal(insets.at(-1), 64, "关闭通知当下不得闪到旧面板位置");
  assert.ok(!insets.includes(512), "整个开合过程都不得把入口放到展开态的面板左缘");

  // 官方展开按钮在新的布局阶段重新出现：同步校正回收起态锚点。
  buttonVisible = true;
  panelVisible = false;
  runFrames();
  assert.equal(insets.at(-1), 64, "下一帧应回到官方按钮左侧");

  // 若官方按钮在动画结束时才恢复，延时复查仍要把入口带回原位。
  buttonVisible = false;
  panelVisible = true;
  sidebarExpanded = true;
  mutationListener();
  runFrames();
  assert.equal(insets.at(-1), 64);
  sidebarExpanded = false;
  buttonVisible = true;
  panelVisible = false;
  runTimers();
  assert.equal(insets.at(-1), 64, "动画后的复查应消除旧边栏位置");
  stop();
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
});

test("会话页与新建页入口都匹配官方按钮的无边框 28px 底座和 15px 图标", () => {
  assert.match(source, /\.hud-btn\{border:0;width:28px;height:28px;/);
  assert.match(source, /\.hud-btn \.hud-icon svg\{width:15px!important;height:15px!important\}/);
  assert.match(source, /react\.createElement\(Icon, \{ name: "hud-toggle", size: 15,/g);
  assert.match(source, /id: "hud-toggle",\s*\n\s*order: 1,/);
});

test("插件管理等非会话主页面不渲染 HUD", () => {
  assert.match(source, /function HudPanelRoot\(\{ useSessionPendingInteraction, usePanelInfo \}\)/);
  assert.match(source, /const conversationActive = usePanelInfo\(\(info\) => info\.activePanelId === null\);/);
  assert.match(source, /if \(!conversationActive\) return null;/);
});

test("悬浮按钮仅在新建会话页渲染，且与面板共用同一派生可见性", () => {
  assert.match(source, /function HudFloatingButton\(\) \{/);
  assert.match(source, /className: "hud-btn hud-btn-float"/);
  assert.match(source, /"data-hud-float": ""/);
  assert.match(source, /newSession \? react\.createElement\(HudFloatingButton, null\) : null/);
  // 与面板同一派生可见性：展开记忆 ∩ 右侧栏未展开；侧栏展开期间入口整体不渲染
  assert.match(source, /const \[sidebarOpen, setSidebarOpen\] = react\.useState\(\(\) => getSidebarExpanded\(\)\);/);
  assert.match(source, /function HudFloatingButton\(\) \{[\s\S]{0,900}subscribeHud\(sync\)/);
  assert.match(source, /function HudFloatingButton\(\) \{[\s\S]{0,1200}subscribeSidebar\(sync\)/);
  assert.match(source, /if \(sidebarOpen\) return null;/);
  assert.match(source, /function HudFloatingButton\(\) \{[\s\S]{0,2500}onClick: \(\) => toggleHud\(ctx\)/);
  // 每次会话/页面切换都在 effect 中重新激活作用域（渲染期只 peek，不跨根广播）
  assert.match(source, /react\.useEffect\(\(\) => \{\s*\n\s*activateHudScope\(scopeSessionId\);\s*\n\s*\}, \[scopeSessionId\]\);/);
  assert.match(source, /const \[visible, setVisible\] = react\.useState\(\(\) => peekHudOpen\(scopeSessionId\) && !getSidebarExpanded\(\)\);/);
});

test("入口位于右侧工具区，面板与存储键保持兼容", () => {
  const registrations = Array.from(source.matchAll(/ctx\.slots\.inject\("([^"]+)"/g), match => match[1]);
  assert.deepEqual(registrations.sort(), ["conversation.session.header.utilities", "shell.overlay"]);
  // 根组件需要列表和当前视图；漏声明依赖会让新建页入口或面板整体失效。
  assert.match(source, /const inject = \["slots", "locale", "sessions", "uiSession"\];/);
  assert.ok(packageMeta.dsh.client.inject.includes("@deepseek-ai/dsh-api-session-controller"));
  assert.ok(packageMeta.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-session"));
  assert.match(source, /name: "shell\.overlay",\s*\n\s*id: "awesome-hud",\s*\n\s*order: 70,/);
  assert.match(source, /const NOTES_STORAGE_KEY = "dsh-awesome-hud:notes";/);
  assert.match(source, /const TODOS_STORAGE_KEY = "dsh-awesome-hud:todos";/);
  assert.match(source, /const HUD_OPEN_KEY = "dsh-awesome-hud:open";/);
  assert.match(source, /key: `note-\$\{scopeKey\}`/);
  assert.match(source, /key: `todo-\$\{scopeKey\}`/);
});
