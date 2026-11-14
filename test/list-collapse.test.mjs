// dsh-awesome-hud — v0.19.2：产物 / 计划清单 / 子代理任务三个列表模块共用的折叠交互。
//  1) 默认只显示前 3 条；超过 3 条时在第 3 条下方给出「展开其余 n 个…」，展开后最后一条下方给出「收起」。
//  2) 三个模块共用 previewListRows / listMoreButton，文案按模块区分（文件 / 计划 / 子代理）。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  clientSource as source,
  extractConst,
  extractFunction,
  hudClient,
} from "./helpers/client-harness.mjs";

const { zh } = hudClient().dictionaries[0];

const walk = (node) => {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (typeof node !== "object") return [node];
  return [node, ...(node.children ?? []).flatMap(walk)];
};
const textOf = (node) => walk(node).filter((child) => typeof child === "string" || typeof child === "number").join("");
const buttonsOf = (node, className) => walk(node).filter((child) => child.type === "button" && child.props.className === className);

/** 构造一个最小 react 沙箱：useState 由 controls 决定初始态，并把 setter 的目标值写回 controls.next。 */
function makeSandbox(controls, extra = {}) {
  return vm.createContext({
    Set,
    Number,
    Math,
    react: {
      Fragment: "fragment",
      useState: () => [controls.expanded === true, (next) => { controls.next = next; }],
      useRef: () => ({ current: null }),
      useEffect: () => undefined,
      createElement: (type, props, ...children) => ({
        type: typeof type === "string" ? type : type?.name ?? "Component",
        props: props ?? {},
        children,
      }),
    },
    ModuleHead: (props) => ({ type: "ModuleHead", props, children: [] }),
    Icon: (props) => ({ type: "Icon", props, children: [] }),
    renderMarkdown: (text) => ({ type: "Markdown", props: {}, children: [String(text)] }),
    formatPlanTime: (time) => String(time),
    t: (key) => zh[key] ?? key,
    interpolate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
    ...extra,
  });
}

test("三个列表模块共用同一套折叠交互（默认 3 条 + 展开其余 / 收起）", () => {
  // 结构断言：三个模块都走 previewListRows / listMoreButton，且共用同一个预览数量。
  assert.match(source, /const LIST_PREVIEW_COUNT = 3;/);
  for (const name of ["OutputsModule", "PlansModule", "SubagentsModule"]) {
    const start = source.indexOf(`function ${name}(props) {`);
    assert.ok(start > 0, `找不到 ${name}`);
    const slice = source.slice(start, start + 4000);
    assert.match(slice, /previewListRows\(/, `${name} 应使用 previewListRows`);
    assert.match(slice, /listMoreButton\(/, `${name} 应使用 listMoreButton`);
    assert.match(slice, /react\.useState\(false\)/, `${name} 应维护折叠状态`);
  }
  // 文案：三个模块各自的展开文案 + 共用的收起文案。
  for (const [key, zhText, enText] of [
    ["outputsExpandRest", "展开其余 {count} 个文件", "Show {count} more files"],
    ["plansExpandRest", "展开其余 {count} 条计划", "Show {count} more plans"],
    ["subagentsExpandRest", "展开其余 {count} 个子代理", "Show {count} more subagents"],
    ["listCollapse", "收起", "Collapse"],
  ]) {
    assert.equal(zh[key], zhText, `${key} 中文文案`);
    assert.equal(hudClient().dictionaries[0].en[key], enText, `${key} 英文文案`);
  }
});

test("子代理任务：超过 3 个默认只渲染 3 个，展开后全部渲染并可收起", () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({
    id: `sa${index + 1}`,
    label: `subagent ${index + 1}`,
    depth: 1,
    activity: index === 0 ? "running" : "done",
  }));
  const byId = {};

  const controls = {};
  const context = makeSandbox(controls);
  vm.runInContext(
    `${extractConst("LIST_PREVIEW_COUNT")}\n${extractFunction("previewListRows")}\n${extractFunction("listMoreButton")}\n${extractFunction("SubagentsModule")}\nthis.SubagentsModule = SubagentsModule;`,
    context,
  );

  const folded = context.SubagentsModule({ entries, byId, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(buttonsOf(folded, "hud-subagent-row").length, 3, "折叠时只渲染 3 行");
  const more = buttonsOf(folded, "hud-list-more")[0];
  assert.ok(more, "超过 3 个时出现展开入口");
  assert.match(textOf(more), /展开其余 2 个子代理/);
  more.props.onClick();
  assert.equal(controls.next, true, "点击展开全部");

  const openControls = { expanded: true };
  const openContext = makeSandbox(openControls);
  vm.runInContext(
    `${extractConst("LIST_PREVIEW_COUNT")}\n${extractFunction("previewListRows")}\n${extractFunction("listMoreButton")}\n${extractFunction("SubagentsModule")}\nthis.SubagentsModule = SubagentsModule;`,
    openContext,
  );
  const expanded = openContext.SubagentsModule({ entries, byId, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(buttonsOf(expanded, "hud-subagent-row").length, 5, "展开后渲染全部行");
  const collapse = buttonsOf(expanded, "hud-list-more")[0];
  assert.match(textOf(collapse), /^收起$/);
  collapse.props.onClick();
  assert.equal(openControls.next, false, "点击收起");

  // 恰好 3 个：不出现入口。
  const small = openContext.SubagentsModule({ entries: entries.slice(0, 3), byId, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(buttonsOf(small, "hud-list-more").length, 0);
});

test("计划清单：超过 3 条默认只渲染 3 条，展开后全部渲染并可收起", () => {
  const plans = Array.from({ length: 5 }, (_, index) => ({
    id: `plan${index + 1}`,
    title: `plan ${index + 1}`,
    status: index === 0 ? "approved" : "pending",
    time: null,
    plan: "body",
  }));

  const controls = {};
  const context = makeSandbox(controls, {
    planStatusMeta: () => ({ kind: "pending", label: "待审批" }),
  });
  vm.runInContext(
    `${extractConst("LIST_PREVIEW_COUNT")}\n${extractFunction("previewListRows")}\n${extractFunction("listMoreButton")}\n${extractFunction("PlansModule")}\nthis.PlansModule = PlansModule;`,
    context,
  );

  const folded = context.PlansModule({ plans, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(buttonsOf(folded, "hud-plan-row").length, 3, "折叠时只渲染 3 行");
  const more = buttonsOf(folded, "hud-list-more")[0];
  assert.match(textOf(more), /展开其余 2 条计划/);
  // 底部三态统计仍按全部计划统计，不受折叠影响。
  assert.match(textOf(folded), /待审批|已执行|已废弃/);
  more.props.onClick();
  assert.equal(controls.next, true, "点击展开全部");

  const openControls = { expanded: true };
  const openContext = makeSandbox(openControls, {
    planStatusMeta: () => ({ kind: "pending", label: "待审批" }),
  });
  vm.runInContext(
    `${extractConst("LIST_PREVIEW_COUNT")}\n${extractFunction("previewListRows")}\n${extractFunction("listMoreButton")}\n${extractFunction("PlansModule")}\nthis.PlansModule = PlansModule;`,
    openContext,
  );
  const expanded = openContext.PlansModule({ plans, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.equal(buttonsOf(expanded, "hud-plan-row").length, 5, "展开后渲染全部行");
  const collapse = buttonsOf(expanded, "hud-list-more")[0];
  assert.match(textOf(collapse), /^收起$/);
  collapse.props.onClick();
  assert.equal(openControls.next, false, "点击收起");
});
