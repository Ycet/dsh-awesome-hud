// dsh-awesome-hud — v0.18.5：待办条目卡片化 + 悬浮才显示编辑/删除
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

test('待办条目使用与 HUD 设置模块卡片一致的卡片样式', () => {
  // 卡片：1px 描边 + 浅底 + 10px 圆角 + 6/8 内边距（与 .hud-settings-card 同款）。
  // v0.18.7：底色抽成 --hud-todo-bg 变量，供右侧浮层的渐变遮罩取同一颜色。
  assert.match(source, /\.hud-todo-item\{position:relative;padding:6px 8px;border:1px solid color-mix\(in srgb,var\(--dsw-alias-label-primary\) 12%,transparent\);border-radius:10px;--hud-todo-bg:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 3%,var\(--hud-surface-bg\)\);background:var\(--hud-todo-bg\)/);
  // 列表间距与设置里的卡片列表一致。
  assert.match(source, /\.hud-todo-list\{gap:6px\}/);
  // 悬浮加深描边与底色；拖动中的行不套用悬浮态，避免盖掉虚线占位。
  assert.match(source, /\.hud-todo-item:not\(\[data-dragging=true\]\):hover\{border-color:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 22%,transparent\);--hud-todo-bg:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 6%,var\(--hud-surface-bg\)\)\}/);
});

test('待办编辑/删除按钮默认隐藏，悬浮或键盘聚焦该行时才显示', () => {
  // 两个按钮包进同一个操作区。
  assert.match(source, /react\.createElement\("span", \{ className: "hud-todo-actions" \},/);
  assert.match(source, /className: "hud-todo-actions"[\s\S]{0,700}"aria-label": t\("todoDelete"\)/);
  // v0.18.7：操作区改为绝对定位浮层（不再占用行内宽度），文字因此能铺满整行。
  // 浮层本体是行底色实底（按钮区绝不透字），左侧再挂 16px 伪元素渐隐，
  // 让文字在按钮之前淡出——只给容器一条 14px 渐变会让淡出区落在第一个图标下方。
  assert.match(source, /\.hud-todo-actions\{position:absolute;top:0;bottom:0;right:8px;display:inline-flex;align-items:center;gap:6px;background:var\(--hud-todo-bg\);opacity:0;visibility:hidden;/);
  assert.match(source, /\.hud-todo-actions::before\{content:'';position:absolute;top:0;bottom:0;right:100%;width:16px;pointer-events:none;background:linear-gradient\(90deg,transparent 0,var\(--hud-todo-bg\) 16px\)\}/);
  assert.match(source, /\.hud-todo-text\{flex:1 1 auto;min-width:0;/);
  // 只有 :hover 与「键盘聚焦」(:focus-visible) 触发；鼠标拖动/点击手柄获得的是普通焦点，不会再让按钮滞留。
  assert.match(source, /\.hud-todo-item:hover \.hud-todo-actions,\.hud-todo-item:has\(:focus-visible\) \.hud-todo-actions\{opacity:1;visibility:visible\}/);
  assert.doesNotMatch(source, /\.hud-todo-item:focus-within \.hud-todo-actions/);
  // 拖动中的行不显示浮层：既避免遮住虚线占位，也避免遮罩色与拖动底色不符。
  assert.match(source, /\.hud-todo-item\[data-dragging=true\] \.hud-todo-actions\{opacity:0;visibility:hidden\}/);
  // 触屏等没有 hover 的环境：按钮常显，同时给文字留出 60px 右侧避让，避免常显按钮盖字。
  assert.match(source, /@media\(hover:none\)\{\.hud-todo-text\{padding-right:60px\}\.hud-todo-actions\{opacity:1;visibility:visible\}\}/);
});

test('待办拖动手柄热区覆盖整行高度（多行条目也能整列拖起）', () => {
  // 手柄纵向拉满行内容区，再用等量负外部距/内边距吃掉卡片内边距，命中区 = 整张卡片高度。
  assert.match(source, /\.hud-todo-grip\{align-self:stretch;height:auto;min-height:24px;margin:-6px 0;padding:6px 0\}/);
});

test('待办拖动兜底间距与卡片间距一致（有列表时仍用实测值）', () => {
  assert.match(source, /let gap = 6;/);
  assert.match(source, /gap = Math\.max\(0, rects\[1\]\.top - \(rects\[0\]\.top \+ rects\[0\]\.height\)\);/);
});
