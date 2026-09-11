import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

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
const scopeStore = clip('const HUD_OPEN_KEY = "dsh-awesome-hud:open";', "// —— 官方 sidebarRight")
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

test("面板与已有会话位置一致：固定贴视口右侧、顶部对齐标题栏", () => {
  // 面板不再有 data-side / left 切换，也没有任何「按页面测量」的分支
  assert.doesNotMatch(source, /data-side": floating/);
  assert.doesNotMatch(source, /floatingOffsets/);
  assert.doesNotMatch(source, /floatButtonStyle/);
  assert.match(source, /className: "hud-panel",\s*\n\s*style: \{ top, maxHeight: limitH === null \? undefined : `\$\{limitH\}px` \},/);
  // 顶部：有标题栏 → header 底部 + 8；无标题栏（新建会话页）→ 与标题栏下沿同高的常量
  assert.match(source, /const nextTop = headRect === undefined\s*\n\s*\? HUD_NEW_SESSION_TOP\s*\n\s*: Math\.max\(8, Math\.round\(headRect\.bottom \+ 8\)\);/);
  // 按钮固定贴视口右上角（标题栏按钮的视觉位置）
  assert.match(source, /\.hud-btn-float\{position:fixed;top:\$\{HUD_FLOAT_INSET\}px;z-index:2147482000\}/);
  assert.match(source, /const HUD_FLOAT_PANEL_GAP = PANEL_WIDTH \+ 16;/);
  assert.match(source, /const HUD_FLOAT_INSET = 12;/);
  assert.match(source, /const HUD_FLOAT_RIGHT = 28;/);
  // 让位逻辑保留（新建会话页同样收窄正文并左移内容）
  assert.match(source, /conversationBody\.style\.setProperty\("margin-right", `\$\{PANEL_WIDTH\}px`\);/);
});

test("悬浮按钮展开时向左让位，不与面板重叠", () => {
  // 收起：贴视口右上角；展开：右移量为面板宽 + 面板右贴 + 间隙，落在面板左侧
  assert.match(source, /style: \{ right: open \? `\$\{HUD_FLOAT_RIGHT \+ HUD_FLOAT_PANEL_GAP\}px` : `\$\{HUD_FLOAT_RIGHT\}px` \},/);
  assert.match(source, /const HUD_FLOAT_PANEL_GAP = PANEL_WIDTH \+ 16;/);
  // 面板本身固定在右侧（right: 8px），按钮让位后不再与其重叠
  assert.match(source, /\.hud-panel\{position:fixed;right:8px;/);
  // 按钮宽度（.hud-btn 32px）小于让位后的可用间距，保证完全落在面板左侧
  assert.match(source, /\.hud-btn\{[^}]*width:32px/);
});

test("悬浮按钮仅在新建会话页渲染，且与面板共用同一开合状态", () => {
  assert.match(source, /function HudFloatingButton\(\) \{/);
  assert.match(source, /className: "hud-btn hud-btn-float"/);
  assert.match(source, /"data-hud-float": ""/);
  assert.match(source, /newSession \? react\.createElement\(HudFloatingButton, null\) : null/);
  // 与标题栏按钮同一 store：订阅 + toggle
  assert.match(source, /function HudFloatingButton\(\) \{[\s\S]{0,400}subscribeHud\(\(\) => setOpen\(getHudOpen\(\)\)\)/);
  assert.match(source, /function HudFloatingButton\(\) \{[\s\S]{0,600}onClick: \(\) => toggleHud\(ctx\)/);
  // 每次会话/页面切换都在 effect 中重新激活作用域（渲染期只 peek，不跨根广播）
  assert.match(source, /react\.useEffect\(\(\) => \{\s*\n\s*activateHudScope\(scopeSessionId\);\s*\n\s*\}, \[scopeSessionId\]\);/);
  assert.match(source, /const \[open, setOpen\] = react\.useState\(\(\) => peekHudOpen\(scopeSessionId\)\);/);
});

test("座位与存储键保持兼容（slot 集合不变、便笺/待办键名不变）", () => {
  const registrations = Array.from(source.matchAll(/ctx\.slots\.inject\("([^"]+)"/g), match => match[1]);
  assert.deepEqual(registrations.sort(), ["conversation.session.header.utilities", "shell.overlay"]);
  assert.match(source, /name: "shell\.overlay",\s*\n\s*id: "awesome-hud",\s*\n\s*order: 70,/);
  assert.match(source, /const NOTES_STORAGE_KEY = "dsh-awesome-hud:notes";/);
  assert.match(source, /const TODOS_STORAGE_KEY = "dsh-awesome-hud:todos";/);
  assert.match(source, /const HUD_OPEN_KEY = "dsh-awesome-hud:open";/);
  assert.match(source, /key: `note-\$\{scopeKey\}`/);
  assert.match(source, /key: `todo-\$\{scopeKey\}`/);
});
