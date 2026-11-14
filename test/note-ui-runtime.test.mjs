// dsh-awesome-hud — v0.20.0 便笺模块渲染：列表视图 / 编辑视图（状态化 hooks 运行时）
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { clientSource as source, extractFunction, extractConst, nodes } from './helpers/client-harness.mjs';

const cls = (node) => node?.props?.className;
const byClass = (node, name) => nodes(node).filter((child) => typeof cls(child) === 'string' && cls(child) === name);
const textOf = (node) => (typeof node === 'string' ? node : (node?.children ?? []).flat(Infinity).map(textOf).join(''));

/** 便笺模块的渲染运行时：hooks 槽位跨重渲染保留，setState 后由测试手动重渲染。 */
function loadNoteUi(options = {}) {
  const states = [];
  const refs = [];
  const effects = [];
  let stateCursor = 0;
  let refCursor = 0;
  const toasts = [];
  const storage = new Map(Object.entries(options.storage ?? {}));
  const dictionary = {
    noteDefaultTitle: '便笺{count}', noteUntitled: '未命名便笺', noteEmpty: '还没有便笺，点「添加便笺」新建。',
    noteAdd: '添加便笺', noteCreateFromChat: '从聊天创建', noteDeleteAll: '删除全部便笺',
    noteDeleteAllTitle: '删除全部便笺', noteDeleteAllNote: '将删除全部 {count} 条便笺及其图片，此操作不可撤销。',
    noteDeleteAllConfirm: '删除全部', noteDeleteTitle: '删除便笺', noteDeleteNote: '将删除「{title}」及其图片，此操作不可撤销。',
    noteDeleteConfirm: '删除', noteDelete: '删除便笺', noteEdit: '编辑便笺', noteBack: '返回便笺列表',
    noteDrag: '拖动排序', noteTitlePlaceholder: '便笺标题', noteStorageUnavailable: '保存失败：无法写入本地存储',
    noteLimitReached: '便笺数量已达上限 {count} 条，请在 HUD 设置中调整', noteImageRemove: '移除图片',
    noteImageLimit: '便笺最多保存 {count} 张图片', noteImageStorageUnavailable: '当前环境无法持久化图片',
    noteClear: '清空', noteClearConfirm: '确认清空', noteClearFailed: '清空失败', noteImportFromChat: '从聊天导入',
    noteImportEmpty: '输入框里没有内容', noteSendToChat: '添加至聊天', noteConfirmOverwrite: '清空并写入',
    noteModule: '便笺', noteImportSkippedFiles: '跳过 {count} 个附件',
  };
  const context = vm.createContext({
    globalThis: { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) }, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Math, Promise, console, setTimeout, clearTimeout,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    indexedDB: undefined,
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
    ${extractFunction('NoteConfirmDialog')}
    ${extractFunction('NoteImageLightbox')}
    ${extractFunction('NoteModule')}
    this.NoteModule = NoteModule;
  `, context);
  const render = (props = {}, presets) => {
    stateCursor = 0;
    refCursor = 0;
    effects.length = 0;
    if (presets !== undefined) {
      for (let index = 0; index < presets.length; index += 1) states[index] = presets[index];
    }
    return context.NoteModule({
      sessionId: 's1', workspaceKey: '/tmp/w', workspaceCandidates: [], sendSessionId: 's1', noteMaxCount: 5,
      fold: false, onFold() {}, ...props,
    });
  };
  const flush = () => { for (const effect of effects.splice(0)) { const cleanup = effect(); if (typeof cleanup === 'function') cleanup(); } };
  return { render, flush, toasts, states, storage };
}

test('列表视图：空态文案 + 两个半宽按钮 + 删除全部（空时置灰）', () => {
  const ui = loadNoteUi({ storage: { 'dsh-awesome-hud:notes': JSON.stringify({}) } });
  const tree = ui.render();
  assert.equal(byClass(tree, 'hud-note-empty').length, 1);
  const row = byClass(tree, 'hud-note-list-actions')[0];
  assert.equal(row.children.filter((child) => child.type === 'button').length, 2);
  const deleteAll = nodes(tree).find((node) => typeof cls(node) === 'string' && cls(node).includes('hud-note-delete-all'));
  assert.equal(deleteAll.props.disabled, true);
});

test('列表视图：已有便笺渲染便笺条（拖动条 / 标题 / 编辑与删除按钮）', () => {
  const storage = {
    'dsh-awesome-hud:notes': JSON.stringify({
      '/tmp/w': { v: 4, height: 180, notes: [{ id: 'n1', title: '便笺1', text: '第一条', updatedAt: 1 }] },
    }),
  };
  const ui = loadNoteUi({ storage });
  const tree = ui.render();
  const bar = byClass(tree, 'hud-note-bar')[0];
  assert.ok(bar, '应渲染便笺条');
  assert.equal(byClass(bar, 'hud-note-grip').length, 1);
  assert.equal(textOf(byClass(bar, 'hud-note-bar-title')[0]), '便笺1');
  const actions = byClass(bar, 'hud-note-bar-actions')[0];
  const buttons = actions.children.filter((child) => child.type === 'button');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props['aria-label'], '编辑便笺');
  assert.equal(buttons[1].props['aria-label'], '删除便笺');
});

test('编辑视图：返回 + 可编辑标题 + 图片区 + 共用高度 + 三个动作按钮', () => {
  const note = { id: 'n1', title: '便笺1', text: '第一条', updatedAt: 1 };
  const storage = { 'dsh-awesome-hud:notes': JSON.stringify({ '/tmp/w': { v: 4, height: 220, notes: [note] } }) };
  const ui = loadNoteUi({ storage });
  const doc = { notes: [note], height: 220, legacy: false };
  const tree = ui.render({}, [doc, { noteId: 'n1' }, []]);
  assert.equal(byClass(tree, 'hud-note-back').length, 1);
  const title = byClass(tree, 'hud-note-title-input')[0];
  assert.equal(title.props.value, '便笺1');
  const area = byClass(tree, 'hud-note-area')[0];
  assert.equal(area.props.value, '第一条');
  assert.equal(area.props.style.height, '220px');
  const buttons = nodes(byClass(tree, 'hud-note-buttons')[0]).filter((node) => node.type === 'button');
  assert.equal(buttons.length, 3);
  assert.equal(textOf(buttons[0]), '清空');
  assert.equal(textOf(buttons[1]), '从聊天导入');
  assert.equal(textOf(buttons[2]), '添加至聊天');
});

test('编辑视图：标题与正文输入即保存（写回 localStorage 的对应便笺）', () => {
  const note = { id: 'n1', title: '便笺1', text: '旧', updatedAt: 1 };
  const storage = { 'dsh-awesome-hud:notes': JSON.stringify({ '/tmp/w': { v: 4, height: 180, notes: [note] } }) };
  const ui = loadNoteUi({ storage });
  const doc = { notes: [note], height: 180, legacy: false };
  let tree = ui.render({}, [doc, { noteId: 'n1' }, []]);
  byClass(tree, 'hud-note-title-input')[0].props.onChange({ target: { value: '新标题' } });
  tree = ui.render();
  byClass(tree, 'hud-note-area')[0].props.onChange({ target: { value: '新正文' } });
  ui.flush();
  const stored = JSON.parse(ui.storage.get('dsh-awesome-hud:notes'));
  assert.equal(stored['/tmp/w'].notes[0].title, '新标题');
  assert.equal(stored['/tmp/w'].notes[0].text, '新正文');
});

test('列表视图：删除单条走确认弹窗（danger 按钮），取消不删除', () => {
  const note = { id: 'n1', title: '便笺1', text: 'x', updatedAt: 1 };
  const storage = { 'dsh-awesome-hud:notes': JSON.stringify({ '/tmp/w': { v: 4, height: 180, notes: [note] } }) };
  const ui = loadNoteUi({ storage });
  let tree = ui.render({}, [{ notes: [note], height: 180, legacy: false }, null, []]);
  const bar = byClass(tree, 'hud-note-bar')[0];
  const deleteButton = byClass(bar, 'hud-note-bar-actions')[0].children.filter((child) => child.type === 'button')[1];
  deleteButton.props.onClick();
  tree = ui.render();
  // 弹窗：NoteConfirmDialog（danger 变体）+ 取消按钮
  const dialog = nodes(tree).find((node) => node?.type?.name === 'NoteConfirmDialog');
  assert.ok(dialog, '应弹出确认弹窗');
  assert.equal(dialog.props.danger, true);
  const dialogTree = dialog.type(dialog.props);
  const cancel = nodes(dialogTree).find((node) => node.type === 'button' && node.props?.['data-kind'] === 'cancel');
  assert.ok(cancel, '弹窗应有取消按钮');
  cancel.props.onClick();
  ui.flush();
  const stored = JSON.parse(ui.storage.get('dsh-awesome-hud:notes'));
  assert.equal(stored['/tmp/w'].notes.length, 1, '取消后便笺仍在');
});

test('编辑视图：标题清空后失焦自动补「便笺n」，编号取现有最大编号 + 1', () => {
  const first = { id: 'n1', title: '便笺1', text: 'a', updatedAt: 1 };
  const second = { id: 'n2', title: '便笺4', text: 'b', updatedAt: 2 };
  const storage = { 'dsh-awesome-hud:notes': JSON.stringify({ '/tmp/w': { v: 4, height: 180, notes: [first, second] } }) };
  const ui = loadNoteUi({ storage });
  let tree = ui.render({}, [{ notes: [first, second], height: 180, legacy: false }, { noteId: 'n1' }, []]);
  const title = byClass(tree, 'hud-note-title-input')[0];
  title.props.onChange({ target: { value: '' } });
  tree = ui.render();
  byClass(tree, 'hud-note-title-input')[0].props.onBlur();
  ui.flush();
  const stored = JSON.parse(ui.storage.get('dsh-awesome-hud:notes'));
  assert.equal(stored['/tmp/w'].notes[0].title, '便笺5', '应取现有最大值 4 再加 1');
});
