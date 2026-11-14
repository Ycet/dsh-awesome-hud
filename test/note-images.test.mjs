// dsh-awesome-hud — v0.19.0「便笺图片」回归
//  1) 取消字数上限，且底部不再显示字数
//  2) 按钮区在宽度不足时把「清空」换到另外两个按钮下方一行
//  3) 粘贴：只收图片、最多 20 张、接管粘贴事件
//  4) IndexedDB 持久化（按工作区键、原图 Blob、重启后仍在）与不可用时的内存降级
//  5) 清空：文字与图片一起清、两次点击才执行
//  6) 灯箱：portal + role=dialog + 遮罩关闭
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { hudClient, nodes, extractFunction, clientSource as source } from "./helpers/client-harness.mjs";

const cls = (node) => node?.props?.className;
const byClass = (node, name) => nodes(node).filter((child) => cls(child) === name);

/** 最小 IndexedDB 假实现：单 store，记录读/写/删以便断言。 */
function fakeIndexedDb() {
  const records = new Map();
  const reads = [];
  const deletes = [];
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => ({
      onabort: null,
      objectStore: () => ({
        get: (key) => { reads.push(key); return request(records.get(key)); },
        put: (record) => { records.set(record.key, record); return request(record.key); },
        delete: (key) => { deletes.push(key); records.delete(key); return request(true); },
      }),
    }),
  };
  return {
    records,
    reads,
    deletes,
    open: () => {
      const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
}

const fakeUrl = () => {
  let seq = 0;
  return { createObjectURL: () => `blob:note-${seq += 1}`, revokeObjectURL: () => {} };
};

function noteHarness(options = {}) {
  const state = options.state ?? { byId: { s1: { id: "s1", cwd: "/tmp/w", running: false } }, current: "s1" };
  const harness = hudClient({
    state,
    current: "s1",
    storage: {
      "dsh-awesome-hud:open": JSON.stringify({ s1: "1" }),
      ...(options.storage ?? {}),
    },
    globals: {
      URL: options.URL ?? fakeUrl(),
      ...(options.globals ?? {}),
    },
    respond: options.respond ?? (() => ({ ok: true, modules: {}, usage: {}, context: {}, order: [], panel: {}, entries: [], isRepo: true, servers: [], total: 0, enabled: 0 })),
  });
  const panel = harness.panel();
  const element = nodes(panel).find((node) => node?.type?.name === "NoteModule");
  assert.ok(element, "面板应渲染便笺模块");
  /** 渲染便笺并执行这一轮收集到的 effect（挂载读图片、测量按钮宽度都在 effect 里）。 */
  const render = (props = {}) => {
    const rendered = element.type({ ...element.props, ...props });
    for (const effect of harness.effects.splice(0)) {
      try { const cleanup = effect(); if (typeof cleanup === "function") cleanup(); } catch { /* 测试桩：清理异常忽略 */ }
    }
    return rendered;
  };
  return { harness, element, render };
}

/** 图片存储函数的小上下文：只装载「工作区 → 便笺分桶」读写所需的函数。 */
function loadImageStorage(globals = {}) {
  const globalObject = { indexedDB: globals.indexedDB, URL: globals.URL };
  const context = vm.createContext({
    globalThis: globalObject,
    indexedDB: globals.indexedDB,
    URL: globals.URL,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Array,
    Object,
    String,
    Number,
    JSON,
    Date,
    Math,
    console,
  });
  vm.runInContext(`
    const NOTE_IMAGE_DB = "dsh-awesome-hud";
    const NOTE_IMAGE_STORE = "noteImages";
    const NOTE_MAX_IMAGES = 20;
    const noteImageMemory = new Map();
    let noteImageDbPromise = null;
    ${extractFunction("openNoteImageDb")}
    ${extractFunction("noteImageRequest")}
    async ${extractFunction("readNoteImageValue")}
    async ${extractFunction("writeNoteImageMap")}
    async ${extractFunction("deleteNoteImages")}
    ${extractFunction("dehydrateNoteImages")}
    ${extractFunction("hydrateNoteImages")}
    this.readNoteImageValue = readNoteImageValue;
    this.writeNoteImageMap = writeNoteImageMap;
    this.deleteNoteImages = deleteNoteImages;
    this.dehydrateNoteImages = dehydrateNoteImages;
  `, context);
  return context;
}

const pasteEvent = (items) => {
  const event = { clipboardData: { items }, prevented: false, preventDefault() { this.prevented = true; } };
  return event;
};

const imageItem = (type = "image/png") => ({ kind: "file", type, getAsFile: () => ({ type, name: "pasted.png", size: 128 }) });
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test("便笺取消字数上限：不再有 maxLength / slice，底部也不再显示字数", () => {
  assert.ok(!/const NOTE_MAX_LEN/.test(source), "NOTE_MAX_LEN 常量必须移除");
  assert.ok(!/maxLength: NOTE_MAX_LEN/.test(source), "textarea 不再设置 maxLength");
  // v0.20.0：编辑视图按当前便笺写入（多便笺：updateNote(note.id, { text })）。
  assert.match(source, /onChange: \(event\) => updateNote\(note\.id, \{ text: event\.target\.value \}\)/);
  // v0.19.0：底部不再展示「0 chars / 0 字」这类字数信息
  assert.ok(!/noteCountText|hud-note-count|noteCountChars|noteCountImages/.test(source), "便笺底部不再渲染字数");
});

test("便笺按钮区：固定两行（清空在上独占一行，另两个各占一半），中英一致", () => {
  assert.match(source, /\.hud-note-buttons\{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:nowrap;min-width:0;flex:1 1 100%\}/);
  assert.match(source, /\.hud-note-buttons\[data-stacked\]\{flex-wrap:wrap\}/);
  // 堆叠布局：清空在上独占一行，另外两个各占一半宽度（两行都铺满便笺宽度，与输入框左右边线对齐）
  assert.match(source, /\.hud-note-buttons\[data-stacked\] \.hud-note-clear\{order:-1;flex:1 0 100%;justify-content:center\}/);
  assert.match(source, /\.hud-note-buttons\[data-stacked\] \.hud-note-import,\.hud-note-buttons\[data-stacked\] \.hud-note-send\{flex:1 1 0;min-width:0;justify-content:center;padding-left:8px;padding-right:8px\}/);
  // 铺满后按钮必须 border-box + 单行：否则 padding/边框会把整宽按钮顶出便笺右边界，英文文案会被折成两行
  assert.match(source, /\.hud-note-buttons\[data-stacked\] \.hud-btn-small\{box-sizing:border-box;white-space:nowrap\}/);
  // v0.19.0：不再按可用宽度实测切换，恒定堆叠（中英界面布局一致）
  assert.match(source, /"data-stacked": "",/);
  assert.equal(/scrollWidth/.test(source), false, "不再按自然宽度测量按钮");
  assert.equal(/setStacked/.test(source), false, "不再有堆叠状态");
  // 清空按钮带稳定类名，供堆叠规则选中；按钮顺序仍是 清空 → 从聊天导入 → 添加至聊天
  assert.match(source, /className: clearConfirming \? "hud-btn-small hud-note-clear hud-note-clear-confirm" : "hud-btn-small hud-note-clear"/);
  assert.match(source, /className: "hud-btn-small hud-note-import"/);
  assert.match(source, /className: "hud-btn-small hud-note-send"/);
  const actions = source.indexOf('className: "hud-note-buttons"');
  const clear = source.indexOf('t(clearConfirming ? "noteClearConfirm" : "noteClear")', actions);
  const importFromChat = source.indexOf('t("noteImportFromChat")', actions);
  const send = source.indexOf('t("noteSendToChat")', actions);
  assert.ok(actions > 0 && clear > actions && importFromChat > clear && send > importFromChat);
});

test("noteClearAction：只有图片也算有内容，空便笺才是 noop", () => {
  const context = vm.createContext({});
  vm.runInContext(`${extractFunction("noteClearAction")}`, context);
  assert.equal(context.noteClearAction("", false, false), "noop");
  assert.equal(context.noteClearAction("", false, true), "confirm", "有图片无文字同样可清空");
  assert.equal(context.noteClearAction("text", false, false), "confirm");
  assert.equal(context.noteClearAction("", true, true), "clear");
  assert.equal(context.noteClearAction(null, false, true), "confirm");
});

test("粘贴过滤：只收 image/*，非图片与非文件项一律忽略", () => {
  const context = vm.createContext({});
  vm.runInContext(`${extractFunction("noteImageAcceptable")}\n${extractFunction("notePasteImageFiles")}`, context);
  const files = context.notePasteImageFiles([
    imageItem("image/png"),
    { kind: "string", type: "text/plain" },
    imageItem("text/plain"),
    imageItem("image/jpeg"),
    null,
  ]);
  assert.equal(files.length, 2, "只保留两张图片文件");
  assert.deepEqual([...files.map((file) => file.type)], ["image/png", "image/jpeg"]);
  assert.equal(context.notePasteImageFiles(null).length, 0);
});

test("图片上限 20 张：超出部分拒绝并给出提示文案", () => {
  const context = vm.createContext({ NOTE_MAX_IMAGES: 20 });
  vm.runInContext(`${extractFunction("noteMergeImages")}`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.noteMergeImages(0, 5))), { accepted: 5, rejected: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.noteMergeImages(18, 5))), { accepted: 2, rejected: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.noteMergeImages(20, 3))), { accepted: 0, rejected: 3 });
  assert.match(source, /const NOTE_MAX_IMAGES = 20;/);
  assert.match(source, /noteImageLimit: "便笺最多保存 \{count\} 张图片"/);
  assert.match(source, /noteImageLimit: "A note holds at most \{count\} images"/);
});

test("粘贴图片写入 IndexedDB：按「工作区 → 便笺 id」分桶、原图 Blob、受 20 张上限约束", async () => {
  const idb = fakeIndexedDb();
  const context = loadImageStorage({ indexedDB: idb, URL: fakeUrl() });
  const images = Array.from({ length: 23 }, (_, index) => ({
    id: `img-${index}`, type: "image/png", name: "pasted.png", blob: { fake: index },
  }));
  const written = await context.writeNoteImageMap("/tmp/w", { "note-1": context.dehydrateNoteImages(images) });
  assert.equal(written, true);
  const record = idb.records.get("/tmp/w");
  assert.ok(record, "应以工作区路径为键保存图片记录");
  assert.equal(record.images["note-1"].length, 20, "超过 20 张时截断到上限");
  assert.equal(record.images["note-1"][0].type, "image/png");
  assert.ok(record.images["note-1"][0].blob, "保存的是原图 Blob");
  assert.ok(record.updatedAt > 0);
  // 读回：同一工作区的不同便笺互不干扰
  const loaded = await context.readNoteImageValue("/tmp/w");
  assert.equal(loaded["note-1"].length, 20);
  assert.equal(loaded["note-2"], undefined);
  // 粘贴入口：图片按 20 张上限合并，写入当前便笺的桶
  assert.match(source, /const added = makeImages\(accepted\);/);
  assert.match(source, /const room = noteMergeImages\(imagesRef\.current\.length, added\.length\);/);
  assert.match(source, /queueImageWrite\(openNote\.id, next\);/);
  assert.match(source, /map\[noteId\] = dehydrateNoteImages\(nextImages\);/);
});

test("挂载时按工作区键读回图片（重启后仍在）", async () => {
  const idb = fakeIndexedDb();
  idb.records.set("/tmp/w", { key: "/tmp/w", updatedAt: 1, images: [{ id: "i1", type: "image/png", name: "a.png", blob: { fake: true } }] });
  const harness = noteHarness({ globals: { indexedDB: idb } });
  harness.render();
  await wait();
  assert.ok(idb.reads.includes("/tmp/w"), "挂载时应按工作区键读回图片");
  // 读回的记录会转成带 objectURL 的内存图片（用于缩略图渲染）
  assert.match(source, /function hydrateNoteImages\(records\)/);
  assert.match(source, /globalThis\.URL\?\.createObjectURL\?\.\(record\.blob\)/);
});

test("IndexedDB 不可用时降级为内存并提示，不阻塞便笺文字", async () => {
  const context = loadImageStorage({ indexedDB: undefined, URL: fakeUrl() });
  const written = await context.writeNoteImageMap("/tmp/w", { "note-1": [{ id: "i1", type: "image/png", name: "a.png", blob: { fake: true } }] });
  assert.equal(written, false, "IndexedDB 不可用时返回未持久化");
  assert.match(source, /noteImageMemory\.set\(key, images\)/, "降级时写内存镜像");
  const loaded = await context.readNoteImageValue("/tmp/w");
  assert.equal(loaded["note-1"].length, 1, "内存镜像仍可读回");
  assert.match(source, /t\("noteImageStorageUnavailable"\)/, "必须提示图片无法持久化");
  assert.match(source, /noteImageStorageUnavailable: "当前环境无法持久化图片，图片只在本次会话内保留"/);
  assert.match(source, /noteImageStorageUnavailable: "Images cannot be persisted here, so they stay for this session only"/);
  // 文字输入不受影响：超过 5000 字也不再截断
  assert.match(source, /onChange: \(event\) => updateNote\(note\.id, \{ text: event\.target\.value \}\)/, "文字不截断");
});

test("清空：连文字与图片一起清，并清掉该便笺的图片桶", () => {
  // 两次点击的状态机由 noteClearAction 覆盖；这里固定「确认后」的落盘与清理接线。
  const clearStart = source.indexOf("const onClear = () => {");
  const clearBody = source.slice(clearStart, clearStart + 1600);
  assert.match(clearBody, /const action = noteClearAction\(note\.text, clearConfirming, images\.length > 0\);/);
  // 文字与图片必须一起清，且失败时不能假装成功
  assert.match(clearBody, /releaseImages\(imagesRef\.current\);/);
  assert.match(clearBody, /const result = persistDoc\(withNotePatch\(note\.id, \{ text: "" \}\)\);/);
  assert.match(clearBody, /if \(!result\.persisted\) toast\(t\("noteClearFailed"\)\);/);
  assert.match(clearBody, /setImages\(\[\]\);/);
  assert.match(clearBody, /queueImageWrite\(note\.id, \[\]\);/);
  assert.match(clearBody, /setPreview\(null\);/);
  assert.match(clearBody, /publishNoteChange\(scope\.key\);/);
  // 有内容才可点：只有图片同样可清空
  assert.match(source, /disabled: note\.text === "" && images\.length === 0,/);
  // 删除全部：清空文档并删除整条图片记录
  const deleteAllStart = source.indexOf("const deleteAllNotes = () => {");
  const deleteAllBody = source.slice(deleteAllStart, deleteAllStart + 600);
  assert.match(deleteAllBody, /persistDoc\(\{ \.\.\.docRef\.current, notes: \[\] \}\);/);
  assert.match(deleteAllBody, /void deleteNoteImages\(scope\.key\);/);
  assert.match(deleteAllBody, /setImages\(\[\]\);/);
});

test("缩略图栏与灯箱：结构、交互与悬停保持标记", () => {
  // 缩略图栏横滑 + 悬浮移除按钮 + 点击放大
  assert.match(source, /className: "hud-note-images", role: "list"/);
  assert.match(source, /\.hud-note-images\{display:flex;gap:6px;overflow-x:auto/, "缩略图栏需支持左右滑动");
  assert.match(source, /className: "hud-note-thumb"/);
  assert.match(source, /className: "hud-note-thumb-remove"/);
  assert.match(source, /t\("noteImageRemove"\)/);
  // 点击缩略图打开灯箱；拖动排序结束后补发的 click 必须被吃掉，不能自动放大。
  assert.match(source, /if \(imageDragSuppressClickRef\.current\) \{ imageDragSuppressClickRef\.current = false; return; \}/);
  assert.match(source, /imageDragSuppressClickRef\.current = imageDragMovedRef\.current;/);
  assert.match(source, /Math\.abs\(moveEvent\.clientX - startX\) > 3\) imageDragMovedRef\.current = true;/);
  // 灯箱：portal 到 body、role=dialog + aria-modal、Esc / 遮罩关闭
  const lightboxStart = source.indexOf("function NoteImageLightbox(");
  const lightbox = source.slice(lightboxStart, lightboxStart + 2600);
  assert.match(lightbox, /react_dom\.createPortal\(lightbox, document\.body\)/);
  assert.match(lightbox, /role: "dialog",\n\t+"aria-modal": "true"/);
  assert.match(lightbox, /"aria-modal": "true"/);
  assert.match(lightbox, /event\.key === "Escape"/);
  assert.match(lightbox, /onClick: props\.onClose/);
});

test("只有图片没有文字时，「清空」与「添加至聊天」都保持可用", () => {
  // 置灰条件同时看文字与图片
  assert.match(source, /disabled: note\.text === "" && images\.length === 0,\s*\n\s*"aria-label": t\(clearConfirming/);
  assert.match(source, /disabled: note\.text === "" && images\.length === 0,\s*\n\s*onClick: \(\) => \{ void onAddToChat\(\); \}/);
});
