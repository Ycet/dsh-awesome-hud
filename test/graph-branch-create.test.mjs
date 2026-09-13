import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("git/create-branch accepts an optional commit and keeps HEAD-based creation unchanged", async () => {
  const host = await readFile(join(root, "lib/index.js"), "utf8");

  // 可选 commit：未传 = 从当前 HEAD 创建（旧客户端行为不变）；显式传入但非法则直接报错
  assert.match(host, /const hasCommit = payload\?\.commit !== undefined && payload\?\.commit !== null;/);
  assert.match(host, /const commit = hasCommit \? sanitizeGitCommit\(payload\.commit\) : null;/);
  assert.match(host, /if \(hasCommit && commit === null\) throw new Error\("缺少合法的提交 id"\);/);
  assert.match(host, /commit === null \? \["checkout", "-b", branch\] : \["checkout", "-b", branch, commit\]/);
  // 重名预检沿用；参数数组执行，无 shell 拼接
  assert.match(host, /if \(list\.includes\(branch\)\) throw new Error\(`分支「\$\{branch\}」已存在`\);/);
  assert.doesNotMatch(host, /checkout", "-b", branch, commit\]\)`/);
});

test("git/create-branch reports local-changes conflicts with the structured checkout error", async () => {
  const host = await readFile(join(root, "lib/index.js"), "utf8");
  const start = host.indexOf('async "git/create-branch"(payload)');
  assert.ok(start >= 0, "git/create-branch handler is missing");
  const body = host.slice(start, start + 1600);

  assert.match(body, /const conflict = parseCheckoutConflict\(result\.stderr\);/);
  assert.match(body, /Object\.assign\(err, conflict\);/);
  assert.match(body, /本地修改将被切换覆盖/);
  assert.match(body, /withGitWrite\(ctx, payload/);
});

test("graph menu state always initializes the branch-create field (regression: undefined .text crash)", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  // openMenu 必须显式初始化该字段：缺失时 undefined 会被误判为「已展开」，读取 .text 直接抛错使整个菜单渲染失败
  assert.match(client, /setMenu\(\{ x, y, commit, reset: \{ allowed: null, code: "checking" \}, confirmMode: null, branchCreate: null \}\);/);
  // 读取统一走归一化后的 branchCreate，禁止直接读 menu.branchCreate.text
  assert.doesNotMatch(client, /menu\.branchCreate\.text/);
  assert.match(client, /const branchCreate = menu !== null && menu\.branchCreate !== null && menu\.branchCreate !== undefined \? menu\.branchCreate : null;/);
  assert.match(client, /branchCreateOpenRef\.current = branchCreate !== null;/);
  assert.match(client, /if \(menu === null \|\| branchCreate === null \|\| branchCreateBusy \|\| onCreateBranch === null\) return;/);
});

test("git graph right-click menu gains a create-branch entry in the merge group", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  const mergeAt = client.indexOf("renderMergeItem(),");
  const createAt = client.indexOf("renderBranchCreateItem(),");
  const resetAt = client.indexOf('renderResetItem("soft", "gitResetSoft")');
  assert.ok(mergeAt >= 0, "merge menu item is missing");
  assert.ok(createAt > mergeAt, "create-branch entry must sit below the merge entry");
  assert.ok(resetAt > createAt, "create-branch entry must stay in the merge group, above the reset group");

  assert.match(client, /react\.createElement\(Icon, \{ name: "git-branch", size: 13 \}\)/);
  assert.match(client, /t\("gitBranchCreateHere"\)/);
  assert.match(client, /className: "hud-git-menu-branch-create"/);
});

test("create-branch entry swaps in place into an input with close/check icon buttons", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  assert.match(client, /className: "hud-branch-add-input"/);
  assert.match(client, /placeholder: t\("gitBranchAddPlaceholder"\)/);
  assert.match(client, /react\.createElement\(Icon, \{ name: "close", size: 14 \}\)/);
  assert.match(client, /react\.createElement\(Icon, \{ name: "check", size: 14 \}\)/);
  assert.match(client, /"data-kind": "confirm"/);
  // 空输入置灰；取消按钮恢复为原菜单项
  assert.match(client, /disabled: text\.trim\(\) === "" \|\| branchCreateBusy,/);
  assert.match(client, /branchCreate: null \}\);[\s\S]{0,80}menuItemRefs\.current\[4\]\?\.focus\(\);/);
});

test("create-branch entry stays disabled while a Git operation is in progress", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  // 复用菜单打开时已有的 reset-status 预检结果，零新增 Host 调用
  assert.match(client, /menu\.reset\?\.code === "operation-in-progress" \|\| \(onResetStatus !== null && menu\.reset\?\.allowed === null\)/);
  assert.match(client, /title: blocked \? t\("gitBranchCreateBlocked"\) : undefined,/);
  assert.match(client, /onCreateBranch === null \|\| blocked;/);
});

test("Enter never submits the inline branch input and Escape cancels it first", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  assert.match(client, /if \(event\.key === "Enter"\) event\.preventDefault\(\);/);
  assert.doesNotMatch(client, /onKeyDown: \(event\) => \{[\s\S]{0,200}createBranchHere/);
  // 菜单级 Escape 处理器：输入行展开时先取消输入行，再按一次才关闭整个菜单
  assert.match(client, /if \(branchCreateOpenRef\.current === true\) \{ cancelBranchCreate\(\); return; \}/);
  assert.match(client, /const branchCreateOpenRef = react\.useRef\(false\);/);
  assert.match(client, /branchCreateOpenRef\.current = branchCreate !== null;/);
});

test("successful creation toasts, closes the menu and refreshes snapshot plus graph", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  assert.match(client, /call\("git\/create-branch", \{ sessionId: props\.sessionId, branch: name, commit: hash \}\)/);
  assert.match(client, /toast\(interpolate\(t\("gitBranchCreatedHere"\), \{ branch: name, commit: hash\.slice\(0, 7\) \}\), "success"\)/);
  assert.match(client, /props\.onGit\?\.\(body\);/);
  assert.match(client, /const succeeded = await onCreateBranch\(menu\.commit, name\);[\s\S]{0,90}if \(succeeded === true\) closeMenu\(false\);/);
  // 失败：保持输入行展开并保留文本，冲突走结构化文件清单提示
  assert.match(client, /失败时不关闭菜单：输入行保持展开且文本保留/);
  assert.match(client, /error\?\.code === "local-changes-conflict"[\s\S]{0,160}gitBranchConflict/);
  assert.match(client, /onCreateBranch: \(commit, name\) => doCreateBranchHere\(commit, name\),[\s\S]{0,40}branchCreateBusy,/);
});

test("menu geometry and styles accommodate the extra entry and inline row", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  assert.match(client, /const menuH = 9 \* 31 \+ 48;/);
  assert.match(client, /\.hud-git-menu-branch-create\{display:flex;align-items:center;gap:4px;padding:1px 2px\}/);
  // 既有选择器保持不变（v0.13.4 曾因改动选择器导致回归）
  assert.match(client, /\.hud-git-menu-cancel\{border:1px solid var\(--dsw-alias-label-primary\);background:var\(--hud-surface-bg\);color:var\(--dsw-alias-label-primary\)\}/);
});

test("both locales expose the three new branch-creation strings", async () => {
  const client = await readFile(join(root, "lib/client.js"), "utf8");

  assert.match(client, /gitBranchCreateHere: "从此处创建分支",/);
  assert.match(client, /gitBranchCreatedHere: "已从 \{commit\} 创建并切换到分支「\{branch\}」",/);
  assert.match(client, /gitBranchCreateBlocked: "Git 操作进行中，暂不能创建分支",/);
  assert.match(client, /gitBranchCreateHere: "Create branch here",/);
  // 英文文案含转义引号，用字符串包含断言避免正则二次转义
  assert.ok(client.includes('gitBranchCreatedHere: "Created and switched to branch \\"{branch}\\" from {commit}",'));
  assert.match(client, /gitBranchCreateBlocked: "A Git operation is in progress, so a branch cannot be created now",/);
});
