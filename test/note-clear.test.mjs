import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const clip = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `function ${name} must exist in lib/client.js`);
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

function memoryStorage(initial = {}, fail = false) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (fail) throw new Error("storage unavailable");
      map.set(key, String(value));
    },
    raw: key => (map.has(key) ? JSON.parse(map.get(key)) : null),
  };
}

function createContext(storage) {
  const context = vm.createContext({
    globalThis: { localStorage: storage },
    Date, JSON, Object, Array, String, Number, Boolean, Set, Math, isNaN,
  });
  const helpers = clip('const NOTES_STORAGE_KEY = "dsh-awesome-hud:notes"', "const CSS_TAG = ")
    + "const NOTE_STORAGE_VERSION = 3;\n"
    + extractFunction("loadJsonStorage")
    + extractFunction("persistNoteEntry")
    + extractFunction("noteClearAction");
  vm.runInContext(helpers, context);
  return context;
}

test("noteClearAction separates empty, confirmation and clear actions", () => {
  const context = createContext(memoryStorage());
  assert.equal(context.noteClearAction("", false), "noop");
  assert.equal(context.noteClearAction("note", false), "confirm");
  assert.equal(context.noteClearAction("note", true), "clear");
  assert.equal(context.noteClearAction(null, true), "noop");
});

test("persistNoteEntry reports successful workspace clearing", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:notes": JSON.stringify({ "/ws/a": { text: "old", height: 180, v: 3 } }),
  });
  const context = createContext(storage);
  const result = context.persistNoteEntry({ key: "/ws/a" }, { text: "", height: 180 });

  assert.equal(result.persisted, true);
  assert.equal(result.payload.text, "");
  assert.equal(storage.raw("dsh-awesome-hud:notes")["/ws/a"].text, "");
});

test("persistNoteEntry reports storage failure without claiming the clear succeeded", () => {
  const storage = memoryStorage({
    "dsh-awesome-hud:notes": JSON.stringify({ "/ws/a": { text: "old", height: 180, v: 3 } }),
  }, true);
  const context = createContext(storage);
  const result = context.persistNoteEntry({ key: "/ws/a" }, { text: "", height: 180 });

  assert.equal(result.persisted, false);
  assert.equal(result.payload.text, "");
  assert.equal(storage.raw("dsh-awesome-hud:notes")["/ws/a"].text, "old");
});

test("NoteModule renders the clear / import / add buttons in order", () => {
  const actions = source.indexOf('className: "hud-note-buttons"');
  const clear = source.indexOf('t(clearConfirming ? "noteClearConfirm" : "noteClear")', actions);
  const importFromChat = source.indexOf('t("noteImportFromChat")', actions);
  const send = source.indexOf('t("noteSendToChat")', actions);

  assert.ok(actions > 0);
  assert.ok(clear > actions);
  // v0.19.0：「从聊天导入」固定在「添加至聊天」左侧
  assert.ok(importFromChat > clear);
  assert.ok(send > importFromChat);
  // 文字与图片都为空时才置灰（只有图片同样可清空）
  assert.match(source, /disabled: note\.text === "" && images\.length === 0/);
  assert.match(source, /"aria-label": t\(clearConfirming \? "noteClearConfirm" : "noteClear"\)/);
  assert.match(source, /className: clearConfirming \? "hud-btn-small hud-note-clear hud-note-clear-confirm" : "hud-btn-small hud-note-clear"/);
});

test("NoteModule implements the requested confirmation cancellation and synchronization", () => {
  assert.match(source, /const NOTE_CLEAR_CONFIRM_MS = 2000;/);
  assert.match(source, /globalThis\.setTimeout\(\(\) => \{/);
  assert.match(source, /globalThis\.addEventListener\?\.\("pointerdown", onPointerDown, true\)/);
  assert.match(source, /globalThis\.addEventListener\?\.\("keydown", onKeyDown, true\)/);
  assert.match(source, /if \(event\.key !== "Escape"\) return;/);
  assert.match(source, /globalThis\.addEventListener\?\.\(NOTE_CHANGE_EVENT, onNoteChange\)/);
  assert.match(source, /globalThis\.addEventListener\?\.\("storage", onStorage\)/);
  assert.match(source, /publishNoteChange\(scope\.key\)/);
  assert.match(source, /areaRef\.current\?\.focus\?\.\(\)/);
  assert.match(source, /toast\(t\("noteClearFailed"\)\)/);
});

test("clear confirmation styling is theme-aware and uses the error color", () => {
  assert.match(source, /\.hud-note-clear-confirm\{border:1px solid var\(--dsw-alias-state-error-primary\);background:var\(--hud-surface-bg\);color:var\(--dsw-alias-state-error-primary\)\}/);
  // v0.19.0：按钮区固定两行，且容器铺满便笺内容宽度（不再收缩到内容宽、右对齐）
  assert.match(source, /\.hud-note-buttons\{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:nowrap;min-width:0;flex:1 1 100%\}/);
  assert.match(source, /\.hud-note-buttons\[data-stacked\] \.hud-note-clear\{order:-1;flex:1 0 100%;justify-content:center\}/);
  // 外层容器只占位，不应再对收缩后的容器做右对齐（否则两行按钮会被推到右边、左边留空）
  assert.match(source, /\.hud-note-actions\{display:flex;align-items:center;gap:6px;flex-wrap:wrap\}/);
  assert.ok((source.match(/noteClear:/g) ?? []).length >= 2, "Chinese and English clear labels must exist");
});
