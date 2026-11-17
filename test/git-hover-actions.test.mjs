// dsh-awesome-hud — v0.21.2：git 变更树的行内按钮不再「黏住」。
//
// 旧实现用 `:focus-within` 控制按钮可见性：点击文件夹/文件的展开按钮后该按钮一直持有焦点，
// 鼠标移开仍然命中 `:focus-within`，按钮就一直挂在行右侧。现在改为：
//   - 鼠标悬浮（:hover）显示；
//   - 键盘可见焦点（:has(:focus-visible)）显示，鼠标点击产生的焦点不算；
//   - 焦点已在操作按钮自身（.hud-git-file-actions:focus-within）时保持显示，Tab 可达。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "lib/client.js"), "utf8");

test("可见性规则：hover + 键盘可见焦点，不再用 :focus-within 的后代选择器", () => {
  assert.match(
    source,
    /\.hud-git-file-row:hover \.hud-git-file-actions,\.hud-git-dir-row:hover \.hud-git-file-actions,\.hud-git-file-row:has\(:focus-visible\) \.hud-git-file-actions,\.hud-git-dir-row:has\(:focus-visible\) \.hud-git-file-actions,\.hud-git-file-actions:focus-within\{opacity:1;visibility:visible\}/,
  );
  // 行级 `:focus-within` 是「点击后黏住」的根因，必须不再出现。
  assert.doesNotMatch(source, /\.hud-git-file-row:focus-within \.hud-git-file-actions/);
  assert.doesNotMatch(source, /\.hud-git-dir-row:focus-within \.hud-git-file-actions/);
});

test("操作区自身获得焦点时仍然可见，键盘用户不会丢按钮", () => {
  assert.match(source, /\.hud-git-file-actions:focus-within\{opacity:1;visibility:visible\}/);
});

test("默认隐藏与触屏兜底保持不变", () => {
  assert.match(source, /\.hud-git-file-actions\{position:absolute;top:0;bottom:0;right:3px;z-index:1;display:flex;align-items:center;gap:2px;padding-left:18px;background:linear-gradient\(90deg,transparent 0,var\(--hud-surface-bg\) 18px\);opacity:0;visibility:hidden/);
  assert.match(source, /@media\(hover:none\)\{\.hud-git-file-actions\{opacity:1;visibility:visible\}\}/);
});

test("文件夹行与文件行共用同一套操作区样式（两处一起修）", () => {
  // 文件夹行把操作按钮挂在与文件行相同的 .hud-git-file-actions 容器里。
  assert.match(source, /const renderFolderActions = \(files, group\) => react\.createElement\("div", \{ className: "hud-git-file-actions hud-git-folder-actions" \},/);
  assert.match(source, /renderFolderActions\(files, group\)\),/);
});
