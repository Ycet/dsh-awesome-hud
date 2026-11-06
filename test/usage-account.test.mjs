import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAccountBalance,
  normalizeAccountClient,
  readAccountBalance,
} from '../lib/index.js';

// 「用量」模块的官方账户兜底：未安装/未启用 dsh-account-usage 时，
// host 路由仍通过官方 deepseekAccount 服务提供 DeepSeek 余额。
const client = () => ({ version: 'test-usage-account-0.0.1', locale: 'zh-CN', timezoneOffsetSeconds: 28800 });

test('官方余额归一：充值 + 赠送给人民币合计，金额按分四舍五入', () => {
  assert.deepEqual(
    { ...normalizeAccountBalance({ status: 'ready', value: [{ currency: 'CNY', balance: '2.31' }], bonusWallets: [{ currency: 'CNY', balance: '0.01' }] }) },
    { available: true, currency: 'CNY', toppedUp: 2.31, granted: 0.01, total: 2.32 },
  );
  // 浮点求和（0.1 + 0.2）按分四舍五入，避免界面出现 0.30000000000000004
  assert.deepEqual(
    { ...normalizeAccountBalance({ status: 'ready', value: [{ currency: 'CNY', balance: '0.1' }, { currency: 'CNY', balance: '0.2' }], bonusWallets: [] }) },
    { available: true, currency: 'CNY', toppedUp: 0.3, granted: 0, total: 0.3 },
  );
});

test('多币种优先人民币；未登录/失败不伪造余额', () => {
  assert.equal(
    normalizeAccountBalance({ status: 'ready', value: [{ currency: 'USD', balance: '1' }, { currency: 'CNY', balance: '2' }], bonusWallets: [] }).toppedUp,
    2,
  );
  assert.deepEqual({ ...normalizeAccountBalance(null) }, { available: false, reason: 'signed-out' });
  assert.deepEqual({ ...normalizeAccountBalance(undefined) }, { available: false, reason: 'signed-out' });
  assert.deepEqual({ ...normalizeAccountBalance({ status: 'failed' }) }, { available: false, reason: 'unavailable' });
});

test('客户端元信息校验：版本/语言/时区缺一不可', () => {
  assert.deepEqual(
    { ...normalizeAccountClient({ version: '0.2.2-rc.1', locale: 'zh-CN', timezoneOffsetSeconds: 28800.4 }) },
    { version: '0.2.2-rc.1', locale: 'zh-CN', timezoneOffsetSeconds: 28800 },
  );
  for (const payload of [
    null,
    {},
    { version: '', locale: 'zh-CN', timezoneOffsetSeconds: 0 },
    { version: 'x'.repeat(65), locale: 'zh-CN', timezoneOffsetSeconds: 0 },
    { version: '1.0.0', locale: '', timezoneOffsetSeconds: 0 },
    { version: '1.0.0', locale: 'zh-CN', timezoneOffsetSeconds: '28800' },
    { version: '1.0.0', locale: 'zh-CN', timezoneOffsetSeconds: 90000 },
  ]) {
    assert.equal(normalizeAccountClient(payload), null, JSON.stringify(payload));
  }
});

test('host 路由：调用官方 deepseekAccount，并按客户端元信息缓存 30s', async () => {
  const seen = [];
  const ctx = {
    get: name => name === 'deepseekAccount'
      ? { async getBalance(meta) { seen.push(meta); return { status: 'ready', value: [{ currency: 'CNY', balance: '3.5' }], bonusWallets: [{ currency: 'CNY', balance: '1' }] }; } }
      : undefined,
  };
  const first = await readAccountBalance(ctx, client());
  const second = await readAccountBalance(ctx, client());
  assert.deepEqual({ ...first }, { available: true, currency: 'CNY', toppedUp: 3.5, granted: 1, total: 4.5 });
  assert.deepEqual(second, first);
  assert.equal(seen.length, 1, '相同元信息的 60s 轮询应命中缓存，不重复请求平台');
  assert.deepEqual({ ...seen[0] }, client());
  // 语言变化属于不同请求头，不共享缓存
  await readAccountBalance(ctx, { ...client(), locale: 'en-US' });
  assert.equal(seen.length, 2);
});

test('host 路由：服务缺失/未登录/平台失败返回 available:false，非法参数抛错', async () => {
  assert.deepEqual({ ...(await readAccountBalance({ get: () => undefined }, client())) }, { available: false, reason: 'no-service' });
  assert.deepEqual(
    { ...(await readAccountBalance({ get: () => ({ getBalance: async () => null }) }, { ...client(), version: 'test-usage-account-null' })) },
    { available: false, reason: 'signed-out' },
  );
  assert.deepEqual(
    { ...(await readAccountBalance({ get: () => ({ getBalance: async () => { throw new Error('network'); } }) }, { ...client(), version: 'test-usage-account-throw' })) },
    { available: false, reason: 'unavailable' },
  );
  await assert.rejects(readAccountBalance({ get: () => ({ getBalance: async () => null }) }, { version: '' }), /合法的账户查询参数/);
});
