// dsh-awesome-hud — v0.19.0「便笺 ↔ 会话输入框」双向搬运
//  1) 添加到聊天 = 两段式：先清空输入框（setDraft("") + 逐个移除并释放旧附件），再写入便笺文字与图片
//  2) 输入框非空才弹确认；空输入框直接写入
//  3) 从聊天导入 = 先清空便笺（文字 + 图片 + IndexedDB 记录），再写入输入框内容；非图片附件跳过并提示
//  4) 失败/降级路径（无目标会话、发送中、清空失败、宿主不支持图片）都要有明确提示
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { hudClient, nodes, extractFunction, clientSource as source } from "./helpers/client-harness.mjs";

const cls = (node) => node?.props?.className;
const byClass = (node, name) => nodes(node).filter((child) => cls(child) === name);

/** 一个可观察的会话输入框假实现（覆盖 setDraft / 附件增删 / 快照）。 */
function fakeComposer(initial = { draft: "", attachmentIds: [] }) {
  const state = {
    draft: initial.draft,
    attachmentIds: [...initial.attachmentIds],
    phase: initial.phase ?? "plain",
  };
  const log = [];
  const released = [];
  const input = {
    state: { getSnapshot: () => ({ ...state, attachmentIds: [...state.attachmentIds] }) },
    // 真实宿主里 setDraft 只改编辑区文字，不动草稿附件列表（附件由 removeAttachment 单独移除）。
    setDraft(text) { log.push(["setDraft", text]); state.draft = text; },
    addAttachments(ids) { log.push(["addAttachments", [...ids]]); state.attachmentIds = [...state.attachmentIds, ...ids]; return state.phase === "plain"; },
    removeAttachment(id) { log.push(["removeAttachment", id]); state.attachmentIds = state.attachmentIds.filter((item) => item !== id); return true; },
    focus() { log.push(["focus"]); },
  };
  const conversation = {
    input: { for: () => input },
    resolveDraftAttachments: (ids) => ids.map((id) => ({ id, kind: "image", file: { name: `${id}.png`, type: "image/png" } })),
    releaseDraftAttachments: (drafts) => { released.push(...drafts.map((draft) => draft.id)); },
    createDrafts: (sessionId, files, uploadImages) => {
      log.push(["createDrafts", sessionId, files.length, uploadImages]);
      return files.map((file, index) => ({ id: `draft-${index + 1}`, kind: "image", file }));
    },
  };
  return { state, log, released, input, conversation };
}

/** 抽取 async 函数：extractFunction 的切片从 `function` 开始，会丢掉前面的 `async`。 */
function extractAsync(name) {
  const body = extractFunction(name);
  const start = source.indexOf(`function ${name}(`);
  const isAsync = source.slice(Math.max(0, start - 6), start) === "async ";
  return isAsync ? `async ${body}` : body;
}

/** 抽取 replaceComposerWithNote 到沙箱里执行（真实实现，非替代）。 */
function loadTransfer(composer) {
  const context = vm.createContext({
    ctx: {
      get: (name) => {
        if (name === "conversation") return composer.conversation;
        if (name === "sessions") return { scope: () => ({ id: "scope" }), binding: () => ({ session: { getSnapshot: () => ({ subagent: null }) } }) };
        if (name === "uiWorkspace") return {};
        return undefined;
      },
    },
    globalThis: { setTimeout, File: class FakeFile { constructor(parts, name, opts) { this.name = name; this.type = opts?.type; } } },
    File: class FakeFile { constructor(parts, name, opts) { this.name = name; this.type = opts?.type; } },
    Promise,
  });
  vm.runInContext(
    `${extractFunction("composerBusyPhase")}\n${extractAsync("resolveComposerTarget")}\n${extractFunction("noteImageFile")}\n${extractFunction("clearComposerDraft")}\n${extractFunction("writeComposerDraft")}\n${extractAsync("replaceComposerWithNote")}\n${extractAsync("readComposerForNote")}`,
    context,
  );
  return context;
}

const images = [
  { id: "a", type: "image/png", name: "a.png", blob: { b: 1 } },
  { id: "b", type: "image/jpeg", name: "b.jpg", blob: { b: 2 } },
  { id: "c", type: "image/png", name: "c.png", blob: { b: 3 } },
];

test("添加到聊天：先清空旧文字/附件并释放，再按便笺顺序写入", async () => {
  const composer = fakeComposer({ draft: "old text", attachmentIds: ["old-1", "old-2"] });
  const context = loadTransfer(composer);
  const result = await context.replaceComposerWithNote("s1", "note text", images);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, images: 3 });
  // 顺序契约：setDraft("") 清文字 → removeAttachment ×2 → createDrafts → addAttachments → focus
  assert.deepEqual(composer.log.map((entry) => entry[0]), [
    "setDraft", "removeAttachment", "removeAttachment", "setDraft", "createDrafts", "addAttachments", "focus",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(composer.log[0])), ["setDraft", ""], "第一步必须是把输入框清空");
  assert.deepEqual(JSON.parse(JSON.stringify(composer.log[3])), ["setDraft", "note text"], "旧内容清掉后才写入便笺文字");
  // 旧附件必须释放，避免 blob URL 泄漏
  assert.deepEqual(composer.released, ["old-1", "old-2"]);
  // 新附件按便笺顺序
  assert.deepEqual(JSON.parse(JSON.stringify(composer.log[5][1])), ["draft-1", "draft-2", "draft-3"]);
  // createDrafts 拿到的是 File，且普通会话允许上传图片
  assert.deepEqual(composer.log[4].slice(1), ["s1", 3, true]);
  // 最终输入框里只剩便笺内容，旧图片没有残留
  assert.equal(composer.state.draft, "note text");
  assert.deepEqual(composer.state.attachmentIds, ["draft-1", "draft-2", "draft-3"]);
});

test("添加到聊天：便笺没有图片时只写文字，旧的图片同样会被移除并释放", async () => {
  const composer = fakeComposer({ draft: "old text", attachmentIds: ["old-1"] });
  const context = loadTransfer(composer);
  const result = await context.replaceComposerWithNote("s1", "only text", []);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, images: 0 });
  assert.deepEqual(composer.log.map((entry) => entry[0]), ["setDraft", "removeAttachment", "setDraft", "focus"]);
  assert.deepEqual(composer.released, ["old-1"]);
  assert.equal(composer.state.draft, "only text");
  assert.deepEqual(composer.state.attachmentIds, []);
});

test("添加到聊天：便笺只有图片时，旧文字同样先被清空", async () => {
  const composer = fakeComposer({ draft: "old text", attachmentIds: [] });
  const context = loadTransfer(composer);
  const result = await context.replaceComposerWithNote("s1", "", images);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, images: 3 });
  assert.deepEqual(composer.log.map((entry) => entry[0]), ["setDraft", "setDraft", "createDrafts", "addAttachments", "focus"]);
  assert.deepEqual(JSON.parse(JSON.stringify(composer.log[1])), ["setDraft", ""]);
  assert.equal(composer.state.draft, "");
  assert.deepEqual(composer.state.attachmentIds, ["draft-1", "draft-2", "draft-3"]);
});

test("添加到聊天：发送中/裁决中的会话直接拒绝，不改写输入框", async () => {
  for (const phase of ["adjudicating", "submitting", "sending"]) {
    const composer = fakeComposer({ draft: "keep", attachmentIds: ["keep-1"], phase });
    const context = loadTransfer(composer);
    const result = await context.replaceComposerWithNote("s1", "note", images);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "busy");
    assert.deepEqual(composer.log, [], `phase=${phase} 不应发生任何写入`);
    assert.equal(composer.state.draft, "keep");
  }
});

test("添加到聊天：宿主不支持图片通道时退回纯文字（不静默丢图片）", async () => {
  const composer = fakeComposer();
  delete composer.conversation.createDrafts;
  const context = loadTransfer(composer);
  const result = await context.replaceComposerWithNote("s1", "text", images);
  assert.equal(result.ok, true);
  assert.equal(result.images, 0);
  assert.equal(result.reason, "images-unsupported");
  assert.deepEqual(composer.log.map((entry) => entry[0]), ["setDraft", "setDraft", "focus"]);
  // 提示文案必须存在（中英各一条）
  assert.match(source, /noteImageUnavailable: "当前 DSH 版本不支持把图片加入输入框，已只写入文字"/);
  assert.match(source, /noteImageUnavailable: "This DSH version cannot add images to the input; only the text was written"/);
});

test("添加到聊天：addAttachments 被拒时释放已创建的草稿", async () => {
  const composer = fakeComposer({ draft: "", attachmentIds: [], phase: "plain" });
  composer.input.addAttachments = () => false;
  const context = loadTransfer(composer);
  const result = await context.replaceComposerWithNote("s1", "text", images);
  assert.equal(result.images, 0);
  assert.equal(result.reason, "attachments-rejected");
  assert.deepEqual(composer.released, ["draft-1", "draft-2", "draft-3"]);
});

test("添加到聊天：清空阶段失败就中止，不写入便笺内容", async () => {
  const composer = fakeComposer({ draft: "keep", attachmentIds: ["keep-1"] });
  composer.input.setDraft = () => { throw new Error("frozen"); };
  const context = loadTransfer(composer);
  const result = await context.replaceComposerWithNote("s1", "note text", images);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "clear-failed");
  assert.equal(composer.state.draft, "keep", "清空失败时旧内容保持不变");
  assert.deepEqual(composer.state.attachmentIds, ["keep-1"]);
});

test("从聊天导入：读取输入框文字与图片；非图片附件计入 skipped", async () => {
  const composer = fakeComposer({ draft: "from composer", attachmentIds: ["img-1", "file-1"] });
  composer.conversation.resolveDraftAttachments = (ids) => ids.map((id) => (id === "file-1"
    ? { id, kind: "file", file: { name: "doc.pdf", type: "application/pdf" } }
    : { id, kind: "image", file: { name: "shot.png", type: "image/png" } }));
  const context = loadTransfer(composer);
  const content = await context.readComposerForNote("s1");
  assert.equal(content.text, "from composer");
  assert.equal(content.files.length, 1);
  assert.equal(content.files[0].type, "image/png");
  assert.equal(content.skippedFiles, 1, "非图片附件跳过并计数");
});

test("从聊天导入：先清空当前便笺（文字 + 图片），再写入输入框内容", () => {
  const importStart = source.indexOf("const runImportFromChat = async () => {");
  const body = source.slice(importStart, importStart + 3200);
  assert.match(body, /const content = await readComposerForNote\(targetSessionId\);/);
  // 源内容为空时直接返回，不清空便笺
  const emptyGuard = body.indexOf('toast(t("noteImportEmpty"))');
  const clearStart = body.indexOf("persistDoc(withNotePatch(note.id, { text: \"\" }))");
  assert.ok(emptyGuard >= 0, "源为空要提示");
  assert.ok(clearStart > emptyGuard, "空源必须在清空便笺之前返回");
  // 两段式：先清空（释放旧图片 → 写空文字 → 清掉该便笺的图片桶）→ 再写入（文字 → 图片）
  assert.match(body, /releaseImages\(imagesRef\.current\);/);
  assert.match(body, /const emptied = persistDoc\(withNotePatch\(note\.id, \{ text: \"\" \}\)\);/);
  assert.match(body, /queueImageWrite\(note\.id, \[\]\);/);
  assert.match(body, /const written = persistDoc\(withNotePatch\(note\.id, \{ text: content\.text \}\)\);/);
  assert.match(body, /setImages\(incoming\);/);
  assert.match(body, /queueImageWrite\(note\.id, incoming\);/);
  assert.match(body, /const files = content\.files\.filter\(noteImageAcceptable\)\.slice\(0, NOTE_MAX_IMAGES\);/);
  assert.match(body, /if \(content\.skippedFiles > 0\) toast\(interpolate\(t\("noteImportSkippedFiles"\), \{ count: content\.skippedFiles \}\), "warn"\);/);
  assert.match(body, /publishNoteChange\(scope\.key\);/);
  // 清空失败时不写入新内容，并提示失败
  assert.match(body, /if \(!emptied\.persisted\) \{[\s\S]{0,120}toast\(t\("noteClearFailed"\)\);/);
});

test("确认弹窗的触发条件：输入框非空才确认覆盖；便笺非空才确认导入", () => {
  const addStart = source.indexOf("const onAddToChat = async () => {");
  const addBody = source.slice(addStart, addStart + 900);
  // 输入框有文字或图片 → 弹确认；否则直接写入
  assert.match(addBody, /const busy = snapshot !== null && \(String\(snapshot\.draft \?\? ""\) !== "" \|\| \(Array\.isArray\(snapshot\.attachmentIds\) && snapshot\.attachmentIds\.length > 0\)\);/);
  assert.match(addBody, /if \(busy\) \{ setConfirm\(\{ kind: "add", noteId: note\.id \}\); return; \}/);
  assert.match(addBody, /await runAddToChat\(\);/);

  const importStart = source.indexOf("const onImportFromChat = async () => {");
  const importBody = source.slice(importStart, importStart + 700);
  assert.match(importBody, /if \(note\.text !== "" \|\| images\.length > 0\) \{ setConfirm\(\{ kind: "import", noteId: note\.id \}\); return; \}/);
  assert.match(importBody, /await runImportFromChat\(\);/);

  // 确认弹窗：标题按场景、带「先清空再写入」文案、portal 到 body
  assert.match(source, /noteAddOverwriteConfirm: "将先清空会话输入框里的文字与图片，再写入便笺内容"/);
  assert.match(source, /noteImportConfirm: "将先清空便笺里的文字与图片，再写入会话输入框的内容"/);
  assert.match(source, /noteConfirmOverwrite: "清空并写入"/);
  assert.match(source, /className: "hud-modal hud-settings-modal",\n\t+role: "dialog",\n\t+"aria-modal": "true",\n\t+"aria-label": props\.title,/);
});

test("便笺列表视图：空态、两行功能按钮与编辑视图按钮禁用条件", () => {
  const harness = hudClient({
    state: { byId: { s1: { id: "s1", cwd: "/tmp/w" } }, current: "s1" },
    current: "s1",
    storage: { "dsh-awesome-hud:open": JSON.stringify({ s1: "1" }) },
    respond: () => ({ ok: true, modules: {}, usage: {}, context: {}, order: [], panel: {}, entries: [], isRepo: true, servers: [], total: 0, enabled: 0 }),
  });
  const panel = harness.panel();
  const element = nodes(panel).find((node) => node?.type?.name === "NoteModule");
  const rendered = element.type({ ...element.props, sendSessionId: "", noteMaxCount: 5 });
  // 空列表：空文案 + 「删除全部便笺」置灰
  assert.equal(byClass(rendered, "hud-note-empty").length, 1, "空列表显示空文案");
  const deleteAll = nodes(rendered).find((node) => typeof cls(node) === "string" && cls(node).includes("hud-note-delete-all"));
  assert.equal(deleteAll.type, "button");
  assert.equal(deleteAll.props.disabled, true, "空列表时「删除全部便笺」置灰");
  // 第一行两个按钮（从聊天创建 / 添加便笺）各占一半
  const row = byClass(rendered, "hud-note-list-actions")[0];
  const buttons = row.children.filter((child) => child?.type === "button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props.disabled, true, "无目标会话时「从聊天创建」置灰");
  assert.equal(buttons[1].props.disabled, undefined, "「添加便笺」始终可用（受数量上限运行时判断）");
  // 编辑视图的按钮顺序与禁用条件（源码级：清空 → 从聊天导入 → 添加至聊天）
  const actions = source.indexOf('className: "hud-note-buttons"');
  const clear = source.indexOf('t(clearConfirming ? "noteClearConfirm" : "noteClear")', actions);
  const importFromChat = source.indexOf('t("noteImportFromChat")', actions);
  const send = source.indexOf('t("noteSendToChat")', actions);
  assert.ok(actions > 0 && clear > actions && importFromChat > clear && send > importFromChat);
  assert.match(source, /disabled: note\.text === "" && images\.length === 0/);
  assert.equal(byClass(rendered, "hud-note-count").length, 0, "底部不再有字数");
});

test("composerDraftHasContent：文字或图片任一存在即视为有内容（纯函数）", () => {
  const context = vm.createContext({});
  vm.runInContext(extractFunction("composerDraftHasContent"), context);
  const has = context.composerDraftHasContent;
  assert.equal(has(null), false);
  assert.equal(has(undefined), false);
  assert.equal(has({}), false);
  assert.equal(has({ draft: "", attachmentIds: [] }), false);
  assert.equal(has({ draft: "hi", attachmentIds: [] }), true);
  assert.equal(has({ draft: "", attachmentIds: ["a"] }), true);
  assert.equal(has({ draft: "hi", attachmentIds: ["a", "b"] }), true);
  assert.equal(has({ draft: null, attachmentIds: null }), false);
  assert.equal(has({ draft: "", attachmentIds: null }), false);
});

test("从聊天创建/导入按钮：输入框无文字/图片时置灰，有内容时可用，且不因面板渲染打开会话", () => {
  // 订阅辅助：只读解析输入框，绝不调用 uiWorkspace.openSession
  const hookStart = source.indexOf("function useComposerHasContent(sessionId)");
  assert.ok(hookStart > 0, "应存在 useComposerHasContent 订阅钩子");
  const hookBody = source.slice(hookStart, hookStart + 1800);
  assert.match(hookBody, /readComposerInput\(sessionId\)\?\.state/);
  assert.match(hookBody, /composerDraftHasContent\(store\.getSnapshot\(\)\)/);
  assert.match(hookBody, /store\.subscribe\(/);
  assert.equal(/openSession/.test(hookBody), false, "置灰判定不得打开会话（不能跳页）");
  // 两个入口用同一个禁用条件：无目标会话，或输入框里没有文字/图片
  assert.match(source, /const composerHasContent = useComposerHasContent\(targetSessionId\);/);
  assert.ok((source.match(/disabled: targetSessionId === "" \|\| composerHasContent !== true,/g) ?? []).length >= 2, "「从聊天创建」与「从聊天导入」共用前置条件");

  const makeClient = (draft) => hudClient({
    state: { byId: { s1: { id: "s1", cwd: "/tmp/w" } }, current: "s1" },
    current: "s1",
    storage: { "dsh-awesome-hud:open": JSON.stringify({ s1: "1" }) },
    extraServices: {
      sessions: { list: { getSnapshot: () => ({ byId: { s1: { id: "s1", cwd: "/tmp/w" } }, current: "s1" }), subscribe: () => () => {} }, scope: () => ({}) },
      conversation: { input: { for: () => ({ state: { getSnapshot: () => ({ draft, attachmentIds: [] }), subscribe: () => () => {} } }) } },
    },
    respond: () => ({ ok: true, modules: {}, usage: {}, context: {}, order: [], panel: {}, entries: [], isRepo: true, servers: [], total: 0, enabled: 0 }),
  });
  for (const [draft, expected] of [["", true], ["hello", false]]) {
    const element = nodes(makeClient(draft).panel()).find((node) => node?.type?.name === "NoteModule");
    const rendered = element.type({ ...element.props, sendSessionId: "s1" });
    const create = byClass(rendered, "hud-note-list-actions")[0].children.filter((child) => child?.type === "button")[0];
    assert.equal(create.props.disabled, expected, draft === "" ? "输入框为空时「从聊天创建」置灰" : "输入框有文字时「从聊天创建」可点");
  }
});
