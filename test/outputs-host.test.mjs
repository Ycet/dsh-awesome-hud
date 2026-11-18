// dsh-awesome-hud — v0.21.0：产物绝对路径与「在文件夹显示」Host 接口
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createHarness, createRepo, cleanupRepo } from "./helpers/host-harness.mjs";

function fixtureServices(root, calls) {
  return {
    sessions: {
      get: (id) => (id === "fixture" ? {
        header: { cwd: root },
        // v0.21.4：产物只认 durable 的 write/edit 证据。
        snapshotEvents: () => [{ type: "tool/call", seq: 1, time: 1000, data: { turn: 1, name: "write", arguments: JSON.stringify({ file_path: "docs/a.md" }) } }],
      } : undefined),
    },
    sessionController: {
      openWorkspacePath: async (request) => { calls.push(request); return { opened: true }; },
    },
  };
}

test("outputs：每个文件带 Host 侧绝对路径", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-host-");
  try {
    const calls = [];
    const { call } = createHarness(root, fixtureServices(root, calls));
    const body = await call("outputs");
    assert.equal(body.status, 200, JSON.stringify(body));
    const file = body.files.find((item) => item.path === "docs/a.md");
    assert.ok(file, "产物列表应包含 docs/a.md");
    assert.equal(file.absolutePath, join(root, "docs/a.md"));
    assert.equal(file.address.startsWith("dsh-resource://file/session/"), true);
  } finally { await cleanupRepo(root); }
});

test("workspace/reveal-file：只允许工作区内文件，并在文件管理器中选中文件", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-reveal-file-");
  try {
    const calls = [];
    const { call } = createHarness(root, fixtureServices(root, calls));
    const ok = await call("workspace/reveal-file", { path: "docs/a.md" });
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "reveal");
    assert.equal(calls[0].path, await realpath(join(root, "docs/a.md")), "应传真实绝对路径（macOS 上 /var 会解析为 /private/var）");

    const traversal = await call("workspace/reveal-file", { path: "../outside.md" });
    assert.equal(traversal.status, 400, "拒绝工作区外的路径");
    const absolute = await call("workspace/reveal-file", { path: "/etc/passwd" });
    assert.equal(absolute.status, 400);
    const missing = await call("workspace/reveal-file", { path: "docs/missing.md" });
    assert.equal(missing.status, 404);
    const dir = await call("workspace/reveal-file", { path: "docs" });
    assert.equal(dir.status, 400, "目录不算产物文件");
  } finally { await cleanupRepo(root); }
});

// —— v0.21.3：产物把子会话（子代理）写出的文件一并返回 ——

test("outputs：子会话产物合并进列表，冷读的观察在使用后释放", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-subagent-");
  try {
    await mkdir(join(root, "docs/sub"), { recursive: true });
    await writeFile(join(root, "docs/sub/b.md"), "b\n");
    await writeFile(join(root, "docs/sub/live.md"), "live\n");
    const disposed = [];
    const { call } = createHarness(root, {
      ...fixtureServices(root, []),
      // 仍在内存里的子会话走 snapshotEvents；已结束的走 sessionQuery 冷读。
      sessions: {
        get: (id) => (id === "fixture" ? {
          header: { cwd: root },
          snapshotEvents: () => [{ type: "tool/call", seq: 1, time: 1, data: { turn: 1, name: "write", arguments: JSON.stringify({ file_path: "docs/a.md" }) } }],
        } : id === "child-2" ? {
          header: { cwd: root },
          // fork 子代理：前两条是继承来的父会话事件，不能算成子会话自己的产物。
          inheritedEventCount: 2,
          snapshotEvents: () => [{
            type: "tool/call",
            seq: 0,
            time: Date.now() - 2,
            data: { name: "write", arguments: JSON.stringify({ file_path: "docs/inherited.md" }) },
          }, {
            type: "tool/call",
            seq: 1,
            time: Date.now() - 1,
            data: { name: "write", arguments: JSON.stringify({ file_path: "docs/inherited.md" }) },
          }, {
            type: "tool/call",
            seq: 2,
            time: Date.now() + 1,
            data: { name: "edit", arguments: JSON.stringify({ file_path: "docs/sub/live.md" }) },
          }],
        } : undefined),
      },
      subagents: {
        listDescendants: async () => [
          { kind: "child", id: "child-1", mode: "one-shot", activity: "inactive", depth: 1, parentId: "fixture" },
          { kind: "child", id: "child-2", mode: "continuable", activity: "running", depth: 1, parentId: "fixture" },
          // 诊断行（日志损坏 / 不可读）必须跳过，不能中断主会话的产物。
          { kind: "diagnostic", id: "child-broken", depth: 1, parentId: "fixture", reason: "corrupt" },
        ],
      },
      sessionQuery: {
        observeSession: async (id) => ({
          header: { cwd: root },
          events: [
            {
              type: "tool/call",
              seq: 1,
              time: Date.now(),
              data: { name: "write", arguments: JSON.stringify({ file_path: join(root, "docs/sub/b.md") }) },
            },
          ],
          [Symbol.dispose]: () => { disposed.push(id); },
        }),
      },
    });
    const body = await call("outputs");
    assert.equal(body.status, 200, JSON.stringify(body));
    const child = body.files.find((item) => item.path === "docs/sub/b.md");
    assert.ok(child, "子会话写出的文件应在产物里");
    assert.equal(child.source, "subagent", "标记来源为子会话");
    assert.equal(child.absolutePath, join(root, "docs/sub/b.md"));
    assert.equal(child.address, "dsh-resource://file/session/fixture/docs/sub/b.md", "地址仍用主会话 id");
    assert.equal(body.files.find((item) => item.path === "docs/sub/live.md")?.source, "subagent", "活着的子会话走内存事件");
    assert.equal(body.files.some((item) => item.path === "docs/inherited.md"), false, "fork 继承来的前缀事件不算子会话产物");
    assert.ok(body.files.some((item) => item.path === "docs/a.md"), "主会话产物不受影响");
    assert.deepEqual(disposed, ["child-1"], "诊断行不读取，读到的观察立即释放；内存会话无需冷读");
  } finally { await cleanupRepo(root); }
});

test("outputs：子代理服务缺失或报错时只影响子会话产物", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-nosubagent-");
  try {
    const missing = createHarness(root, fixtureServices(root, []));
    const withoutService = await missing.call("outputs");
    assert.equal(withoutService.status, 200, "没有 subagents 服务时仍返回主会话产物");
    assert.deepEqual(withoutService.files.map((item) => item.path), ["docs/a.md"]);

    const broken = createHarness(root, {
      ...fixtureServices(root, []),
      subagents: { listDescendants: async () => { throw new Error("catalog unavailable"); } },
    });
    const failed = await broken.call("outputs");
    assert.equal(failed.status, 200, "子会话读取失败不影响主会话产物");
    assert.deepEqual(failed.files.map((item) => item.path), ["docs/a.md"]);
  } finally { await cleanupRepo(root); }
});

// —— v0.21.3：分支会话延续来源会话的产物 ——

/** 构造一条 write 工具调用事件。 */
const forkWrite = (seq, time, filePath) => ({
  type: "tool/call",
  seq,
  time,
  data: { name: "write", arguments: JSON.stringify({ file_path: filePath }) },
});

/**
 * 分支场景夹具：
 *  父会话 parent-1 的日志前缀被 fixture 会话逐字继承，边界事件（turn/end）时间与类型一致；
 *  前缀里的 job 事件 owner 指向 parent-1，宿主据此认出 fork 来源。
 */
function forkFixture(root, disposed = []) {
  const boundary = { type: "turn/end", seq: 2, time: 1000, data: { turn: 1 } };
  const prefix = [
    { type: "job/registered", seq: 0, time: 900, data: { jobId: "j1", owner: "parent-1" } },
    { type: "workspace/changes", seq: 1, time: 950, data: { turn: 1 } },
    boundary,
    { type: "session/end-seed", seq: 3, time: 1000, data: { inherited: true } },
  ];
  const own = forkWrite(4, 1100, "docs/notes.md");
  return {
    sessions: {
      get: (id) => (id === "fixture" ? {
        header: { cwd: root },
        inheritedEventCount: 3,
        eventAt: (seq) => [undefined, undefined, boundary][seq],
        snapshotEvents: () => [...prefix, own],
      } : id === "parent-1" ? {
        header: { cwd: root },
        inheritedEventCount: 0,
        eventAt: (seq) => [undefined, undefined, boundary][seq],
        snapshotEvents: () => [...prefix, { type: "subagent/catalog", seq: 3, time: 1001, data: { childId: "child-9" } }],
      } : undefined),
    },
    subagents: {
      listDescendants: async (id) => (id === "parent-1"
        ? [{ kind: "child", id: "child-9", mode: "one-shot", activity: "inactive", depth: 1, parentId: "parent-1" }]
        : []),
    },
    sessionQuery: {
      observeSession: async (id) => {
        if (id !== "child-9") throw new Error("unavailable");
        return {
          header: { cwd: root },
          inheritedEventCount: 0,
          events: [forkWrite(0, 1200, "docs/handoff/handoff.md")],
          [Symbol.dispose]: () => { disposed.push(id); },
        };
      },
    },
  };
}

test("outputs：分支会话认出 fork 来源，延续来源会话的子代理产物", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-fork-");
  try {
    await mkdir(join(root, "docs/handoff"), { recursive: true });
    await writeFile(join(root, "docs/handoff/handoff.md"), "h\n");
    await writeFile(join(root, "docs/notes.md"), "n\n");
    const disposed = [];
    const { call } = createHarness(root, forkFixture(root, disposed));
    const body = await call("outputs");
    assert.equal(body.status, 200, JSON.stringify(body));
    assert.equal(body.forkSource, "parent-1", "分支会话应认出 fork 来源");
    const paths = body.files.map((item) => item.path);
    assert.ok(paths.includes("docs/handoff/handoff.md"), "来源会话的子代理产物同样列出");
    assert.ok(paths.includes("docs/notes.md"), "分支自己的 write 照常收录");
    assert.equal(body.files.find((item) => item.path === "docs/handoff/handoff.md")?.source, "subagent");
    assert.deepEqual(disposed, ["child-9"], "子代理日志读完即释放");
  } finally { await cleanupRepo(root); }
});

test("outputs：边界事件对不上时不认来源，仅按本会话证据列出", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-fork-mismatch-");
  try {
    await mkdir(join(root, "docs/handoff"), { recursive: true });
    await writeFile(join(root, "docs/handoff/handoff.md"), "h\n");
    await writeFile(join(root, "docs/notes.md"), "n\n");
    const fixture = forkFixture(root);
    // 来源会话在同一 seq 上是别的事件：不能凭 owner 字段就认账。
    const tampered = {
      ...fixture.sessions,
      get: (id) => (id === "parent-1" ? {
        header: { cwd: root },
        inheritedEventCount: 0,
        eventAt: () => ({ type: "step/start", seq: 2, time: 999 }),
        snapshotEvents: () => [],
      } : fixture.sessions.get(id)),
    };
    const { call } = createHarness(root, { ...fixture, sessions: tampered });
    const body = await call("outputs");
    assert.equal(body.status, 200, JSON.stringify(body));
    assert.equal(body.forkSource, null, "边界事件不一致时不认来源");
    assert.deepEqual(body.files.map((item) => item.path), ["docs/notes.md"], "只剩分支自己的产物");
  } finally { await cleanupRepo(root); }
});

test("outputs：子代理服务缺失时仍能靠日志里的 subagent/catalog 收录子代理产物", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-catalog-");
  try {
    await mkdir(join(root, "docs/sub"), { recursive: true });
    await writeFile(join(root, "docs/sub/c.md"), "c\n");
    const childEvents = [forkWrite(0, 500, "docs/sub/c.md")];
    const { call } = createHarness(root, {
      sessions: {
        get: (id) => (id === "fixture" ? {
          header: { cwd: root },
          snapshotEvents: () => [
            { type: "tool/call", seq: 1, time: 100, data: { turn: 1, name: "write", arguments: JSON.stringify({ file_path: "docs/a.md" }) } },
            // 目录事件是 durable 的：即使子代理服务不可用也能拿到直接子代理。
            { type: "subagent/catalog", seq: 2, time: 200, data: { childId: "child-3", mode: "one-shot" } },
          ],
        } : id === "child-3" ? {
          header: { cwd: root },
          inheritedEventCount: 0,
          snapshotEvents: () => childEvents,
        } : undefined),
      },
    });
    const body = await call("outputs");
    assert.equal(body.status, 200, JSON.stringify(body));
    const child = body.files.find((item) => item.path === "docs/sub/c.md");
    assert.ok(child, "日志里的子代理目录足以定位子代理会话");
    assert.equal(child.source, "subagent");
    assert.ok(body.files.some((item) => item.path === "docs/a.md"), "主会话产物不受影响");
  } finally { await cleanupRepo(root); }
});

test("outputs：子代理会话不认 fork 来源，避免混进父会话其它子代理的产物", { timeout: 30000 }, async () => {
  const root = await createRepo("hud-outputs-subagent-page-");
  try {
    await mkdir(join(root, "docs/handoff"), { recursive: true });
    await writeFile(join(root, "docs/handoff/handoff.md"), "h\n");
    await writeFile(join(root, "docs/own.md"), "o\n");
    const fixture = forkFixture(root);
    const child = forkWrite(4, 1100, "docs/own.md");
    const { call } = createHarness(root, {
      ...fixture,
      sessions: {
        ...fixture.sessions,
        get: (id) => (id === "fixture" ? {
          // 子代理会话：header 记录 parentSession，日志同样有继承前缀。
          header: { cwd: root, parentSession: "parent-1" },
          inheritedEventCount: 3,
          eventAt: () => ({ type: "turn/end", seq: 2, time: 1000 }),
          snapshotEvents: () => [{ type: "job/registered", seq: 0, time: 900, data: { owner: "parent-1" } }, { type: "session/end-seed", seq: 1, time: 1000, data: { inherited: true } }, child],
        } : fixture.sessions.get(id)),
      },
    });
    const body = await call("outputs");
    assert.equal(body.status, 200, JSON.stringify(body));
    assert.equal(body.forkSource, null, "子代理会话不认 fork 来源");
    assert.deepEqual(body.files.map((item) => item.path), ["docs/own.md"], "只列自己的产物");
  } finally { await cleanupRepo(root); }
});
