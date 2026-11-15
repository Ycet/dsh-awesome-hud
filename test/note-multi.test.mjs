// dsh-awesome-hud — v0.20.0 多便笺：迁移 / 存储 / 标题编号 / 条数上限 / 设置保存校验
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { clientSource as source, extractFunction, extractConst } from "./helpers/client-harness.mjs";
import { normalizeNoteMaxCount, NOTE_COUNT_MIN, NOTE_COUNT_MAX, NOTE_COUNT_DEFAULT } from "../lib/settings.js";

/** 便笺存储函数的小上下文（localStorage 用内存 Map 模拟）。 */
function loadNoteStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
  const context = vm.createContext({
    globalThis: { localStorage },
    localStorage,
    Date, JSON, Object, Array, String, Number, Boolean, Set, Math, Promise, console,
  });
  vm.runInContext(`
    const NOTES_STORAGE_KEY = "dsh-awesome-hud:notes";
    const NOTE_STORAGE_VERSION = 4;
    const NOTE_DEFAULT_HEIGHT = 180;
    function t(key) { return key; }
    function interpolate(template, values) { return String(template).replace(/\\{(\\w+)\\}/g, function (match, key) { return String(values && values[key] != null ? values[key] : ""); }); }
    function migrateWorkspaceScope() { return { migrated: false }; }
    ${extractFunction("loadJsonStorage")}
    ${extractFunction("defaultNoteTitle")}
    ${extractFunction("newNoteId")}
    ${extractFunction("nextNoteNumber")}
    ${extractFunction("normalizeNoteDocument")}
    ${extractFunction("readNoteDocument")}
    ${extractFunction("initialNoteDocument")}
    ${extractFunction("persistNoteDocument")}
    ${extractFunction("noteScope")}
    this.readNoteDocument = readNoteDocument;
    this.persistNoteDocument = persistNoteDocument;
    this.initialNoteDocument = initialNoteDocument;
    this.nextNoteNumber = nextNoteNumber;
    this.normalizeNoteDocument = normalizeNoteDocument;
    this.defaultNoteTitle = defaultNoteTitle;
    this.noteScope = noteScope;
  `, context);
  return { context, map };
}

test("存储：旧单便笺（v3）迁移为一条带标题的便笺，保留文字与共享高度", () => {
  const { context } = loadNoteStorage({
    "dsh-awesome-hud:notes": JSON.stringify({ "/ws/a": { text: "旧内容", height: 220, updatedAt: 42, v: 3 } }),
  });
  const doc = context.readNoteDocument("/ws/a");
  assert.equal(doc.notes.length, 1);
  assert.equal(doc.notes[0].text, "旧内容");
  assert.equal(doc.notes[0].title, "noteDefaultTitle");
  assert.equal(doc.height, 220);
  assert.equal(doc.legacy, true);
});

test("存储：写入 v4 文档（标题/文字/高度）并可读回", () => {
  const { context, map } = loadNoteStorage();
  const doc = {
    notes: [
      { id: "n1", title: "便笺1", text: "第一条", updatedAt: 1 },
      { id: "n2", title: "便笺2", text: "", updatedAt: 2 },
    ],
    height: 200,
  };
  assert.equal(context.persistNoteDocument({ key: "/ws/a" }, doc).persisted, true);
  const stored = JSON.parse(map.get("dsh-awesome-hud:notes"))["/ws/a"];
  assert.equal(stored.v, 4);
  assert.equal(stored.height, 200);
  assert.equal(stored.notes.length, 2);
  const read = context.readNoteDocument("/ws/a");
  assert.deepEqual(JSON.parse(JSON.stringify(read.notes.map((note) => [note.id, note.title, note.text]))), [["n1", "便笺1", "第一条"], ["n2", "便笺2", ""]]);
});

test("初始化：工作区作用域为空时返回空文档；缺失便笺目录时安全降级", () => {
  const { context } = loadNoteStorage();
  const doc = context.initialNoteDocument({ workspaceKey: "/ws/a", workspaceCandidates: [], sessionId: "s1" });
  // v0.20.0：空文档带上只增不复用的编号计数器 nextNumber。
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), { notes: [], height: 180, legacy: false, nextNumber: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.noteScope({ workspaceKey: "", sessionId: "s1" }))), { key: "s1", workspace: false });
});

test("标题编号：取现有「便笺n / Note n」的最大值 + 1（自定义标题不参与编号）", () => {
  const { context } = loadNoteStorage();
  const notes = [{ title: "便笺1" }, { title: "便笺3" }, { title: "临时记录" }, { title: "Note 7" }];
  assert.equal(context.nextNoteNumber(notes), 8);
  // 不能只按条数计算：现有便笺 1/3 的下一个应是 4，而不是 3。
  assert.equal(context.nextNoteNumber([{ title: "便笺1" }, { title: "便笺3" }]), 4);
  assert.equal(context.nextNoteNumber([], "n1"), 1);
  assert.equal(context.nextNoteNumber([{ id: "n1", title: "便笺3" }, { title: "便笺1" }], "n1"), 2, "排除自身后重新编号");
});

test("条数上限：5–20 收敛（宿主与客户端同规则）", () => {
  assert.equal(NOTE_COUNT_MIN, 5);
  assert.equal(NOTE_COUNT_MAX, 20);
  assert.equal(NOTE_COUNT_DEFAULT, 5);
  assert.equal(normalizeNoteMaxCount(4), 5);
  assert.equal(normalizeNoteMaxCount(21), 20);
  assert.equal(normalizeNoteMaxCount(12.4), 12);
  assert.equal(normalizeNoteMaxCount("9"), 9);
  assert.equal(normalizeNoteMaxCount(undefined), 5);
});

test("客户端接线：达到上限只 toast；上限调低后仍可保存", () => {
  // 创建入口：达到上限先 toast 再返回，不创建
  assert.match(source, /if \(docRef\.current\.notes\.length >= maxCount\) \{/);
  assert.match(source, /toast\(interpolate\(t\("noteLimitReached"\), \{ count: String\(maxCount\) \}\), "warn"\);/);
  assert.match(source, /const note = createNote\(content\.text, incoming\);/);
  assert.match(source, /onClick: \(\) => \{ createNote\("", \[\]\); \}/);
  // v0.20.1：保存不再扫描工作区、也不再因超限拒绝；只保留新建时的上限检查。
  const confirmStart = source.indexOf("const confirmSettings = () => {");
  const body = source.slice(confirmStart, source.indexOf("};", confirmStart));
  assert.doesNotMatch(body, /noteCountViolations|noteCapRejected|violations/);
  assert.match(body, /props\.onConfirm\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, gitDraft\);/);
  assert.match(source, /noteLimitReached: "便笺数量已达上限 \{count\} 条，请在 HUD 设置中调整"/);
});

test("列表视图：便笺条结构（拖动条/标题/悬停按钮）、空态与两行按钮", () => {
  assert.match(source, /className: "hud-note-bar",/);
  assert.match(source, /className: "hud-note-grip",/);
  assert.match(source, /className: "hud-note-bar-title"/);
  assert.match(source, /className: "hud-note-bar-actions"/);
  // v0.20.1：编辑按钮移除，改为点击标题进入编辑视图。
  assert.doesNotMatch(source, /"aria-label": t\("noteEdit"\)/);
  assert.match(source, /className: "hud-note-bar-title",\n\t+role: "button",/);
  // v0.21.0：点击便笺条进入编辑（弹窗开关决定弹窗或模块内编辑视图）。
  assert.match(source, /onClick: \(event\) => \{ event\?\.stopPropagation\?\.\(\); openNoteEditor\(note\.id\); \},/);
  assert.match(source, /const openNoteEditor = \(noteId\) => \{/);
  assert.match(source, /"aria-label": t\("noteDelete"\)/);
  assert.match(source, /className: "hud-note-empty"/);
  assert.match(source, /className: "hud-note-list-actions"/);
  assert.match(source, /className: "hud-btn-small hud-note-delete-all"/);
  // 悬停显示 / 键盘与触屏降级
  assert.match(source, /\.hud-note-bar:hover \.hud-note-bar-actions,\.hud-note-bar:focus-within \.hud-note-bar-actions/);
  assert.match(source, /@media\(hover:none\)\{\.hud-note-bar-title\{padding-right:52px\}/);
});

test("编辑视图：返回/标题输入/图片拖动/共用高度/删除全部确认", () => {
  assert.match(source, /className: "hud-note-back"/);
  assert.match(source, /className: "hud-note-title-input"/);
  assert.match(source, /onChange: \(event\) => updateNote\(note\.id, \{ title: event\.target\.value \}\)/);
  // v0.21.0：共用高度只作用于内联编辑视图；弹窗固定高度（供 renderNoteTextarea 二选一）。
  assert.match(source, /inDialog \? \{ height: `\$\{NOTE_DIALOG_AREA_HEIGHT\}px` \} : \(doc\.height === null \? undefined : \{ height: `\$\{doc\.height\}px` \}\)/);
  assert.match(source, /inDialog \? null : react\.createElement\("div", \{ className: "hud-note-resize"/);
  assert.match(source, /const startResize = \(event\) => \{/);
  assert.match(source, /const startImageDrag = \(event, imageId\) => \{/);
  assert.match(source, /onPointerDown: \(event\) => startImageDrag\(event, image\.id\)/);
  // 拖动中的便笺条 / 图片也移动到落点（展示「站位」），不再跳过快照位移。
  assert.match(source, /style: offset === 0 \? undefined : \{ transform: `translateX\(\$\{offset\}px\)` \}/);
  assert.match(source, /style: offset === 0 \? undefined : \{ transform: `translateY\(\$\{offset\}px\)` \}/);
  assert.match(source, /className: "hud-btn-small hud-note-delete-all"/);
  // v0.20.1：删除单条走行内二次确认；删除全部仍走确认弹窗（danger 按钮）。
  assert.match(source, /note\.id === deleteConfirmId/);
  assert.match(source, /color: "var\(--dsw-alias-state-error-primary\)"/);
  assert.match(source, /kind: "deleteAll"/);
  // 所有便笺确认弹窗（删除 / 删除全部 / 添加至聊天 / 从聊天导入）都用红色危险按钮。
  assert.match(source, /danger: true,/);
  assert.match(source, /todoDeleteConfirm: "确认删除"/);
  assert.match(source, /noteDeleteAllNote: "将删除全部 \{count\} 条便笺及其图片，此操作不可撤销。"/);
  // v0.20.1：便笺条拖动与待办一致——松手在列表外兜底提交，Esc 取消。
  assert.match(source, /const endBarDrag = \(event\) => \{/);
  assert.match(source, /if \(!barDropRef\.current && event\?\.dataTransfer\?\.dropEffect !== "none"\) commitBarDrag\(\);/);
});
