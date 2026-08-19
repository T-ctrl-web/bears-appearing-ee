/**
 * 熊出没集团 — DeepSeek Harness 插件
 *
 * 注册 7 个工具，让 DeepSeek 能够调用熊出没集团的多Agent协作能力：
 *   bears.start       — 启动任务（Leader评估+拆解）
 *   bears.dispatch    — 派发Worker执行
 *   bears.verify      — 触发Verifier验证
 *   bears.iterate     — 驳回重跑
 *   bears.deliver     — 交付任务结果
 *   bears.status      — 查询当前状态
 *   bears.reset       — 重置任务
 *
 * 所有工具通过 HTTP API 调用本地服务器（默认 http://localhost:3120）
 * 状态机保证流程合法性，非法操作自动拒绝
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'bears-appearing-ee'
export const inject = ['tools']

export function apply(ctx, config) {
  const serverUrl = config?.serverUrl || 'http://localhost:3120'

  async function callAPI(path, body = {}) {
    const res = await fetch(`${serverUrl}/api/sm/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async function getState() {
    const res = await fetch(`${serverUrl}/api/sm/snapshot`)
    return res.json()
  }

  // 1. 启动任务
  ctx.tools.register(defineTool({
    name: 'bears.start',
    description: '启动熊出没集团任务。Leader(熊大)评估复杂度并拆解为子任务。状态：IDLE → DRAFTING → DISPATCHING。',
    parameters: {
      title: { type: 'string', required: true, description: '任务标题' },
      complexity: {
        type: 'string',
        required: false,
        description: '复杂度：simple(简单,总裁直接做) / medium(中等,走L1验证) / complex(复杂,走L2/L3验证)',
      },
      waves: {
        type: 'array',
        required: false,
        description: '波次计划，每个波次含 roles(角色ID数组) 和 task(任务描述)',
      },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const r1 = await callAPI('start', { title: args.title, complexity: args.complexity || 'medium' })
      if (!r1.ok) return { error: r1.error }
      if (args.waves) await callAPI('draft', { waves: args.waves })
      const r2 = await callAPI('complete-draft')
      return { ok: true, state: r2.state, message: `任务已启动：${args.title}，状态：${r2.state}` }
    },
  }))

  // 2. 派发Worker
  ctx.tools.register(defineTool({
    name: 'bears.dispatch',
    description: '派发指定波次的Worker执行任务。状态：DISPATCHING → EXECUTING。需指定波次索引和角色。',
    parameters: {
      waveIndex: { type: 'number', required: true, description: '波次索引（从0开始）' },
      roles: {
        type: 'array',
        required: true,
        description: '角色ID数组：guangtouqiang(架构), xionger(开发), bengbeng(测试), luobotou(调试), feibo(文档), cuihua(界面), tutu(视觉), tuotuo(运维), maomao(调研)',
      },
      task: { type: 'string', required: false, description: '任务描述' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const r = await callAPI('dispatch', { waveIndex: args.waveIndex, waveData: { roles: args.roles, task: args.task || '' } })
      return r.ok ? { ok: true, state: r.state, message: `波次${args.waveIndex}已派发` } : { error: r.error }
    },
  }))

  // 3. Worker完成
  ctx.tools.register(defineTool({
    name: 'bears.complete-worker',
    description: '标记某个Worker完成。当波次所有Worker完成时，自动进入验证阶段。状态：EXECUTING → VERIFYING。',
    parameters: {
      roleId: { type: 'string', required: true, description: '完成工作的角色ID' },
      result: { type: 'string', required: false, description: '产出描述' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const r = await callAPI('complete-worker', { roleId: args.roleId, result: args.result || '' })
      return r.ok ? { ok: true, state: r.state, message: `Worker完成，当前状态：${r.state}` } : { error: r.error }
    },
  }))

  // 4. 验证
  ctx.tools.register(defineTool({
    name: 'bears.verify',
    description: '触发Verifier验证。通过则进入交付，驳回则进入重跑。状态：VERIFYING → DELIVERING(通过) 或 → ITERATING(驳回)。',
    parameters: {
      passed: { type: 'boolean', required: true, description: 'true=验证通过, false=驳回' },
      verifierId: {
        type: 'string',
        required: false,
        description: '验证者ID：jiji(L1吉吉国王), laoe(L2老鳄), xiaoli(质量门禁小狸), tiezhang(L3铁掌大师)',
      },
      issues: { type: 'array', required: false, description: '驳回问题列表' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      if (args.verifierId) await callAPI('verify', { verifierId: args.verifierId })
      const r = await callAPI('complete-verify', { passed: args.passed, issues: args.issues || [] })
      return r.ok ? { ok: true, state: r.state, message: `验证${args.passed ? '通过' : '驳回'}，状态：${r.state}` } : { error: r.error }
    },
  }))

  // 5. 修复完成（驳回重跑后）
  ctx.tools.register(defineTool({
    name: 'bears.iterate',
    description: '萝卜头修复完成，重新派发。状态：ITERATING → DISPATCHING。',
    parameters: {},
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const r = await callAPI('complete-iteration')
      return r.ok ? { ok: true, state: r.state, message: `修复完成，重新派发，状态：${r.state}` } : { error: r.error }
    },
  }))

  // 6. 交付
  ctx.tools.register(defineTool({
    name: 'bears.deliver',
    description: '交付任务结果。状态：DELIVERING → COMPLETED。',
    parameters: {
      result: { type: 'string', required: false, description: '交付结果描述' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const r = await callAPI('deliver', { result: args.result || '任务完成' })
      return r.ok ? { ok: true, state: r.state, message: `任务已交付，状态：${r.state}` } : { error: r.error }
    },
  }))

  // 7. 查询状态
  ctx.tools.register(defineTool({
    name: 'bears.status',
    description: '查询熊出没集团当前任务状态、波次、迭代次数、状态历史。',
    parameters: {},
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      return await getState()
    },
  }))

  // 8. 重置
  ctx.tools.register(defineTool({
    name: 'bears.reset',
    description: '重置熊出没集团任务状态，所有角色回到空闲。',
    parameters: {},
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const r = await callAPI('reset')
      return { ok: true, state: 'IDLE', message: '已重置' }
    },
  }))

  console.log('[bears-appearing-ee] 插件已加载，8个工具已注册')
  console.log(`[bears-appearing-ee] 服务器地址：${serverUrl}`)
}
