import test from 'node:test';
import assert from 'node:assert/strict';
import { hudClient, moduleOf, nodes, settled, clientSource } from './helpers/client-harness.mjs';

// v0.21.4：MCP 模块的启停开关改为与 HUD 设置右栏同一个 HudSwitch 组件。
// 新建会话页的 HUD 入口与真实会话不同：与既有 MCP 用例一致，用工作区快照打开面板。
const fixture = {
  state: { current: 'old', byId: { old: { cwd: '/ws/old', updatedAt: 1 }, recent: { cwd: '/ws/recent', updatedAt: 9 } } },
  workspaces: [
    { path: '/ws/old', title: 'Old', updatedAt: 1, sessionIds: ['old'] },
    { path: '/ws/recent', title: 'Recent', updatedAt: 9, sessionIds: ['recent'] },
  ],
};
const servers = [{ name: 'alpha', enabled: true }, { name: 'beta', enabled: false }];

/** 打开会话页的 HUD 面板并等 MCP 快照落地，返回 MCP 模块元素。 */
async function openMcp(primitives) {
  const client = hudClient({
    ...fixture,
    primitives,
    respond: (call) => (call.url.endsWith('/mcp')
      ? { ok: true, servers, total: servers.length, enabled: 1 }
      : { ok: true, isRepo: true }),
  });
  client.button().props.onClick();
  client.panel();
  client.runPolls();
  await settled();
  const mcp = moduleOf(client.panel(), 'McpModule');
  assert.ok(mcp, '会话页应渲染 MCP 模块');
  return { client, mcp };
}

/** 取出 MCP 模块展开后每行的 HudSwitch 元素。 */
function switchElements(mcp) {
  return nodes(mcp.type({ ...mcp.props, fold: false })).filter(node => node.type?.name === 'HudSwitch');
}

test('MCP 启停开关复用 HUD 设置右栏的 HudSwitch（同一几何与类名）', async () => {
  const { mcp } = await openMcp();
  const tree = nodes(mcp.type({ ...mcp.props, fold: false }));
  assert.equal(tree.some(node => node.props?.className === 'hud-switch'), false, '不再渲染自定义 hud-switch');

  const toggles = switchElements(mcp);
  assert.equal(toggles.length, 2);
  assert.deepEqual(toggles.map(node => node.props.checked), [true, false]);
  assert.deepEqual(toggles.map(node => node.props.label), ['alpha', 'beta']);
  assert.deepEqual(toggles.map(node => node.props.title), ['alpha', 'beta']);

  // 无官方 primitives 时的回退实现与设置页共用 .hud-official-switch。
  const button = toggles[0].type({ ...toggles[0].props });
  assert.equal(button.type, 'button');
  assert.equal(button.props.role, 'switch');
  assert.equal(button.props['aria-checked'], true);
  assert.equal(button.props['aria-label'], 'alpha');
  assert.equal(button.props.className, 'hud-official-switch');
  assert.equal(button.children[0].props.className, 'hud-official-switch-thumb');
  assert.equal(Object.hasOwn(button.props, 'data-on'), false, '不再带旧 data-on 属性');
});

test('MCP 开关点击后把取反值交给启停接口', async () => {
  const { mcp } = await openMcp();
  const seen = [];
  const button = switchElements(mcp)[0].type({ ...switchElements(mcp)[0].props, onChange: next => seen.push(next) });
  button.props.onClick();
  assert.deepEqual(seen, [false]);
});

test('官方 Switch 可用时 MCP 与设置页一样交给官方组件渲染', async () => {
  const Official = () => null;
  const { mcp } = await openMcp({ Switch: Official });
  const rendered = switchElements(mcp)[0].type({ ...switchElements(mcp)[0].props });
  assert.equal(rendered.type, Official);
  assert.equal(rendered.props.checked, true);
  assert.equal(rendered.props.label, 'alpha');
  assert.equal(rendered.props.title, 'alpha');
});

test('旧 .hud-switch 样式已删除，面板只保留 .hud-official-switch 一套开关样式', () => {
  const client = hudClient(fixture);
  const css = client.styles.join('\n');
  assert.equal(css.includes('.hud-switch{'), false);
  assert.equal(css.includes('.hud-switch::after'), false);
  assert.match(css, /\.hud-official-switch\{/);
  assert.match(css, /\.hud-official-switch-thumb\{/);
  assert.equal(clientSource.includes('"hud-switch"'), false);
  assert.match(clientSource, /checked: server\.enabled === true/);
});
