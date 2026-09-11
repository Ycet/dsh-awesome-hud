import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { collectGitSnapshot } from "../lib/index.js";
import { scanPlanEvents } from "../lib/plans.js";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("const moduleSnapshots ="), source.indexOf("// —— 面板主体 ——"));

test("plan endpoint reads modern session snapshots and legacy event arrays", async () => {
  const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const start = host.indexOf('async "plans"(payload)');
  const end = host.indexOf('async "git/stage"', start);
  const events = [{ type: "tool/call", seq: 1, data: { name: "exit_plan_mode", callId: "review", arguments: JSON.stringify({ plan: "# New plan\nSteps" }) } }];
  for (const session of [{ snapshotEvents: () => events }, { events }]) {
    const context = vm.createContext({
      ctx: { get: () => ({ get: () => session }) },
      sanitizeSessionId: id => id, scanPlanEvents,
    });
    const handler = vm.runInContext(`({${host.slice(start, end)}}).plans`, context);
    const result = await handler({ sessionId: "A" });
    assert.equal(result.plans.length, 1);
    assert.equal(result.plans[0].title, "New plan");
    assert.equal(result.plans[0].status, "pending");
  }
});

test("cached modules survive remounts and isolate session data", () => {
  let state;
  const react = {
    useState(init) { state ??= init(); return [state, value => { state = value; }]; },
    useCallback(fn) { return fn; },
  };
  const context = vm.createContext({ react });
  vm.runInContext(helpers, context);
  context.useModuleSnapshot("plans:A", [])[1](["A plan"]);
  assert.deepEqual(Array.from(context.useModuleSnapshot("plans:B", [])[0]), []);
  state = undefined;
  assert.deepEqual(Array.from(context.useModuleSnapshot("plans:A", [])[0]), ["A plan"]);
  context.useModuleSnapshot("git:/workspace", null)[1]({ isRepo: true });
  state = undefined;
  assert.equal(context.useModuleSnapshot("git:/workspace", null)[0].isRepo, true);
});

test("single-flight polling skips overlap and recovers after failure", async () => {
  const context = vm.createContext({});
  vm.runInContext(helpers, context);
  let release, count = 0;
  const poll = context.singleFlight(() => { count++; return new Promise((resolve, reject) => { release = reject; }); });
  const first = poll();
  await poll();
  assert.equal(count, 1);
  release(new Error("offline"));
  await assert.rejects(first, /offline/);
  const next = poll();
  assert.equal(count, 2);
  release(new Error("offline"));
  await assert.rejects(next);
});

test("failed polling retains modules; responses after session cleanup are ignored", async () => {
  let refresh, cleanup, fail = true;
  const values = { git: { isRepo: true }, subagents: ["child"], mcp: { total: 1 }, plans: ["plan"] };
  const context = vm.createContext({
    sessionId: "A", gitKey: "git:A", gitRevision: { current: 0 },
    moduleSessionId: "A", newSessionPage: false,
    singleFlight: fn => fn,
    react: { useEffect(fn) { cleanup = fn(); } },
    window: { setInterval(fn) { refresh = fn; }, clearInterval() {} },
    call: async method => { if (fail) throw new Error("offline"); return method === "git" ? { isRepo: false } : {}; },
    setGit: value => { values.git = value; },
    setSubagents: value => { values.subagents = value; },
    setMcp: value => { values.mcp = value; },
    setPlans: value => { values.plans = value; },
  });
  const start = source.indexOf('react.useEffect(() => {', source.indexOf('// git / 子代理 / MCP / 计划'));
  const endMarker = '}, [sessionId, gitKey, moduleSessionId, newSessionPage]);';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start > 0 && end > start, "polling effect slice must be located");
  vm.runInContext(source.slice(start, end), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(values.git.isRepo, true);
  assert.deepEqual(values.plans, ["plan"]);
  assert.deepEqual(values.subagents, ["child"]);
  assert.equal(values.mcp.total, 1);
  fail = false;
  refresh();
  cleanup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(values.git.isRepo, true);
});

test("Git transient failure is not reported as a non-repository", async () => {
  function subprocess(stderr) {
    return { spawn: () => ({ done: Promise.resolve({ exitCode: 128 }), collected: {
      stdout: { readFrom: () => ({ text: "" }) }, stderr: { readFrom: () => ({ text: stderr }) },
    } }) };
  }
  await assert.rejects(collectGitSnapshot(subprocess("resource temporarily unavailable"), "/workspace"), /temporarily unavailable/);
  assert.equal((await collectGitSnapshot(subprocess("fatal: not a git repository"), "/workspace")).isRepo, false);
});
