// dsh-awesome-hud — v0.21.2：子代理任务在右侧栏「当前分栏」以标签页打开。
//
// 旧实现传 `preferNewPane: true`，右侧栏已有内容时会再分一列（屏幕上出现第三个竖栏）。
// 现在不传该字段：落到当前 docked 分栏；同一子代理已打开时由 revealIfOpened 默认切过去。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "lib/client.js"), "utf8");

const clip = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

/** 在沙箱里跑真实的 navigateSubagent，记录 openResource 的调用参数。 */
function runNavigate(entry, services) {
  const calls = [];
  const scope = vm.createContext({
    ctx: { get: (name) => services[name] },
    t: (key) => key,
    URLSearchParams,
    calls,
  });
  vm.runInContext(clip("async function navigateSubagent", "// v0.20.0：便笺升级为「多条便笺」"), scope);
  return { calls, run: () => scope.navigateSubagent(entry) };
}

test("不请求新分栏：openResource 只带 kind", async () => {
  const captured = [];
  const { run } = runNavigate(
    { parentId: "parent-1", id: "child-1", mode: "continuable" },
    { sidebarRight: { openResource: (...args) => captured.push(args) } },
  );
  await run();
  assert.equal(captured.length, 1);
  const [address, options] = captured[0];
  assert.equal(options.kind, "subagentchat");
  assert.equal("preferNewPane" in options, false, "不得再要求新分栏");
  assert.equal("paneId" in options, false);
  assert.equal("replaceTab" in options, false);
  // revealIfOpened 不传即默认 true：同一子代理已打开时切到已有标签，不重复开。
  assert.equal("revealIfOpened" in options, false);
  const url = new URL(address);
  assert.equal(url.protocol, "dsh-resource:");
  assert.equal(url.hostname, "subagentchat");
  assert.equal(decodeURIComponent(url.pathname.slice("/session/".length)), "child-1");
  assert.equal(url.searchParams.get("parent"), "parent-1");
  assert.equal(url.searchParams.get("mode"), "continuable");
});

test("侧栏服务缺失时仍然显式报错", async () => {
  const { run } = runNavigate({ parentId: "p", id: "c", mode: "continuable" }, {});
  await assert.rejects(run, /subagentOpenFailed/);
});

test("源码里不再出现 preferNewPane: true", () => {
  assert.doesNotMatch(source, /preferNewPane: true/);
});
