// dsh-awesome-hud — v0.21.1：右键「添加至 .gitignore」
//  1) 纯函数：规则写法（前导斜杠锚定 / 目录尾斜杠 / 通配符转义）、去重、模板
//  2) host 接口 git/ignore：新建模板、追加去重、目录、子目录 cwd、越权与非仓库报错、
//     已跟踪标记、check-ignore 自检、路由白名单
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GITIGNORE_DEFAULT_LINES, escapeGitignorePath, gitignoreRuleFor, mergeGitignore, buildGitignoreTemplate,
} from "../lib/git.js";
import { createHarness, createRepo, cleanupRepo, gitIn } from "./helpers/host-harness.mjs";

const readGitignore = (root) => readFile(join(root, ".gitignore"), "utf8");

test("纯函数：规则锚定到仓库根、目录补尾斜杠、通配符转义", () => {
  assert.equal(gitignoreRuleFor("dsh-awesome-hud/lib/client.js"), "/dsh-awesome-hud/lib/client.js");
  // 目录：去重尾斜杠后补一个尾斜杠
  assert.equal(gitignoreRuleFor("docs/", true), "/docs/");
  assert.equal(gitignoreRuleFor("/docs"), "/docs");
  // Windows 反斜杠输入归一为 POSIX
  assert.equal(gitignoreRuleFor("docs\\a.md"), "/docs/a.md");
  // 空路径返回空串，调用方按错误处理
  assert.equal(gitignoreRuleFor("  "), "");
  assert.equal(gitignoreRuleFor("/"), "");
  // 通配符必须转义成字面量
  assert.equal(gitignoreRuleFor("a[1]/*.md"), "/a\\[1\\]/\\*.md");
  assert.equal(escapeGitignorePath("#note"), "\\#note");
  assert.equal(escapeGitignorePath("!keep"), "\\!keep");
  assert.equal(escapeGitignorePath("trail "), "trail\\ ");
});

test("纯函数：合并规则去重、补换行、模板内容", () => {
  const rule = "/logs/app.log";
  // 空文件（不存在）→ 只写规则本身
  assert.deepEqual(mergeGitignore("", rule), { text: `${rule}\n`, changed: true, duplicate: false });
  // 已有内容但缺结尾换行 → 追加前补换行，避免粘连
  assert.deepEqual(mergeGitignore(".DS_Store", rule), {
    text: `.DS_Store\n${rule}\n`, changed: true, duplicate: false,
  });
  // 完全相同的规则 → 不重复写
  assert.deepEqual(mergeGitignore(`${rule}\n`, rule), { text: `${rule}\n`, changed: false, duplicate: true });
  // 只差前导/尾随斜杠的等价写法也算已存在
  assert.equal(mergeGitignore("logs/app.log\n", rule).duplicate, true);
  assert.equal(mergeGitignore("/logs/app.log/\n", rule).duplicate, true);
  // 注释行与其它规则不影响判断
  assert.equal(mergeGitignore("# 注释\n\nother/\n", rule).duplicate, false);
  // 模板 = 通用项 + 空行 + 本次规则
  const template = buildGitignoreTemplate(rule);
  assert.equal(template, `${[...GITIGNORE_DEFAULT_LINES, "", rule].join("\n")}\n`);
  assert.match(template, /^\.DS_Store\nThumbs\.db\ndesktop\.ini\n\.codegraph\nnode_modules\/\n/);
  assert.match(template, /npm-debug\.log\*\nyarn-debug\.log\*\nyarn-error\.log\*\n\n\/logs\/app\.log\n$/);
});

test("host：仓库没有 .gitignore 时新建模板并写入规则", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    await writeFile(join(root, "debug.log"), "x\n");
    const harness = createHarness(root);
    const body = await harness.call("git/ignore", { path: "debug.log" });
    assert.equal(body.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.ignore.created, true, "首次写入要标记为新建文件");
    assert.equal(body.ignore.duplicate, false);
    assert.equal(body.ignore.rule, "/debug.log");
    assert.equal(body.ignore.path, "debug.log");
    assert.equal(body.ignore.gitignorePath, ".gitignore");
    assert.equal(body.ignore.tracked, false, "未跟踪文件不该被标记为已跟踪");
    assert.equal(body.ignore.verified, true, "git check-ignore 必须认可该规则");
    const text = await readGitignore(root);
    for (const line of GITIGNORE_DEFAULT_LINES) assert.ok(text.split("\n").includes(line), `模板缺少 ${line}`);
    assert.ok(text.endsWith("/debug.log\n"), "规则写在文件末尾");
    // 已忽略的文件从 changes 分组消失
    assert.equal((body.files ?? []).some((file) => file.path === "debug.log"), false);
  } finally {
    await cleanupRepo(root);
  }
});

test("host：已有 .gitignore 时只追加，重复规则不重复写", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    const existing = "# 我的规则\nnode_modules\n";
    await writeFile(join(root, ".gitignore"), existing);
    await writeFile(join(root, "debug.log"), "x\n");
    const harness = createHarness(root);
    const first = await harness.call("git/ignore", { path: "debug.log" });
    assert.equal(first.status, 200);
    assert.equal(first.ignore.created, false);
    // 原文件已以换行结尾 → 直接追加一行，不额外插空行
    assert.equal(await readGitignore(root), `${existing}/debug.log\n`);
    // 第二次点击：等价规则已存在 → 不写盘
    const second = await harness.call("git/ignore", { path: "debug.log" });
    assert.equal(second.status, 200);
    assert.equal(second.ignore.duplicate, true);
    assert.equal(await readGitignore(root), `${existing}/debug.log\n`);
  } finally {
    await cleanupRepo(root);
  }
});

test("host：文件夹按目录规则写入，文件夹内已跟踪文件带 tracked 标记", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes/a.md"), "a\n");
    await writeFile(join(root, "notes/b.md"), "b\n");
    const harness = createHarness(root);
    const body = await harness.call("git/ignore", { path: "notes", kind: "dir" });
    assert.equal(body.status, 200);
    assert.equal(body.ignore.rule, "/notes/");
    assert.equal(body.ignore.tracked, false);
    assert.equal((await readGitignore(root)).split("\n").includes("/notes/"), true);
    assert.equal(body.ignore.verified, true);
  } finally {
    await cleanupRepo(root);
  }
});

test("host：已跟踪文件只写规则并回报 tracked（不动索引）", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    // tracked.txt 已提交且当前被修改：属于已跟踪文件
    await writeFile(join(root, "tracked.txt"), "two\n");
    const harness = createHarness(root);
    const body = await harness.call("git/ignore", { path: "tracked.txt" });
    assert.equal(body.status, 200);
    assert.equal(body.ignore.tracked, true, "已跟踪文件必须带 tracked 标记");
    // 索引未被改动：文件仍是已跟踪状态（porcelain 第一列 M，而不是 ??）
    const snapshot = await harness.call("git");
    const file = (snapshot.files ?? []).find((item) => item.path === "tracked.txt");
    assert.ok(file, "文件仍在变更列表里（只写规则不取消跟踪）");
    assert.notEqual(file.status, "?", "不得把文件从索引中移除");
    assert.equal(file.staged, false, "不得自动暂存");
  } finally {
    await cleanupRepo(root);
  }
});

test("host：会话 cwd 在子目录时规则仍按仓库根写入", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    const sub = join(root, "docs");
    await writeFile(join(sub, "b.md"), "b\n");
    // 夹具会话 cwd 指向子目录；porcelain 输出的路径始终相对仓库根，客户端传的就是这个路径
    const harness = createHarness(sub);
    const body = await harness.call("git/ignore", { path: "docs/b.md" });
    assert.equal(body.status, 200);
    assert.equal(body.ignore.path, "docs/b.md", "回报路径相对仓库根");
    assert.equal(body.ignore.rule, "/docs/b.md");
    // .gitignore 写在仓库根而不是子目录
    assert.equal((await readGitignore(root)).split("\n").includes("/docs/b.md"), true);
    await assert.rejects(readFile(join(sub, ".gitignore"), "utf8"));
  } finally {
    await cleanupRepo(root);
  }
});

test("host：越权路径、非变更文件与非仓库都返回结构化错误", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    await writeFile(join(root, "debug.log"), "x\n");
    const harness = createHarness(root);
    // 不在变更列表里的路径：拒绝写入任意文件（.gitignore 自身也不允许）
    const outside = await harness.call("git/ignore", { path: "docs/not-changed.md" });
    assert.equal(outside.status, 400);
    assert.match(outside.error, /不在当前变更列表/);
    // 目录里没有变更文件
    const emptyDir = await harness.call("git/ignore", { path: "docs", kind: "dir" });
    assert.equal(emptyDir.status, 400);
    assert.match(emptyDir.error, /当前没有变更文件/);
    // 含 .. 的路径直接拒绝
    const traversal = await harness.call("git/ignore", { path: "../escape.txt" });
    assert.equal(traversal.status, 400);
    assert.match(traversal.error, /非法的文件路径/);
    // 以 - 开头的路径被 sanitizeGitPath 拦下
    const dash = await harness.call("git/ignore", { path: "-rf" });
    assert.equal(dash.status, 400);
    await assert.rejects(readFile(join(root, ".gitignore"), "utf8"), "失败时不得写出 .gitignore");
  } finally {
    await cleanupRepo(root);
  }
});

test("host：非 git 仓库返回 400，且路由白名单放行 git/ignore", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "hud-ignore-norepo-"));
  try {
    await writeFile(join(dir, "a.txt"), "a\n");
    const harness = createHarness(dir);
    const body = await harness.call("git/ignore", { path: "a.txt" });
    assert.equal(body.status, 400);
    assert.match(body.error, /不是 git 仓库/);
    const unknown = await harness.call("git/not-a-method", {});
    assert.equal(unknown.status, 404);
  } finally {
    await cleanupRepo(dir);
  }
});

test("host：目录规则对目录内的新文件立即生效", async () => {
  const root = await createRepo("hud-ignore-");
  try {
    await mkdir(join(root, "build"), { recursive: true });
    await writeFile(join(root, "build/out.js"), "x\n");
    const harness = createHarness(root);
    const body = await harness.call("git/ignore", { path: "build", kind: "dir" });
    assert.equal(body.status, 200);
    // 之后新加的同目录文件应被 git 直接忽略（不再出现在 status 中）
    await writeFile(join(root, "build/extra.js"), "y\n");
    const status = await gitIn(root, ["status", "--porcelain", "--", "build"]);
    assert.equal(status.trim(), "", "整个目录已被忽略");
  } finally {
    await cleanupRepo(root);
  }
});
