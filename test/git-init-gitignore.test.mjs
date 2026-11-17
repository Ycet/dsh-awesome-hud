// dsh-awesome-hud — v0.21.2：初始化仓库时创建 / 补全 .gitignore
//
// 覆盖点：
//   1. 工作区没有 .gitignore → 按通用模板新建（8 项）；
//   2. 已有但缺项 → 只追加缺失项，已有规则与换行风格保持；
//   3. 已有且齐全 → 不写盘（内容不变）；
//   4. 写盘失败 → 建仓仍成功，接口回 gitignore.mode="failed"；
//   5. git init 失败 / 已是仓库的幂等分支 → 不产生 .gitignore；
//   6. 纯函数 mergeGitignoreDefaults 的去重、换行、幂等口径。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply, sanitizeHandoffLabel } from "../lib/index.js";
import { GITIGNORE_DEFAULT_LINES, buildGitignoreTemplate, mergeGitignoreDefaults } from "../lib/git.js";

/**
 * 假 subprocess：按 argv 模拟「非仓库 → git init → 仓库」的命令序列。
 * @param {string} root 仓库根（`git rev-parse --show-toplevel` 的返回值）
 * @param {{ initialRepo?: boolean, initFailure?: string | null }} options 初始状态
 */
function createFakeSubprocess(root, options = {}) {
  const { initialRepo = false, initFailure = null } = options;
  const calls = [];
  let isRepo = initialRepo;
  const respond = (line) => {
    if (line === "git rev-parse --is-inside-work-tree --git-dir") {
      return isRepo
        ? { exitCode: 0, stdout: "true\n.git\n", stderr: "" }
        : { exitCode: 128, stdout: "", stderr: "fatal: not a git repository\n" };
    }
    if (line === "git init") {
      if (initFailure !== null) return { exitCode: 128, stdout: "", stderr: initFailure };
      isRepo = true;
      return { exitCode: 0, stdout: `Initialized empty Git repository in ${root}/.git/\n`, stderr: "" };
    }
    if (line === "git rev-parse --show-toplevel") {
      return isRepo ? { exitCode: 0, stdout: `${root}\n`, stderr: "" } : { exitCode: 128, stdout: "", stderr: "fatal\n" };
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

/** 复用真实 host 路由（含方法分发表）发一次 JSON 请求；cwd 指向临时目录。 */
function createHarness({ cwd, subprocess }) {
  const routes = [];
  const services = {
    subprocess,
    sessions: { get: (id) => (id === "fixture" ? { header: { cwd } } : undefined) },
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
    Object.assign(req, { method: "POST", url: `/awesome-hud/api/${endpoint}`, headers: { host: "127.0.0.1:1234" } });
    let status;
    let result;
    await api(req, { writeHead: (code) => { status = code; }, end: (data) => { result = JSON.parse(data); } });
    return { status, ...result };
  };
}

/** 建临时工作区目录，用例结束后自动清理。 */
async function withWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), "hud-gitignore-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mergeGitignoreDefaults：缺项补齐、已有项去重、换行风格保留、幂等", () => {
  // 空内容 → 模板全文
  const created = mergeGitignoreDefaults("");
  assert.equal(created.changed, true);
  assert.equal(created.added.length, GITIGNORE_DEFAULT_LINES.length);
  assert.equal(created.text, buildGitignoreTemplate(""));

  // 已有等价项（带不带尾斜杠视为同一项）→ 不重复添加
  const partial = mergeGitignoreDefaults("node_modules\ndist/\n");
  assert.deepEqual(partial.added.includes("node_modules/"), false, "node_modules 已存在时不得重复");
  assert.ok(partial.added.includes(".DS_Store"));
  assert.ok(partial.text.startsWith("node_modules\ndist/\n"), "已有内容必须原样保留在前");
  assert.ok(partial.text.endsWith("\n"), "结果以换行结尾");

  // 全部齐全 → changed=false，内容不动
  const complete = mergeGitignoreDefaults(buildGitignoreTemplate(""));
  assert.equal(complete.changed, false);
  assert.deepEqual(complete.added, []);

  // CRLF 文件沿用 CRLF
  const crlf = mergeGitignoreDefaults(".DS_Store\r\n");
  assert.ok(crlf.text.includes("\r\n"), "CRLF 文件继续用 CRLF");
  assert.equal(crlf.text.includes("\n.") && !crlf.text.includes("\r\n."), false, "不得混入裸 LF 新行");

  // 幂等：对结果再跑一次不再改动
  const again = mergeGitignoreDefaults(partial.text);
  assert.equal(again.changed, false);
});

test("非仓库工作区：建仓后按通用模板新建 .gitignore", async () => {
  await withWorkspace(async (dir) => {
    const fake = createFakeSubprocess(dir);
    const call = createHarness({ cwd: dir, subprocess: fake.subprocess });
    const response = await call("git/init");
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.ok, true);
    assert.equal(response.gitignore.mode, "created");
    assert.equal(response.gitignore.path, ".gitignore");
    assert.deepEqual(Array.from(response.gitignore.added), [...GITIGNORE_DEFAULT_LINES]);
    const text = await readFile(join(dir, ".gitignore"), "utf8");
    assert.equal(text, buildGitignoreTemplate(""));
    // 建仓命令只执行一次，且 .gitignore 写入在 init 之后、快照之前
    const lines = fake.calls.map((argv) => argv.join(" "));
    assert.equal(lines.filter((line) => line === "git init").length, 1);
  });
});

test("已有 .gitignore：只追加缺失的通用项，已有规则保持", async () => {
  await withWorkspace(async (dir) => {
    const before = "node_modules\ndist/\n.env\n";
    await writeFile(join(dir, ".gitignore"), before, "utf8");
    const fake = createFakeSubprocess(dir);
    const call = createHarness({ cwd: dir, subprocess: fake.subprocess });
    const response = await call("git/init");
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.gitignore.mode, "merged");
    const added = Array.from(response.gitignore.added);
    assert.ok(!added.includes("node_modules/"), "已有的 node_modules 不得重复追加");
    assert.ok(added.includes(".DS_Store"));
    const text = await readFile(join(dir, ".gitignore"), "utf8");
    assert.ok(text.startsWith(before), "原内容必须原样保留");
    // 每一行只出现一次（含等价写法）
    const lines = text.split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\/+|\/+$/g, ""));
    assert.equal(new Set(lines).size, lines.length, "不得出现重复规则");
  });
});

test("已有 .gitignore 且齐全：不写盘", async () => {
  await withWorkspace(async (dir) => {
    const template = buildGitignoreTemplate("");
    await writeFile(join(dir, ".gitignore"), template, "utf8");
    const before = await stat(join(dir, ".gitignore"));
    const fake = createFakeSubprocess(dir);
    const call = createHarness({ cwd: dir, subprocess: fake.subprocess });
    const response = await call("git/init");
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.gitignore.mode, "kept");
    assert.deepEqual(Array.from(response.gitignore.added), []);
    const after = await stat(join(dir, ".gitignore"));
    assert.equal(after.mtimeMs, before.mtimeMs, "文件不应被重写");
    assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), template);
  });
});

test("写盘失败：建仓仍成功，接口回 mode=failed 与原因", async () => {
  await withWorkspace(async (dir) => {
    // 新建同名目录制造 EISDIR：读不出来、也写不进去
    await mkdir(join(dir, ".gitignore"));
    const fake = createFakeSubprocess(dir);
    const call = createHarness({ cwd: dir, subprocess: fake.subprocess });
    const response = await call("git/init");
    assert.equal(response.status, 200, "写 .gitignore 失败不得影响建仓结果");
    assert.equal(response.ok, true);
    assert.equal(response.isRepo, true);
    assert.equal(response.gitignore.mode, "failed");
    assert.equal(typeof response.gitignore.error, "string");
    assert.ok(response.gitignore.error.length > 0);
  });
});

test("git init 失败 / 已是仓库的幂等分支：不产生 .gitignore", async () => {
  await withWorkspace(async (dir) => {
    const failing = createFakeSubprocess(dir, { initFailure: "fatal: cannot create directory .git" });
    const callFail = createHarness({ cwd: dir, subprocess: failing.subprocess });
    const failed = await callFail("git/init");
    assert.equal(failed.status, 400);
    await assert.rejects(readFile(join(dir, ".gitignore"), "utf8"), /ENOENT/);
  });
  await withWorkspace(async (dir) => {
    const repo = createFakeSubprocess(dir, { initialRepo: true });
    const callRepo = createHarness({ cwd: dir, subprocess: repo.subprocess });
    const response = await callRepo("git/init");
    assert.equal(response.status, 200);
    assert.equal(response.gitignore, undefined, "幂等分支不写 .gitignore");
    await assert.rejects(readFile(join(dir, ".gitignore"), "utf8"), /ENOENT/);
  });
});

test("交接子代理的 label 收敛：空/超长回退英文默认值", () => {
  assert.equal(sanitizeHandoffLabel("交接文档"), "交接文档");
  assert.equal(sanitizeHandoffLabel("  Handoff  "), "Handoff");
  assert.equal(sanitizeHandoffLabel(""), "Handoff");
  assert.equal(sanitizeHandoffLabel("   "), "Handoff");
  assert.equal(sanitizeHandoffLabel("x".repeat(41)), "Handoff");
  assert.equal(sanitizeHandoffLabel(null), "Handoff");
  assert.equal(sanitizeHandoffLabel(7), "Handoff");
});
