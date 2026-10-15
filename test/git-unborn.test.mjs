import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";

const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

/** 真实 git 的 subprocess 适配器：对齐 DSH subprocess provider 的最小契约（done + collected）。 */
function localSubprocess() {
  return {
    spawn({ argv, cwd, signal }) {
      const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const done = new Promise((resolve) => {
        child.on("close", (code) => resolve({ exitCode: code ?? 0 }));
        child.on("error", () => resolve({ exitCode: 128 }));
      });
      signal?.addEventListener("abort", () => { child.kill("SIGKILL"); }, { once: true });
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: stderr }) },
        },
      };
    },
  };
}

/** 直接跑一次 git（仅用于测试夹具准备）。 */
function gitIn(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")}: ${stderr}`))));
  });
}

/** 通过真实 host 路由（含方法分发表）发一次 JSON 请求。 */
function createHarness(cwd) {
  const routes = [];
  const services = {
    subprocess: localSubprocess(),
    sessions: { get: (id) => (id === "fixture" ? { header: { cwd } } : undefined) },
  };
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => fn(),
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  apply(ctx, { modules: { get: () => ({}) }, usage: { get: () => ({}) } });
  const api = routes.find((route) => route.path === "/awesome-hud/api").handler;
  return async function call(endpoint, body = {}) {
    // 默认带上夹具会话 id；显式传 sessionId 时以显式值为准
    const payload = { sessionId: "fixture", ...body };
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, { method: "POST", url: "/awesome-hud/api/" + endpoint, headers: { host: "127.0.0.1:1234" } });
    let status;
    let result;
    await api(req, { writeHead: (code) => { status = code; }, end: (data) => { result = JSON.parse(data); } });
    return { status, ...result };
  };
}

test("尚无提交的仓库：暂存后取消暂存（全部 / 单个）都可用，git graph 返回空历史", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "hud-unborn-"));
  try {
    await gitIn(root, ["init", "-b", "main"]);
    await gitIn(root, ["config", "user.email", "hud-test@example.invalid"]);
    await gitIn(root, ["config", "user.name", "HUD Test"]);
    await gitIn(root, ["config", "commit.gpgsign", "false"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "a.txt"), "hello\n");
    await writeFile(join(root, "docs/b.md"), "# b\n");
    const call = createHarness(root);

    // 空仓库：两个文件的变更可见，尚未暂存
    const initial = await call("git");
    assert.equal(initial.isRepo, true);
    assert.equal(initial.branch, "main");
    assert.equal(initial.counts.staged, 0);

    // 暂存全部 → 取消暂存全部（旧实现用 restore --staged，会报 could not resolve HEAD）
    const staged = await call("git/stage-all");
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(staged.counts.staged, 2);
    const cleared = await call("git/unstage-all");
    assert.equal(cleared.status, 200, JSON.stringify(cleared));
    assert.equal(cleared.counts.staged, 0);
    assert.deepEqual(Array.from(cleared.files, (file) => file.status), ["?", "?"]);

    // 单个文件：暂存后再取消暂存
    const one = await call("git/stage", { sessionId: "fixture", path: "a.txt" });
    assert.equal(one.counts.staged, 1);
    const single = await call("git/unstage", { sessionId: "fixture", path: "a.txt" });
    assert.equal(single.status, 200, JSON.stringify(single));
    assert.equal(single.counts.staged, 0);

    // 无提交时打开 git graph：空历史而不是 git log 的原始报错
    const graph = await call("git/graph", { offset: 0 });
    assert.equal(graph.status, 200);
    assert.deepEqual(Array.from(graph.commits), []);
    assert.equal(graph.hasMore, false);
    assert.equal(graph.error, undefined);
    assert.equal(graph.currentBranch, "main");

    // 首个提交后：图形返回该提交，取消暂存仍正常
    await gitIn(root, ["add", "-A"]);
    await gitIn(root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "chore: seed"]);
    const afterCommit = await call("git/graph", { offset: 0 });
    assert.equal(afterCommit.commits.length, 1);
    assert.equal(afterCommit.error, undefined);

    await writeFile(join(root, "a.txt"), "changed\n");
    const stagedAgain = await call("git/stage-all");
    assert.equal(stagedAgain.counts.staged, 1);
    const clearedAgain = await call("git/unstage-all");
    assert.equal(clearedAgain.status, 200, JSON.stringify(clearedAgain));
    assert.equal(clearedAgain.counts.staged, 0);
    assert.equal(clearedAgain.files[0].status, "M");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("取消暂存改用 reset（两种仓库通用），不再依赖 HEAD", () => {
  assert.match(hostSource, /await runGit\(subprocess, cwd, \["reset", "-q", "--", path\]\);/);
  assert.match(hostSource, /await runGit\(subprocess, cwd, \["reset", "-q", "--", \.\.\.targets\.slice\(i, i \+ 500\)\]\);/);
  assert.doesNotMatch(hostSource, /"restore", "--staged"/);
  // 空仓库的 graph 走空历史分支（先探测 HEAD 是否可解析）
  assert.match(hostSource, /await runGit\(subprocess, cwd, \["rev-parse", "-q", "--verify", "HEAD"\]\);/);
  assert.match(hostSource, /if \(headRaw\.exitCode !== 0\) return \{ currentBranch, commits: \[\], hasMore: false \};/);
});

test("git graph 弹窗为空历史提供空态（而非 git log 的原始报错）", () => {
  const clientSource = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.match(clientSource, /: graphState\.commits\.length === 0\s*\n\s*\/\/ 仓库还没有任何提交（刚初始化）：空态而非 git log 的原始报错\s*\n\s*\? react\.createElement\("div", \{ className: "hud-graph-empty" \}, t\("graphEmpty"\)\)/);
  assert.match(clientSource, /graphEmpty: "当前仓库还没有任何提交",/);
  assert.match(clientSource, /graphEmpty: "This repository has no commits yet",/);
  assert.match(clientSource, /\.hud-graph-empty\{display:flex;align-items:center;justify-content:center;min-height:120px/);
});
