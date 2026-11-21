// dsh-awesome-hud — v0.21.1：右键「添加至 .gitignore」（客户端）
//  1) 文件与文件夹共用同一套菜单项渲染，changes 分组才出现忽略项
//  2) 文件夹菜单的批量动作复用文件树的 paths 接口
//  3) 点击忽略项调用 host 的 git/ignore（文件传 kind=file、文件夹传 kind=dir）
//  4) 文件夹行可用右键与 Shift+F10 打开菜单
//  5) 图标走新资产 ignore.svg，并已加入宿主白名单与内联兜底
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { clientSource as source, hudClient } from "./helpers/client-harness.mjs";
import { assetFileFor } from "../lib/index.js";

const root = new URL("../", import.meta.url);
const assetText = readFileSync(new URL("assets/icons/ignore.svg", root), "utf8");

/** 取出菜单项构造段（从 isDirMenu 到 fileMenu 之前），在沙箱里按不同 menu 求值。 */
function loadMenuItems() {
  const start = source.indexOf("const isDirMenu = menu.kind === \"dir\";");
  const end = source.indexOf("fileMenu = react.createElement", start);
  assert.ok(start > 0 && end > start, "定位不到菜单项构造段");
  const block = source.slice(start, end);
  return (menu, stubs = {}) => {
    const calls = [];
    const sandbox = {
      react: {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        Fragment: "fragment",
      },
      Icon: (props) => ({ type: "Icon", props }),
      MenuIcon: (props) => ({ type: "MenuIcon", props }),
      t: (key) => key,
      menu,
      setMenu: (value) => calls.push({ setMenu: value }),
      doStage: (...args) => calls.push({ fn: "doStage", args }),
      doUnstage: (...args) => calls.push({ fn: "doUnstage", args }),
      doStagePaths: (...args) => calls.push({ fn: "doStagePaths", args }),
      doUnstagePaths: (...args) => calls.push({ fn: "doUnstagePaths", args }),
      openRevertFileConfirm: (...args) => calls.push({ fn: "openRevertFileConfirm", args }),
      openRevertPathsConfirm: (...args) => calls.push({ fn: "openRevertPathsConfirm", args }),
      doIgnore: (...args) => calls.push({ fn: "doIgnore", args }),
      // v0.21.6：文件菜单追加「产物」同款动作，这里给出它们的桩与最简 Git 上下文。
      props: { sendSessionId: "s1", sessionId: "s1", git: { prefix: "", root: "/repo" } },
      gitWorkspacePath: () => "dsh-awesome-hud/lib/client.js",
      gitAbsolutePath: () => "/repo/dsh-awesome-hud/lib/client.js",
      addGitTargetToChat: (...args) => calls.push({ fn: "addGitTargetToChat", args: [args[0].path, args[1]] }),
      revealGitFile: (...args) => calls.push({ fn: "revealGitFile", args }),
      copyWithToast: async (text, label) => { calls.push({ fn: "copyWithToast", args: [text, label] }); return true; },
      splitRelativePath: (path) => { const parts = String(path).split("/"); return { name: parts[parts.length - 1] }; },
      ...stubs,
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(`{ ${block} this.items = items; }`, context);
    // v0.21.6：文件菜单里混入分割线，把 div 映射成 { divider: true }，其余映射成 { label, icon }。
    const items = Array.from(context.items, (item) => (item.type === "div"
      ? { divider: true }
      : { label: item.children[1].children[0], icon: item.children[0].props.official ?? item.children[0].props.asset }));
    return { items, raw: context.items, calls };
  };
}

const click = (item) => item.props.onClick({ stopPropagation() {} });

// v0.21.6：产物右键菜单的动作整体搬进 Git 变更文件菜单，Git 原生动作排在最上方。
const fileExtras = [
  { divider: true },
  { label: "chatAddToChat", icon: "at" },
  { label: "outputsRevealInFolder", icon: "folder" },
  { divider: true },
  { label: "outputsCopyName", icon: "copy" },
  { label: "outputsCopyRelativePath", icon: "copy" },
  { label: "outputsCopyAbsolutePath", icon: "copy" },
];

test("changes 分组的文件菜单：Git 动作在上，其后是产物同款动作", () => {
  const build = loadMenuItems();
  const { items } = build({ kind: "file", file: { path: "dsh-awesome-hud/lib/client.js" }, group: "changes" });
  assert.deepEqual(items, [
    { label: "gitAddToStage", icon: "plus" },
    { label: "gitRevertOption", icon: "revert" },
    { label: "gitAddToGitignore", icon: "ignore" },
    ...fileExtras,
  ]);
});

test("staged 分组的文件菜单：先移出暂存，其后同样有产物同款动作", () => {
  const build = loadMenuItems();
  const { items } = build({ kind: "file", file: { path: "a.txt" }, group: "staged" });
  assert.deepEqual(items, [{ label: "gitRemoveFromStage", icon: "minus" }, ...fileExtras]);
});

test("文件夹菜单也有产物同款动作：添加至聊天、定位与复制都可用", () => {
  const build = loadMenuItems();
  const dir = build({ kind: "dir", path: "docs", files: [{ path: "docs/a.md" }], group: "changes" });
  assert.deepEqual(dir.items, [
    { label: "gitAddToStage", icon: "plus" },
    { label: "gitRevertOption", icon: "revert" },
    { label: "gitAddToGitignore", icon: "ignore" },
    ...fileExtras,
  ]);
  const chat = dir.raw.find((item) => item.type !== "div" && item.props?.key === "add-to-chat");
  assert.equal(chat.props.disabled, false, "文件夹同样可以作为 @ 引用");
  assert.equal(chat.props.title, undefined);
  const reveal = dir.raw.find((item) => item.type !== "div" && item.props?.key === "reveal");
  assert.equal(reveal.props.disabled, false, "文件夹可以在文件管理器中显示");

  const staged = build({ kind: "dir", path: "docs", files: [{ path: "docs/a.md" }], group: "staged" });
  assert.deepEqual(staged.items, [
    { label: "gitRemoveFromStage", icon: "minus" },
    ...fileExtras,
  ]);
});

test("文件菜单的动作接线：添加至聊天、在文件夹显示、三个复制", () => {
  const build = loadMenuItems();
  const file = { path: "dsh-awesome-hud/lib/client.js" };
  const { raw, calls } = build({ kind: "file", file, group: "changes" });
  const at = raw.findIndex((item) => item.type !== "div" && item.props?.key === "add-to-chat");
  const reveal = raw.findIndex((item) => item.type !== "div" && item.props?.key === "reveal");
  const copyName = raw.findIndex((item) => item.type !== "div" && item.props?.key === "copy-name");
  const copyRelative = raw.findIndex((item) => item.type !== "div" && item.props?.key === "copy-relative");
  const copyAbsolute = raw.findIndex((item) => item.type !== "div" && item.props?.key === "copy-absolute");
  assert.ok(at > 0 && reveal > at && copyName > reveal && copyRelative > copyName && copyAbsolute > copyRelative, "动作顺序固定");
  click(raw[at]);
  click(raw[reveal]);
  click(raw[copyName]);
  assert.deepEqual(calls.filter((call) => call.fn === "addGitTargetToChat"), [{ fn: "addGitTargetToChat", args: [file.path, false] }]);
  assert.deepEqual(calls.filter((call) => call.fn === "revealGitFile"), [{ fn: "revealGitFile", args: [{ path: file.path }, false] }]);
  assert.deepEqual(calls.filter((call) => call.fn === "copyWithToast"), [{ fn: "copyWithToast", args: ["client.js", "copiedOutputName"] }]);
});

test("文件菜单的禁用态：无聊天输入框、已删除、绝对路径不可得", () => {
  const build = loadMenuItems();
  const deleted = { path: "a.md", status: "D" };
  const menu = build({ kind: "file", file: deleted, group: "changes" });
  const at = menu.raw.find((item) => item.type !== "div" && item.props?.key === "add-to-chat");
  assert.equal(at.props.disabled, true, "已删除的文件不能添加至聊天");
  assert.equal(at.props.title, "gitChatDeleted");
  const reveal = menu.raw.find((item) => item.type !== "div" && item.props?.key === "reveal");
  assert.equal(reveal.props.disabled, true, "已删除的文件不能定位");

  const noTarget = build({ kind: "file", file: { path: "a.md" }, group: "changes" }, {
    props: { sendSessionId: "", sessionId: "s1", git: { prefix: "", root: "/repo" } },
  });
  const add = noTarget.raw.find((item) => item.type !== "div" && item.props?.key === "add-to-chat");
  assert.equal(add.props.disabled, true, "没有聊天输入框时置灰");
  assert.equal(add.props.title, "chatAddNoTarget");

  const noRoot = build({ kind: "file", file: { path: "a.md" }, group: "changes" }, { gitAbsolutePath: () => "" });
  const copyAbsolute = noRoot.raw.find((item) => item.type !== "div" && item.props?.key === "copy-absolute");
  assert.equal(copyAbsolute.props.disabled, true, "拿不到仓库根时绝对路径置灰");
  assert.equal(copyAbsolute.props.title, "gitRootUnavailable");
});

test("菜单定位：文件菜单按条目数与分割线数夹取到视口内", () => {
  assert.match(source, /const items = group === "staged" \? 6 : 8;/);
  assert.match(source, /gitMenuPlacement\(event, items, 2\)/);
  assert.match(source, /const gitMenuPlacement = \(event, itemCount, dividerCount = 0\) => \{/);
  assert.match(source, /react_dom\.createPortal\(fileMenu, document\.body\)/);
});

test("点击忽略项：文件传 kind=file，文件夹传 kind=dir", () => {
  const build = loadMenuItems();
  const file = build({ kind: "file", file: { path: "dsh-awesome-hud/README.md" }, group: "changes" });
  click(file.raw[2]);
  assert.deepEqual(file.calls.filter((call) => call.fn === "doIgnore"), [{ fn: "doIgnore", args: ["dsh-awesome-hud/README.md", "file"] }]);
  // 点击后先关菜单（原有交互不变）
  assert.deepEqual(file.calls[0], { setMenu: null });

  const dir = build({ kind: "dir", path: "docs", files: [], group: "changes" });
  click(dir.raw[2]);
  assert.deepEqual(dir.calls.filter((call) => call.fn === "doIgnore"), [{ fn: "doIgnore", args: ["docs", "dir"] }]);
});

test("文件夹菜单：暂存 / 撤销走批量接口", () => {
  const build = loadMenuItems();
  const files = [{ path: "docs/a.md" }, { path: "docs/b.md" }];
  const dir = build({ kind: "dir", path: "docs", files, group: "changes" });
  click(dir.raw[0]);
  click(dir.raw[1]);
  assert.deepEqual(dir.calls.filter((call) => call.fn === "doStagePaths"), [{ fn: "doStagePaths", args: [["docs/a.md", "docs/b.md"]] }]);
  assert.deepEqual(dir.calls.filter((call) => call.fn === "openRevertPathsConfirm"), [{ fn: "openRevertPathsConfirm", args: [files] }]);

  const staged = build({ kind: "dir", path: "docs", files, group: "staged" });
  click(staged.raw[0]);
  assert.deepEqual(staged.calls.filter((call) => call.fn === "doUnstagePaths"), [{ fn: "doUnstagePaths", args: [["docs/a.md", "docs/b.md"]] }]);
});

test("文件夹菜单：添加至聊天、定位与复制都用目录路径", () => {
  const build = loadMenuItems();
  const dir = build({ kind: "dir", path: "docs/guides", files: [{ path: "docs/guides/a.md" }], group: "changes" });
  const chat = dir.raw.find((item) => item.type !== "div" && item.props?.key === "add-to-chat");
  click(chat);
  assert.deepEqual(dir.calls.filter((call) => call.fn === "addGitTargetToChat").map((call) => call.args), [["docs/guides", true]]);
  const reveal = dir.raw.find((item) => item.type !== "div" && item.props?.key === "reveal");
  click(reveal);
  assert.deepEqual(JSON.parse(JSON.stringify(dir.calls.filter((call) => call.fn === "revealGitFile"))), [{ fn: "revealGitFile", args: [{ path: "docs/guides" }, true] }]);
  const copyName = dir.raw.find((item) => item.type !== "div" && item.props?.key === "copy-name");
  click(copyName);
  assert.deepEqual(dir.calls.filter((call) => call.fn === "copyWithToast").map((call) => call.args), [["guides", "copiedOutputName"]]);
});

test("文件夹行接线：右键与 Shift+F10 都能打开菜单", () => {
  assert.match(source, /const openDirMenu = \(event, node, files, group\) => \{/);
  assert.match(source, /setMenu\(\{ kind: "dir", path: node\.path, name: node\.name, files, group, \.\.\.gitMenuPlacement\(event, items, 2\) \}\);/);
  const rowStart = source.indexOf('key: `dir:${key}`');
  const rowEnd = source.indexOf("renderFolderActions(files, group)", rowStart);
  assert.ok(rowStart > 0 && rowEnd > rowStart, "定位不到文件夹行");
  const row = source.slice(rowStart, rowEnd);
  assert.match(row, /onContextMenu: \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*openDirMenu\(event, node, files, group\);/s);
  assert.match(row, /if \(event\.key !== "ContextMenu" && !\(event\.shiftKey && event\.key === "F10"\)\) return;/);
  assert.match(row, /openDirMenu\(event, node, files, group\);/);
});

test("doIgnore：按 host 返回分四种提示，被跟踪时追加警告", () => {
  const start = source.indexOf("const doIgnore = (path, kind) => {");
  const end = source.indexOf("const doStageAll = () => {", start);
  assert.ok(start > 0 && end > start, "定位不到 doIgnore");
  const body = source.slice(start, end);
  assert.match(body, /runWrite\("git\/ignore", \{ path, kind \}, \(body\) => \{/);
  assert.match(body, /if \(info\?\.duplicate === true\) \{\s*toast\(interpolate\(t\("gitIgnoreExisting"\)/);
  assert.match(body, /else if \(info\?\.created === true\) \{\s*toast\(interpolate\(t\("gitIgnoreCreated"\), \{ path: shown \}\), "success"\)/);
  assert.match(body, /toast\(interpolate\(t\("gitIgnoreDone"\), \{ path: shown \}\), "success"\)/);
  assert.match(body, /if \(info\?\.tracked === true\) toast\(interpolate\(t\("gitIgnoreTrackedHint"\), \{ path: shown \}\), "warn"\)/);
});

test("文案与图标资产：中英键成对、ignore.svg 已入库且合法", () => {
  const { zh, en } = hudClient().dictionaries[0];
  for (const key of ["gitAddToGitignore", "gitIgnoreDone", "gitIgnoreCreated", "gitIgnoreExisting", "gitIgnoreTrackedHint"]) {
    assert.equal(typeof zh[key], "string", `中文缺键：${key}`);
    assert.equal(typeof en[key], "string", `英文缺键：${key}`);
  }
  assert.match(zh.gitAddToGitignore, /\.gitignore/);
  assert.match(en.gitAddToGitignore, /\.gitignore/);
  // 资产：入库、可被 adaptIcon 处理（无写死尺寸）、单色填充
  assert.match(assetText, /viewBox="0 0 1024 1024"/);
  assert.match(assetText, /fill="#000000"/, "单色图标需能被是否保留颜色的逻辑统一替换");
  assert.doesNotMatch(assetText, /style="width:16px/, "入库文件保持原始资产，尺寸由客户端注入");
  // 宿主白名单放行（否则客户端请求会 404）
  const asset = assetFileFor("ignore.svg");
  assert.ok(asset.path.endsWith("/assets/icons/ignore.svg"), asset.path);
  assert.equal(asset.contentType, "image/svg+xml");
  // 客户端仍有内联兜底，旧宿主未放行白名单时菜单图标不会空白
  assert.match(source, /ignore: `<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1024 1024"/);
});
