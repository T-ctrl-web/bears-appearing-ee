/**
 * 熊出没集团 — DeepSeek Harness 插件
 *
 * 注册 8 个工具，让 DeepSeek 能够调用熊出没集团的多Agent协作能力：
 *   bears.start          — 启动任务（Leader评估+拆解）
 *   bears.dispatch       — 派发Worker执行
 *   bears.complete-worker — Worker完成
 *   bears.verify         — 触发Verifier验证
 *   bears.iterate        — 驳回重跑
 *   bears.deliver        — 交付任务结果
 *   bears.status         — 查询当前状态
 *   bears.reset          — 重置任务
 *
 * 插件加载时自动启动内置服务器，无需手动开启
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 中加载 CJS 模块（server/state.js、engine/team-runner.js 均为 CommonJS）
const require = createRequire(import.meta.url)

export const name = 'bears-appearing-ee'
export const inject = ['tools']

const PORT = 3120
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export function apply(ctx, config) {
  const serverUrl = config?.serverUrl || `http://localhost:${PORT}`

  // === 自动启动内置服务器 ===
  let serverStarted = false

  function startServer() {
    if (serverStarted) return
    serverStarted = true

    // 动态加载状态模块
    const stateModule = loadStateModule()
    const { TeamRunner } = loadTeamRunner()
    const runner = new TeamRunner(stateModule)

    const sseClients = new Set()
    stateModule.subscribe(() => {
      const data = JSON.stringify(stateModule.getState())
      for (const res of sseClients) {
        try { res.write(`event: update\ndata: ${data}\n\n`); } catch {}
      }
    })

    const server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      const url = new URL(req.url, `http://localhost:${PORT}`)
      const p = url.pathname

      function sendJson(code, data) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(data))
      }
      function readBody() {
        return new Promise((resolve) => {
          let b = ''; req.on('data', c => b += c); req.on('end', () => {
            try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) }
          })
        })
      }

      // 看板页面
      if (p === '/' || p === '/dashboard') {
        try {
          const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf-8')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
        } catch { sendJson(404, { error: 'dashboard.html not found' }) }
        return
      }

      // SSE
      if (p === '/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' })
        res.write(`event: init\ndata: ${JSON.stringify(stateModule.getState())}\n\n`)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }

      // 静态文件
      if (req.method === 'GET' && !p.startsWith('/api') && !p.startsWith('/events')) {
        const relPath = decodeURIComponent(p.replace(/^\//, ''))
        const fp = path.join(ROOT, relPath)
        const ext = path.extname(fp).toLowerCase()
        const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript', '.ico': 'image/x-icon' }
        if (types[ext] && fs.existsSync(fp)) {
          try { res.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'max-age=3600' }); res.end(fs.readFileSync(fp)); return } catch {}
        }
      }

      // 状态机 API
      if (p.startsWith('/api/sm/') && req.method === 'POST') {
        const body = await readBody()
        const action = p.replace('/api/sm/', '')
        try {
          let result
          switch (action) {
            case 'start': runner.startTask(body); result = { ok: true, state: runner.currentState }; break
            case 'draft': runner.startDrafting(body.waves || null); result = { ok: true, state: runner.currentState }; break
            case 'complete-draft': runner.completeDrafting(); result = { ok: true, state: runner.currentState }; break
            case 'dispatch': runner.dispatchWave(body.waveIndex, body.waveData); result = { ok: true, state: runner.currentState }; break
            case 'complete-worker': runner.completeWorker(body.roleId, body.result); result = { ok: true, state: runner.currentState }; break
            case 'verify': runner.startVerification(body.verifierId); result = { ok: true, state: runner.currentState }; break
            case 'complete-verify': runner.completeVerification(body.passed, body.issues || []); result = { ok: true, state: runner.currentState }; break
            case 'complete-iteration': runner.completeIteration(); result = { ok: true, state: runner.currentState }; break
            case 'deliver': runner.deliver(body.result); result = { ok: true, state: runner.currentState }; break
            case 'reset': runner.reset(); result = { ok: true, state: 'IDLE' }; break
            default: result = { error: 'Unknown action: ' + action }
          }
          sendJson(200, result)
        } catch (e) { sendJson(400, { error: e.message }) }
        return
      }
      if (p === '/api/sm/snapshot' && req.method === 'GET') { sendJson(200, runner.getSnapshot()); return; }
      if (p === '/api/state' && req.method === 'GET') { sendJson(200, stateModule.getState()); return; }
      if (p === '/api/roles' && req.method === 'GET') { sendJson(200, stateModule.ROLES); return; }
      if (p === '/api/logs' && req.method === 'GET') { sendJson(200, stateModule.getState().logs); return; }
      if (p === '/api/reset' && req.method === 'POST') { runner.reset(); sendJson(200, { ok: true }); return; }
      if (p === '/api/role/status' && req.method === 'POST') {
        const body = await readBody()
        stateModule.setRoleStatus(body.roleId, body.status, body.task)
        sendJson(200, { ok: true }); return
      }
      if (p === '/api/log' && req.method === 'POST') {
        const body = await readBody()
        stateModule.addLog(body.level || 'info', body.message, body.roleId)
        sendJson(200, { ok: true }); return
      }
      sendJson(404, { error: 'Not found', path: p })
    })

    server.listen(PORT, () => {
      console.log(`[bears-appearing-ee] 内置服务器已启动：http://localhost:${PORT}`)
      console.log(`[bears-appearing-ee] 看板地址：http://localhost:${PORT}`)
    })

    ctx.effect(() => { server.close(); console.log('[bears-appearing-ee] 服务器已关闭') })
  }

  function loadStateModule() {
    return require(path.join(ROOT, 'server', 'state.js'))
  }

  function loadTeamRunner() {
    return require(path.join(ROOT, 'engine', 'team-runner.js'))
  }

  // 启动内置服务器（同步调用，require 已通过 createRequire 就绪）
  startServer()

  async function callAPI(path, body = {}) {
    try {
      const res = await fetch(`${serverUrl}/api/sm/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.json()
    } catch (e) {
      return { error: `服务器未就绪: ${e.message}` }
    }
  }

  async function getState() {
    try {
      const res = await fetch(`${serverUrl}/api/sm/snapshot`)
      return res.json()
    } catch (e) {
      return { error: `服务器未就绪: ${e.message}` }
    }
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
        description: '复杂度：simple(简单,总裁直接做) / medium(中等,走L1验证) / complex(复杂,走L2/L3验证)。不传则按任务标题自动评估',
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
      const r1 = await callAPI('start', { title: args.title, complexity: args.complexity })
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
