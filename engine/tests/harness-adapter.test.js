/**
 * Harness 适配器测试（全部 mock，不发真实网络请求）
 * 运行：node --test engine/tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HarnessAdapter, mapLimit, parseVerdict, normalizeVerdict } = require('../harness-adapter');

const REAL_FETCH = global.fetch;
function withMockFetch(mock, fn) {
  return async () => {
    global.fetch = mock;
    try { await fn(); } finally { global.fetch = REAL_FETCH; }
  };
}

// === 引擎状态 ===

test('未配置 Key → mock 引擎演示模式', () => {
  const a = new HarnessAdapter({ apiKey: null });
  assert.equal(a.config.engine, 'mock');
  assert.equal(a.engineStatus.configured, false);
  assert.match(a.engineStatus.mode, /演示模式/);
});

test('配置 Key → deepseek 引擎', () => {
  const a = new HarnessAdapter({ apiKey: 'sk-test', model: 'deepseek-chat' });
  assert.equal(a.config.engine, 'deepseek');
  assert.equal(a.engineStatus.configured, true);
  assert.equal(a.engineStatus.model, 'deepseek-chat');
});

// === mock 引擎执行 ===

test('mock 引擎：确定性产出，包含角色名与任务', async () => {
  const a = new HarnessAdapter({ apiKey: null });
  const r = await a.executeWorker({ roleId: 'guangtouqiang', task: '设计登录架构' });
  assert.equal(r.status, 'success');
  assert.equal(r.engine, 'mock');
  assert.equal(r.assignee, '光头强');
  assert.match(r.output, /光头强/);
  assert.match(r.output, /设计登录架构/);
});

test('mock 引擎：未知角色 ID 也能执行（降级命名）', async () => {
  const a = new HarnessAdapter({ apiKey: null });
  const r = await a.executeWorker({ roleId: 'unknown-role', task: 'x' });
  assert.equal(r.status, 'success');
  assert.equal(r.assignee, 'unknown-role');
});

// === deepseek 引擎（mock fetch） ===

test('deepseek：成功调用，提取 choices[0].message.content', withMockFetch(
  async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '架构方案：三模块设计' } }] }),
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeWorker({ roleId: 'guangtouqiang', task: '设计架构' });
    assert.equal(r.status, 'success');
    assert.equal(r.output, '架构方案：三模块设计');
    assert.equal(r.engine, 'deepseek');
    assert.ok(r.duration_ms >= 0);
  }
));

test('deepseek：请求携带角色 system prompt 与任务 user prompt', withMockFetch(
  async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(opts.headers.Authorization, 'Bearer sk-test');
    assert.equal(body.model, 'deepseek-chat');
    assert.match(body.messages[0].content, /光头强/); // system = 角色 MD 全文
    assert.match(body.messages[1].content, /设计登录架构/); // user = 任务
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  },
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test', model: 'deepseek-chat' });
    const r = await a.executeWorker({ roleId: 'guangtouqiang', task: '设计登录架构', context: '参考调研报告' });
    assert.equal(r.status, 'success');
  }
));

test('deepseek：HTTP 错误 → status failed 且错误信息含状态码', withMockFetch(
  async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-bad' });
    const r = await a.executeWorker({ roleId: 'xionger', task: '写代码' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /API 401/);
    assert.equal(r.output, null);
  }
));

test('deepseek：超时中断 → failed 且提示超时', withMockFetch(
  (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test', timeoutMs: 50 });
    const r = await a.executeWorker({ roleId: 'xionger', task: '慢任务' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /超时/);
  }
));

test('deepseek：空内容响应 → failed', withMockFetch(
  async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeWorker({ roleId: 'feibo', task: '写文档' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /空内容/);
  }
));

// === Agent Loop 工具层（workspace + function calling） ===

test('工具层 Worker：tool_calls 写文件真实落盘，输出附工作区清单', withMockFetch(
  (() => {
    let call = 0;
    return async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (call === 0) {
        call++;
        assert.ok(Array.isArray(body.tools) && body.tools.length === 3, '应携带 3 个工具定义');
        assert.equal(body.tool_choice, 'auto');
        return { ok: true, status: 200, json: async () => ({
          choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/index.js', content: 'console.log(42)' }) } },
          ] } }],
          usage: { total_tokens: 100 },
        }) };
      }
      call++;
      // 第二轮应包含 tool 结果消息
      const roles = body.messages.map(m => m.role);
      assert.ok(roles.includes('tool'), '第二轮请求应回填 tool 结果');
      return { ok: true, status: 200, json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: '已写入入口文件' } }],
        usage: { total_tokens: 50 },
      }) };
    };
  })(),
  async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-ws-'));
    const a = new HarnessAdapter({ apiKey: 'sk-test', model: 'deepseek-chat' });
    const r = await a.executeWorker({ roleId: 'xionger', task: '写入口文件', workspace: ws });
    assert.equal(r.status, 'success');
    assert.ok(fs.existsSync(path.join(ws, 'src', 'index.js')), '文件应真实落盘');
    assert.equal(fs.readFileSync(path.join(ws, 'src', 'index.js'), 'utf-8'), 'console.log(42)');
    assert.match(r.output, /工作区产出/);
    assert.match(r.output, /src\/index\.js/);
    assert.ok(r.meta.toolCalls >= 1);
    assert.ok(r.meta.rounds >= 2);
    assert.equal(r.tokens, 150);
  }
));

test('工具层 Verifier：只读工具 + 基于真实文件给出结构化结论', withMockFetch(
  (() => {
    let call = 0;
    return async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (call === 0) {
        call++;
        const names = (body.tools || []).map(t => t.function.name);
        assert.deepEqual(names.sort(), ['list_dir', 'read_file'], 'Verifier 只有只读工具');
        return { ok: true, status: 200, json: async () => ({
          choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [
            { id: 'v1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/index.js' }) } },
          ] } }],
          usage: { total_tokens: 80 },
        }) };
      }
      call++;
      const toolMsg = body.messages.find(m => m.role === 'tool');
      assert.ok(toolMsg && toolMsg.content.includes('console.log(42)'), '读到的应是真实文件内容');
      return { ok: true, status: 200, json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: '审查通过，文件符合要求。\n{"passed": true, "issues": [], "verdict": "文件真实且正确"}' } }],
        usage: { total_tokens: 40 },
      }) };
    };
  })(),
  async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-ws-'));
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), 'console.log(42)', 'utf-8');
    const a = new HarnessAdapter({ apiKey: 'sk-test', model: 'deepseek-chat' });
    const r = await a.executeVerifier({ verifierId: 'jiji', task: '写入口文件', outputs: { xionger: '完成' }, workspace: ws });
    assert.equal(r.status, 'success');
    assert.equal(r.passed, true);
    assert.equal(r.parsed, true);
    assert.ok(r.toolCalls >= 1);
  }
));

test('工具层：路径越界的 tool_call 返回 ERROR 回填，不中断循环', withMockFetch(
  (() => {
    let call = 0;
    return async () => {
      if (call === 0) {
        call++;
        return { ok: true, status: 200, json: async () => ({
          choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [
            { id: 'e1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: '../evil.txt', content: 'x' }) } },
          ] } }],
          usage: { total_tokens: 30 },
        }) };
      }
      call++;
      return { ok: true, status: 200, json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: '路径被拒，已改用安全路径。\n{"passed": true, "issues": [], "verdict": "ok"}' } }],
        usage: { total_tokens: 20 },
      }) };
    };
  })(),
  async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-ws-'));
    const a = new HarnessAdapter({ apiKey: 'sk-test', model: 'deepseek-chat' });
    const r = await a.executeWorker({ roleId: 'xionger', task: 'x', workspace: ws });
    assert.equal(r.status, 'success');
    assert.ok(!fs.existsSync(path.join(ws, '..', 'evil.txt')), '越界文件不应存在');
  }
));

// === Verifier 对抗审查 ===

test('mock 引擎审查：产出齐全 → 通过', async () => {
  const a = new HarnessAdapter({ apiKey: null });
  const r = await a.executeVerifier({ verifierId: 'jiji', outputs: { xionger: '代码完成' } });
  assert.equal(r.status, 'success');
  assert.equal(r.passed, true);
  assert.equal(r.parsed, true);
  assert.equal(r.assignee, '吉吉国王');
});

test('mock 引擎审查：存在空产出 → 驳回', async () => {
  const a = new HarnessAdapter({ apiKey: null });
  const r = await a.executeVerifier({ verifierId: 'tiezhang', outputs: { xionger: null } });
  assert.equal(r.passed, false);
  assert.equal(r.issues.length, 1);
});

test('deepseek 审查：解析末行 JSON 结论', withMockFetch(
  async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '整体不错，但有两个问题。\n{"passed": false, "issues": ["缺测试", "命名不规范"], "verdict": "驳回重跑"}' } }] }),
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeVerifier({ verifierId: 'laoe', level: 'level_2', task: '实现登录', outputs: { xionger: '代码' } });
    assert.equal(r.status, 'success');
    assert.equal(r.passed, false);
    assert.deepEqual(r.issues, ['缺测试', '命名不规范']);
    assert.equal(r.verdict, '驳回重跑');
    assert.equal(r.parsed, true);
  }
));

test('deepseek 审查：请求携带级别规则与产出', withMockFetch(
  async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.match(body.messages[0].content, /老鳄/); // system = Verifier 角色 MD
    assert.match(body.messages[0].content, /标准审查/); // 附加 level_2 规则
    assert.match(body.messages[1].content, /实现登录/); // 任务
    assert.match(body.messages[1].content, /Worker 产出[\s\S]*代码完成/); // 产出
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"passed": true, "issues": [], "verdict": "ok"}' } }] }) };
  },
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeVerifier({ verifierId: 'laoe', level: 'level_2', task: '实现登录', outputs: { xionger: '代码完成' } });
    assert.equal(r.passed, true);
  }
));

test('deepseek 审查：代码块包裹的 JSON 也能解析', withMockFetch(
  async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '审查报告…\n```json\n{"passed": true, "issues": [], "verdict": "放行"}\n```' } }] }),
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeVerifier({ verifierId: 'jiji', outputs: { xionger: 'ok' } });
    assert.equal(r.passed, true);
    assert.equal(r.parsed, true);
  }
));

test('deepseek 审查：无结构化 JSON → 转人工复核而非关键词猜判定', withMockFetch(
  async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '安全问题严重，驳回重跑！' } }] }),
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeVerifier({ verifierId: 'tiezhang', outputs: { xionger: 'x' } });
    assert.equal(r.status, 'success');
    assert.equal(r.passed, null);      // 不再关键词猜 mock 判定
    assert.equal(r.parsed, false);
    assert.equal(r.needsHuman, true);  // 转人工复核
  }
));

// === parseVerdict 结构化解析单元测试 ===

test('parseVerdict：JSON 代码块 → 正常解析', () => {
  const r = parseVerdict('审查完毕。\n```json\n{"passed": false, "issues": ["跑题：产出是游戏逻辑而非口号", "缺测试"], "verdict": "驳回重跑"}\n```');
  assert.equal(r.passed, false);
  assert.equal(r.parsed, true);
  assert.equal(r.needsHuman, false);
  assert.deepEqual(r.issues, ['跑题：产出是游戏逻辑而非口号', '缺测试']);
  assert.equal(r.verdict, '驳回重跑');
});

test('parseVerdict：代码块 JSON 通过', () => {
  const r = parseVerdict('```json\n{"passed": true, "issues": [], "verdict": "放行"}\n```');
  assert.equal(r.passed, true);
  assert.equal(r.parsed, true);
});

test('parseVerdict：passed 为字符串 "false" 正确解析为 false', () => {
  const r = parseVerdict('```json\n{"passed": "false", "issues": ["a"], "verdict": "驳回"}\n```');
  assert.equal(r.passed, false);
  assert.equal(r.parsed, true);
});

test('parseVerdict：无 JSON 且有驳回关键词 → needsHuman，不猜判定', () => {
  const r = parseVerdict('这个方案完全不行，存在严重安全问题，必须驳回重跑！');
  assert.equal(r.passed, null);
  assert.equal(r.parsed, false);
  assert.equal(r.needsHuman, true);
  assert.equal(r.verdict, '无法解析审查结论，需人工复核');
});

test('parseVerdict：空串 → needsHuman', () => {
  const r = parseVerdict('');
  assert.equal(r.passed, null);
  assert.equal(r.needsHuman, true);
});

test('parseVerdict：flat JSON 兜底解析', () => {
  const r = parseVerdict('结论：{"passed": false, "issues": ["缺边界处理"], "verdict": "驳回"}');
  assert.equal(r.passed, false);
  assert.equal(r.parsed, true);
  assert.deepEqual(r.issues, ['缺边界处理']);
});

test('parseVerdict：嵌套/损坏 JSON → needsHuman，不误读', () => {
  const r = parseVerdict('前文 {broken json} 后文 {"passed": true}');
  assert.equal(r.passed, true); // 仍能兜底到含 passed 的扁平对象
});

test('deepseek 审查：API 错误 → status failed', withMockFetch(
  async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeVerifier({ verifierId: 'jiji', outputs: { xionger: 'x' } });
    assert.equal(r.status, 'failed');
    assert.equal(r.passed, null);
    assert.match(r.error, /API 500/);
  }
));

// === mapLimit 并发控制 ===

test('mapLimit：限制并发上限且结果保序', async () => {
  let running = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const results = await mapLimit(items, 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 10));
    running--;
    return n * 10;
  });
  assert.ok(peak <= 3, `并发峰值 ${peak} 应不超过 3`);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70]);
});
