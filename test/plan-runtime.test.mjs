import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply } from '../lib/index.js';

const runtime = process.env.DSH_TEST_INSTALL_ROOT;

// 使用官方工具执行、消息构造与会话日志，通过 HUD host 路由验证完整状态链；无需调用模型。
test('官方桌面计划审批流程：待审批、通过后退出、拒审、要求修改', { skip: !runtime }, async t => {
  const load = name => import(pathToFileURL(join(runtime, 'node_modules', '@deepseek-ai', name, 'lib/index.js')));
  const { Context } = await load('cordis');
  const { SessionStore } = await load('dsh-session');
  const { SessionProjectionRegistry } = await load('dsh-session-projection');
  const { PlanModeController } = await load('dsh-plan-mode');
  const { createToolResultMessage } = await load('dsh-llm');
  const { UserQuestionError } = await load('dsh-user-questions');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const tools = new Map(), routes = new Map();
  let answer;
  ctx.provide('tools', { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } });
  ctx.provide('systemPrompt', { getSectionOrder: () => 0, section: () => () => {} });
  ctx.provide('userQuestions', { ask: request => answer(request) });
  ctx.provide('webServer', { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } });
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  const controller = new PlanModeController(ctx, { section: 'Plan review test policy' });
  apply(ctx, { modules: { get: () => ({}) }, usage: { get: () => ({}) } });
  const planTool = tools.get('exit_plan_mode');
  assert.ok(planTool);
  const plans = async sessionId => {
    const req = Readable.from([Buffer.from(JSON.stringify({ sessionId }))]);
    Object.assign(req, { method: 'POST', url: '/awesome-hud/api/plans', headers: { host: '127.0.0.1:3080' } });
    let code, body;
    await routes.get('/awesome-hud/api')(req, { writeHead: value => { code = value; }, end: value => { body = JSON.parse(value); } });
    assert.equal(code, 200);
    return body.plans;
  };

  for (const outcome of ['approve', 'revise', 'dismiss']) {
    const session = ctx.sessions.create(`plan-${outcome}`);
    const agent = { session };
    const callId = `call-${outcome}`;
    const args = { plan: '# 官方审批流程验证\n- 步骤一' };
    session.append('plan/mode', { active: true });
    const call = session.append('tool/call', { turn: 1, step: 1, name: 'exit_plan_mode', callId, arguments: JSON.stringify(args) });
    let concluded = false;
    answer = async request => {
      assert.equal((await plans(session.id))[0].status, 'pending');
      const review = request.questions[0];
      assert.equal(review.intent.kind, 'plan-review');
      assert.equal(review.intent.callId, callId);
      // rc.5：「要求修改」只是关闭审查、回到输入框，ask() 以 ASK_CANCELLED 结束，
      // 计划工具不再抛错，而是返回成功的 { approved: false }（计划模式仍生效）。
      if (outcome === 'dismiss') throw new UserQuestionError('dismissed', 'ASK_CANCELLED');
      return { answers: [{ id: review.id, selected: [outcome === 'approve' ? review.intent.approve : review.options[1].label] }] };
    };
    let content, isError = false, output;
    const exec = { agent, callId, signal: new AbortController().signal, concludeTurn: () => { concluded = true; } };
    try {
      output = await planTool.execute(args, exec);
      content = planTool.output.render(args, output);
    } catch (error) {
      assert.equal(outcome, 'revise');
      assert.match(error.message, /The user chose to keep planning/);
      isError = true;
      content = [{ type: 'text', text: error.message }];
    }
    if (outcome === 'approve') {
      assert.deepEqual(output, { approved: true });
      assert.equal(concluded, false);
    }
    if (outcome === 'dismiss') {
      // 关闭审查的成功结果不是审批通过，HUD 必须按「已废弃」处理
      assert.deepEqual(output, { approved: false });
      assert.equal(concluded, true);
    }
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content, isError }) }, {
      surfaceOp: 'append', sourceEventSeqs: [call.seq],
    });
    const expected = outcome === 'approve' ? 'approved' : 'discarded';
    assert.equal((await plans(session.id))[0].status, expected);
    // 审批通过才会在下一步真正退出模式；该事件不得反转已批准状态。
    controller.onBoundary(session);
    assert.equal(controller.loggedActive(session), outcome !== 'approve');
    assert.equal((await plans(session.id))[0].status, expected);
  }
});
