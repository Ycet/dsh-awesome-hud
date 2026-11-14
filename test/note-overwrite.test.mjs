// dsh-awesome-hud — v0.19.0「从聊天导入」的两段式覆盖：先清空便笺，再写入输入框内容
//  1) 清空 = 写空文字 → 释放旧图片 objectURL → 删除 IndexedDB 记录
//  2) 写入 = 写文字 → 保存新图片
//  3) 空文字落盘失败 ⇒ 中止且不释放/删除任何旧内容
//  4) 新文字落盘失败 ⇒ 便笺已清空（不回滚，已确认的降级语义），返回空文字的 payload 供界面同步
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { extractFunction } from "./helpers/client-harness.mjs";

/** 可观察的便笺 IO 假实现：按调用顺序记录，并可指定第几次 persistText 失败。 */
function fakeIo(options = {}) {
  const calls = [];
  let persistCount = 0;
  const failAt = options.failAt ?? null;
  const io = {
    persistText(text) {
      persistCount += 1;
      calls.push(["persistText", text]);
      if (failAt === persistCount) return { persisted: false, payload: { text: "", height: 180, updatedAt: 0 } };
      return { persisted: true, payload: { text, height: 180, updatedAt: 1000 + persistCount } };
    },
    releaseImages(list) { calls.push(["releaseImages", list.map((image) => image.id)]); },
    dropImages() { calls.push(["dropImages"]); },
    saveImages(list) { calls.push(["saveImages", list.map((image) => image.id)]); },
  };
  return { io, calls };
}

function load() {
  const context = vm.createContext({});
  vm.runInContext(extractFunction("overwriteNoteContent"), context);
  return context;
}

const oldImages = [{ id: "old-1", url: "blob:old-1" }, { id: "old-2", url: "blob:old-2" }];
const newImages = [{ id: "new-1", url: "blob:new-1" }];

test("先清空再写入：调用顺序固定为 空文字 → 释放旧图 → 删记录 → 新文字 → 存新图", () => {
  const context = load();
  const { io, calls } = fakeIo();
  const result = context.overwriteNoteContent(io, { images: oldImages }, { text: "from chat", images: newImages });
  assert.equal(result.ok, true);
  assert.deepEqual(result.images.map((image) => image.id), ["new-1"]);
  assert.deepEqual(calls.map((call) => call[0]), ["persistText", "releaseImages", "dropImages", "persistText", "saveImages"]);
  assert.deepEqual(calls[0].slice(1), [""], "第一步必须把便笺文字清空");
  assert.deepEqual(calls[1][1], ["old-1", "old-2"], "旧图片逐个释放");
  assert.deepEqual(calls[3].slice(1), ["from chat"], "清空之后才写入新文字");
  assert.deepEqual(calls[4][1], ["new-1"]);
  assert.equal(result.payload.text, "from chat");
});

test("空文字落盘失败：中止并且不动旧内容（图片不释放、记录不删除）", () => {
  const context = load();
  const { io, calls } = fakeIo({ failAt: 1 });
  const result = context.overwriteNoteContent(io, { images: oldImages }, { text: "next", images: newImages });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, reason: "storage" });
  assert.deepEqual(calls.map((call) => call[0]), ["persistText"], "只尝试了清空，其他都不该发生");
});

test("新文字落盘失败：便笺已清空、不回滚，返回空文字 payload 供界面同步", () => {
  const context = load();
  const { io, calls } = fakeIo({ failAt: 2 });
  const result = context.overwriteNoteContent(io, { images: oldImages }, { text: "next", images: newImages });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "storage");
  assert.equal(result.cleared, true);
  assert.equal(result.payload.text, "", "payload 是清空后的空便笺");
  assert.deepEqual(calls.map((call) => call[0]), ["persistText", "releaseImages", "dropImages", "persistText"]);
  assert.equal(calls.some((call) => call[0] === "saveImages"), false, "失败时不保存新图片");
});

test("便笺原本为空：同样走两段式，不创建多余的图片对象", () => {
  const context = load();
  const { io, calls } = fakeIo();
  const result = context.overwriteNoteContent(io, { images: [] }, { text: "", images: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.images)), []);
  assert.deepEqual(calls.map((call) => call[0]), ["persistText", "releaseImages", "dropImages", "persistText", "saveImages"]);
  assert.deepEqual(calls[1][1], []);
});
