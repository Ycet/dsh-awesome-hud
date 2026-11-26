import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import vm from "node:vm";
import { apply } from "../lib/index.js";
import { hudClient, moduleOf, nodes } from "./helpers/client-harness.mjs";

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
  // v0.21.7：会话缺失统一 404 + missing-session（预期内暂态，客户端据此自愈不落错误）
  assert.equal(unknown.status, 404);
  assert.equal(unknown.code, "missing-session");
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

// v0.21.2：标题行按钮改成「加载中 → 空 / 仓库 → 分支 / 非仓库 → 初始化」三段分流。
// v0.21.7（issue #3）：错误终态优先于加载态，右侧为「重试」按钮。
const headExtra = extractExpression(source.indexOf("extra: erroring") + "extra: ".length);

test("Git 模块标题栏：加载中不出按钮，非仓库展示「初始化仓库」，仓库展示分支切换按钮", () => {
  assert.ok(headExtra.startsWith("erroring"), "extra 必须以「错误终态」优先分流");
  const sandbox = {
    react: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Icon: "Icon",
    t: (key) => key,
    props: { git: {} },
    branchBtnRef: { marker: "branchBtn" },
    toggleBranchMenu: () => {},
    initRepo: () => {},
    initBusy: false,
    retryBusy: false,
    retryGit: () => {},
  };
  // 错误终态：右侧是「重试」按钮
  const retry = vm.runInNewContext(headExtra, { ...sandbox, erroring: true, loading: false, isRepo: false });
  assert.equal(retry.type, "button");
  assert.equal(retry.props.className, "hud-btn-small hud-git-btn");
  assert.equal(retry.props.title, "gitRetry");
  assert.equal(retry.children[0].props.name, "refresh");
  assert.equal(retry.children[1], "gitRetry");
  // 重试进行中：按钮置灰
  const retryBusyState = vm.runInNewContext(headExtra, { ...sandbox, erroring: true, loading: false, isRepo: false, retryBusy: true });
  assert.equal(retryBusyState.props.disabled, true);
  // 加载中：两侧都还判断不出来，标题行右侧留空
  const pending = vm.runInNewContext(headExtra, { ...sandbox, erroring: false, loading: true, isRepo: false });
  assert.equal(pending, null, "加载中不得先摆「初始化仓库」或分支按钮");
  // 非仓库：同一位置渲染「初始化仓库」按钮
  const initButton = vm.runInNewContext(headExtra, { ...sandbox, erroring: false, loading: false, isRepo: false });
  assert.equal(initButton.type, "button");
  assert.equal(initButton.props.className, "hud-btn-small hud-git-btn");
  assert.equal(initButton.props.title, "gitInitRepoTitle");
  assert.equal(initButton.props["aria-label"], "gitInitRepoTitle");
  assert.equal(initButton.props.disabled, false);
  assert.equal(initButton.children[0].type, "Icon");
  assert.equal(initButton.children[0].props.name, "plus");
  assert.equal(initButton.children[1], "gitInitRepo");

  // 初始化进行中：按钮置灰
  const busy = vm.runInNewContext(headExtra, { ...sandbox, erroring: false, loading: false, isRepo: false, initBusy: true });
  assert.equal(busy.props.disabled, true);

  // 仓库：仍是分支切换按钮（位置相同），不出现「初始化仓库」
  const repoExtra = vm.runInNewContext(headExtra, { ...sandbox, erroring: false, loading: false, isRepo: true, props: { git: { branch: "main" } } });
  assert.equal(repoExtra.props.className, "hud-btn-small hud-git-btn hud-branch-switch");
  assert.equal(repoExtra.props.ref.marker, "branchBtn");
  assert.equal(repoExtra.children[1].children[0], "main");

  // 仓库但无分支名（分离 HEAD 且读不到名字）：不渲染任何按钮
  const noBranch = vm.runInNewContext(headExtra, { ...sandbox, erroring: false, loading: false, isRepo: true, props: { git: { branch: null } } });
  assert.equal(noBranch, null);
});

test("Git 模块：加载中先给提示，非仓库只展示提示，仓库正文保留动作与统计", () => {
  // v0.21.2：快照未到（null）算加载中，正文先渲染一行加载提示
  // v0.21.7（issue #3）：错误终态（props.gitError）优先于加载态，避免 403 永远转圈
  assert.match(source, /const loading = \(props\.git === null \|\| props\.git === undefined\) && props\.gitError == null;/);
  assert.match(source, /const erroring = \(props\.git === null \|\| props\.git === undefined\) && props\.gitError != null;/);
  assert.match(source, /const isRepo = loading !== true && erroring !== true && props\.git\.isRepo === true;/);
  assert.match(source, /const gitFiles = isRepo && Array\.isArray\(props\.git\.files\) \? props\.git\.files : \[\];/);
  assert.match(source, /loading\n\t+\? react\.createElement\("div", \{ className: "hud-git-loading", role: "status", "aria-live": "polite" \}, t\("gitLoading"\)\)/);
  // 非仓库：正文是提示文案（不渲染 git graph / commit / revert）
  assert.match(source, /: react\.createElement\("div", \{ className: "hud-git-summary" \}, t\("gitNoRepo"\)\),/);
  assert.match(source, /isRepo \? react\.createElement\("div", \{ className: "hud-git-summary" \}, summaryText\) : null\)\)/);
  // 模块不再被「快照为空」挡掉：只要模块启用、且存在可探测的会话就渲染（加载态由模块内部处理）；
  // 例外是没有可探测会话时（空工作区新建页）保持隐藏，避免永远转圈。
  assert.match(source, /git: \(\) => activeModules\.git === false \|\| \(git === null && moduleSessionId === ""\) \? null : react\.createElement\(GitModule, \{/);
  assert.match(source, /git: git \?\? null,/);
  assert.doesNotMatch(source, /activeModules\.git === false \|\| git === null \|\| git === undefined/);
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
    retryBusy: false,
    retryGit: () => {},
    erroring: false,
    loading: false,
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
  assert.match(source, /const snapshot = await call\("git\/init", \{ sessionId: props\.sessionId, cwd: props\.cwd \}\);/);
  // v0.21.2：成功提示按宿主回报的 .gitignore 结果分流（新建 / 补全 / 未改动 / 写盘失败）。
  assert.match(source, /toast\(t\(mode === "created" \? "gitInitIgnoreCreated" : mode === "merged" \? "gitInitIgnoreMerged" : "gitInitDone"\), "success"\);/);
  assert.match(source, /if \(mode === "failed"\) toast\(interpolate\(t\("gitIgnoreFailed"\), \{ detail: ignore\?\.error \?\? "" \}\), "error"\);/);
  assert.match(source, /toast\(interpolate\(t\("gitInitFailed"\), \{ detail: error\?\.message \?\? String\(error\) \}\), "error"\);/);
  assert.match(source, /gitInitRepo: "初始化仓库",/);
  assert.match(source, /gitInitRepoTitle: "在当前工作区初始化 git 仓库",/);
  assert.match(source, /gitNoRepo: "当前工作区不是 git 仓库",/);
  assert.match(source, /gitInitRepo: "init repo",/);
  assert.match(source, /gitNoRepo: "The current workspace is not a git repository",/);
});

test("进入会话页：git 快照未到时模块直接展示加载态，标题行不摆按钮", () => {
  const client = hudClient({
    state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, displayTitle: "Session A" } } },
    current: "sess",
    workspaces: [{ workspaceId: "w1", path: "/work/session", title: "Session", updatedAt: 2, sessionIds: ["sess"] }],
  });
  const gitModule = moduleOf(client.panel(), "GitModule");
  assert.ok(gitModule !== undefined, "Git 模块必须首帧就渲染（不再等快照）");
  assert.equal(gitModule.props.git, null, "首帧快照为空 → 交给模块内的加载态");
  // 折叠状态下标题行立刻可见（默认折叠 git），右侧没有按钮
  const foldedTree = gitModule.type(gitModule.props);
  const foldedHead = nodes(foldedTree).find((node) => node.type?.name === "ModuleHead");
  assert.equal(foldedHead.props.extra, null, "折叠 + 加载中：标题行不放按钮");
  // 展开后：正文给加载提示（带 role=status，方便读屏播报）
  const tree = gitModule.type({ ...gitModule.props, fold: false });
  const loading = nodes(tree).find((node) => node.props?.className === "hud-git-loading");
  assert.ok(loading !== undefined, "加载中必须在正文给提示");
  assert.equal(loading.props.role, "status");
  assert.equal(loading.props["aria-live"], "polite");
  assert.equal(loading.children[0], "gitLoading");
  // 标题行：extra 为空（既不是分支按钮，也不是「初始化仓库」），也不显示变更计数
  const head = nodes(tree).find((node) => node.type?.name === "ModuleHead");
  assert.ok(head !== undefined, "标题行必须存在");
  assert.equal(head.props.extra, null, "加载中标题行不放按钮");
  assert.equal(head.props.countText, null, "加载中不显示变更计数");
  // 整棵子树没有任何操作按钮，也没有「不是 git 仓库」的提示
  assert.deepEqual(nodes(tree).filter((node) => node.type === "button"), [], "加载中不应出现操作按钮");
  assert.equal(nodes(tree).some((node) => (node.children ?? []).includes("gitNoRepo")), false);
});
