// dsh-awesome-hud — v0.21.2：HUD 各模块的折叠/展开状态改为「按会话」保存。
//
//  1) 每个会话一条记录（localStorage `dsh-awesome-hud:folds:v2`），互不影响；
//  2) 没有记录的会话用新默认集：展开 上下文/任务/子代理任务/计划清单/产物，
//     折叠 用量/git/便笺/待办/MCP；
//  3) 旧全局键 `dsh-awesome-hud:folds` 只清理、不迁移；
//  4) 最多保留最近 200 个会话（LRU），坏数据逐字段回退默认；
//  5) 新建会话页用内存态：重新进入恢复默认，从该页创建的会话继承当时的状态。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { extractConst, extractFunction } from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "lib/client.js"), "utf8");

/** 内存版 localStorage：记录写入与删除，便于断言「旧键被清理」。 */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  const removes = [];
  return {
    map,
    writes,
    removes,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { writes.push([key, String(value)]); map.set(key, String(value)); },
    removeItem: (key) => { removes.push(key); map.delete(key); },
  };
}

/** 在沙箱里加载折叠表的全部纯函数（真实执行，不只匹配源码）。 */
function loadFolds(storage) {
  const context = vm.createContext({ globalThis: { localStorage: storage } });
  vm.runInContext(
    [
      extractConst("FOLDS_STORAGE_KEY"),
      extractConst("FOLDS_STORAGE_KEY_LEGACY"),
      extractConst("FOLDS_MAX_SESSIONS"),
      extractConst("FOLD_MODULE_KEYS"),
      extractFunction("defaultFoldMap"),
      extractFunction("normalizeFoldMap"),
      extractFunction("trimFoldsStore"),
      extractFunction("readFoldsStore"),
      extractFunction("writeFoldsStore"),
      extractFunction("foldsForSession"),
      extractFunction("setFoldsForSession"),
      extractFunction("seedFoldsForSession"),
      extractFunction("nextNewPageVisit"),
      extractFunction("pickNewPageFolds"),
      "let newPageFoldsMemory = null;",
      "let newPageEpoch = 0;",
      "let newPagePhase = null;",
      extractFunction("advanceNewPageVisit"),
      "this.api = { defaultFoldMap, normalizeFoldMap, trimFoldsStore, readFoldsStore, writeFoldsStore, foldsForSession, setFoldsForSession, seedFoldsForSession, nextNewPageVisit, pickNewPageFolds, advanceNewPageVisit, memoryOf: () => newPageFoldsMemory, setMemory: (value) => { newPageFoldsMemory = value; }, epochOf: () => newPageEpoch, FOLDS_MAX_SESSIONS, FOLDS_STORAGE_KEY, FOLDS_STORAGE_KEY_LEGACY, FOLD_MODULE_KEYS };",
    ].join("\n"),
    context,
  );
  return context.api;
}

const EXPANDED = ["context", "tasks", "subagents", "plans", "outputs"];
const FOLDED = ["usage", "git", "note", "todo", "mcp"];

test("新默认集：5 个展开、5 个折叠，覆盖全部可折叠模块", () => {
  const { defaultFoldMap, FOLD_MODULE_KEYS } = loadFolds(makeStorage());
  const defaults = defaultFoldMap();
  assert.deepEqual(Object.keys(defaults).sort(), [...FOLD_MODULE_KEYS].sort(), "默认集必须覆盖全部模块键");
  for (const key of EXPANDED) assert.equal(defaults[key], false, `${key} 默认展开`);
  for (const key of FOLDED) assert.equal(defaults[key], true, `${key} 默认折叠`);
});

test("坏数据逐字段回退默认值，不抛错", () => {
  const { normalizeFoldMap, defaultFoldMap } = loadFolds(makeStorage());
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeFoldMap(null))), JSON.parse(JSON.stringify(defaultFoldMap())));
  const partial = normalizeFoldMap({ git: false, note: "yes", extra: true });
  assert.equal(partial.git, false, "合法布尔照用");
  assert.equal(partial.note, true, "坏类型回退默认（便笺默认折叠）");
  assert.equal("extra" in partial, false, "未知键丢弃");
});

test("读取：没有记录返回空表，旧全局键被删除且不迁移", () => {
  const storage = makeStorage({
    "dsh-awesome-hud:folds": JSON.stringify({ context: true, git: true }),
  });
  const { readFoldsStore, FOLDS_STORAGE_KEY_LEGACY } = loadFolds(storage);
  const store = readFoldsStore();
  assert.deepEqual(JSON.parse(JSON.stringify(store)), { sessions: {}, order: [] });
  assert.deepEqual(storage.removes, [FOLDS_STORAGE_KEY_LEGACY], "旧键只清理");
  assert.equal(storage.map.has(FOLDS_STORAGE_KEY_LEGACY), false);
});

test("读取：按会话还原，坏 JSON 回退空表", () => {
  const storage = makeStorage({
    "dsh-awesome-hud:folds:v2": JSON.stringify({ sessions: { s1: { git: false }, s2: {} }, order: ["s2", "s1"] }),
  });
  const { readFoldsStore } = loadFolds(storage);
  const store = readFoldsStore();
  assert.equal(store.sessions.s1.git, false);
  assert.equal(store.sessions.s2.git, true, "缺字段补默认");
  // order 里 s2 在前（更久未用），s1 在后（最近使用）。
  assert.deepEqual(JSON.parse(JSON.stringify(store.order)), ["s2", "s1"]);

  const broken = loadFolds(makeStorage({ "dsh-awesome-hud:folds:v2": "{not json" })).readFoldsStore();
  assert.deepEqual(JSON.parse(JSON.stringify(broken)), { sessions: {}, order: [] });
});

test("写入：整张表落到 v2 键，存储异常只降级不抛错", () => {
  const storage = makeStorage();
  const { writeFoldsStore } = loadFolds(storage);
  writeFoldsStore({ sessions: { s1: {} }, order: ["s1"] });
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], "dsh-awesome-hud:folds:v2");
  assert.deepEqual(JSON.parse(storage.writes[0][1]).order, ["s1"]);

  const broken = loadFolds({ getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} });
  assert.doesNotThrow(() => broken.writeFoldsStore({ sessions: {}, order: [] }));
});

test("按会话隔离：改 A 会话不影响 B 会话", () => {
  const { setFoldsForSession, foldsForSession } = loadFolds(makeStorage());
  let store = { sessions: {}, order: [] };
  store = setFoldsForSession(store, "s1", "git", true);
  store = setFoldsForSession(store, "s2", "mcp", false);
  assert.equal(foldsForSession(store, "s1").git, true);
  assert.equal(foldsForSession(store, "s2").git, true, "B 会话仍是默认折叠（git 默认折叠）");
  assert.equal(foldsForSession(store, "s2").mcp, false, "B 会话自己的改动生效");
  assert.equal(foldsForSession(store, "unknown").git, true, "没有记录用默认集");
});

test("LRU：改动把会话移到末尾，超过 200 个淘汰最久未用", () => {
  const { setFoldsForSession, FOLDS_MAX_SESSIONS, foldsForSession } = loadFolds(makeStorage());
  let store = { sessions: {}, order: [] };
  for (let index = 0; index < FOLDS_MAX_SESSIONS + 1; index += 1) {
    store = setFoldsForSession(store, `s${index}`, "git", false);
  }
  assert.equal(store.order.length, FOLDS_MAX_SESSIONS, "只保留上限条数");
  assert.equal(store.order.includes("s0"), false, "最久未用的被淘汰");
  assert.equal(store.order[store.order.length - 1], `s${FOLDS_MAX_SESSIONS}`, "最新改动排最后");
  assert.equal(foldsForSession(store, "s0").git, true, "淘汰后回到默认集");

  // 再次改动老会话会把它移到末尾，从而避免下次淘汰。
  store = setFoldsForSession(store, `s1`, "git", false);
  assert.equal(store.order[store.order.length - 1], "s1");
});

test("播种：从新建页创建会话时继承当时的折叠快照", () => {
  const { seedFoldsForSession, foldsForSession } = loadFolds(makeStorage());
  const newPage = { context: true, git: false, note: false };
  const store = seedFoldsForSession({ sessions: {}, order: [] }, "fresh", newPage);
  const folds = foldsForSession(store, "fresh");
  assert.equal(folds.context, true, "继承新建页的上下文折叠");
  assert.equal(folds.git, false, "继承新建页的 git 展开");
  assert.equal(folds.note, false, "继承新建页的便笺展开");
  assert.equal(folds.mcp, true, "未提及的键仍用默认");
  assert.deepEqual(JSON.parse(JSON.stringify(store.order)), ["fresh"]);
});

test("面板接线：按会话存读，新建页走内存态并在首条消息后播种", () => {
  assert.match(source, /const \[foldsStore, setFoldsStore\] = react\.useState\(readFoldsStore\);/);
  assert.match(source, /const sessionFolds = typeof current === "string" && current !== "" \? foldsForSession\(foldsStore, current\) : defaultFoldMap\(\);/);
  assert.match(source, /const folds = newSessionPage \? newPageFolds : sessionFolds;/);
  assert.match(source, /setFoldsStore\(\(prev\) => setFoldsForSession\(prev, current, key, value\)\);/);
  assert.match(source, /writeFoldsStore\(foldsStore\);/);
  // 新建页：按「访问编号」保留内存态，重新进入作废旧快照。
  assert.match(source, /let newPageFoldsMemory = null;/);
  assert.match(source, /let newPageEpoch = 0;/);
  assert.match(source, /let newPagePhase = null;/);
  assert.match(source, /const epoch = advanceNewPageVisit\(newSessionPage\);/);
  assert.match(source, /const \[newPageState, setNewPageState\] = react\.useState\(\(\) => \(\{/);
  // 关键：世代变了要在渲染期立刻纠正 state（面板不重挂时旧 state 会一直留着）。
  assert.match(source, /if \(newPageState\.epoch !== epoch\) \{\n\t+setNewPageState\(\{ epoch, folds: defaultFoldMap\(\) \}\);/);
  assert.match(source, /const newPageFolds = newPageState\.epoch === epoch \? newPageState\.folds : defaultFoldMap\(\);/);
  assert.match(source, /folds: \{ \.\.\.\(prev\.epoch === epoch \? prev\.folds : defaultFoldMap\(\)\), \[key\]: value === true \},/);
  // 切页订阅：面板没挂载时也能推进阶段（否则「关着面板跳页再回来」判不出新一次访问）。
  assert.match(source, /advanceNewPageVisit\(isNewSessionPage\(state, activeSessionId\(binding, state\)\)\);/);
  assert.match(source, /const sessionsStore = ctx\.get\("sessions"\)\?\.list;/);
  assert.match(source, /advanceNewPageVisit\(isNewSessionPage\(state, activeSessionId\(binding, state\)\)\);/);
  assert.match(source, /newPageFoldsMemory = \{ folds: newPageFolds, epoch \};/);
  assert.match(source, /seedFoldsForSession\(prev, current, snapshot\)/);
  // 旧的「只有主视图没有会话才重置」写法必须消失，否则新建页绑定的空白会话会让旧状态一直沿用。
  assert.doesNotMatch(source, /setNewPageFolds\(defaultFoldMap\(\)\)/);
  assert.doesNotMatch(source, /newPageFoldsMemory = \{ folds: newPageFolds, at: Date\.now\(\) \};/);
  // 旧全局持久化写法不得残留。
  assert.doesNotMatch(source, /function loadStoredFolds\(\)/);
  assert.doesNotMatch(source, /setFolds\(\(prev\) => \(\{ \.\.\.prev,/);
});

test("新建页访问状态机：从会话页进入即重置，同一次访问内重挂保留改动", () => {
  const { nextNewPageVisit, pickNewPageFolds, defaultFoldMap, normalizeFoldMap } = loadFolds(makeStorage());
  const defaults = () => JSON.parse(JSON.stringify(defaultFoldMap()));
  const changed = () => {
    const folds = normalizeFoldMap(defaultFoldMap());
    folds.note = false;
    folds.mcp = false;
    return folds;
  };

  // 1) 首次进入新建页（上一次不是新建页，或首次渲染知道得不多）：新访问 → 不再读旧内存。
  let memory = { folds: changed(), epoch: 1 };
  const first = nextNewPageVisit(true, null, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), { token: 1, reset: true });
  // 调用方在 reset 时清空内存（HudPanel 里的 `if (visit.reset) newPageFoldsMemory = null;`）。
  memory = null;
  assert.deepEqual(JSON.parse(JSON.stringify(pickNewPageFolds(true, memory, first.token))), defaults(), "reset 后旧快照作废，回到默认集");

  // 2) 同一次访问内面板重挂（关开 HUD / 右侧栏互斥）：不重置，沿用改动。
  const remount = nextNewPageVisit(true, true, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(remount)), { token: 1, reset: false });
  const current = changed();
  assert.deepEqual(JSON.parse(JSON.stringify(pickNewPageFolds(true, { folds: current, epoch: 1 }, 1))), JSON.parse(JSON.stringify(current)), "重挂保留同一次访问的改动");

  // 3) 用户在新建页调整后切到会话页、再重新进入新建页：必须回到默认（本次反馈的缺陷）。
  const toSession = nextNewPageVisit(false, true, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(toSession)), { token: 1, reset: false });
  const reenter = nextNewPageVisit(true, false, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(reenter)), { token: 2, reset: true }, "从会话页进入新建页算新访问");
  // reset 时内存被清空 → 回到默认集。
  assert.deepEqual(JSON.parse(JSON.stringify(pickNewPageFolds(true, memory, reenter.token))), defaults());

  // 4) 新建页里再点「新建会话」仍是同一次新建页阶段（空白会话也属于新建页）：不重置，
  //    这样在该页做的改动才能被新建的会话继承。
  const nextBlank = nextNewPageVisit(true, true, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(nextBlank)), { token: 2, reset: false });
});

test("访问世代：面板关着也能记录「去过会话页再回新建页」，重新进入必然回默认", () => {
  const api = loadFolds(makeStorage());
  const changed = api.normalizeFoldMap(api.defaultFoldMap());
  changed.note = false;
  const defaults = () => JSON.parse(JSON.stringify(api.defaultFoldMap()));

  // 1) 首次进入新建页：世代 1。
  const first = api.advanceNewPageVisit(true);
  assert.equal(first, 1);
  // 2) 用户在新页面展开便笺 → 快照落进内存。
  api.setMemory({ folds: changed, epoch: first });
  // 3) 面板关掉后切到会话页：订阅在模块级推进阶段（世代不变）。
  assert.equal(api.advanceNewPageVisit(false), 1);
  // 4) 回到新建页（面板仍未挂载，订阅先看到 true）：世代 +1，快照作废 → 一定是默认集。
  const reenter = api.advanceNewPageVisit(true);
  assert.equal(reenter, 2, "从会话页进入新建页要递增世代");
  assert.equal(api.memoryOf(), null, "旧快照被清掉");
  assert.deepEqual(JSON.parse(JSON.stringify(api.pickNewPageFolds(true, api.memoryOf(), reenter))), defaults());

  // 5) 同一次访问内面板重挂：世代不变，改动保留。
  api.setMemory({ folds: changed, epoch: reenter });
  assert.equal(api.advanceNewPageVisit(true), 2, "同一次访问不递增");
  assert.deepEqual(JSON.parse(JSON.stringify(api.pickNewPageFolds(true, api.memoryOf(), 2))), JSON.parse(JSON.stringify(changed)));
});

test("apply 全量执行副作用不抛错：入口按钮与面板 slot 仍然注册（TDZ 回归）", async () => {
  const { hudClient } = await import("./helpers/client-harness.mjs");
  const fixture = {
    state: { current: undefined, byId: { old: { cwd: "/work/old", updatedAt: 1 } } },
    workspaces: [{ path: "/work/old", title: "Old", updatedAt: 1, sessionIds: ["old"] }],
    storage: {},
    // 按 DSH 真实语义执行 apply 期间的全部 effect：任何一处抛错都会中断 apply，
    // 后续 slot 注册全部丢失（症状就是 HUD 入口按钮消失）。
    effectFilter: () => true,
    respond: () => ({ ok: true, modules: {}, usage: {}, context: {}, order: [], panel: {}, entries: [], isRepo: true, servers: [], total: 0, enabled: 0 }),
  };
  const client = hudClient(fixture);
  assert.ok(client.button(), "新建会话页的悬浮入口按钮必须注册");
  assert.ok(client.slotEntries.some((entry) => entry.meta?.name === "conversation.session.header.utilities"), "会话页头部入口必须注册");
  assert.ok(client.slotEntries.some((entry) => entry.meta?.name === "shell.overlay"), "面板 overlay 必须注册");
});

test("切页订阅的声明顺序：折叠表状态必须先于订阅（否则 apply 首跑命中 TDZ）", () => {
  const declIndex = source.indexOf("let newPageEpoch = 0;");
  const effectIndex = source.indexOf('"dsh-awesome-hud: new page visit"');
  const applyIndex = source.indexOf("function apply(ctx) {");
  assert.ok(declIndex > 0, "缺少访问世代声明");
  assert.ok(effectIndex > 0, "缺少切页订阅");
  assert.ok(declIndex < effectIndex, "声明必须早于订阅：订阅在 apply 期间会首跑一次，晚声明会抛 ReferenceError");
  assert.ok(applyIndex < declIndex && declIndex < applyIndex + 2600, "折叠表状态应声明在 apply 开头");
  // 订阅体自保护：异常就地吞掉，首跑放到微任务。
  assert.match(source, /这段只做阶段跟踪：任何异常都就地吞掉/);
  assert.match(source, /Promise\.resolve\(\)\.then\(sync\)\.catch\(\(\) => \{\}\);/);
});
