// dsh-awesome-hud — v0.19.1「产物 / Outputs」模块：
//  1) 汇总本会话**所有轮次**里指定格式、位于工作区内、仍存在的改动文件；
//     按最后改动轮次倒序，最多展示 OUTPUT_LIMIT（10）个；界面默认先显示前 3 个、可展开全部。
//  2) 点击行在官方右侧栏打开文件内容：地址按 DSH 的 file 资源语法逐段编码。
//  3) 客户端：默认位于 git 之上、无产物时整模块隐藏、新建会话页不展示。
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
  collectWorkspaceOutputs,
  mergeOutputFiles,
  resolveSessionStartedAt,
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
    assert.equal(output.files.length, 10, "展示仍受 10 条上限约束");
    const paths = output.files.map((file) => file.path);
    assert.equal(paths.includes("docs/t1.md"), false, "最早的轮次排在 10 名之外");
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

test("collectOutputs：按最后改动倒序，最多 10 个并标记截断", () => {
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
    assert.equal(OUTPUT_LIMIT, 10);
    assert.equal(output.files.length, 10, "只返回 10 个");
    assert.equal(output.total, 30);
    assert.equal(output.truncated, true);
    // 同一轮内按 display 升序：f1、f10、f11… 的码元序
    assert.equal(output.files[0].path, "out/f1.png");
    const next = collectOutputs({ sessionId: "s1", events, summaryFor: () => ({ turn: 1, files: files.slice(0, 3) }), exists: async () => true });
    return next.then((small) => assert.equal(small.truncated, false, "不足 10 个时不算截断"));
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
    limit: 100,
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

test("客户端接线：默认位于 git 之上、新建会话页不展示、说明页与文案齐全", () => {
  const moduleKeys = vm.runInNewContext(`${extractConst("MODULE_KEYS")}\nMODULE_KEYS;`);
  const newSessionKeys = vm.runInNewContext(`${extractConst("NEW_SESSION_MODULE_KEYS")}\nNEW_SESSION_MODULE_KEYS;`);
  assert.equal(moduleKeys.indexOf("outputs"), moduleKeys.indexOf("git") - 1, "默认位于 git 之上");
  assert.equal(newSessionKeys.includes("outputs"), false, "新建会话页不展示该模块");
  assert.match(source, /outputs: \(\) => activeModules\.outputs === false \|\| outputs === null \|\| \(Array\.isArray\(outputs\.files\) \? outputs\.files\.length : 0\) === 0 \? null : react\.createElement\(OutputsModule/, "无产物时渲染门直接返回 null");
  assert.doesNotMatch(source, /supported: outputs\.supported !== false/, "不再向组件传 supported");
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
  for (const key of ["outputsModule", "outputsLimitHint", "outputsOpenFailed",
    "guideOutputsTitle", "guideOutputsShowList", "guideOutputsShowOrder", "guideOutputsOpen", "guideOutputsScope"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文`);
    assert.equal(typeof en[key], "string", `${key} 需要英文`);
  }
  // 无产物时整模块不渲染，因此不再保留空态文案。
  for (const key of ["outputsEmpty", "outputsUnsupported"]) {
    assert.equal(zh[key], undefined, `${key} 应已移除`);
    assert.equal(en[key], undefined, `${key} 应已移除`);
  }
});

/**
 * 在沙箱里跑真实的 OutputsModule，验证渲染结果而不依赖宿主。
 * 这里给出一套最小但「有状态」的 hooks 运行时：state/ref 按调用顺序存槽位，
 * 重新调用 render 即可看到 setState 后的结果；定时器由 window 桩攒起来，测试可手动触发。
 * controls.expanded 用来模拟「已展开」的初始 state；controls.next 保留最后一次 setState 的值。
 */
function loadOutputsModule(dict, controls = {}) {
  const states = [];
  const refs = [];
  const timers = new Map();
  const effects = [];
  let cursor = 0;
  let nextTimer = 1;
  const timersByDelay = (delay) => [...timers].filter(([, timer]) => timer.delay === delay && timer.cleared !== true);
  const context = vm.createContext({
    Set,
    Number,
    Math,
    react: {
      Fragment: "fragment",
      useState: (init) => {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof init === "function" ? init() : init;
        return [states[index], (next) => {
          const value = typeof next === "function" ? next(states[index]) : next;
          states[index] = value;
          controls.next = value;
        }];
      },
      useRef: (init) => {
        const index = cursor++;
        if (!(index in refs)) refs[index] = { current: init };
        return refs[index];
      },
      useEffect: (effect) => { effects.push(effect); return undefined; },
      createElement: (type, props, ...children) => ({
        type: typeof type === "string" ? type : type?.name ?? "Component",
        props: props ?? {},
        children,
      }),
    },
    react_dom: { createPortal: (node) => node },
    document: { body: {} },
    window: {
      setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay, cleared: false }); return id; },
      clearTimeout: (id) => { const timer = timers.get(id); if (timer !== undefined) timer.cleared = true; },
      addEventListener() {}, removeEventListener() {},
      innerWidth: 1280, innerHeight: 800,
    },
    ModuleHead: (props) => ({ type: "ModuleHead", props, children: [] }),
    t: (key) => dict[key] ?? key,
    interpolate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
  });
  vm.runInContext(
    `${extractConst("LIST_PREVIEW_COUNT")}\n${extractConst("OUTPUT_TIP_DELAY_MS")}\n${extractFunction("fileHoverTipPlacement")}\n${extractFunction("previewListRows")}\n${extractFunction("listMoreButton")}\n${extractFunction("OutputsModule")}\nthis.OutputsModule = OutputsModule; this.previewListRows = previewListRows; this.fileHoverTipPlacement = fileHoverTipPlacement; this.OUTPUT_TIP_DELAY_MS = OUTPUT_TIP_DELAY_MS;`,
    context,
  );
  // 预置「已展开」的初始 state（组件内是 useState(false)，槽位 0 即展开态）。
  if (controls.expanded !== undefined) states[0] = controls.expanded === true;
  const render = (props) => {
    cursor = 0;
    effects.length = 0;
    return context.OutputsModule(props);
  };
  const fireTimers = (delay) => {
    for (const [, timer] of timersByDelay(delay)) {
      if (timer.cleared === true) continue;
      timer.cleared = true;
      timer.fn();
    }
  };
  return {
    render,
    fireTimers,
    timersByDelay,
    rowsView: context.previewListRows,
    placement: context.fileHoverTipPlacement,
    delay: context.OUTPUT_TIP_DELAY_MS,
  };
}

const walk = (node) => {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (typeof node !== "object") return [node];
  return [node, ...(node.children ?? []).flatMap(walk)];
};
const textOf = (node) => walk(node).filter((child) => typeof child === "string" || typeof child === "number").join("");

test("组件：计数、文件名与目录、截断提示；无产物时整个模块不渲染", () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh);
  const opened = [];
  const files = [
    { path: "docs/a.md", display: "docs/a.md", name: "a.md", dir: "docs" },
    { path: "out.png", display: "out.png", name: "out.png", dir: "" },
  ];
  const tree = runtime.render({ files, limit: 10, truncated: true, fold: false, onOpen: (file) => opened.push(file.path), onFoldChange: () => {} });
  assert.equal(tree.type, "div");
  // v0.20.0：产物列表有自己的容器类，供「文件行向右缩进」的样式作用域使用。
  assert.equal(tree.props.className, "hud-section hud-output-section");
  const head = walk(tree).find((node) => node.type === "ModuleHead");
  assert.equal(head.props.icon, "outputs");
  assert.equal(head.props.countText, "2", "计数为文件数");
  assert.equal(head.props.title, zh.outputsModule);
  const rows = walk(tree).filter((node) => node.type === "button");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].props.className, "hud-output-row");
  // v0.20.0：改用自定义悬停提示（0.5s、跟随鼠标），不再挂原生 title（避免两个提示同时出现）。
  assert.equal(rows[0].props.title, undefined);
  assert.equal(typeof rows[0].props.onMouseEnter, "function");
  assert.equal(typeof rows[0].props.onMouseMove, "function");
  assert.equal(typeof rows[0].props.onMouseLeave, "function");
  assert.equal(rows[0].props["aria-label"], "docs/a.md");
  assert.deepEqual(rows[0].children.map((child) => [child.type, child.children[0]]), [
    ["span", "a.md"],
    ["span", "docs"],
  ]);
  assert.equal(rows[1].children.filter((child) => child !== null).length, 1, "无目录时只渲染文件名");
  rows[0].props.onClick();
  assert.deepEqual(opened, ["docs/a.md"]);
  assert.match(textOf(tree), /仅展示最近改动的 10 个文件/, "截断时给出提示");

  // v0.19.2：没有产物时整个模块不渲染（与子代理 / 任务 / 计划清单一致）。
  assert.equal(runtime.render({ files: [], limit: 10, truncated: false, fold: false }), null, "无产物时不渲染模块");
  assert.equal(runtime.render({ files: [], supported: false, limit: 10, truncated: false, fold: false }), null, "能力不可用时同样隐藏");
  assert.equal(runtime.render({ limit: 10, truncated: false, fold: false }), null, "快照缺失时也隐藏");

  const folded = runtime.render({ files, limit: 10, truncated: false, fold: true, onFoldChange: () => {} });
  assert.equal(walk(folded).filter((node) => node.type === "button").length, 0, "折叠时不渲染列表行");
});

test("v0.19.2：列表默认只给前 3 个，超过时提供「展开其余 n 个文件 / 收起」", () => {
  const { zh } = hudClient().dictionaries[0];
  const files = Array.from({ length: 8 }, (_, index) => ({
    path: `docs/f${index + 1}.md`,
    display: `docs/f${index + 1}.md`,
    name: `f${index + 1}.md`,
    dir: "docs",
  }));

  // 纯函数：折叠只取前 3 个，展开给全部；remaining 与是否可展开无关，始终是「超出 3 个的数量」。
  const collapsed = loadOutputsModule(zh);
  assert.equal(collapsed.rowsView(files, false).rows.length, 3);
  assert.equal(collapsed.rowsView(files, false).remaining, 5);
  assert.equal(collapsed.rowsView(files, false).expanded, false);
  assert.equal(collapsed.rowsView(files, true).rows.length, 8);
  assert.equal(collapsed.rowsView(files, true).remaining, 5);
  assert.equal(collapsed.rowsView(files, true).expanded, true);
  // 不超过 3 个时无需展开：直接全量展示，不出现入口。
  assert.equal(collapsed.rowsView(files.slice(0, 2), false).rows.length, 2);
  assert.equal(collapsed.rowsView(files.slice(0, 2), false).remaining, 0);
  assert.equal(collapsed.rowsView(files.slice(0, 3), false).expanded, true, "恰好 3 个时不折叠");

  // 折叠态：3 行 + 第 3 行下方的「展开其余 5 个文件」。
  const foldControls = {};
  const collapsedModule = loadOutputsModule(zh, foldControls);
  const foldedTree = collapsedModule.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const rows = walk(foldedTree).filter((node) => node.type === "button" && node.props.className === "hud-output-row");
  assert.equal(rows.length, 3, "折叠时只渲染 3 行");
  assert.equal(rows[2].props["aria-label"], "docs/f3.md", "第 3 行就是切分点");
  const more = walk(foldedTree).find((node) => node.type === "button" && node.props.className === "hud-list-more");
  assert.ok(more, "超过 3 个时出现展开入口");
  assert.match(textOf(more), /展开其余 5 个文件/);
  more.props.onClick();
  assert.equal(foldControls.next, true, "点击展开");

  // 展开态：全部行 + 最后一行下方的「收起」。
  const openControls = { expanded: true };
  const expandedModule = loadOutputsModule(zh, openControls);
  const expandedTree = expandedModule.render({ files, limit: 10, truncated: true, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const expandedRows = walk(expandedTree).filter((node) => node.type === "button" && node.props.className === "hud-output-row");
  assert.equal(expandedRows.length, 8, "展开后渲染全部行");
  const collapse = walk(expandedTree).find((node) => node.type === "button" && node.props.className === "hud-list-more");
  assert.match(textOf(collapse), /收起/);
  collapse.props.onClick();
  assert.equal(openControls.next, false, "点击收起");
  // 截断提示仍在最后一行下方。
  assert.match(textOf(expandedTree), /仅展示最近改动的 10 个文件/);

  // 3 个及以内不出现任何展开 / 收起入口。
  const smallTree = expandedModule.render({ files: files.slice(0, 3), limit: 10, truncated: false, fold: false });
  assert.equal(walk(smallTree).find((node) => node.props?.className === "hud-list-more"), undefined, "不超过 3 个时没有入口");
});

test("v0.20.0：悬停 0.5 秒在鼠标位置弹出与 git 一致的路径提示", () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh);
  assert.equal(runtime.delay, 500, "悬停延迟固定为 0.5 秒");
  const files = [{ path: "docs/a.md", display: "docs/a.md", name: "a.md", dir: "docs" }];

  let tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  let row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onMouseEnter({ clientX: 300, clientY: 200 });
  // 计时器未到：不弹提示。
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "0.5 秒内不出现提示");

  runtime.fireTimers(500);
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const tip = walk(tree).find((node) => node.props?.className === "hud-file-tip");
  assert.ok(tip, "悬停超过 0.5 秒后出现提示");
  assert.equal(tip.props.role, "tooltip");
  // 内容与 git 变更文件行的提示一致：只有完整相对路径，没有标签行。
  assert.equal(textOf(tip), "docs/a.md");
  // 定位与 git 共用：鼠标右下 12 / 18px，宽度按剩余空间收敛。
  assert.deepEqual([tip.props.style.left, tip.props.style.top, tip.props.style.maxWidth], [312, 218, 960]);
  assert.equal(tip.props.style.transform, undefined, "空间足够时显示在鼠标下方");

  // 鼠标移动后按最后一次位置弹提示（不是进入点）。
  row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onMouseLeave();
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  row = walk(tree).find((node) => node.type === "button" && node.props.className === "hud-output-row");
  row.props.onMouseEnter({ clientX: 100, clientY: 100 });
  row.props.onMouseMove({ clientX: 420, clientY: 320 });
  runtime.fireTimers(500);
  tree = runtime.render({ files, limit: 10, truncated: false, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  const moved = walk(tree).find((node) => node.props?.className === "hud-file-tip");
  assert.deepEqual([moved.props.style.left, moved.props.style.top], [432, 338], "按最后一次 mousemove 定位");
});

test("v0.20.0：离开 / 按下 / 点击都会收起提示", () => {
  const { zh } = hudClient().dictionaries[0];
  const runtime = loadOutputsModule(zh);
  const files = [{ path: "out.png", display: "out.png", name: "out.png", dir: "" }];
  const opened = [];
  const props = { files, limit: 10, truncated: false, fold: false, onOpen: (file) => opened.push(file.path), onFoldChange: () => {} };
  const rowOf = (tree) => walk(tree).filter((node) => node.type === "button" && node.props.className === "hud-output-row")[0];

  // 500ms 内离开：计时器被取消，不再弹提示。
  let tree = runtime.render(props);
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  rowOf(tree).props.onMouseLeave();
  runtime.fireTimers(500);
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "离开后不再弹出");

  // 弹出后离开：立即收起。
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  runtime.fireTimers(500);
  tree = runtime.render(props);
  assert.ok(walk(tree).find((node) => node.props?.className === "hud-file-tip"));
  rowOf(tree).props.onMouseLeave();
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "离开即收起");

  // 弹出后按下（拖拽 / 右键）也会收起。
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  runtime.fireTimers(500);
  tree = runtime.render(props);
  rowOf(tree).props.onPointerDown();
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "按下即收起");

  // 弹出后点击：先收起提示，再打开文件。
  rowOf(tree).props.onMouseEnter({ clientX: 200, clientY: 200 });
  runtime.fireTimers(500);
  tree = runtime.render(props);
  rowOf(tree).props.onClick();
  tree = runtime.render(props);
  assert.equal(walk(tree).find((node) => node.props?.className === "hud-file-tip"), undefined, "点击即收起");
  assert.deepEqual(opened, ["out.png"], "点击仍然打开文件");
});

test("v0.20.0：fileHoverTipPlacement 靠近底部翻到上方、靠右收进视口、窄视口收敛宽度", () => {
  const runtime = loadOutputsModule(hudClient().dictionaries[0].zh);
  const placement = runtime.placement;
  const plainPlacement = (x, y, width, height) => JSON.parse(JSON.stringify(placement(x, y, width, height)));
  // 与 git 文件行同一套算法：右下 12 / 18px，最左保留 8px，宽度按剩余空间收敛。
  assert.deepEqual(plainPlacement(300, 200, 1280, 800), { left: 312, top: 218, below: true, maxWidth: 960 });
  // 底部空间不足（800 - 24 = 776 < 798）：翻到鼠标上方并上移 8px。
  assert.deepEqual(plainPlacement(300, 780, 1280, 800), { left: 312, top: 772, below: false, maxWidth: 960 });
  // 靠右：向左收到视口内，宽度收敛到剩余空间（1280 - 1072 - 8 = 200）。
  assert.deepEqual(plainPlacement(1270, 100, 1280, 800), { left: 1072, top: 118, below: true, maxWidth: 200 });
  // 窄视口：左侧留 8px，宽度至少 120。
  assert.deepEqual(plainPlacement(10, 10, 200, 800), { left: 8, top: 28, below: true, maxWidth: 184 });
});

test("v0.20.0：文件行向右缩进、悬停提示复用 git 的路径提示样式", () => {
  // 文件行与「展开其余 / 收起」按模块标题文字对齐（14px 模块内边距 + 24px 缩进）。
  assert.match(source, /\.hud-output-section \.hud-output-row,\.hud-output-section \.hud-list-more\{padding-left:24px\}/);
  // 悬停提示：复用 git 变更文件行的 .hud-file-tip（等宽、可换行、跟随鼠标），只显示完整相对路径。
  assert.match(source, /className: "hud-file-tip",\s*\n\s*role: "tooltip",/);
  assert.match(source, /}, tip\.text\),/);
  assert.match(source, /setTip\(\{ text: file\.path, \.\.\.fileHoverTipPlacement\(x, y, window\.innerWidth, window\.innerHeight\) \}\);/);
  // git 文件行与产物共用同一套定位。
  assert.match(source, /setFileTip\(\{ text, \.\.\.fileHoverTipPlacement\(x, y, window\.innerWidth, window\.innerHeight\) \}\);/);
  // 旧的两行标签气泡已移除。
  assert.doesNotMatch(source, /\.hud-output-tip/);
  assert.doesNotMatch(source, /outputsTipDir|outputsTipRoot|outputsTipName|outputsTipPath/);
  // 说明页要点：显示完整相对路径。
  const { zh, en } = hudClient().dictionaries[0];
  assert.match(zh.guideOutputsHover, /完整相对路径/);
  assert.match(en.guideOutputsHover, /full relative path/);
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

// —— v0.20.0：终端命令产生的改动也纳入产物（工作区扫描） ——

test('collectWorkspaceOutputs：按扩展名/修改时间收录，跳过 node_modules 与隐藏项', async () => {
  const { mkdtemp, mkdir, writeFile, utimes, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'hud-outputs-'));
  try {
    await mkdir(join(root, 'sub'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'new.md'), 'x');
    await writeFile(join(root, 'old.md'), 'x');
    await writeFile(join(root, 'note.txt'), 'x');
    await writeFile(join(root, 'sub', 'deep.md'), 'x');
    await writeFile(join(root, 'node_modules', 'hidden.md'), 'x');
    await writeFile(join(root, '.hidden.md'), 'x');
    const now = Date.now();
    await utimes(join(root, 'new.md'), new Date(now - 10_000), new Date(now - 10_000));
    await utimes(join(root, 'sub', 'deep.md'), new Date(now - 20_000), new Date(now - 20_000));
    await utimes(join(root, 'old.md'), new Date(now - 7_200_000), new Date(now - 7_200_000));
    await utimes(join(root, 'note.txt'), new Date(now - 5_000), new Date(now - 5_000));
    const since = now - 60_000;
    const result = await collectWorkspaceOutputs({ cwd: root, since, limit: 10 });
    assert.deepEqual(JSON.parse(JSON.stringify(result.files.map((file) => file.path))), ['new.md', 'sub/deep.md']);
    assert.equal(result.total, 2);
    assert.equal(result.truncated, false);
    // 限制条数：最新的在前，超出部分标记截断。
    const limited = await collectWorkspaceOutputs({ cwd: root, since, limit: 1 });
    assert.deepEqual(JSON.parse(JSON.stringify(limited.files.map((file) => file.path))), ['new.md']);
    assert.equal(limited.truncated, true);
    // 会话开始前的旧文件不收（重启后 since 不变，仍能列出同样的文件）。
    const older = await collectWorkspaceOutputs({ cwd: root, since: now - 1_000 });
    assert.deepEqual(JSON.parse(JSON.stringify(older.files.map((file) => file.path))), []);
    // 不存在的目录按空列表处理。
    const missing = await collectWorkspaceOutputs({ cwd: join(root, 'nope'), since, limit: 10 });
    assert.deepEqual(JSON.parse(JSON.stringify(missing.files)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolveSessionStartedAt：优先 header.createdAt，回退首个事件时间', () => {
  assert.equal(resolveSessionStartedAt({ header: { createdAt: 1234 } }, []), 1234);
  assert.equal(resolveSessionStartedAt({ header: { startedAt: 2345 } }, []), 2345);
  assert.equal(resolveSessionStartedAt({ header: {} }, [{ time: 3456 }]), 3456);
  const fallback = resolveSessionStartedAt({ header: {} }, []);
  assert.ok(typeof fallback === 'number' && fallback > 0);
});

test('mergeOutputFiles：摘要与扫描合并去重，按修改时间倒序并补右侧栏地址', () => {
  const merged = mergeOutputFiles('s1', [
    { path: 'a.md', display: 'a.md', turn: 3 },
    { path: 'b.md', display: 'b.md', turn: 1 },
  ], [
    { path: 'a.md', mtimeMs: 300 },
    { path: 'c.md', mtimeMs: 200 },
    { path: 'd.md', mtimeMs: 400 },
  ], 10);
  // 同一路径只出现一次；按 mtime 倒序（d > a > c），摘要补上的轮次保留。
  // 摘要独有、扫描没扫到的 b.md 排在带 mtime 的文件之后。
  assert.deepEqual(JSON.parse(JSON.stringify(merged.files.map((file) => file.path))), ['d.md', 'a.md', 'c.md', 'b.md']);
  assert.equal(merged.files[1].turn, 3, '摘要的轮次合并进扫描结果');
  assert.equal(merged.total, 4);
  assert.equal(merged.files[0].address.startsWith('dsh-resource://file/session/s1/'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.files[0].name)), 'd.md');
  // 摘要里没有 mtime 的条目排在带 mtime 的条目之后，仍可被限制条数。
  const limited = mergeOutputFiles('s1', [{ path: 'z.md', turn: 9 }, ...Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.md`, mtimeMs: i }))], [], 2);
  assert.equal(limited.files.length, 2);
  assert.equal(limited.truncated, true);
  assert.equal(limited.total, 13);
});
