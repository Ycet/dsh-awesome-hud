// dsh-awesome-hud — v0.21.0：Git 变更文件悬浮操作与文件树
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assetFileFor } from "../lib/index.js";
import { clientSource as source, extractFunction } from "./helpers/client-harness.mjs";

const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

function loadTree() {
  const context = vm.createContext({});
  vm.runInContext(`${extractFunction("gitChangeTree")}\n${extractFunction("gitTreeFiles")}\nthis.gitChangeTree = gitChangeTree; this.gitTreeFiles = gitTreeFiles;`, context);
  return context;
}

test("gitChangeTree：嵌套目录、目录在前文件在后、同层按名称排序、目录条目按叶子保留", () => {
  const context = loadTree();
  const tree = JSON.parse(JSON.stringify(context.gitChangeTree([
    { path: "b/z.txt", status: "M" },
    { path: "a/sub/y.ts", status: "M" },
    { path: "a/x.js", status: "M" },
    { path: "root.md", status: "?" },
    { path: "dir/", status: "?" },
  ])));
  assert.deepEqual(tree.map((node) => `${node.type}:${node.name}`), ["dir:a", "dir:b", "file:dir", "file:root.md"]);
  assert.deepEqual(tree[0].children.map((node) => `${node.type}:${node.name}`), ["dir:sub", "file:x.js"]);
  assert.deepEqual(tree[0].children[0].children.map((node) => `${node.type}:${node.name}`), ["file:y.ts"]);
  assert.equal(tree[0].path, "a");
  assert.equal(tree[0].children[0].path, "a/sub");
  const files = context.gitTreeFiles(tree[0], []).map((file) => file.path).sort();
  assert.deepEqual(files, ["a/sub/y.ts", "a/x.js"]);
});

test("gitChangeTree：空输入、Windows 分隔符、前导斜杠与根目录文件", () => {
  const context = loadTree();
  assert.deepEqual(JSON.parse(JSON.stringify(context.gitChangeTree([]))), []);
  const tree = JSON.parse(JSON.stringify(context.gitChangeTree([
    { path: "/root.md" },
    { path: "dir\\win.md" },
    { path: "a//b.md" },
  ])));
  // 前导空段被过滤；反斜杠不是 POSIX 分隔符，按单个文件名保留（git 路径始终是 POSIX）。
  assert.deepEqual(tree.map((node) => `${node.type}:${node.name}`), ["dir:a", "file:dir\\win.md", "file:root.md"]);
  assert.deepEqual(tree[0].children.map((node) => node.name), ["b.md"]);
});

test("Git 模块接线：gitView、悬浮操作、文件夹批量、右键图标", () => {
  assert.match(source, /const gitView = props\.gitView === "tree" \? "tree" : "list";/);
  assert.match(source, /const GIT_COLLAPSED_DIRS = new Set\(\);/);
  assert.match(source, /const \[collapsedDirs, setCollapsedDirs\] = react\.useState\(\(\) => new Set\(GIT_COLLAPSED_DIRS\)\);/);
  assert.match(source, /gitView === "tree" \? renderTreeNodes\(gitChangeTree\(stagedFiles\), "staged"\) : stagedFiles\.map/);
  assert.match(source, /gitView === "tree" \? renderTreeNodes\(gitChangeTree\(changesFiles\), "changes"\) : changesFiles\.map/);
  assert.match(source, /renderTreeNodes\(node\.children, group, depth \+ 1\)/);
  assert.match(source, /className: "hud-git-tree-caret"/);
  assert.match(source, /className: "hud-git-file-actions"/);
  assert.match(source, /renderRowAction\("revert", "revert", t\("gitRevertOption"\)/);
  assert.match(source, /renderRowAction\("stage", "plus", t\("gitAddToStage"\)/);
  assert.match(source, /renderRowAction\("unstage", "minus", t\("gitRemoveFromStage"\)/);
  assert.match(source, /doStagePaths\(files\.map\(\(file\) => file\.path\)\)/);
  assert.match(source, /openRevertPathsConfirm\(files\)/);
  assert.match(source, /runWrite\("git\/stage", \{ paths \}/);
  assert.match(source, /runWrite\("git\/revert-file", \{ paths: current\.files\.map\(\(file\) => file\.path\) \}/);
  // 右键菜单图标：暂存区 minus、变更区 plus、撤销保持 revert。
  assert.match(source, /doUnstage\(menu\.file\)[\s\S]{0,160}name: "minus"/);
  assert.match(source, /doStage\(menu\.file\)[\s\S]{0,160}name: "plus"/);
  assert.match(source, /openRevertFileConfirm\(menu\.file\)[\s\S]{0,160}name: "revert"/);
  // 文件夹撤销确认卡片与按钮。
  assert.match(source, /const isPaths = confirm\.kind === "revert-paths";/);
  assert.match(source, /gitRevertFolderTitle/);
  assert.match(source, /gitRevertFolderConfirm/);
  // 暂存区旧提示文案已移除。
  assert.doesNotMatch(source, /gitStagedHint/);
});

test("Git 悬浮操作蒙层与文件树样式", () => {
  assert.match(source, /\.hud-git-file-row\{position:relative;min-width:0\}/);
  assert.match(source, /\.hud-git-file-actions\{position:absolute;top:0;bottom:0;right:3px;z-index:1;display:flex;align-items:center;gap:2px;padding-left:18px;background:linear-gradient\(90deg,transparent 0,var\(--hud-surface-bg\) 18px\)/);
  assert.match(source, /\.hud-git-file-row:hover \.hud-git-file-actions,\.hud-git-file-row:focus-within \.hud-git-file-actions,\.hud-git-dir-row:hover \.hud-git-file-actions,\.hud-git-dir-row:focus-within \.hud-git-file-actions\{opacity:1;visibility:visible\}/);
  assert.match(source, /\.hud-git-dir-row\{position:relative;display:flex;align-items:center;/);
  assert.match(source, /\.hud-git-tree-caret\[data-collapsed=true\]\{transform:rotate\(-90deg\)\}/);
  assert.match(source, /@media\(hover:none\)\{\.hud-git-file-actions\{opacity:1;visibility:visible\}\}/);
});

test("Host 批量接口：paths 白名单、去重上限与单路径兼容", () => {
  assert.match(hostSource, /const GIT_BATCH_MAX_PATHS = 2000;/);
  assert.match(hostSource, /function sanitizeGitPaths\(payload\)/);
  assert.match(hostSource, /if \(raw === undefined\) return \{ paths: \[sanitizeGitPath\(payload\?\.path\)\], batch: false \};/);
  assert.match(hostSource, /const \{ paths \} = sanitizeGitPaths\(payload\);\n\t+for \(const path of paths\) fileOfSnapshot\(before, path\);/);
  assert.match(hostSource, /const \{ paths \} = sanitizeGitPaths\(payload\);\n\t+for \(const path of paths\) \{/);
  assert.match(hostSource, /const \{ paths, batch \} = sanitizeGitPaths\(payload\);/);
  assert.match(hostSource, /return \{ skippedRevert: skipped\.map\(\(item\) => item\.path\) \};/);
});

test("HUD 模块标题吸附：只作用于滚动区、不透明底色、限制在 section 内", () => {
  assert.match(source, /\.hud-panel-body>\.hud-section>\.hud-module-head\{position:sticky;top:0;z-index:1\}/);
  assert.match(source, /\.hud-panel-body>\.hud-section>\.hud-module-head\[data-stuck=true\]\{background:var\(--hud-surface-bg\)\}/);
  assert.match(source, /const stuck = scrolled && headTop <= bodyTop \+ 1 && sectionBottom > bodyTop \+ 2;/);
  assert.match(source, /\.hud-panel-body>\.hud-section:not\(:first-child\)>\.hud-module-head\[data-stuck=true\]::before\{content:'';position:absolute;left:0;right:0;top:0;height:1px;/);
  // 边栏样式：固定区（会话 + 可选置顶上下文）与第一个滚动区模块都要有分割线。
  assert.match(source, /\.hud-panel\[data-style=sidebar\] \.hud-panel-body,\.hud-panel\[data-style=sidebar\] \.hud-panel-pin,\.hud-panel\[data-style=sidebar\] \.hud-panel-body>\.hud-section\{border-top:0;background-image:linear-gradient/);
  assert.match(source, /\.hud-panel\[data-style=sidebar\] \.hud-panel-body>\.hud-section>\.hud-module-head::before\{background:linear-gradient\(to right,transparent 14px/);
  // 会话模块与固定上下文模块在 body 外，基础规则仍是 position:relative，不受吸附影响。
  assert.match(source, /\.hud-module-head\{display:flex;align-items:center;gap:8px;padding:10px 14px;min-height:20px;cursor:default;position:relative\}/);
});


test("图标资产：minus.svg / at.svg 已入库并加入宿主白名单", async () => {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  for (const name of ["minus.svg", "at.svg"]) {
    await access(resolve(root, "assets/icons", name));
    assert.ok(assetFileFor(name).path.endsWith(`/assets/icons/${name}`));
    const text = readFileSync(resolve(root, "assets/icons", name), "utf8");
    assert.doesNotMatch(text, /data-darkreader-inline-fill/, `${name} 不应保留 DarkReader 内联样式`);
  }
});
