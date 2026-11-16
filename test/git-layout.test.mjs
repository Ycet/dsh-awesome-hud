// dsh-awesome-hud — v0.21.1：git 模块布局
//  1) graph / commit / revert 三按钮三等分、共同铺满模块内容宽（与便笺按钮行对齐）
//  2) 分支按钮固定宽度（88px），超长分支名省略号截断，不再随分支名伸缩
//  3) 标题栏的初始化仓库按钮与动作区互不影响
import assert from "node:assert/strict";
import test from "node:test";
import { clientSource as source } from "./helpers/client-harness.mjs";

/** 取指定选择器的 CSS 规则体（源码里样式是压缩成一行写的）。 */
function ruleBody(selector) {
  const start = source.indexOf(`${selector}{`);
  assert.ok(start > 0, `样式缺少 ${selector}`);
  const end = source.indexOf("}", start);
  return source.slice(start + selector.length + 1, end);
}

test("动作区：三等分铺满模块宽度，按钮内容居中且可收缩", () => {
  const actions = ruleBody(".hud-git-actions");
  assert.match(actions, /width:100%/);
  assert.match(actions, /box-sizing:border-box/);
  assert.match(actions, /display:flex/);
  assert.match(actions, /gap:6px/);
  // 面板内容宽 272px - 两个 6px 间距 = 260 / 3 ≈ 86.7px，与便笺「清空 / 从聊天导入 / 添加至聊天」的观感一致
  const button = ruleBody(".hud-git-actions .hud-btn-small");
  assert.match(button, /flex:1 1 0/);
  assert.match(button, /min-width:0/);
  assert.match(button, /justify-content:center/);
  // 动作区里的按钮拉满行高（标题栏按钮仍保持原来的 flex-start）
  assert.match(ruleBody(".hud-git-actions .hud-git-btn"), /align-self:stretch/);
  assert.match(ruleBody(".hud-git-btn"), /align-self:flex-start/);
});

test("分支按钮：固定 88px，不再用 max-width 自动宽度", () => {
  const branch = ruleBody(".hud-branch-switch");
  assert.match(branch, /width:88px/);
  assert.match(branch, /max-width:88px/);
  assert.match(branch, /flex:0 0 88px/);
  assert.match(branch, /box-sizing:border-box/);
  assert.doesNotMatch(branch, /max-width:150px/, "旧的 150px 自动宽度必须移除");
  // 分支名超长时省略号截断
  assert.match(source, /\.hud-branch-switch span\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  // 标题栏右侧的分支按钮仍带 .hud-branch-switch（宽度规则才会生效）
  assert.match(source, /className: "hud-btn-small hud-git-btn hud-branch-switch",/);
});

test("按钮文案不会换行：短标签在三分之一宽度内单行显示", () => {
  const button = ruleBody(".hud-git-actions .hud-btn-small");
  assert.match(button, /white-space:nowrap/);
  // 三个按钮的文案都很短（git graph / commit / revert），英文环境同样单行
  assert.match(source, /t\("gitGraph"\)\),/);
  assert.match(source, /\}, react\.createElement\(Icon, \{ name: "commit" \}\), "commit"\),/);
  assert.match(source, /\}, react\.createElement\(Icon, \{ name: "revert", size: 13 \}\), "revert"\)\)/);
});
