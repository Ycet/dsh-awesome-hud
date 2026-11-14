// dsh-awesome-hud — v0.19.2：任务 / 待办模块把已完成的条目移到最下方并默认折叠。
//  1) 未完成条目保持原顺序在前；已完成条目整组后置，组内仍保持原顺序（先完成的在上）。
//  2) 折叠态显示「展开已完成任务 / 展开已完成待办」，展开后末尾显示「收起」。
//  3) 待办的拖动只在未完成区段内重排，已完成条目固定组在末尾。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  clientSource as source,
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
const rowsOf = (node) => walk(node).filter((child) => child.props?.className === "hud-task-row");
const moreOf = (node) => walk(node).filter((child) => child.type === "button" && child.props.className === "hud-list-more");

/** 用真实实现跑 TasksModule：只给渲染必需的最小依赖。 */
function loadTasksModule(controls) {
  const context = vm.createContext({
    Set,
    Number,
    Math,
    react: {
      useState: () => [controls.expanded === true, (next) => { controls.next = next; }],
      createElement: (type, props, ...children) => ({
        type: typeof type === "string" ? type : type?.name ?? "Component",
        props: props ?? {},
        children,
      }),
    },
    ModuleHead: (props) => ({ type: "ModuleHead", props, children: [] }),
    Icon: (props) => ({ type: "Icon", props, children: [] }),
    TaskProgressIcon: () => ({ type: "TaskProgressIcon", props: {}, children: [] }),
    t: (key) => zh[key] ?? key,
    interpolate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
  });
  vm.runInContext(
    `${extractFunction("splitCompleted")}\n${extractFunction("listMoreButton")}\n${extractFunction("TasksModule")}\nthis.TasksModule = TasksModule;`,
    context,
  );
  return context.TasksModule;
}

test("splitCompleted：未完成保持原顺序在前，已完成整组后置且组内顺序不变", () => {
  const context = vm.createContext({});
  vm.runInContext(`${extractFunction("splitCompleted")}\nthis.splitCompleted = splitCompleted;`, context);
  const { splitCompleted } = context;

  const items = [
    { id: "a", done: false },
    { id: "b", done: true },
    { id: "c", done: false },
    { id: "d", done: true },
    { id: "e", done: true },
  ];
  const view = splitCompleted(items, (item) => item.done);
  // 沙箱里的数组来自另一个 realm，展开成当前 realm 的数组再比较。
  assert.deepEqual([...view.open.map((item) => item.id)], ["a", "c"], "未完成条目保持原先后");
  assert.deepEqual([...view.completed.map((item) => item.id)], ["b", "d", "e"], "已完成条目保持原先后（先完成的在上）");
  assert.equal(view.total, 5);
  // 坏输入安全返回
  const empty = splitCompleted(null, (item) => item.done);
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), { open: [], completed: [], total: 0 });
});

test("任务模块：已完成任务移到最下方并默认折叠，展开后末尾给「收起」", () => {
  const todos = [
    { content: "pending-1", status: "pending" },
    { content: "done-1", status: "completed" },
    { content: "doing", status: "in_progress" },
    { content: "done-2", status: "completed" },
    { content: "pending-2", status: "pending" },
  ];

  // 折叠态：只渲染未完成的 3 行，已完成整组隐藏。
  const controls = {};
  const TasksModule = loadTasksModule(controls);
  const folded = TasksModule({ todos, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.deepEqual(rowsOf(folded).map((node) => textOf(node.children[1])), ["pending-1", "doing", "pending-2"]);
  const more = moreOf(folded)[0];
  assert.ok(more, "存在已完成任务时出现展开入口");
  assert.match(textOf(more), /展开已完成任务/);
  // 底部三态计数仍按全部任务统计（2 完成 / 1 进行中 / 2 待处理）。
  assert.match(textOf(folded), /2/);
  more.props.onClick();
  assert.equal(controls.next, true, "点击展开已完成任务");

  // 展开态：全部 5 行，已完成按原先后排在末尾，末尾给「收起」。
  const openControls = { expanded: true };
  const OpenTasks = loadTasksModule(openControls);
  const expanded = OpenTasks({ todos, fold: false, onOpen: () => {}, onFoldChange: () => {} });
  assert.deepEqual(rowsOf(expanded).map((node) => textOf(node.children[1])), ["pending-1", "doing", "pending-2", "done-1", "done-2"]);
  const collapse = moreOf(expanded)[0];
  assert.match(textOf(collapse), /^收起$/);
  collapse.props.onClick();
  assert.equal(openControls.next, false, "点击收起");

  // 没有已完成任务时没有入口。
  const noDone = OpenTasks({ todos: todos.filter((item) => item.status !== "completed"), fold: false, onFoldChange: () => {} });
  assert.equal(moreOf(noDone).length, 0);
});

test("待办模块接线：已完成待办后置折叠，拖动只在未完成区段内重排", () => {
  // 分区 + 渲染顺序
  assert.match(source, /const doneView = splitCompleted\(todos, \(item\) => item\.done\);/);
  assert.match(source, /const renderTodos = doneExpanded \? activeTodos\.concat\(doneTodos\) : activeTodos;/);
  assert.match(source, /renderTodos\.map\(\(item\) => \{/, "列表按 renderTodos 渲染");
  assert.match(source, /expandText: t\("todoExpandDone"\)/);
  // 已完成行不提供拖动手柄
  assert.match(source, /item\.done \? null : react\.createElement\("button", \{\n\s+type: "button",\n\s+className: "hud-todo-grip",/);
  // 拖动只统计未完成行，落盘时把已完成整组接回末尾
  assert.match(source, /const order = activeTodos\.map\(\(value\) => value\.id\);/);
  assert.match(source, /\.filter\(\(node\) => node\.getAttribute\?\.\("data-done"\) === "false"\)/);
  assert.match(source, /const merged = next\.length === activeTodos\.length \? next\.concat\(doneTodos\) : \[\];/);
  assert.match(source, /persist\(merged\);/);
  // 文案成对
  for (const key of ["tasksExpandDone", "todoExpandDone"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文`);
    assert.equal(typeof hudClient().dictionaries[0].en[key], "string", `${key} 需要英文`);
  }
  assert.equal(zh.tasksExpandDone, "展开已完成任务");
  assert.equal(zh.todoExpandDone, "展开已完成待办");
});
