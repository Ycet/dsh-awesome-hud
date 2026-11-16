// dsh-awesome-hud — v0.21.1：点遮罩关闭弹窗的安全判定
//  1) 唯一实现 useOverlayDismiss：必须「在遮罩上按下 + 在遮罩上松开」才关闭
//  2) 在输入框里按下拖动选中、指针移到弹窗外再松手（click 落在遮罩上）不得关闭
//  3) 关闭按钮 / Esc 等既有入口不受影响
//  4) 便笺编辑弹窗、便笺确认弹窗、设置弹窗、git graph 弹窗统一接线
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { clientSource as source, extractFunction } from "./helpers/client-harness.mjs";

/** 只记录元素与 effect 的最小 React 适配器。 */
function fakeReact() {
  return {
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: "fragment",
  };
}

/** 载入 useOverlayDismiss + 指定弹窗组件，返回可直接调用的组件。 */
function loadDialogs(names) {
  const react = fakeReact();
  const context = vm.createContext({
    react,
    react_dom: { createPortal: (node) => node },
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    globalThis: { addEventListener() {}, removeEventListener() {} },
    Icon: (props) => ({ type: "Icon", props, children: [] }),
    t: (key) => key,
    isImeComposing: () => false,
    interpolate: (text, values) => Object.entries(values ?? {}).reduce((next, [key, value]) => next.replace(`{${key}}`, String(value)), text),
  });
  const script = [extractFunction("useOverlayDismiss"), ...names.map((name) => extractFunction(name))].join("\n");
  vm.runInContext(script, context);
  return context;
}

const walk = (node) => {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (typeof node !== "object") return [node];
  return [node, ...(node.children ?? []).flatMap(walk)];
};
const byClass = (node, name) => walk(node).filter((child) => typeof child.props?.className === "string" && child.props.className.split(" ").includes(name));

/** 遮罩自身的三连（pointerdown + pointerup + click 都落在遮罩上）。 */
const clickOverlay = (overlay) => {
  const target = { kind: "overlay" };
  overlay.props.onPointerDown({ target, currentTarget: target });
  overlay.props.onPointerUp({ target, currentTarget: target });
  overlay.props.onClick({ target, currentTarget: target });
};

test("便笺编辑弹窗：在输入框里拖选文字、指针移到弹窗外松手，不关闭", () => {
  const context = loadDialogs(["NoteEditorDialog"]);
  let closed = 0;
  const tree = context.NoteEditorDialog({
    title: "编辑便笺",
    onClose: () => { closed += 1; },
    children: [],
  });
  const overlay = byClass(tree, "hud-note-editor-modal")[0];
  assert.ok(overlay, "遮罩存在");
  const input = { kind: "textarea" };
  // 按下发生在输入框（弹窗内），松手时 click 被派发到共同祖先 = 遮罩
  overlay.props.onPointerDown({ target: input, currentTarget: overlay });
  overlay.props.onClick({ target: overlay, currentTarget: overlay });
  assert.equal(closed, 0, "从弹窗内开始的选择不得关闭弹窗");
});

test("便笺编辑弹窗：遮罩按下 + 遮罩松开才关闭；下压在遮罩、松手在卡片不关闭", () => {
  const context = loadDialogs(["NoteEditorDialog"]);
  let closed = 0;
  const render = () => context.NoteEditorDialog({ title: "编辑便笺", onClose: () => { closed += 1; }, children: [] });
  let overlay = byClass(render(), "hud-note-editor-modal")[0];
  const card = { kind: "card" };
  overlay.props.onPointerDown({ target: overlay, currentTarget: overlay });
  overlay.props.onPointerUp({ target: card, currentTarget: overlay });
  overlay.props.onClick({ target: overlay, currentTarget: overlay });
  assert.equal(closed, 0, "松手落在卡片上（拖回弹窗内）不得关闭");

  overlay = byClass(render(), "hud-note-editor-modal")[0];
  clickOverlay(overlay);
  assert.equal(closed, 1, "在遮罩上按下并松开才关闭");
});

test("便笺确认弹窗与关闭按钮：遮罩语义一致，关闭按钮照常关闭", () => {
  const context = loadDialogs(["NoteConfirmDialog"]);
  let closed = 0;
  const render = () => context.NoteConfirmDialog({
    title: "删除全部便笺",
    note: "将删除全部 2 条便笺",
    confirmLabel: "删除全部",
    danger: true,
    onClose: () => { closed += 1; },
    onConfirm: () => {},
  });
  const overlay = byClass(render(), "hud-modal")[0];
  const inside = { kind: "confirm-note" };
  overlay.props.onPointerDown({ target: inside, currentTarget: overlay });
  overlay.props.onClick({ target: overlay, currentTarget: overlay });
  assert.equal(closed, 0, "弹窗内按下后松手到遮罩不关闭");
  clickOverlay(byClass(render(), "hud-modal")[0]);
  assert.equal(closed, 1, "遮罩点击关闭");

  const closeButton = byClass(render(), "hud-modal-close")[0];
  closeButton.props.onClick();
  assert.equal(closed, 2, "关闭按钮仍然直接关闭");
});

test("接线：五个点遮罩关闭的弹窗都改用同一套安全判定（设置 / 便笺确认 / 便笺编辑 / git graph / commit）", () => {
  // 设置弹窗 / 便笺确认 / 便笺编辑：直接展开同一个 hook 的返回值
  assert.equal((source.match(/\.\.\.overlayDismiss,/g) ?? []).length, 3, "三处直接展开 overlayDismiss");
  // v0.21.1：git graph 与 commit 弹窗各自绑定自己的关闭回调
  assert.match(source, /const commitOverlayDismiss = useOverlayDismiss\(closeCommit\);/);
  assert.match(source, /\.\.\.commitOverlayDismiss,/);
  // git graph 弹窗：hook 绑定 closeGraph
  assert.match(source, /const graphOverlayDismiss = useOverlayDismiss\(closeGraph\);/);
  assert.match(source, /\.\.\.graphOverlayDismiss,/);
  // 旧的「点遮罩就关闭」写法必须全部消失；唯一保留的是便笺图片大图预览
  // （里面没有任何输入框，不存在拖选误关的问题）。
  assert.match(source, /className: "hud-note-lightbox",[\s\S]{0,260}onClick: props\.onClose,/, "大图预览保持点击遮罩关闭");
  assert.doesNotMatch(source, /onClick: \(event\) => \{ if \(event\.target === event\.currentTarget\) props\.onClose\(\); \}/);
  // 遮罩层的 onClick 必须由 hook 提供：这些位置不再出现「直接绑 onClose/closeGraph」
  assert.doesNotMatch(source, /"aria-label": t\("gitGraph"\),\s*onClick: closeGraph,/);
  // v0.21.1：commit 弹窗同样支持点遮罩关闭，且复用同一套安全判定
  assert.match(source, /const commitOverlayDismiss = useOverlayDismiss\(closeCommit\);/);
  assert.match(source, /\.\.\.commitOverlayDismiss,/);
});

test("hook 自身：没有事件对象时不做任何事（防止程序化调用误关）", () => {
  const context = loadDialogs([]);
  let closed = 0;
  const props = context.useOverlayDismiss(() => { closed += 1; });
  props.onClick();
  props.onPointerDown();
  props.onPointerUp();
  assert.equal(closed, 0);
  // pointerdown 落在遮罩、click 目标也是遮罩 → 关闭
  const overlay = {};
  props.onPointerDown({ target: overlay, currentTarget: overlay });
  props.onClick({ target: overlay, currentTarget: overlay });
  assert.equal(closed, 1);
});
