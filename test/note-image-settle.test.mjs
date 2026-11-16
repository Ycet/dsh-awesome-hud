// dsh-awesome-hud — v0.21.1：便笺图片拖动松手后不再左右抽动
//  1) 落位那一帧给缩略图栏加 data-settling，CSS 在该状态下禁用 transform 过渡
//  2) 松手时先置 settling，再清拖动状态并提交新顺序（同一次提交里完成 DOM 重排）
//  3) 顺序没变时不进入 settling，也不写库
//  4) 定时器在卸载时清理
import assert from "node:assert/strict";
import test from "node:test";
import { clientSource as source } from "./helpers/client-harness.mjs";

/** startImageDrag 整段（含 onUp 收尾），直接在源码里按已知锚点切片。 */
const DRAG_START = source.indexOf("const startImageDrag = (event, imageId) => {");
const DRAG_END = source.indexOf('globalThis.addEventListener?.("pointercancel", onUp);', DRAG_START);
assert.ok(DRAG_START > 0 && DRAG_END > DRAG_START, "必须能定位图片拖动实现");
const onUpBody = source.slice(DRAG_START, DRAG_END);

test("缩略图栏带 data-settling，且该状态下禁用 transform 过渡（CSS 已就位）", () => {
  assert.match(
    source,
    /className: "hud-note-images", role: "list", ref: imageStripRef, "data-settling": imageSettling/,
    "缩略图栏必须把 settling 状态挂到 DOM 上",
  );
  assert.match(source, /\.hud-note-thumb\{cursor:grab;touch-action:none;transition:transform \.16s var\(--ds-ease-in-out,ease\)\}/);
  assert.match(source, /\.hud-note-images\[data-settling=true\] \.hud-note-thumb\{transition:none\}/);
});

test("松手顺序：先置 settling，再清拖动并提交顺序（同一批更新）", () => {
  const settle = onUpBody.indexOf("setImageSettling(true)");
  const clearDrag = onUpBody.indexOf("setImageDrag(null)");
  const commit = onUpBody.indexOf("replaceImages(next)");
  assert.ok(settle > 0, "落位时必须置 settling");
  assert.ok(clearDrag > settle, "settling 必须在清拖动状态之前置位");
  assert.ok(commit > clearDrag, "清拖动状态后再提交新顺序");
  // 只在顺序真的变了时进入 settling，且此时才写库
  assert.match(onUpBody, /const changed = state !== null && !sameOrder\(state\.baseOrder, state\.order\);/);
  assert.match(onUpBody, /if \(changed\) \{[\s\S]{0,260}setImageSettling\(true\);/);
  assert.match(onUpBody, /if \(!changed\) return;/);
  // 下一拍恢复过渡：定时器句柄存 ref，重复落位时先清旧定时器
  assert.match(onUpBody, /imageSettleTimerRef\.current = globalThis\.setTimeout\?\.\(\(\) => \{/);
  assert.match(onUpBody, /setImageSettling\(false\)/);
  assert.match(onUpBody, /if \(imageSettleTimerRef\.current !== null\) globalThis\.clearTimeout\?\.\(imageSettleTimerRef\.current\);/);
});

test("拖动预览与站位保持原样：拖动中各缩略图仍有 translateX 位移", () => {
  // 松手不动画的前提是「拖动期间已经把图片摆到目标槽位」，这里确认预览逻辑没被删掉。
  assert.match(source, /const imageOffsets = imageDrag === null \? null : previewOffsets\(imageDrag\.baseOrder, imageDrag\.order, imageDrag\.lefts, imageDrag\.widths, imageDrag\.gap\);/);
  assert.match(source, /style: offset === 0 \? undefined : \{ transform: `translateX\(\$\{offset\}px\)` \}/);
  assert.match(source, /\.hud-note-thumb\[data-dragging=true\]\{z-index:2;box-shadow:0 6px 18px rgba\(0,0,0,\.28\);opacity:\.85\}/);
});

test("卸载时清理落位定时器，避免对已卸载组件 setState", () => {
  assert.match(source, /if \(imageSettleTimerRef\.current !== null\) globalThis\.clearTimeout\?\.\(imageSettleTimerRef\.current\);\s*\n\s*if \(clearTimerRef\.current !== null\)/);
  // 定时器回调先清句柄再复位状态
  assert.match(source, /imageSettleTimerRef\.current = null;\s*\n\s*setImageSettling\(false\);/);
});
