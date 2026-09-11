import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const clip = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
/** 按「函数声明 + 平衡大括号」精确抽取一个函数（避免误带相邻的 git/UI 代码）。 */
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

// 便笺/待办的工作区级作用域：常量 + loadJsonStorage + 相关纯函数与 localStorage 读写
const WORKSPACE_FUNCTIONS = [
  "isStorageRecord", "readStorageEntry", "writeStorageEntry", "commitStorage",
  "mergeTodoLists", "normalizeTodoList", "migrateWorkspaceScope",
  "persistWorkspaceTodos", "resolveWorkspaceKey", "isNewSessionPage", "liveSessionsOf",
  "resolveTargetWorkspace", "panelVisibleModules",
];
const scopeHelpers = clip('const NOTES_STORAGE_KEY = "dsh-awesome-hud:notes"', "const CSS_TAG = ")
  + extractFunction("loadJsonStorage")
  + WORKSPACE_FUNCTIONS.map(extractFunction).join("\n");
// 新建会话页的模块筛选依赖这两个常量
const moduleConstants = clip('const NEW_SESSION_MODULE_KEYS = ["balance"', "// 菜单可隐藏的模块（会话模块恒展示）")
  + clip('const MODULE_KEYS = ["context"', "const zh = {");

/** 内存版 localStorage：仅实现插件用到的 getItem/setItem。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    raw: key => (map.has(key) ? JSON.parse(map.get(key)) : null),
  };
}

function createContext(storage) {
  const context = vm.createContext({
    globalThis: { localStorage: storage },
    Set, Number, Date, JSON, Math, Array, Object, String, Boolean, isNaN,
  });
  vm.runInContext(scopeHelpers, context);
  return context;
}

test("resolveWorkspaceKey 以 cwd 优先、工作区实体 path 兜底，两者皆无才返回 null", () => {
  const storage = memoryStorage();
  const context = createContext(storage);
  const items = [{ workspaceId: "w1", path: "/ws/a", title: "A" }, { workspaceId: "w2", path: "/ws/b", title: "B" }];

  assert.equal(context.resolveWorkspaceKey("/ws/b", items), "/ws/b");
  assert.equal(context.resolveWorkspaceKey("/ws/unknown", items), "/ws/unknown");
  assert.equal(context.resolveWorkspaceKey("", items), "/ws/a");
  assert.equal(context.resolveWorkspaceKey(undefined, items), "/ws/a");
  assert.equal(context.resolveWorkspaceKey(undefined, []), null);
  assert.equal(context.resolveWorkspaceKey(undefined, null), null);
});

test("isNewSessionPage 只把「无当前会话」与「blank 会话」判定为新建会话页", () => {
  const context = createContext(memoryStorage());

  assert.equal(context.isNewSessionPage({ current: undefined, byId: {} }), true);
  assert.equal(context.isNewSessionPage({ current: null, byId: {} }), true);
  assert.equal(context.isNewSessionPage({ current: "s1", byId: { s1: { blank: true } } }), true);
  assert.equal(context.isNewSessionPage({ current: "s1", byId: { s1: { blank: false } } }), false);
  assert.equal(context.isNewSessionPage({ current: "s1", byId: {} }), false);
  // store 未就绪：不判定，避免初载误收起
  assert.equal(context.isNewSessionPage(null), false);
  assert.equal(context.isNewSessionPage(undefined), false);
});

test("resolveTargetWorkspace 新建会话页取最近更新的非空工作区，并排除已归档会话", () => {
  const context = createContext(memoryStorage());
  const items = [
    { workspaceId: "w1", path: "/ws/old", title: "Old", sessionIds: ["s1"], updatedAt: 10 },
    { workspaceId: "w2", path: "/ws/new", title: "New", sessionIds: ["s2", "s3", "archived"], updatedAt: 99 },
    { workspaceId: "w3", path: "/ws/empty", title: "Empty", sessionIds: [], updatedAt: 100 },
  ];
  const snapshot = {
    current: undefined,
    byId: {
      s1: { cwd: "/ws/old", updatedAt: 10 },
      s2: { cwd: "/ws/new", updatedAt: 20 },
      s3: { cwd: "/ws/new", updatedAt: 30 },
      archived: { cwd: "/ws/new", updatedAt: 40 },
    },
    archivedSessionIds: ["archived"],
  };

  const target = context.resolveTargetWorkspace(snapshot, items);
  assert.equal(target.path, "/ws/new");
  assert.equal(target.workspaceTitle, "New");
  // 代理会话取该工作区最近更新的存活会话
  assert.equal(target.gitSessionId, "s3");
  assert.equal(target.sendSessionId, "s3");
  assert.deepEqual(Array.from(target.candidates), ["s3", "s2"]);

  // 当前会话存在时以自身 cwd 为准
  const inSession = context.resolveTargetWorkspace({ ...snapshot, current: "s2" }, items);
  assert.equal(inSession.path, "/ws/new");
  assert.equal(inSession.gitSessionId, "s2");
  assert.equal(inSession.sendSessionId, "s2");

  // 无任何存活会话 → 空结果（调用方降级）
  const none = context.resolveTargetWorkspace({ current: undefined, byId: {}, archivedSessionIds: [] }, []);
  assert.equal(none.path, null);
  assert.equal(none.gitSessionId, null);
  assert.equal(none.sendSessionId, null);
});

test("migrateWorkspaceScope 归并旧会话级数据并只执行一次", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:notes": JSON.stringify({
      oldB: { text: "older", height: 300, v: 3, updatedAt: 100 },
      oldA: { text: "newer", height: 180, v: 3, updatedAt: 200 },
      legacy: { text: "no stamp", height: 180, v: 3 },
    }),
    "dsh-awesome-hud:todos": JSON.stringify({
      oldA: [{ id: "t1", text: "one", done: false }],
      oldB: [{ id: "t1", text: "dup", done: true }, { id: "t2", text: "two", done: false }],
    }),
  });
  const context = createContext(storage);
  const key = "/ws/a";
  const read = storageKey => JSON.parse(storage.getItem(storageKey));
  const snapshot = {
    "dsh-awesome-hud:notes": read("dsh-awesome-hud:notes"),
    "dsh-awesome-hud:todos": read("dsh-awesome-hud:todos"),
  };

  const first = context.migrateWorkspaceScope(snapshot, key, ["oldA", "oldB", "legacy"]);
  assert.equal(first.migrated, true);
  assert.equal(first.note.text, "newer");
  assert.deepEqual(Array.from(first.todos, item => item.id), ["t1", "t2"]);
  assert.equal(first.todos[0].text, "one");
  assert.equal(first.storage["dsh-awesome-hud:workspace-migrated"][key], 1);
  // 旧的会话级键原样保留（便于回滚）
  assert.equal(first.storage["dsh-awesome-hud:notes"].oldA.text, "newer");
  assert.equal(first.storage["dsh-awesome-hud:notes"].oldB.text, "older");

  const second = context.migrateWorkspaceScope(first.storage, key, ["oldA", "oldB"]);
  assert.equal(second.migrated, false);
  // 二次调用不会覆盖已归并的内容
  assert.equal(second.note, undefined);
});

test("migrateWorkspaceScope 对无 cwd 的工作区键与空候选安全返回", () => {
  const context = createContext(memoryStorage());
  assert.equal(context.migrateWorkspaceScope({}, "", ["s1"]).migrated, false);
  assert.equal(context.migrateWorkspaceScope({}, "  ", ["s1"]).migrated, false);
  assert.equal(context.migrateWorkspaceScope(null, "/ws", ["s1"]).migrated, false);
  const empty = context.migrateWorkspaceScope({}, "/ws", []);
  assert.equal(empty.migrated, true);
  assert.equal(empty.note, null);
  assert.deepEqual(Array.from(empty.todos), []);
});

test("mergeTodoLists 保持本地顺序，只补充对方独有条目", () => {
  const context = createContext(memoryStorage());
  const local = [{ id: "b", text: "B", done: false }, { id: "a", text: "A", done: false }];
  const remote = [{ id: "a", text: "A2", done: true }, { id: "c", text: "C", done: false }];

  const merged = context.mergeTodoLists(local, remote);
  assert.deepEqual(merged.map(item => item.id), ["b", "a", "c"]);
  assert.equal(merged[1].text, "A");
  assert.equal(merged[1].done, false);
  // 非法输入不再抛错，且过滤掉结构不完整的条目
  assert.deepEqual(Array.from(context.mergeTodoLists(null, null)), []);
  assert.deepEqual(Array.from(context.mergeTodoLists([{ id: 1 }], [{ text: "x" }])), []);
});

test("persistWorkspaceTodos 写入前重读存储，不覆盖其他会话新增的条目", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:todos": JSON.stringify({
      "/ws/a": [{ id: "old", text: "written by another tab", done: false }],
    }),
  });
  const context = createContext(storage);

  const landed = context.persistWorkspaceTodos("dsh-awesome-hud:todos", "/ws/a", [{ id: "mine", text: "mine", done: false }], new Set());
  assert.deepEqual(Array.from(landed, item => item.id), ["mine", "old"]);
  assert.deepEqual(Array.from(storage.raw("dsh-awesome-hud:todos")["/ws/a"], item => item.id), ["mine", "old"]);

  // 工作区键不可用时不动存储（调用方降级为会话级）
  const untouched = storage.raw("dsh-awesome-hud:todos");
  context.persistWorkspaceTodos("dsh-awesome-hud:todos", "", [{ id: "x", text: "x", done: false }], new Set());
  assert.deepEqual(storage.raw("dsh-awesome-hud:todos"), untouched);
});

test("persistWorkspaceTodos 删除条目后不会被存储里的旧内容复活", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:todos": JSON.stringify({
      "/ws/a": [{ id: "keep", text: "keep", done: false }, { id: "gone", text: "delete me", done: false }],
    }),
  });
  const context = createContext(storage);

  // 删除 gone：传 removedIds
  const afterDelete = context.persistWorkspaceTodos(
    "dsh-awesome-hud:todos", "/ws/a",
    [{ id: "keep", text: "keep", done: false }],
    new Set(["gone"]),
  );
  assert.deepEqual(Array.from(afterDelete, item => item.id), ["keep"]);
  assert.deepEqual(Array.from(storage.raw("dsh-awesome-hud:todos")["/ws/a"], item => item.id), ["keep"]);

  // 再次写入（例如新增一条）仍不会让已删除条目回来
  const afterAdd = context.persistWorkspaceTodos(
    "dsh-awesome-hud:todos", "/ws/a",
    [{ id: "new", text: "new", done: false }, { id: "keep", text: "keep", done: false }],
    new Set(),
  );
  assert.deepEqual(Array.from(afterAdd, item => item.id).sort(), ["keep", "new"]);
  assert.equal(Array.from(storage.raw("dsh-awesome-hud:todos")["/ws/a"]).some(item => item.id === "gone"), false);
});

test("persistWorkspaceTodos 清空已完成：空列表也能删除存储里的旧条目", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:todos": JSON.stringify({
      "/ws/a": [{ id: "a", text: "a", done: true }, { id: "b", text: "b", done: true }],
    }),
  });
  const context = createContext(storage);

  // cleared=true + 全部条目删除 → 存储落为空数组，而不是保留旧值
  const emptied = context.persistWorkspaceTodos("dsh-awesome-hud:todos", "/ws/a", [], new Set(["a", "b"]), { cleared: true });
  assert.deepEqual(Array.from(emptied), []);
  assert.deepEqual(Array.from(storage.raw("dsh-awesome-hud:todos")["/ws/a"]), []);

  // 无任何操作的空列表（未清理）不应改动存储
  const before = storage.raw("dsh-awesome-hud:todos");
  context.persistWorkspaceTodos("dsh-awesome-hud:todos", "/ws/a", [], new Set());
  assert.deepEqual(storage.raw("dsh-awesome-hud:todos"), before);
});

test("persistWorkspaceTodos 清空只保留未完成项，其它会话新增项仍归并进来", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:todos": JSON.stringify({
      "/ws/a": [
        { id: "done", text: "done", done: true },
        { id: "pending", text: "pending", done: false },
        { id: "other", text: "from another tab", done: false },
      ],
    }),
  });
  const context = createContext(storage);

  const after = context.persistWorkspaceTodos(
    "dsh-awesome-hud:todos", "/ws/a",
    [{ id: "pending", text: "pending", done: false }],
    new Set(["done"]),
    { cleared: true },
  );
  assert.deepEqual(Array.from(after, item => item.id), ["pending", "other"]);
});

test("panelVisibleModules 在新建会话页只放行有数据源的模块", () => {
  const storage = memoryStorage();
  const moduleContext = vm.createContext({ Set, Number, Array, Object, isNaN });
  vm.runInContext(scopeHelpers + moduleConstants, moduleContext);

  const all = moduleContext.panelVisibleModules(null, false, false);
  assert.deepEqual(Array.from(Object.keys(all)).sort(), ["balance", "context", "git", "mcp", "note", "plans", "subagents", "tasks", "todo"]);
  assert.equal(Array.from(Object.values(all)).every(Boolean), true);

  // 新建会话页：上下文/子代理/任务/计划清单无数据源，恒不展示
  const hero = moduleContext.panelVisibleModules(null, false, true);
  assert.equal(hero.context, false);
  assert.equal(hero.subagents, false);
  assert.equal(hero.tasks, false);
  assert.equal(hero.plans, false);
  assert.equal(hero.note, true);
  assert.equal(hero.todo, true);
  assert.equal(hero.mcp, true);
  assert.equal(hero.balance, true);
  assert.equal(hero.git, false);

  // 工作区是 git 仓库时放行 git
  assert.equal(moduleContext.panelVisibleModules(null, true, true).git, true);

  // 用户设置仍然生效（显式 false 优先）
  const disabled = moduleContext.panelVisibleModules({ note: false, mcp: false }, true, true);
  assert.equal(disabled.note, false);
  assert.equal(disabled.mcp, false);
  assert.equal(disabled.git, true);
  // 真实会话页维持原语义：未显式关闭即展示
  assert.equal(moduleContext.panelVisibleModules({ note: false }, false, false).context, true);
});
