// dsh-awesome-hud — v0.21.0：便笺内容编辑弹窗（设置开关 / 打开方式 / 布局 / 关闭与保存）
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { clientSource as source, extractFunction, extractConst } from './helpers/client-harness.mjs';

const cls = (node) => node?.props?.className;
const byClass = (node, name) => nodes(node).filter((child) => typeof cls(child) === 'string' && cls(child).split(' ').includes(name));
const textOf = (node) => (typeof node === 'string' ? node : (node?.children ?? []).flat(Infinity).map(textOf).join(''));
function nodes(root) {
  const out = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    // 函数组件就地展开（便于断言弹窗外壳等由组件渲染出来的结构）。
    if (typeof node.type === 'function') { walk(node.type({ ...node.props, children: node.children })); return; }
    out.push(node);
    walk(node.children ?? []);
  };
  walk(root);
  return out;
}

const NOTE = { id: 'n1', title: '便笺1', text: '第一条', updatedAt: 1 };

/**
 * 便笺模块运行时：state / ref 槽位跨重渲染保留，便于真实走一遍
 * 「点便笺条 → 弹窗打开 → 改标题 → 关闭」。
 */
function loadNoteUi(options = {}) {
  const states = [];
  const refs = [];
  const effects = [];
  const toasts = [];
  let stateCursor = 0;
  let refCursor = 0;
  const storage = new Map(Object.entries(options.storage ?? {}));
  const local = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const url = options.url ?? { createObjectURL: () => 'blob:note', revokeObjectURL() {} };
  const dictionary = {
    noteDefaultTitle: '便笺{count}', noteUntitled: '未命名便笺', noteEmpty: '还没有便笺，点「添加便笺」新建。',
    noteAdd: '添加便笺', noteCreateFromChat: '从聊天创建', noteDeleteAll: '删除全部便笺',
    noteDeleteAllTitle: '删除全部便笺', noteDeleteAllNote: '将删除全部 {count} 条便笺及其图片，此操作不可撤销。',
    noteDeleteAllConfirm: '删除全部', noteDelete: '删除便笺', noteBack: '返回便笺列表',
    noteDrag: '拖动排序', noteTitlePlaceholder: '便笺标题', noteStorageUnavailable: '保存失败：无法写入本地存储',
    noteLimitReached: '便笺数量已达上限 {count} 条，请在 HUD 设置中调整', noteImageRemove: '移除图片',
    noteImageLimit: '便笺最多保存 {count} 张图片', noteImageStorageUnavailable: '当前环境无法持久化图片',
    noteClear: '清空', noteClearConfirm: '确认清空', noteClearFailed: '清空失败', noteImportFromChat: '从聊天导入',
    noteImportEmpty: '输入框里没有内容', noteSendToChat: '添加至聊天', noteConfirmOverwrite: '清空并写入',
    noteModule: '便笺', noteImportSkippedFiles: '跳过 {count} 个附件', noteEditDialogTitle: '编辑便笺',
    closeModal: '关闭',
  };
  const context = vm.createContext({
    globalThis: {
      localStorage: local,
      addEventListener() {},
      removeEventListener() {},
      // v0.21.0：图片存储走 globalThis.indexedDB / globalThis.URL。
      indexedDB: options.indexedDB,
      URL: url,
    },
    localStorage: local,
    Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Math, Promise, console, setTimeout, clearTimeout,
    URL: url,
    indexedDB: options.indexedDB,
    document: { body: {}, addEventListener() {}, removeEventListener() {} },
    t: (key) => dictionary[key] ?? key,
    interpolate: (template, values) => String(template).replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? '')),
    toast: (message, kind) => toasts.push({ message, kind }),
    Icon: 'Icon',
    IME_INPUT_PROPS: {},
    isImeComposing: () => false,
    Icons: {},
    useComposerHasContent: () => options.composerHasContent === true,
    readComposerForNote: async () => options.composerContent ?? { text: '', files: [], skippedFiles: 0 },
    resolveComposerTarget: () => options.targetSessionId ?? 's1',
    replaceComposerWithNote: () => {},
    migrateWorkspaceScope: () => ({ migrated: false }),
    loadJsonStorage: (key) => (storage.has(key) ? JSON.parse(storage.get(key)) : null),
  });
  context.react = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({
      type,
      props: children.length === 0 ? (props ?? {}) : { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
      children,
    }),
    useState(init) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof init === 'function' ? init() : init;
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef(value) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    useEffect(effect) { effects.push(effect); },
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
  };
  context.react_dom = { createPortal: (node) => node };
  vm.runInContext(`
    const NOTES_STORAGE_KEY = 'dsh-awesome-hud:notes';
    const NOTE_STORAGE_VERSION = 4;
    const NOTE_DEFAULT_HEIGHT = 180;
    const NOTE_CHANGE_EVENT = 'dsh-awesome-hud:note-change';
    const NOTE_MAX_IMAGES = 20;
    const NOTE_IMAGE_DB = 'dsh-awesome-hud';
    const NOTE_IMAGE_STORE = 'noteImages';
    const NOTE_CLEAR_CONFIRM_MS = 2000;
    const NOTE_COUNT_MIN = 5;
    const NOTE_COUNT_MAX = 20;
    const NOTE_COUNT_DEFAULT = 5;
    // v0.21.0：弹窗固定高度。
    const NOTE_DIALOG_AREA_HEIGHT = 240;
    function normalizeNoteMaxCount(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(NOTE_COUNT_MAX, Math.max(NOTE_COUNT_MIN, Math.round(number))) : NOTE_COUNT_DEFAULT;
    }
    ${extractFunction('defaultNoteTitle')}
    ${extractFunction('newNoteId')}
    ${extractFunction('nextNoteNumber')}
    ${extractFunction('normalizeNoteDocument')}
    ${extractFunction('readNoteDocument')}
    ${extractFunction('initialNoteDocument')}
    ${extractFunction('persistNoteDocument')}
    ${extractFunction('noteScope')}
    ${extractFunction('publishNoteChange')}
    ${extractFunction('noteClearAction')}
    ${extractFunction('noteImageAcceptable')}
    ${extractFunction('notePasteImageFiles')}
    ${extractFunction('noteMergeImages')}
    const noteImageMemory = new Map();
    let noteImageDbPromise = null;
    ${extractFunction('openNoteImageDb')}
    ${extractFunction('noteImageRequest')}
    async ${extractFunction('readNoteImageValue')}
    async ${extractFunction('writeNoteImageMap')}
    async ${extractFunction('deleteNoteImages')}
    ${extractFunction('hydrateNoteImages')}
    ${extractFunction('dehydrateNoteImages')}
    ${extractFunction('releaseNoteImage')}
    ${extractFunction('sameOrder')}
    ${extractFunction('dropIndexAt')}
    ${extractFunction('previewModuleOrder')}
    ${extractFunction('previewOffsets')}
    ${extractFunction('suppressNativeDragImage')}
    ${extractFunction('ModuleHead')}
    ${extractFunction('useOverlayDismiss')}
    ${extractFunction('NoteConfirmDialog')}
    ${extractFunction('NoteImageLightbox')}
    ${extractFunction('NoteEditorDialog')}
    ${extractFunction('NoteModule')}
    this.NoteModule = NoteModule;
  `, context);
  const render = (props = {}) => {
    stateCursor = 0;
    refCursor = 0;
    effects.length = 0;
    return context.NoteModule({
      sessionId: 's1', workspaceKey: '/tmp/w', workspaceCandidates: [], sendSessionId: 's1', noteMaxCount: 5,
      notePopupEdit: false, fold: false, onFold() {}, ...props,
    });
  };
  const flush = () => { for (const effect of effects.splice(0)) { const cleanup = effect(); if (typeof cleanup === 'function') cleanup(); } };
  // 只执行 effect、保留 cleanup：用于验证异步图片读取完成前的竞态（图片被清空）。
  const runEffects = () => { for (const effect of effects.splice(0)) effect(); };
  return { render, flush, runEffects, toasts, storage };
}

const storageWithNote = () => ({
  'dsh-awesome-hud:notes': JSON.stringify({
    '/tmp/w': { v: 4, height: 180, notes: [{ ...NOTE, updatedAt: 1 }] },
  }),
});

const clickTitle = (tree, index = 0) => {
  const title = byClass(tree, 'hud-note-bar-title')[index];
  assert.ok(title, '应渲染便笺条标题');
  title.props.onClick({ stopPropagation() {} });
};
const readNotes = (storage) => JSON.parse(storage.get('dsh-awesome-hud:notes'))['/tmp/w'].notes;

test('默认关闭：点击便笺条在模块内打开编辑视图，不出现弹窗', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render();
  assert.equal(byClass(tree, 'hud-note-editor').length, 0);
  clickTitle(tree);
  tree = ui.render();
  assert.equal(byClass(tree, 'hud-note-editor').length, 1, '模块内编辑视图');
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 0, '默认不弹窗');
  assert.equal(byClass(tree, 'hud-note-back').length, 1);
});

test('开启后：点击便笺条打开弹窗，便笺模块保持列表视图', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render({ notePopupEdit: true });
  clickTitle(tree);
  tree = ui.render({ notePopupEdit: true });

  const modal = byClass(tree, 'hud-note-editor-modal');
  assert.equal(modal.length, 1, '应打开便笺编辑弹窗');
  assert.equal(modal[0].props.role, 'dialog');
  assert.equal(modal[0].props['aria-modal'], 'true');
  const card = byClass(tree, 'hud-note-editor-card');
  assert.equal(card.length, 1);
  assert.equal(textOf(byClass(tree, 'hud-modal-title')[0]), '编辑便笺');
  // 模块仍是列表视图：便笺条还在，内联编辑视图与返回按钮都不出现。
  assert.equal(byClass(tree, 'hud-note-bar').length, 1);
  assert.equal(byClass(tree, 'hud-note-list').length, 1);
  assert.equal(byClass(tree, 'hud-note-editor').length, 0);
  assert.equal(byClass(tree, 'hud-note-back').length, 0);
  // 弹窗正文：标题输入 + 固定高度正文 + 三个动作按钮；无拖动柄。
  assert.equal(byClass(tree, 'hud-note-title-input').length, 1);
  const area = byClass(tree, 'hud-note-area')[0];
  assert.equal(area.props.value, '第一条');
  assert.deepEqual(JSON.parse(JSON.stringify(area.props.style)), { height: '240px' });
  assert.equal(byClass(tree, 'hud-note-area-fixed').length, 1);
  assert.equal(byClass(tree, 'hud-note-resize').length, 0, '弹窗内不显示高度拖动柄');
  const buttons = nodes(byClass(tree, 'hud-note-buttons')[0]).filter((node) => node.type === 'button');
  assert.deepEqual(buttons.map(textOf), ['清空', '从聊天导入', '添加至聊天']);
});

test('弹窗编辑：标题与正文输入即时写回存储', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render({ notePopupEdit: true });
  clickTitle(tree);
  tree = ui.render({ notePopupEdit: true });
  byClass(tree, 'hud-note-title-input')[0].props.onChange({ target: { value: '新标题' } });
  tree = ui.render({ notePopupEdit: true });
  byClass(tree, 'hud-note-area')[0].props.onChange({ target: { value: '新内容' } });
  const notes = readNotes(ui.storage);
  assert.equal(notes[0].title, '新标题');
  assert.equal(notes[0].text, '新内容');
});

test('关闭按钮与点击弹窗外侧都能关闭；关闭后仍停在列表视图', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render({ notePopupEdit: true });
  clickTitle(tree);
  tree = ui.render({ notePopupEdit: true });
  // 关闭按钮。
  const close = byClass(tree, 'hud-modal-close')[0];
  assert.ok(close, '右上角应有关闭按钮');
  close.props.onClick();
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 0);
  assert.equal(byClass(tree, 'hud-note-list').length, 1);

  // 点击遮罩（弹窗外侧）。v0.21.1：必须在遮罩上按下并在遮罩上松开才关闭。
  clickTitle(tree);
  tree = ui.render({ notePopupEdit: true });
  const modal = byClass(tree, 'hud-note-editor-modal')[0];
  const overlay = {};
  modal.props.onPointerDown({ target: overlay, currentTarget: overlay });
  modal.props.onPointerUp({ target: overlay, currentTarget: overlay });
  modal.props.onClick({ target: overlay, currentTarget: overlay });
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 0);
  assert.equal(byClass(tree, 'hud-note-list').length, 1);
});

test('关闭弹窗时标题为空自动补「便笺n」', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render({ notePopupEdit: true });
  clickTitle(tree);
  tree = ui.render({ notePopupEdit: true });
  byClass(tree, 'hud-note-title-input')[0].props.onChange({ target: { value: '  ' } });
  tree = ui.render({ notePopupEdit: true });
  byClass(tree, 'hud-modal-close')[0].props.onClick();
  ui.render({ notePopupEdit: true });
  assert.equal(readNotes(ui.storage)[0].title, '便笺1');
});

test('新建路径：添加便笺与从聊天创建都直接打开弹窗', async () => {
  const ui = loadNoteUi({
    storage: storageWithNote(),
    composerHasContent: true,
    composerContent: { text: '聊天内容', files: [], skippedFiles: 0 },
  });
  let tree = ui.render({ notePopupEdit: true });
  const add = nodes(tree).find((node) => node.type === 'button' && textOf(node) === '添加便笺');
  add.props.onClick();
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 1, '添加便笺后直接弹窗');
  assert.equal(byClass(tree, 'hud-note-bar').length, 2);

  // 关闭后走「从聊天创建」。
  byClass(tree, 'hud-modal-close')[0].props.onClick();
  tree = ui.render({ notePopupEdit: true });
  const fromChat = nodes(tree).find((node) => node.type === 'button' && textOf(node) === '从聊天创建');
  fromChat.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 1, '从聊天创建后直接弹窗');
  const area = byClass(tree, 'hud-note-area')[0];
  assert.equal(area.props.value, '聊天内容');
});


/**
 * 复现“IndexedDB 读早于写”的假库：get 始终返回旧工作区记录（不含新便笺），
 * put 只记录。修复前，新建便笺的图片加载 effect 会读到空记录并把图片清空。
 */
function staleImageDb() {
  const puts = [];
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction: () => ({
      onabort: null,
      objectStore: () => ({
        get: (key) => request({ key, updatedAt: 1, images: {} }),
        put: (record) => { puts.push(record); return request(record.key); },
        delete: () => request(true),
      }),
    }),
  };
  return {
    puts,
    open() {
      const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const composerWithImage = () => ({
  storage: storageWithNote(),
  composerHasContent: true,
  composerContent: { text: '聊天内容', files: [{ type: 'image/png', name: 'a.png', size: 1024 }], skippedFiles: 0 },
  indexedDB: staleImageDb(),
});
const clickCreateFromChat = (tree) => {
  const button = nodes(tree).find((node) => node.type === 'button' && textOf(node) === '从聊天创建');
  assert.ok(button, '应有「从聊天创建」按钮');
  button.props.onClick();
};

test('弹窗中的便笺被删除、或开关被关闭时，弹窗自动收起', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render({ notePopupEdit: true });
  clickTitle(tree);
  tree = ui.render({ notePopupEdit: true });
  // 删除按钮 → 行内二次确认 → 确认。
  const bar = byClass(tree, 'hud-note-bar')[0];
  const actions = byClass(bar, 'hud-note-bar-actions')[0];
  const trash = actions.children.find((node) => node.type === 'button');
  trash.props.onClick();
  tree = ui.render({ notePopupEdit: true });
  const confirmBar = byClass(tree, 'hud-note-bar')[0];
  const confirmButtons = byClass(confirmBar, 'hud-note-bar-actions')[0].children
    .flatMap((node) => (node.type === 'fragment' ? node.children : [node]))
    .filter((node) => node.type === 'button');
  confirmButtons[1].props.onClick();
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 0, '被删除的便笺关闭弹窗');

  // 重新打开一条便笺后关闭设置开关（props 变为 false）。
  const ui2 = loadNoteUi({ storage: storageWithNote() });
  let t2 = ui2.render({ notePopupEdit: true });
  clickTitle(t2);
  t2 = ui2.render({ notePopupEdit: true });
  assert.equal(byClass(t2, 'hud-note-editor-modal').length, 1);
  t2 = ui2.render({ notePopupEdit: false });
  ui2.flush();
  t2 = ui2.render({ notePopupEdit: false });
  assert.equal(byClass(t2, 'hud-note-editor-modal').length, 0, '开关关闭后回到列表');
  assert.equal(byClass(t2, 'hud-note-list').length, 1);
});

test('整条便笺可点：拖动条与操作按钮不触发打开', () => {
  const ui = loadNoteUi({ storage: storageWithNote() });
  let tree = ui.render({ notePopupEdit: true });
  const bar = byClass(tree, 'hud-note-bar')[0];
  // 点在拖动条上：不打开。
  bar.props.onClick({ target: { closest: (selector) => (selector === '.hud-note-grip' ? { selector } : null) } });
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 0);
  // 点在标题空白区（不命中拖动条与操作区）：打开。
  bar.props.onClick({ target: { closest: () => null } });
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 1);
});

test('从聊天创建：弹窗中的图片不会被异步图片加载清空', async () => {
  const ui = loadNoteUi(composerWithImage());
  let tree = ui.render({ notePopupEdit: true });
  clickCreateFromChat(tree);
  await tick();
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-editor-modal').length, 1, '应打开弹窗');
  assert.equal(byClass(tree, 'hud-note-thumb').length, 1, '创建后先展示内存图片');
  // 执行图片加载 effect：修复前会读到旧记录并把图片清空。
  ui.runEffects();
  await tick();
  tree = ui.render({ notePopupEdit: true });
  assert.equal(byClass(tree, 'hud-note-thumb').length, 1, '图片不能被加载 effect 清空');
  assert.equal(byClass(tree, 'hud-note-area')[0].props.value, '聊天内容');
});

test('从聊天创建：内联编辑视图同样保留图片', async () => {
  const ui = loadNoteUi(composerWithImage());
  let tree = ui.render();
  clickCreateFromChat(tree);
  await tick();
  tree = ui.render();
  assert.equal(byClass(tree, 'hud-note-editor').length, 1, '应打开内联编辑视图');
  assert.equal(byClass(tree, 'hud-note-thumb').length, 1);
  ui.runEffects();
  await tick();
  tree = ui.render();
  assert.equal(byClass(tree, 'hud-note-thumb').length, 1, '内联视图的图片同样不能被清空');
});

test('源码接线：新建便笺在打开编辑视图前交接内存图片', () => {
  assert.match(source, /const pendingImagesRef = react\.useRef\(null\);/);
  assert.match(source, /pendingImagesRef\.current = \{ noteId: note\.id, images: fresh \};/);
  assert.match(source, /if \(pending !== null && pending\.noteId === noteId\) \{/);
  assert.match(source, /if \(prev !== pending\.images\) releaseImages\(prev\);/);
});

test('源码接线：设置项、NoteModule prop、固定高度样式与「无 Esc」约定', () => {
  assert.match(source, /settingsNotePopup: "在弹窗页面中进行便笺内容编辑",/);
  assert.match(source, /settingsNotePopup: "Edit note content in a dialog",/);
  assert.match(source, /const popupEdit = props\.notePopupEdit === true;/);
  assert.match(source, /notePopupEdit: normalizeNoteSettings\(noteSettings\)\.popupEdit,/);
  assert.match(source, /function NoteEditorDialog\(props\) \{/);
  assert.match(source, /className: "hud-modal hud-note-editor-modal",/);
  assert.match(source, /\.hud-note-editor-card\{width:min\(560px,calc\(100vw - 40px\)\)\}/);
  assert.match(source, /\.hud-note-area-fixed\{height:240px;max-height:50vh\}/);
  assert.match(source, /const NOTE_DIALOG_AREA_HEIGHT = 240;/);
  // 弹窗外壳不绑定 Esc（按约定仅关闭按钮与点击外侧）。
  const dialogStart = source.indexOf('function NoteEditorDialog(props) {');
  const dialogBody = source.slice(dialogStart, source.indexOf('function NoteModule(props) {', dialogStart));
  assert.doesNotMatch(dialogBody, /"Escape"/);
  // 弹窗关闭时补名（与内联关闭一致）。
  const closeStart = source.indexOf('const closePopup = () => {');
  assert.match(source.slice(closeStart, closeStart + 600), /assignAutoTitle\(note\.id\)/);
});
