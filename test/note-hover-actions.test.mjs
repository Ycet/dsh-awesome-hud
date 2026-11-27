// dsh-awesome-hud — v0.21.9：便笺条的行内删除按钮不再「黏住」。
//
// 旧实现用行级 `:focus-within` 控制按钮可见性：点击便笺标题打开编辑弹窗后，
// 弹窗关闭会把焦点还原到标题（标题带 tabIndex），于是鼠标移开仍命中 `:focus-within`，
// 删除按钮一直挂在便笺条右侧。现在改为：
//   - 鼠标悬浮（:hover）显示；
//   - 键盘可见焦点（:has(:focus-visible)）显示，鼠标点击产生的焦点不算；
//   - 焦点已在操作区自身（.hud-note-bar-actions:focus-within）时保持显示，Tab 可达。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "lib/client.js"), "utf8");

test("可见性规则：hover + 键盘可见焦点，不再用行级 :focus-within", () => {
  assert.match(
    source,
    /\.hud-note-bar:hover \.hud-note-bar-actions,\.hud-note-bar:has\(:focus-visible\) \.hud-note-bar-actions,\.hud-note-bar-actions:focus-within\{opacity:1;visibility:visible\}/,
  );
  // 行级 `:focus-within` 是「关闭弹窗后按钮残留」的根因，必须不再出现。
  assert.doesNotMatch(source, /\.hud-note-bar:focus-within \.hud-note-bar-actions/);
});

test("操作区自身获得焦点时仍然可见，键盘用户不会丢按钮", () => {
  assert.match(source, /\.hud-note-bar-actions:focus-within\{opacity:1;visibility:visible\}/);
});

test("默认隐藏、删除确认与触屏兜底保持不变", () => {
  assert.match(source, /\.hud-note-bar-actions\{position:absolute;top:0;bottom:0;right:6px;display:inline-flex;align-items:center;gap:2px;background:var\(--hud-note-bar-bg\);opacity:0;visibility:hidden/);
  assert.match(source, /\.hud-note-bar\[data-confirming=true\] \.hud-note-bar-actions\{opacity:1;visibility:visible\}/);
  assert.match(source, /@media\(hover:none\)\{\.hud-note-bar-title\{padding-right:52px\}\.hud-note-bar-actions\{opacity:1;visibility:visible\}\}/);
});

test("关闭弹窗仍会把焦点还原到触发元素（可见性由上面的焦点判定兜住）", () => {
  assert.match(source, /return \(\) => \{ previous\?\.focus\?\.\(\); \};/);
});
