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
    // v0.21.7：依赖数组加入 git（错误终态需要判断是否已有快照）
    git: null,
    // v0.21.7 交互修正：快照有无与失败计数改用 ref 跟踪，effect 开头复位
    gitSnapshotRef: { current: false },
    gitFailuresRef: { current: 0 },
    setGitError: () => {},
    singleFlight: fn => fn,
    react: { useEffect(fn) { cleanup = fn(); } },
    window: { setInterval(fn) { refresh = fn; }, clearInterval() {} },
    call: async method => { if (fail) throw new Error("offline"); return method === "git" ? { isRepo: false } : {}; },
    setGit: value => { values.git = value; },
    setSubagents: value => { values.subagents = value; },
    setMcp: value => { values.mcp = value; },
    setPlans: value => { values.plans = value; },
  });
  const marker = source.indexOf('// git / 子代理 / 计划');
  assert.ok(marker > 0, '会话级轮询位置应存在');
  const start = source.indexOf('react.useEffect(() => {', marker);
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

// v0.21.7（issue #3 交互修正）：首拍失败（重启后宿主未就绪）保持加载态自愈，
// 连续失败满 2 次且无快照才落终态错误；错误出现后成功即清除。
test("git poll: first failure stays loading; two consecutive failures raise terminal error; success clears it", async () => {
  let refresh, cleanup, fail = true, calls = 0;
  const errors = [];
  const context = vm.createContext({
    sessionId: "A", gitKey: "git:A", gitRevision: { current: 0 },
    moduleSessionId: "A", newSessionPage: false,
    git: null,
    gitSnapshotRef: { current: false },
    gitFailuresRef: { current: 0 },
    setGitError: value => { errors.push(value); },
    singleFlight: fn => fn,
    react: { useEffect(fn) { cleanup = fn(); } },
    window: { setInterval(fn) { refresh = fn; }, clearInterval() {} },
    call: async method => { if (method !== "git") return {}; calls += 1; if (fail) throw new Error("offline"); return { isRepo: true }; },
    setGit: value => { },
    setSubagents: () => {}, setMcp: () => {}, setPlans: () => {},
  });
  const marker = source.indexOf('// git / 子代理 / 计划');
  const start = source.indexOf('react.useEffect(() => {', marker);
  const endMarker = '}, [sessionId, gitKey, moduleSessionId, newSessionPage]);';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  vm.runInContext(source.slice(start, end), context);
  // 第 1 拍失败：不得落错误（保持加载态，交给 5s 轮询自愈）
  // （一轮 refresh 触发 4 个 poller，git 只发 1 次 call）
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  // effect 开头的复位会先写一次 null（清理上一轮错误缓存），属于预期行为；
  // 断言「没有落 Error 终态」：错误栈里除复位 null 外不得出现真实错误。
  assert.equal(errors.filter(error => error !== null).length, 0, "首拍失败必须保持加载态");
  // 第 2 拍仍失败：落终态错误（错误栈 = 复位 null + 1 个真实错误）
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  const realErrors = errors.filter(error => error !== null);
  assert.equal(realErrors.length, 1);
  assert.match(realErrors[0].message, /offline/);
  // 恢复：成功清空错误
  fail = false;
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors[errors.length - 1], null, "成功后必须清空终态错误");
  cleanup();
});

// v0.21.7：会话缺失（宿主重启后客户端快照滞后 / 会话刚归档）是预期内暂态——
// 不计入失败、不落错误终态，模块停在加载态等轮询自愈；换到有效会话后正常展示。
test("git poll: missing-session is transient and never raises the terminal error", async () => {
  let refresh, cleanup, fail = true, calls = 0;
  const errors = [];
  const context = vm.createContext({
    sessionId: "A", gitKey: "git:A", gitRevision: { current: 0 },
    moduleSessionId: "A", newSessionPage: false,
    git: null,
    gitSnapshotRef: { current: false },
    gitFailuresRef: { current: 0 },
    setGitError: value => { errors.push(value); },
    singleFlight: fn => fn,
    react: { useEffect(fn) { cleanup = fn(); } },
    window: { setInterval(fn) { refresh = fn; }, clearInterval() {} },
    call: async method => {
      if (method !== "git") return {};
      calls += 1;
      if (fail) throw Object.assign(new Error("找不到会话 session-x"), { code: "missing-session" });
      return { isRepo: true };
    },
    setGit: () => {}, setSubagents: () => {}, setMcp: () => {}, setPlans: () => {},
  });
  const marker = source.indexOf('// git / 子代理 / 计划');
  const start = source.indexOf('react.useEffect(() => {', marker);
  const endMarker = '}, [sessionId, gitKey, moduleSessionId, newSessionPage]);';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  vm.runInContext(source.slice(start, end), context);
  // 连续多拍 missing-session：错误栈只应包含 effect 开头复位写入的 null，不得出现真实错误
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls >= 3, "轮询在会话缺失期间应持续进行");
  assert.equal(errors.filter(error => error !== null).length, 0, "missing-session 不得落终态错误");
  // 换到有效会话后：正常展示并清错误
  fail = false;
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors[errors.length - 1], null);
  cleanup();
});

// 旧宿主不带 code：按消息文本兜底识别同类暂态。
test("git poll: legacy host session-not-found (no code) is also transient", async () => {
  let refresh, cleanup, calls = 0;
  const errors = [];
  const context = vm.createContext({
    sessionId: "A", gitKey: "git:A", gitRevision: { current: 0 },
    moduleSessionId: "A", newSessionPage: false,
    git: null,
    gitSnapshotRef: { current: false },
    gitFailuresRef: { current: 0 },
    setGitError: value => { errors.push(value); },
    singleFlight: fn => fn,
    react: { useEffect(fn) { cleanup = fn(); } },
    window: { setInterval(fn) { refresh = fn; }, clearInterval() {} },
    call: async method => {
      if (method !== "git") return {};
      calls += 1;
      throw new Error("找不到会话 session-4fa90791");
    },
    setGit: () => {}, setSubagents: () => {}, setMcp: () => {}, setPlans: () => {},
  });
  const marker = source.indexOf('// git / 子代理 / 计划');
  const start = source.indexOf('react.useEffect(() => {', marker);
  const endMarker = '}, [sessionId, gitKey, moduleSessionId, newSessionPage]);';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  vm.runInContext(source.slice(start, end), context);
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls >= 2);
  assert.equal(errors.filter(error => error !== null).length, 0, "旧宿主的消息兜底同样不得落终态错误");
  cleanup();
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
