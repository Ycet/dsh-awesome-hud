// dsh-awesome-hud — host 半测试夹具
//
// 提供「真实 git + 真实 host 路由」的最小运行环境：subprocess 适配器对齐 DSH
// subprocess provider 的契约（done + collected.stdout/stderr.readFrom），因此
// 默认测试套件里就能跑真实 git，不依赖 DSH 运行时或 DSH_TEST_INSTALL_ROOT。
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../../lib/index.js';

/** 真实 git 的 subprocess 适配器（对齐 DSH subprocess provider 的最小契约）。 */
export function localSubprocess() {
  return {
    spawn({ argv, cwd, signal }) {
      const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const done = new Promise((resolve) => {
        child.on('close', (code) => resolve({ exitCode: code ?? 0 }));
        child.on('error', () => resolve({ exitCode: 128 }));
      });
      signal?.addEventListener('abort', () => { child.kill('SIGKILL'); }, { once: true });
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: stderr }) },
        },
      };
    },
  };
}

/** 直接跑一次 git（仅用于测试夹具准备），成功返回，失败抛出含 stderr 的错误。 */
export function gitIn(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`git ${args.join(' ')}: ${stderr.trim()}`))));
  });
}

/** 通过真实 host 路由（含方法分发表与信任围栏）发一次 JSON 请求。 */
export function createHarness(cwd, extraServices = {}) {
  const routes = [];
  const services = {
    subprocess: localSubprocess(),
    sessions: { get: (id) => (id === 'fixture' ? { header: { cwd } } : undefined) },
    ...extraServices,
  };
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => fn(),
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  apply(ctx, { modules: { get: () => ({}) }, usage: { get: () => ({}) } });
  const api = routes.find((route) => route.path === '/awesome-hud/api').handler;
  const call = async (endpoint, body = {}) => {
    // 默认带上夹具会话 id；显式传 sessionId 时以显式值为准
    const payload = { sessionId: 'fixture', ...body };
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, { method: 'POST', url: '/awesome-hud/api/' + endpoint, headers: { host: '127.0.0.1:1234' } });
    let status;
    let result;
    await api(req, { writeHead: (code) => { status = code; }, end: (data) => { result = JSON.parse(data); } });
    return { status, ...result };
  };
  return { call, services, routes };
}

/** 建立带用户配置的临时仓库；seed=true 时写入初始文件并提交。 */
export async function createRepo(prefix = 'hud-reg-', { seed = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await gitIn(root, ['init', '-b', 'main']);
  await gitIn(root, ['config', 'user.email', 'hud-test@example.invalid']);
  await gitIn(root, ['config', 'user.name', 'HUD Test']);
  await gitIn(root, ['config', 'commit.gpgsign', 'false']);
  await gitIn(root, ['config', 'core.autocrlf', 'false']);
  if (seed) {
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs/a.md'), 'a\n');
    await writeFile(join(root, 'tracked.txt'), 'one\n');
    await gitIn(root, ['add', '-A']);
    await gitIn(root, ['commit', '-q', '-m', 'chore: seed']);
  }
  return root;
}

export async function cleanupRepo(root) {
  await rm(root, { recursive: true, force: true });
}

/** 快照里某个路径的条目（找不到时返回 undefined）。 */
export const fileOf = (snapshot, path) => (snapshot.files ?? []).find((file) => file.path === path);
