// dsh-awesome-hud — MCP 全局启停（host）单测
// 覆盖：委托 pluginManager 写入 + 热重载后的权威快照、旧托管块标记清理、只读/缺服务/未知服务等失败分支。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toggleMcpServer } from '../lib/index.js';
import { MCP_PATCH_BEGIN, MCP_PATCH_END } from '../lib/mcp.js';

const CLIENT = '@deepseek-ai/dsh-mcp-client';
const ROW_ID = 'include:mcp-fixture';

/** 生成一个临时 profile 目录（cordis.yml + cordis.patch.yml）。 */
async function makeProfile(patchText) {
  const root = await mkdtemp(join(tmpdir(), 'hud-mcp-toggle-'));
  const profile = join(root, 'profile');
  await mkdir(profile);
  await writeFile(join(profile, 'cordis.yml'), '[]\n');
  if (patchText !== undefined) await writeFile(join(profile, 'cordis.patch.yml'), patchText);
  return { root, profile };
}

/** 构造最小 ctx：只提供 loader 与（可选）pluginManager。 */
function makeCtx({ profile, entries, manager }) {
  const loader = {
    resolve: () => ({ options: { config: { path: pathToFileURL(join(profile, 'cordis.yml')).href } } }),
    entries: () => entries,
  };
  const services = { loader };
  if (manager !== null) services.pluginManager = manager;
  return { get: (name) => services[name] };
}

/** 两个 MCP 服务条目。 */
function makeEntries() {
  return [
    { id: 'include:mcp-a', options: { id: 'mcp-a', name: CLIENT, config: { serverName: 'server_a' } }, disabled: false },
    { id: 'include:mcp-b', options: { id: 'mcp-b', name: CLIENT, config: { serverName: 'server_b' } }, disabled: false },
  ];
}

/** 仿真官方插件管理器：listPlugins 返回 inventory 行，setPluginEnabled 翻转条目状态。 */
function makeManager(entries, { application = 'applied', flip = true, readOnlyReason, beforeWrite, onCall } = {}) {
  const calls = [];
  return {
    calls,
    listPlugins: async () => entries.map((entry) => ({
      entryId: entry.id,
      patchId: entry.options.id,
      moduleName: CLIENT,
      enabled: !entry.disabled,
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
    })),
    setPluginEnabled: async (entryId, enabled) => {
      calls.push({ entryId, enabled });
      if (beforeWrite !== undefined) await beforeWrite();
      const entry = entries.find((item) => item.id === entryId);
      if (flip && entry !== undefined) entry.disabled = !enabled;
      onCall?.(entryId, enabled);
      return { application, changed: true, entryId, enabled };
    },
  };
}

test('启停委托插件管理器：传 include 前缀 entryId，返回热重载后的权威快照', async () => {
  const { root, profile } = await makeProfile('[]\n');
  try {
    const entries = makeEntries();
    const manager = makeManager(entries);
    const ctx = makeCtx({ profile, entries, manager });
    const body = await toggleMcpServer(ctx, { server: 'server_a', enabled: false });
    assert.deepEqual(manager.calls, [{ entryId: 'include:mcp-a', enabled: false }]);
    assert.equal(body.ok, true);
    assert.equal(body.message, '已全局禁用');
    assert.deepEqual(body.servers.map((item) => [item.name, item.enabled]), [['server_a', false], ['server_b', true]]);
    assert.equal(body.enabled, 1);
    assert.equal(body.total, 2);
    // 只改目标服务：另一个 MCP 的状态不受影响。
    assert.equal(entries[1].disabled, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('启停前清理旧托管块标记：只删两行注释，块内其它插件条目原样保留', async () => {
  const patch = [
    '# 用户原有配置',
    '- id: ui-chat',
    '  config:',
    '    transcriptView: standard',
    '',
    MCP_PATCH_BEGIN,
    '- id: mcp-a',
    '  disabled: false',
    // 旧写入逻辑的受害者：DSH 设置持久化把新行追加到 EOF 注释之前，因而被夹进托管块内部。
    '- id: dsh-connect-workbuddy',
    '  name: dsh-connect-workbuddy',
    '  config:',
    '    regions: {}',
    MCP_PATCH_END,
    '',
  ].join('\n');
  const { root, profile } = await makeProfile(patch);
  try {
    const entries = makeEntries();
    let fileAtWrite;
    const manager = makeManager(entries, { beforeWrite: async () => { fileAtWrite = await readFile(join(profile, 'cordis.patch.yml'), 'utf8'); } });
    await toggleMcpServer(makeCtx({ profile, entries, manager }), { server: 'server_a', enabled: false });
    const finalText = await readFile(join(profile, 'cordis.patch.yml'), 'utf8');
    for (const text of [fileAtWrite, finalText]) {
      assert.ok(!text.includes(MCP_PATCH_BEGIN));
      assert.ok(!text.includes(MCP_PATCH_END));
      // 关键回归：被夹进块内的其它插件配置不得丢失。
      assert.ok(text.includes('- id: dsh-connect-workbuddy\n  name: dsh-connect-workbuddy'));
      assert.ok(text.includes('    regions: {}'));
      assert.ok(text.includes('# 用户原有配置'));
      assert.ok(text.includes('    transcriptView: standard'));
    }
    // 除两行注释外逐字一致（插件管理器负责写入状态行，HUD 不再重建文件）。
    assert.equal(finalText, patch.split('\n').filter((line) => line !== MCP_PATCH_BEGIN && line !== MCP_PATCH_END).join('\n'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('旧标记清理失败不阻断启停（patch 文件缺失）', async () => {
  const { root, profile } = await makeProfile(undefined);
  try {
    const entries = makeEntries();
    const manager = makeManager(entries);
    const body = await toggleMcpServer(makeCtx({ profile, entries, manager }), { server: 'server_b', enabled: false });
    assert.equal(body.servers.find((item) => item.name === 'server_b').enabled, false);
    assert.equal(manager.calls.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('缺少插件管理器 → 503（不再出现写盘成功但状态不生效）', async () => {
  const { root, profile } = await makeProfile('[]\n');
  try {
    const entries = makeEntries();
    const ctx = makeCtx({ profile, entries, manager: null });
    await assert.rejects(toggleMcpServer(ctx, { server: 'server_a', enabled: false }), (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /插件管理器/);
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('目标行不可管理（readOnlyReason）→ 409 且不调用写入', async () => {
  const { root, profile } = await makeProfile('[]\n');
  try {
    const entries = makeEntries();
    const manager = makeManager(entries, { readOnlyReason: 'unaddressable' });
    await assert.rejects(toggleMcpServer(makeCtx({ profile, entries, manager }), { server: 'server_a', enabled: false }), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /server_a/);
      return true;
    });
    assert.equal(manager.calls.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('未知服务 → 404，非法参数 → 400', async () => {
  const { root, profile } = await makeProfile('[]\n');
  try {
    const entries = makeEntries();
    const manager = makeManager(entries);
    const ctx = makeCtx({ profile, entries, manager });
    await assert.rejects(toggleMcpServer(ctx, { server: 'missing', enabled: true }), (error) => error.status === 404);
    await assert.rejects(toggleMcpServer(ctx, { server: 'bad name', enabled: true }), (error) => error.status === undefined && /合法的 MCP 服务名/.test(error.message));
    await assert.rejects(toggleMcpServer(ctx, { server: 'server_a', enabled: 'yes' }), (error) => error.status === undefined && /启用状态/.test(error.message));
    assert.equal(manager.calls.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('无 HMR（restart-required）：返回意图状态与重启提示，不回滚开关', async () => {
  const { root, profile } = await makeProfile('[]\n');
  try {
    const entries = makeEntries();
    const manager = makeManager(entries, { application: 'restart-required', flip: false });
    const body = await toggleMcpServer(makeCtx({ profile, entries, manager }), { server: 'server_a', enabled: false });
    assert.equal(body.servers.find((item) => item.name === 'server_a').enabled, false);
    assert.equal(body.enabled, 1);
    assert.match(body.message, /重启 DSH 后禁用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('写入已返回但状态仍未生效（被更高优先级覆盖）→ 409 明确报错', async () => {
  const { root, profile } = await makeProfile('[]\n');
  try {
    const entries = makeEntries();
    const manager = makeManager(entries, { application: 'applied', flip: false });
    await assert.rejects(toggleMcpServer(makeCtx({ profile, entries, manager }), { server: 'server_a', enabled: false }), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /未能生效/);
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
