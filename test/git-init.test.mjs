import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import vm from "node:vm";
import { apply } from "../lib/index.js";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** 假 subprocess：按 argv 模拟「非仓库 → git init → 仓库」的真实命令序列。 */
function createFakeSubprocess(options = {}) {
  const { initialRepo = false, initFailure = null } = options;
  const calls = [];
  let isRepo = initialRepo;
  const respond = (line) => {
    if (line === "git rev-parse --is-inside-work-tree --git-dir") {
      return isRepo
        ? { exitCode: 0, stdout: "true\n.git\n", stderr: "" }
        : { exitCode: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" };
    }
    if (line === "git init") {
      if (initFailure !== null) return { exitCode: 128, stdout: "", stderr: initFailure };
      isRepo = true;
      return { exitCode: 0, stdout: "Initialized empty Git repository in /workspace/.git/\n", stderr: "" };
    }
    if (line === "git symbolic-ref --short -q HEAD") {
      return isRepo ? { exitCode: 0, stdout: "master\n", stderr: "" } : { exitCode: 1, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return {
    calls,
    subprocess: {
      spawn: ({ argv }) => {
        calls.push(argv);
        const result = respond(argv.join(" "));
        return {
          done: Promise.resolve({ exitCode: result.exitCode }),
          collected: {
            stdout: { readFrom: () => ({ text: result.stdout }) },
            stderr: { readFrom: () => ({ text: result.stderr }) },
          },
        };
      },
    },
  };
}

/** 复用真实 host 路由（含方法分发表）发一次 JSON 请求，确保 git/init 已注册。 */
function createHarness(subprocess) {
  const routes = [];
  const services = {
    subprocess,
    sessions: { get: (id) => (id === "fixture" ? { header: { cwd: "/workspace" } } : undefined) },
  };
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => fn(),
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  apply(ctx, { modules: { get: () => ({}) }, usage: { get: () => ({}) } });
  const api = routes.find((route) => route.path === "/awesome-hud/api").handler;
  return async function call(endpoint, body = { sessionId: "fixture" }) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: "POST", url: "/awesome-hud/api/" + endpoint, headers: { host: "127.0.0.1:1234" } });
    let status;
    let result;
    await api(req, { writeHead: (code) => { status = code; }, end: (data) => { result = JSON.parse(data); } });
    return { status, ...result };
  };
}

test("非仓库工作区：执行 git init 并回传仓库快照", async () => {
  const fake = createFakeSubprocess();
  const call = createHarness(fake.subprocess);

  const response = await call("git/init");
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(response.ok, true);
  assert.equal(response.isRepo, true);
  assert.equal(response.branch, "master");
  assert.equal(response.changedCount, 0);
  assert.deepEqual(Array.from(response.files), []);

  // 命令顺序：先探测（非仓库）→ git init → 再采快照；且只 init 一次
  const lines = fake.calls.map((argv) => argv.join(" "));
  const probe = "git rev-parse --is-inside-work-tree --git-dir";
  assert.equal(lines.filter((line) => line === "git init").length, 1);
  assert.ok(lines.indexOf("git init") > lines.indexOf(probe), "init 必须在校验非仓库之后");
  assert.ok(lines.lastIndexOf(probe) > lines.indexOf("git init"), "init 之后必须重新采集快照");
});

test("已是仓库时保持幂等：不重复执行 git init", async () => {
  const fake = createFakeSubprocess({ initialRepo: true });
  const call = createHarness(fake.subprocess);

  const response = await call("git/init");
  assert.equal(response.status, 200);
  assert.equal(response.isRepo, true);
  assert.equal(response.branch, "master");
  assert.equal(fake.calls.some((argv) => argv.join(" ") === "git init"), false, "仓库内不得重复 init");
});

test("git init 失败时返回 400 与命令错误信息", async () => {
  const fake = createFakeSubprocess({ initFailure: "fatal: cannot create directory .git" });
  const call = createHarness(fake.subprocess);

  const response = await call("git/init");
  assert.equal(response.status, 400);
  assert.equal(response.ok, false);
  assert.match(response.error, /cannot create directory/);
});

test("缺少会话 id 或会话无工作区时拒绝初始化", async () => {
  const fake = createFakeSubprocess();
  const call = createHarness(fake.subprocess);

  const missing = await call("git/init", {});
  assert.equal(missing.status, 400);
  assert.match(missing.error, /会话 id/);

  const unknown = await call("git/init", { sessionId: "other" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.error, /找不到会话/);
  assert.equal(fake.calls.some((argv) => argv.join(" ") === "git init"), false);
});

/** 从 from 起截取一段括号平衡的表达式（遇顶层逗号停止）。 */
function extractExpression(from) {
  let depth = 0;
  let index = from;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) break;
  }
  return source.slice(from, index).trim();
}

const headExtra = extractExpression(source.indexOf("extra: isRepo") + "extra: ".length);

test("Git 模块标题栏：非仓库展示「初始化仓库」，仓库展示分支切换按钮", () => {
  assert.ok(headExtra.startsWith("isRepo"), "extra 必须以「是否仓库」分流");
  const sandbox = {
    react: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Icon: "Icon",
    t: (key) => key,
    props: { git: {} },
    branchBtnRef: { marker: "branchBtn" },
    toggleBranchMenu: () => {},
    initRepo: () => {},
    initBusy: false,
  };
  // 非仓库：同一位置渲染「初始化仓库」按钮
  const initButton = vm.runInNewContext(headExtra, { ...sandbox, isRepo: false });
  assert.equal(initButton.type, "button");
  assert.equal(initButton.props.className, "hud-btn-small hud-git-btn");
  assert.equal(initButton.props.title, "gitInitRepoTitle");
  assert.equal(initButton.props["aria-label"], "gitInitRepoTitle");
  assert.equal(initButton.props.disabled, false);
  assert.equal(initButton.children[0].type, "Icon");
  assert.equal(initButton.children[0].props.name, "plus");
  assert.equal(initButton.children[1], "gitInitRepo");

  // 初始化进行中：按钮置灰
  const busy = vm.runInNewContext(headExtra, { ...sandbox, isRepo: false, initBusy: true });
  assert.equal(busy.props.disabled, true);

  // 仓库：仍是分支切换按钮（位置相同），不出现「初始化仓库」
  const repoExtra = vm.runInNewContext(headExtra, { ...sandbox, isRepo: true, props: { git: { branch: "main" } } });
  assert.equal(repoExtra.props.className, "hud-btn-small hud-git-btn hud-branch-switch");
  assert.equal(repoExtra.props.ref.marker, "branchBtn");
  assert.equal(repoExtra.children[1].children[0], "main");

  // 仓库但无分支名（分离 HEAD 且读不到名字）：不渲染任何按钮
  const noBranch = vm.runInNewContext(headExtra, { ...sandbox, isRepo: true, props: { git: { branch: null } } });
  assert.equal(noBranch, null);
});

test("Git 模块：非仓库正文只展示提示，仓库正文保留动作与统计", () => {
  // 非仓库：正文首子节点是提示文案（不渲染 git graph / commit / revert）
  assert.match(source, /const isRepo = props\.git\?\.isRepo === true;/);
  assert.match(source, /const gitFiles = Array\.isArray\(props\.git\?\.files\) \? props\.git\.files : \[\];/);
  assert.match(source, /: react\.createElement\("div", \{ className: "hud-git-summary" \}, t\("gitNoRepo"\)\),/);
  assert.match(source, /isRepo \? react\.createElement\("div", \{ className: "hud-git-summary" \}, summaryText\) : null\)\)/);
  // 非仓库不再被渲染条件挡掉：只要求拿到快照（isRepo 由模块内部处理）。
  // 合并 main 的「首帧加载态」后：拿到快照即渲染 GitModule，未就绪时显示加载占位。
  assert.match(source, /activeModules\.git === false \|\| moduleSessionId === "" \? null : git === null \? react\.createElement\(ModulePlaceholder, \{ module: "git" \}\) : react\.createElement\(GitModule, \{/);
  assert.doesNotMatch(source, /git\.isRepo !== true \? null : react\.createElement\(GitModule/);
  // 变更计数与分组读取安全（非仓库快照没有 files）
  assert.match(source, /for \(const file of gitFiles\) \{/);
  assert.match(source, /const stagedFiles = gitFiles\.filter\(\(file\) => file\.staged === true\);/);
  assert.match(source, /const changesFiles = gitFiles\.filter\(\(file\) => file\.unstaged === true\);/);
});

test("端到端：非仓库快照渲染「初始化仓库」，init 后的快照渲染分支按钮", async () => {
  const fake = createFakeSubprocess();
  const call = createHarness(fake.subprocess);
  const renderExtra = (snapshot) => vm.runInNewContext(headExtra, {
    react: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Icon: "Icon",
    t: (key) => key,
    props: { git: snapshot },
    branchBtnRef: { marker: "branchBtn" },
    toggleBranchMenu: () => {},
    initRepo: () => {},
    initBusy: false,
    isRepo: snapshot.isRepo === true,
  });

  // 初始化前：host 返回非仓库快照 → 右侧是「初始化仓库」
  const before = await call("git");
  assert.equal(before.isRepo, false);
  assert.equal(renderExtra(before).children[1], "gitInitRepo");

  // 点击后：host 执行 init 并回传仓库快照 → 同一位置换成分支按钮
  const after = await call("git/init");
  const head = renderExtra(after);
  assert.equal(head.props.className, "hud-btn-small hud-git-btn hud-branch-switch");
  assert.equal(head.children[1].children[0], after.branch);
});

test("初始化仓库的调用、提示与中英文案齐备", () => {
  assert.match(source, /const initRepo = async \(event\) => \{/);
  assert.match(source, /event\?\.stopPropagation\?\.\(\); \/\/ 避免触发模块折叠/);
  assert.match(source, /const snapshot = await call\("git\/init", \{ sessionId: props\.sessionId \}\);/);
  assert.match(source, /toast\(t\("gitInitDone"\), "success"\);/);
  assert.match(source, /toast\(interpolate\(t\("gitInitFailed"\), \{ detail: error\?\.message \?\? String\(error\) \}\), "error"\);/);
  assert.match(source, /gitInitRepo: "初始化仓库",/);
  assert.match(source, /gitInitRepoTitle: "在当前工作区初始化 git 仓库",/);
  assert.match(source, /gitNoRepo: "当前工作区不是 git 仓库",/);
  assert.match(source, /gitInitRepo: "init repo",/);
  assert.match(source, /gitNoRepo: "The current workspace is not a git repository",/);
});
