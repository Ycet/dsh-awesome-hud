import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extractFunction } from './helpers/client-harness.mjs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function loadHelpers() {
  const context = vm.createContext({});
  vm.runInContext(
    `${extractFunction('dropIndexAt')}\n${extractFunction('previewOffsets')}\nthis.dropIndexAt = dropIndexAt; this.previewOffsets = previewOffsets;`,
    context,
  );
  return context;
}

test('待办拖动落点：按每行上半/下半区判定（行高可变）', () => {
  const { dropIndexAt } = loadHelpers();
  // 三行高度不同：26 / 46 / 20，top 依次 0 / 28 / 76。
  const tops = [0, 28, 76];
  const heights = [26, 46, 20];
  assert.equal(dropIndexAt(tops, heights, -5), 0);
  assert.equal(dropIndexAt(tops, heights, 10), 0);
  // 第一行下半区 → 第二行。
  assert.equal(dropIndexAt(tops, heights, 20), 1);
  assert.equal(dropIndexAt(tops, heights, 50), 1);
  // 第二行下半区 → 第三行。
  assert.equal(dropIndexAt(tops, heights, 70), 2);
  assert.equal(dropIndexAt(tops, heights, 999), 2);
  assert.equal(dropIndexAt([], [], 0), -1);
});

test('待办拖动预览位移：按预览顺序与真实行高重新堆叠', () => {
  const { previewOffsets } = loadHelpers();
  const order = ['a', 'b', 'c'];
  const tops = [0, 28, 76];
  const heights = [26, 46, 20];
  // 把 c 拖到最上方：c -76、a +22、b +22。
  assert.deepEqual(JSON.parse(JSON.stringify(previewOffsets(order, ['c', 'a', 'b'], tops, heights, 2))), { a: 22, b: 22, c: -76 });
  // 把 a 拖到最下方：b -28、c -28、a +70。
  assert.deepEqual(JSON.parse(JSON.stringify(previewOffsets(order, ['b', 'c', 'a'], tops, heights, 2))), { a: 70, b: -28, c: -28 });
  // 顺序未变时全部为 0（不产生无意义 transform）。
  assert.deepEqual(JSON.parse(JSON.stringify(previewOffsets(order, order, tops, heights, 2))), { a: 0, b: 0, c: 0 });
  // 列表有 padding / 首行不从 0 开始时，预览仍保持相对位移不变。
  assert.deepEqual(JSON.parse(JSON.stringify(previewOffsets(order, ['c', 'a', 'b'], [10, 38, 86], heights, 2))), { a: 22, b: 22, c: -76 });
});

test('待办模块拖动排序：列表级落点 + transform 让位，松手才写回（v0.17.0）', () => {
  // 状态与拖动处理
  assert.match(source, /const startDrag = \(event, item\) => \{/);
  assert.match(source, /const dragOverList = \(event\) => \{/);
  assert.match(source, /const dropTodo = \(event\) => \{/);
  assert.match(source, /dragRef\.current = \{ id: item\.id, baseOrder: order, order, tops, heights, gap \};/);
  assert.match(source, /dragRef\.current = \{ id: item\.id, baseOrder: order, order, tops, heights, gap \};[\s\S]{0,400}suppressNativeDragImage\(event\);/);
  assert.doesNotMatch(source, /setDragImage\?\.\(row/);
  assert.match(source, /const overIndex = dropIndexAt\(state\.tops, state\.heights, event\.clientY - list\.getBoundingClientRect\(\)\.top\);/);
  assert.match(source, /const next = previewModuleOrder\(state\.order, state\.id, overIndex\);/);

  // 列表级 dragover/drop + 落盘当帧关闭过渡
  assert.match(source, /className: "hud-todo-list",\n\s*ref: listRef,\n\s*"data-settling": dragSettling,\n\s*onDragOver: dragOverList,\n\s*onDrop: dropTodo,/);
  assert.match(source, /\.hud-todo-list\[data-settling=true\] \.hud-todo-item\{transition:none\}/);

  // 每行按预览位移；拖动中的行以虚线占位显示
  assert.match(source, /const dragOffsets = dragPreview === null \? null : previewOffsets\(dragPreview\.baseOrder, dragPreview\.order, dragPreview\.tops, dragPreview\.heights, dragPreview\.gap\);/);
  assert.match(source, /style: dragOffsets === null \|\| \(dragOffsets\[item\.id\] \?\? 0\) === 0 \? undefined : \{ transform: `translateY\(\$\{dragOffsets\[item\.id\]\}px\)` \},/);
  assert.match(source, /"data-dragging": dragPreview !== null && dragPreview\.id === item\.id,/);
  assert.match(source, /\.hud-todo-item\[data-dragging=true\]\{opacity:\.55/);
  assert.doesNotMatch(source, /"data-over":/);
  assert.doesNotMatch(source, /\.hud-todo-item\[data-over=true\]/);

  // 松手才 persist；拖到列表外不改变顺序
  assert.match(source, /const order = state\?\.order \?\? dragPreview\?\.order \?\? null;/);
  // v0.19.2：拖动只重排未完成条目，落盘时把已完成整组接回末尾。
  assert.match(source, /const merged = next\.length === activeTodos\.length \? next\.concat\(doneTodos\) : \[\];/);
  assert.match(source, /setDragSettling\(true\);\n\s*persist\(merged\);/);
});

test('拖拽幽灵图：用 1x1 透明图隐藏跟随鼠标的原生快照', () => {
  const context = vm.createContext({ TRANSPARENT_DRAG_IMAGE: { transparent: true } });
  vm.runInContext(
    `${extractFunction('suppressNativeDragImage')}\nthis.suppressNativeDragImage = suppressNativeDragImage;`,
    context,
  );
  const calls = [];
  const event = { dataTransfer: { setDragImage: (image, x, y) => calls.push([image, x, y]) } };
  assert.equal(context.suppressNativeDragImage(event), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].transparent, true);
  assert.deepEqual([calls[0][1], calls[0][2]], [0, 0]);
  // 不支持 setDragImage / 没有事件对象时不抛错，保留浏览器默认行为。
  assert.equal(context.suppressNativeDragImage({ dataTransfer: {} }), false);
  assert.equal(context.suppressNativeDragImage(null), false);
  assert.ok(source.includes("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"));
});
