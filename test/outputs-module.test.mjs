// dsh-awesome-hud — v0.19.1「产物 / Outputs」模块：
//  1) 汇总本会话**所有轮次**里指定格式、位于工作区内、仍存在的改动文件；
//     按最后改动轮次倒序，最多展示 OUTPUT_LIMIT（24）个。
//  2) 点击行在官方右侧栏打开文件内容：地址按 DSH 的 file 资源语法逐段编码。
//  3) 客户端：模块键紧跟 git、新建会话页不展示、能力不可用与空态可区分。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTPUT_EXTENSIONS,
  OUTPUT_LIMIT,
  Config,
  collectOutputs,
  isOutputCandidatePath,
  sessionFileAddress,
} from "../lib/index.js";
import {
  clientSource as source,
  extractArrowHandler,
  extractConst,
  extractFunction,
  hudClient,
} from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 构造一条 workspace/changes 事件（只带 host 侧真正用到的字段）。 */
const changeEvent = (seq, turn) => ({ type: "workspace/changes", seq, data: { turn } });

/** 构造一个按 seq 返回摘要的 summaryFor。 */
const summariesOf = (table) => (seq) => table[seq];

test("格式白名单：16 种扩展名且大小写不敏感，其它一律排除", () => {
  assert.deepEqual(
    [...OUTPUT_EXTENSIONS].sort(),
    ["cd", "clark", "csv", "docx", "gif", "html", "jpeg", "jpg", "md", "pdf", "png", "pptx", "svg", "webp", "xlsx"].sort(),
    "白名单应恰为约定的 16 项",
  );
  for (const ext of OUTPUT_EXTENSIONS) {
    assert.equal(isOutputCandidatePath(`docs/a.${ext}`), true, `.${ext} 应入选`);
    assert.equal(isOutputCandidatePath(`docs/a.${ext.toUpperCase()}`), true, `.${ext.toUpperCase()} 应入选`);
  }
  for (const path of ["a.ts", "a.json", "a.png.bak", "a", "docs/", "../a.md", "/abs/a.md", "C:/a.md", "a/b/../c.md", ""]) {
    assert.equal(isOutputCandidatePath(path), false, `${path} 不应入选`);
  }
  assert.equal(isOutputCandidatePath(undefined), false);
});

test("collectOutputs：跨全部轮次取并集，同一文件以最后一次改动为准", () => {
  const events = [];
  const table = {};
  for (let turn = 1; turn <= 30; turn += 1) {
    const seq = turn * 10;
    events.push(changeEvent(seq, turn));
    table[seq] = { turn, files: [{ path: `docs/t${turn}.md`, display: `docs/t${turn}.md` }, { path: "docs/shared.md", display: "docs/shared.md" }] };
  }
  const base = {
    sessionId: "s1",
    events,
    summaryFor: summariesOf(table),
    exists: async () => true,
  };
  return collectOutputs(base).then((output) => {
    // 不受轮次窗口限制：候选总数覆盖最初一轮至今的全部去重文件
    assert.equal(output.total, 31, "去重后的候选总数 = 30 个独立文件 + 1 个共享文件");
    assert.equal(output.files.length, 24, "展示仍受 24 条上限约束");
    const paths = output.files.map((file) => file.path);
    assert.equal(paths.includes("docs/t1.md"), false, "最早的轮次排在 24 名之外");
    return collectOutputs({ ...base, limit: 100 }).then((all) => {
      const allPaths = all.files.map((file) => file.path);
      assert.ok(allPaths.includes("docs/t1.md"), "放大上限后能拿到最早轮次的文件");
      assert.equal(allPaths.filter((path) => path === "docs/shared.md").length, 1, "同一文件只出现一次");
      const shared = all.files.find((file) => file.path === "docs/shared.md");
      assert.equal(shared.turn, 30, "重复改动取最后一次轮次");
      assert.equal(all.files[0].turn, 30, "按最后改动倒序");
    });
  });
});

test("collectOutputs：按最后改动倒序，最多 24 个并标记截断", () => {
  const events = [changeEvent(10, 1)];
  const files = [];
  for (let index = 1; index <= 30; index += 1) files.push({ path: `out/f${index}.png`, display: `out/f${index}.png` });
  const result = collectOutputs({
    sessionId: "s1",
    events,
    summaryFor: () => ({ turn: 1, files }),
    exists: async () => true,
  });
  return result.then((output) => {
    assert.equal(OUTPUT_LIMIT, 24);
    assert.equal(output.files.length, 24, "只返回 24 个");
    assert.equal(output.total, 30);
    assert.equal(output.truncated, true);
    // 同一轮内按 display 升序：f1、f10、f11… 的码元序
    assert.equal(output.files[0].path, "out/f1.png");
    const next = collectOutputs({ sessionId: "s1", events, summaryFor: () => ({ turn: 1, files: files.slice(0, 3) }), exists: async () => true });
    return next.then((small) => assert.equal(small.truncated, false, "不足 24 个时不算截断"));
  });
});

test("collectOutputs：只保留仍存在的文件，且存在性检查有次数上限", async () => {
  const files = [];
  for (let index = 1; index <= 30; index += 1) files.push({ path: `out/f${index}.md`, display: `out/f${index}.md` });
  const checks = [];
  const output = await collectOutputs({
    sessionId: "s1",
    events: [changeEvent(10, 1)],
    summaryFor: () => ({ turn: 1, files }),
    exists: async (path) => {
      checks.push(path);
      // 前 10 个已被删除
      const index = Number(path.match(/f(\d+)\.md/)[1]);
      return index > 10;
    },
  });
  assert.equal(output.files.length, 20, "删除的文件不进列表");
  assert.equal(output.files[0].path, "out/f11.md");
  assert.equal(new Set(checks).size, checks.length, "同一路径不重复检查");
  assert.ok(output.stats <= 64, "存在性检查次数受 statLimit 约束");

  const capped = await collectOutputs({
    sessionId: "s1",
    events: [changeEvent(10, 1)],
    summaryFor: () => ({ turn: 1, files }),
    exists: async () => false,
    statLimit: 5,
  });
  assert.equal(capped.files.length, 0);
  assert.equal(capped.stats, 5, "到达次数上限即停止检查");
});

test("collectOutputs：坏事件与非摘要事件安全跳过，不抛错", async () => {
  const events = [null, undefined, { type: "other", seq: 1 }, { type: "workspace/changes" }, changeEvent(5, 2), changeEvent(6, 3)];
  const output = await collectOutputs({
    sessionId: "s1",
    events,
    summaryFor: (seq) => {
      if (seq === 5) throw new Error("摘要不可用");
      if (seq === 6) return { turn: 3, files: [{ path: "a.md", display: "a.md" }, { path: "b.pdf" }] };
      return undefined;
    },
    exists: async () => true,
  });
  assert.deepEqual(output.files.map((file) => file.path), ["a.md", "b.pdf"]);
  assert.equal(output.files[1].display, "b.pdf", "缺 display 时回退 path");
  assert.equal(output.files[0].name, "a.md");
  assert.equal(output.files[0].dir, "");
  const nested = await collectOutputs({
    sessionId: "s1",
    events: [changeEvent(1, 1)],
    summaryFor: () => ({ turn: 1, files: [{ path: "src/deep/a.png", display: "src/deep/a.png" }] }),
    exists: async () => true,
  });
  assert.equal(nested.files[0].name, "a.png");
  assert.equal(nested.files[0].dir, "src/deep");
});

test("会话文件地址：逐段编码，`:` 保持字面，与 DSH 的 file 资源语法一致", () => {
  assert.equal(sessionFileAddress("s1", "src/a.md"), "dsh-resource://file/session/s1/src/a.md");
  assert.equal(
    sessionFileAddress("s 1", "src/a b#c?.md"),
    "dsh-resource://file/session/s%201/src/a%20b%23c%3F.md",
    "空格/#/? 逐段编码",
  );
  assert.equal(sessionFileAddress("s1", "docs/报告.md"), "dsh-resource://file/session/s1/docs/%E6%8A%A5%E5%91%8A.md");
  assert.equal(sessionFileAddress("s1", "a:b.md"), "dsh-resource://file/session/s1/a:b.md", "`:` 保持字面");
  assert.equal(sessionFileAddress("s1", "./x/y.png"), "dsh-resource://file/session/s1/x/y.png", "去掉前导 ./");
});

test("宿主契约：默认开启、命令在白名单里、图标资产已放行", async () => {
  const outputsSchema = Config.dict.modules.dict.outputs;
  assert.equal(outputsSchema.type, "boolean", "modules.outputs 是布尔开关");
  assert.equal(outputsSchema.meta.default, true, "新模块默认开启");
  const hostSource = await readFile(join(root, "lib/index.js"), "utf8");
  assert.match(hostSource, /method === "outputs"/, "outputs 必须在 API 方法白名单里");
  assert.match(hostSource, /"outputs\.svg": "svg"/, "图标必须在资产白名单里");
  await access(join(root, "assets/icons/outputs.svg"));
});

test("客户端接线：模块键紧跟 git、新建会话页不展示、说明页与文案齐全", () => {
  const moduleKeys = vm.runInNewContext(`${extractConst("MODULE_KEYS")}\nMODULE_KEYS;`);
  const newSessionKeys = vm.runInNewContext(`${extractConst("NEW_SESSION_MODULE_KEYS")}\nNEW_SESSION_MODULE_KEYS;`);
  assert.equal(moduleKeys.indexOf("outputs"), moduleKeys.indexOf("git") + 1, "默认位于 git 之下");
  assert.equal(newSessionKeys.includes("outputs"), false, "新建会话页不展示该模块");
  assert.match(source, /outputs: \(\) => activeModules\.outputs === false \|\| outputs === null \? null : react\.createElement\(OutputsModule/);
  assert.match(source, /const refreshOutputs = async \(\) => \{/, "轮询存在");
  assert.match(source, /const polls = \[refreshGit, refreshSubagents, refreshPlans, refreshOutputs\]/, "并入 5 秒轮询批次");
  assert.match(source, /setOutputs\(null\);/, "新建会话页/切会话时清空快照");
  assert.match(source, /outputs: typeof parsed\.outputs === "boolean"/, "折叠状态持久化");
  assert.match(source, /icon: "outputs"/);
  // 说明页第 12 节
  assert.match(source, /\{ key: "outputs", title: "guideOutputsTitle"/);
  const sections = vm.runInNewContext(`${extractConst("GUIDE_SECTIONS")}\nGUIDE_SECTIONS;`);
  assert.equal(sections.length, 12, "说明页新增一节");
  assert.deepEqual(plain(sections.find((section) => section.key === "outputs").groups.map((group) => group.kind)), ["show", "act"]);
  // 中英文案成对
  const { zh, en } = hudClient().dictionaries[0];
  for (const key of ["outputsModule", "outputsEmpty", "outputsUnsupported", "outputsLimitHint", "outputsOpenFailed",
    "guideOutputsTitle", "guideOutputsShowList", "guideOutputsShowOrder", "guideOutputsOpen", "guideOutputsScope"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文`);
    assert.equal(typeof en[key], "string", `${key} 需要英文`);
  }
});

/** 在沙箱里跑真实的 OutputsModule，验证渲染结果而不依赖宿主。 */
function loadOutputsModule(dict) {
  const context = vm.createContext({
    Set,
    Number,
    react: {
      Fragment: "fragment",
      createElement: (type, props, ...children) => ({
        type: typeof type === "string" ? type : type?.name ?? "Component",
        props: props ?? {},
        children,
      }),
    },
    ModuleHead: (props) => ({ type: "ModuleHead", props, children: [] }),
    t: (key) => dict[key] ?? key,
    interpolate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
  });
  vm.runInContext(`${extractFunction("OutputsModule")}\nthis.OutputsModule = OutputsModule;`, context);
  return context.OutputsModule;
}

const walk = (node) => {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (typeof node !== "object") return [node];
  return [node, ...(node.children ?? []).flatMap(walk)];
};
const textOf = (node) => walk(node).filter((child) => typeof child === "string" || typeof child === "number").join("");

test("组件：计数、文件名与目录、截断提示、空态与能力不可用", () => {
  const { zh } = hudClient().dictionaries[0];
  const OutputsModule = loadOutputsModule(zh);
  const opened = [];
  const files = [
    { path: "docs/a.md", display: "docs/a.md", name: "a.md", dir: "docs" },
    { path: "out.png", display: "out.png", name: "out.png", dir: "" },
  ];
  const tree = OutputsModule({ files, supported: true, limit: 24, truncated: true, fold: false, onOpen: (file) => opened.push(file.path), onFoldChange: () => {} });
  assert.equal(tree.type, "div");
  const head = walk(tree).find((node) => node.type === "ModuleHead");
  assert.equal(head.props.icon, "outputs");
  assert.equal(head.props.countText, "2", "计数为文件数");
  assert.equal(head.props.title, zh.outputsModule);
  const rows = walk(tree).filter((node) => node.type === "button");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].props.className, "hud-output-row");
  assert.equal(rows[0].props.title, "docs/a.md");
  assert.equal(rows[0].props["aria-label"], "docs/a.md");
  assert.deepEqual(rows[0].children.map((child) => [child.type, child.children[0]]), [
    ["span", "a.md"],
    ["span", "docs"],
  ]);
  assert.equal(rows[1].children.filter((child) => child !== null).length, 1, "无目录时只渲染文件名");
  rows[0].props.onClick();
  assert.deepEqual(opened, ["docs/a.md"]);
  assert.match(textOf(tree), /仅展示最近改动的 24 个文件/, "截断时给出提示");

  const empty = OutputsModule({ files: [], supported: true, limit: 24, truncated: false, fold: false });
  assert.match(textOf(empty), /本会话还没有符合格式的改动文件/);
  assert.equal(walk(empty).find((node) => node.type === "ModuleHead").props.countText, "0");

  const unsupported = OutputsModule({ files: [], supported: false, limit: 24, truncated: false, fold: false });
  assert.match(textOf(unsupported), /当前 DSH 不支持读取本会话改动/);
  assert.equal(walk(unsupported).find((node) => node.type === "ModuleHead").props.countText, undefined, "不可用时不显示计数");

  const folded = OutputsModule({ files, supported: true, limit: 24, truncated: false, fold: true, onFoldChange: () => {} });
  assert.equal(walk(folded).filter((node) => node.type === "button").length, 0, "折叠时不渲染列表行");
});

test("点击打开：调用 sidebarRight.openResource；服务缺失或抛错时 toast", () => {
  const make = (ctxOverrides) => {
    const toasts = [];
    const opened = [];
    const context = vm.createContext({
      ctx: {
        get: (key) => {
          if (key !== "sidebarRight") return undefined;
          return ctxOverrides?.sidebarRight;
        },
      },
      toast: (text, kind) => toasts.push({ text, kind }),
      t: (key) => ({ outputsOpenFailed: "无法在右侧栏打开该文件。" })[key] ?? key,
    });
    vm.runInContext(`${extractArrowHandler("openOutputFile")}\nthis.openOutputFile = openOutputFile;`, context);
    return { openOutputFile: context.openOutputFile, toasts, opened };
  };

  const collected = [];
  const ok = make({ sidebarRight: { openResource: (address) => collected.push(address) } });
  ok.openOutputFile({ path: "docs/a.md", address: "dsh-resource://file/session/s1/docs/a.md" });
  assert.deepEqual(collected, ["dsh-resource://file/session/s1/docs/a.md"], "地址原样交给右侧栏");
  assert.equal(ok.toasts.length, 0, "打开成功不打扰用户");

  const missing = make(undefined);
  missing.openOutputFile({ path: "docs/a.md", address: "dsh-resource://file/session/s1/docs/a.md" });
  assert.equal(missing.toasts.length, 1);
  assert.equal(missing.toasts[0].kind, "error");
  assert.match(missing.toasts[0].text, /右侧栏/);

  const throwing = make({ sidebarRight: { openResource: () => { throw new Error("no surface"); } } });
  throwing.openOutputFile({ path: "docs/a.md", address: "dsh-resource://file/session/s1/docs/a.md" });
  assert.equal(throwing.toasts.length, 1, "抛错也要给出提示");

  const noAddress = make({ sidebarRight: { openResource: () => {} } });
  noAddress.openOutputFile({ path: "docs/a.md" });
  assert.equal(noAddress.toasts.length, 1, "缺地址视为打开失败");
});
