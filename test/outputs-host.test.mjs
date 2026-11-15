// dsh-awesome-hud — v0.21.0：产物绝对路径与「在文件夹显示」Host 接口
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { createHarness, createRepo, cleanupRepo } from "./helpers/host-harness.mjs";

function fixtureServices(root, calls) {
  return {
    sessions: {
      get: (id) => (id === "fixture" ? {
        header: { cwd: root },
        snapshotEvents: () => [{ type: "workspace/changes", seq: 1, data: { turn: 1 } }],
      } : undefined),
    },
    workspaceChanges: {
      summary: () => ({ turn: 1, files: [{ path: "docs/a.md", display: "docs/a.md" }], stats: 1 }),
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
