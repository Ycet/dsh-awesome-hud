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
    useMemo(fn) { return fn(); },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
  };
  const context = vm.createContext({ react });
  vm.runInContext(source.slice(source.indexOf('function useSnapshot'), source.indexOf('/** 镜像 lib/graph.js')), context);
  vm.runInContext(helpers, context);
  context.useModuleSnapshot("plans:A", [])[1](["A plan"]);
  assert.deepEqual(Array.from(context.useModuleSnapshot("plans:B", [])[0]), []);
  state = undefined;
  assert.deepEqual(Array.from(context.useModuleSnapshot("plans:A", [])[0]), ["A plan"]);
  context.useModuleSnapshot("git:/workspace", null)[1]({ isRepo: true });
  state = undefined;
  assert.equal(context.useModuleSnapshot("git:/workspace", null)[0].isRepo, true);
});

test("scope-keyed requests share slow reads and recover after failure", async () => {
  const context = vm.createContext({});
  vm.runInContext(helpers, context);
  let release, count = 0;
  const read = () => { count++; return new Promise((resolve, reject) => { release = reject; }); };
  const first = context.refreshModuleSnapshot('git:/a', read);
  assert.equal(context.refreshModuleSnapshot('git:/a', read), first);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1);
  release(new Error("offline"));
  await assert.rejects(first, /offline/);
  const next = context.refreshModuleSnapshot('git:/a', read);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 2);
  release(new Error("offline"));
  await assert.rejects(next);
});

test("failed polling retains modules; cleanup stops timers but does not discard scoped results", async () => {
  let refresh, cleanup, fail = true;
  const values = { git: { isRepo: true }, subagents: ["child"], mcp: { total: 1 }, plans: ["plan"] };
  const context = vm.createContext({
    sessionId: "A", gitKey: "git:A", subagentsKey: "subagents:A", plansKey: "plans:A",
    moduleSessionId: "A", newSessionPage: false,
    react: { useEffect(fn) { cleanup = fn(); } },
    window: { setInterval(fn) { refresh = fn; }, clearInterval() {} },
    call: async method => { if (fail) throw new Error("offline"); return method === "git" ? { isRepo: false } : {}; },
  });
  vm.runInContext(helpers, context);
  context.cacheModuleSnapshot('git:A', values.git);
  context.cacheModuleSnapshot('subagents:A', values.subagents);
  context.cacheModuleSnapshot('plans:A', values.plans);
  const marker = source.indexOf('// git / 子代理 / 计划');
  assert.ok(marker > 0, '会话级轮询位置应存在');
  const start = source.indexOf('react.useEffect(() => {', marker);
  const endMarker = '}, [sessionId, gitKey, moduleSessionId, newSessionPage, subagentsKey, plansKey]);';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start > 0 && end > start, "polling effect slice must be located");
  vm.runInContext(source.slice(start, end), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('moduleSnapshots.get("git:A").isRepo', context), true);
  assert.deepEqual(Array.from(vm.runInContext('moduleSnapshots.get("plans:A")', context)), ["plan"]);
  assert.deepEqual(Array.from(vm.runInContext('moduleSnapshots.get("subagents:A")', context)), ["child"]);
  assert.equal(values.mcp.total, 1);
  fail = false;
  refresh();
  cleanup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('moduleSnapshots.get("git:A").isRepo', context), false);
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
