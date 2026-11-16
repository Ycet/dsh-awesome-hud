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
      ...stubs,
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(`{ ${block} this.items = items; }`, context);
    return { items: JSON.parse(JSON.stringify(context.items.map((item) => ({ label: item.children[1].children[0], icon: item.children[0].props.name })))), raw: context.items, calls };
  };
}

const click = (item) => item.props.onClick({ stopPropagation() {} });

test("changes 分组的文件菜单：三项且含「添加至 .gitignore」", () => {
  const build = loadMenuItems();
  const { items } = build({ kind: "file", file: { path: "dsh-awesome-hud/lib/client.js" }, group: "changes" });
  assert.deepEqual(items, [
    { label: "gitAddToStage", icon: "plus" },
    { label: "gitRevertOption", icon: "revert" },
    { label: "gitAddToGitignore", icon: "ignore" },
  ]);
});

test("staged 分组的文件菜单：只有移出暂存，不出现忽略项", () => {
  const build = loadMenuItems();
  const { items } = build({ kind: "file", file: { path: "a.txt" }, group: "staged" });
  assert.deepEqual(items, [{ label: "gitRemoveFromStage", icon: "minus" }]);
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

test("文件夹行接线：右键与 Shift+F10 都能打开菜单", () => {
  assert.match(source, /const openDirMenu = \(event, node, files, group\) => \{/);
  assert.match(source, /setMenu\(\{ kind: "dir", path: node\.path, name: node\.name, files, group, \.\.\.gitMenuPlacement\(event, items\) \}\);/);
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
