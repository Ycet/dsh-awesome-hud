import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** 按「函数声明 + 平衡大括号」精确抽取一个函数（跳过参数列表里的默认值）。 */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `function ${name} must exist in lib/client.js`);
  let index = source.indexOf("(", start);
  let parens = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    else if (source[index] === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  index = source.indexOf("{", index);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const VIEWPORT = { width: 1440, height: 900 };
const FULLSCREEN_STYLE = { position: "fixed", display: "block", visibility: "visible" };

/** 构造一个模态浮层节点（默认与 dsh-codex-subscription 图片查看器同形：fixed + 铺满视口）。 */
function overlay(rect = VIEWPORT, style = FULLSCREEN_STYLE) {
  return { getBoundingClientRect: () => rect, style };
}

/** 抽出 fullscreenPreviewOpen 并在可控 DOM 中运行；setNodes 用于切换「当前有哪些模态浮层」。 */
function createPreviewContext(initialNodes) {
  let nodes = initialNodes;
  const context = vm.createContext({
    document: {
      body: {},
      querySelectorAll: selector => {
        assert.equal(selector, '[role="dialog"][aria-modal="true"]');
        return nodes;
      },
    },
    window: {
      innerWidth: VIEWPORT.width,
      innerHeight: VIEWPORT.height,
      getComputedStyle: node => node.style,
    },
  });
  vm.runInContext(extractFunction("fullscreenPreviewOpen"), context);
  return { context, setNodes: value => { nodes = value; } };
}

test("全屏大图预览打开时判定为遮挡（新建会话页入口让位）", () => {
  // codex-subscription 图片查看器：role=dialog + aria-modal + position:fixed + inset:0
  const { context } = createPreviewContext([overlay()]);
  assert.equal(context.fullscreenPreviewOpen(), true);
});

test("小尺寸弹窗、静态浮层与隐藏浮层都不算全屏预览", () => {
  const cases = [
    [overlay({ width: 420, height: 300 }), "居中小弹窗"],
    [overlay(VIEWPORT, { position: "static", display: "block", visibility: "visible" }), "非浮层定位"],
    [overlay(VIEWPORT, { position: "fixed", display: "none", visibility: "visible" }), "display:none"],
    [overlay(VIEWPORT, { position: "fixed", display: "block", visibility: "hidden" }), "visibility:hidden"],
    // 未达 95% 覆盖率的非全屏模态同样不隐藏入口
    [overlay({ width: VIEWPORT.width * 0.9, height: VIEWPORT.height * 0.9 }), "90% 覆盖率"],
  ];
  for (const [node, label] of cases) {
    const { context } = createPreviewContext([node]);
    assert.equal(context.fullscreenPreviewOpen(), false, `${label} must not hide the entry`);
  }
  const { context } = createPreviewContext([]);
  assert.equal(context.fullscreenPreviewOpen(), false, "没有模态浮层时不隐藏");
});

test("只看模态浮层语义与覆盖率，不绑定第三方类名", () => {
  // 选择器要求 role=dialog + aria-modal（HUD 自身弹窗使用 role=dialog 但不带 aria-modal）
  assert.match(source, /document\.querySelectorAll\('\[role="dialog"\]\[aria-modal="true"\]'\)/);
  assert.doesNotMatch(source, /dcsiv/);
  assert.match(source, /rect\.width >= window\.innerWidth \* 0\.95 && rect\.height >= window\.innerHeight \* 0\.95/);
});

test("浮层挂载/卸载时重新判定，并在卸载时断开观察", () => {
  let listener;
  let disconnected = false;
  const observed = [];
  const { context, setNodes } = createPreviewContext([]);
  context.MutationObserver = class {
    constructor(callback) { listener = callback; }
    observe(target, options) { observed.push([target, options]); }
    disconnect() { disconnected = true; }
  };
  vm.runInContext(extractFunction("watchFullscreenPreview"), context);

  const values = [];
  const stop = context.watchFullscreenPreview(value => values.push(value));
  // 订阅即刻判定一次：覆盖「预览已经打开、按钮随后才挂载」的情形
  assert.deepEqual(values, [false]);
  assert.equal(observed.length, 1);
  assert.equal(observed[0][0], context.document.body);
  // 展开为宿主对象再比较：vm 内创建的对象原型来自另一个 realm
  assert.deepEqual({ ...observed[0][1] }, { subtree: true, childList: true });

  setNodes([overlay()]);
  listener();
  assert.deepEqual(values, [false, true]);

  setNodes([]);
  listener();
  assert.deepEqual(values, [false, true, false]);

  stop();
  assert.equal(disconnected, true);
});

test("预览期间悬浮入口按钮不渲染，且 hooks 顺序保持不变", () => {
  const component = extractFunction("HudFloatingButton");
  assert.match(component, /const \[previewOpen, setPreviewOpen\] = react\.useState\(\(\) => fullscreenPreviewOpen\(\)\);/);
  assert.match(component, /react\.useEffect\(\(\) => watchFullscreenPreview\(setPreviewOpen\), \[\]\);/);
  assert.match(component, /if \(previewOpen\) return null;/);
  // 提前返回必须在全部 hooks 之后，否则 React hooks 顺序会被破坏
  assert.ok(component.indexOf("if (previewOpen) return null;") > component.lastIndexOf("react.useEffect("),
    "the early return must come after every hook");
  // 按钮本身的位置与样式不变（仅预览期间整体不渲染）
  assert.match(component, /className: "hud-btn hud-btn-float"/);
  assert.match(component, /style: \{ right: `\$\{sidebarInset\}px` \},/);
  // 仍仅在新建会话页渲染该入口
  assert.match(source, /newSession \? react\.createElement\(HudFloatingButton, null\) : null/);
});

test("按 hooks 顺序真实渲染：预览开关切换组件返回 null / 按钮", () => {
  const cells = [];
  const effects = [];
  let cursor = 0;
  let notifyPreview = null;
  // 极简 hooks 运行时：按调用顺序保存 state/effect，重渲染时复用同一批槽位
  const react = {
    useState: (init) => {
      const position = cursor++;
      if (cells[position] === undefined) cells[position] = { value: typeof init === "function" ? init() : init };
      const cell = cells[position];
      return [cell.value, next => { cell.value = typeof next === "function" ? next(cell.value) : next; }];
    },
    useEffect: fn => { effects[cursor++] = fn; },
    createElement: (type, props, ...children) => ({ type, props, children }),
  };
  const context = vm.createContext({
    react,
    // 悬浮入口使用派生可见性（展开记忆 ∩ 右侧栏未展开）
    peekHudOpen: () => false,
    getSidebarExpanded: () => false,
    isHudVisible: () => false,
    subscribeHud: () => () => {},
    subscribeSidebar: () => () => {},
    watchFloatingHudPosition: () => () => {},
    // 记录组件注册的回调，用它模拟浮层开合真正驱动 state 更新
    watchFullscreenPreview: onChange => { notifyPreview = onChange; return () => {}; },
    fullscreenPreviewOpen: () => false,
    HUD_FLOAT_RIGHT: 72,
    Icon: "Icon",
    t: key => key,
    toggleHud: () => {},
    ctx: {},
  });
  vm.runInContext(extractFunction("HudFloatingButton"), context);
  const render = () => { cursor = 0; return context.HudFloatingButton(); };

  const button = render();
  assert.equal(button.type, "button");
  assert.equal(button.props.className, "hud-btn hud-btn-float");
  assert.equal(button.props["data-hud-float"], "");
  const mounted = effects.filter(fn => typeof fn === "function");
  assert.equal(mounted.length, 3);
  for (const effect of mounted) effect();
  assert.equal(typeof notifyPreview, "function", "浮层开合监听必须接到 setPreviewOpen");

  // 预览打开：同一组 hooks 顺序下直接返回 null（无按钮、无残留浮层）
  notifyPreview(true);
  assert.equal(render(), null);

  // 预览关闭：按钮立即恢复，仍复用同一批 state 槽位
  notifyPreview(false);
  assert.equal(render().props.className, "hud-btn hud-btn-float");
});

