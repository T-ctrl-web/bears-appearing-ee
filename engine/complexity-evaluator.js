/**
 * 熊出没集团 · 复杂度评估器
 * 设计文档：engine/complexity-evaluator.md
 *
 * 评估方式：
 *   evaluate(metrics)      — 结构化指标，六维加权得分判定（总裁评估逻辑）
 *   evaluateFromText(text) — 需求文本关键词启发式（对应文档「快速判断（总裁用）」）
 *   evaluateAuto(input)    — 自动分派：字符串→文本评估，对象→指标评估
 *
 * 判定阈值（见设计文档「评估规则」）：
 *   得分 ≤ 30 → 简单（快速通道）
 *   30 < 得分 ≤ 65 → 中等（拆解顺序执行 + L1 验证）
 *   得分 > 65 → 复杂（拆解 + 并行派发 + L2/L3 验证）
 *   安全敏感 → 无条件升级为复杂 + L3 铁掌大师
 */

// 六维权重（合计 1.0）
const WEIGHTS = {
  fileCount: 0.30,
  moduleCount: 0.25,
  dependency: 0.15,
  techStack: 0.10,
  security: 0.15,
  crossSystem: 0.05,
};

// 各维度三档得分：简单 0 / 中等 50 / 复杂 100
const DIMENSION_SCORES = {
  fileCount(raw) {
    const n = Number(raw) || 0;
    if (n <= 1) return 0;
    if (n <= 5) return 50;
    return 100;
  },
  moduleCount(raw) {
    const n = Number(raw) || 0;
    if (n <= 1) return 0;
    if (n === 2) return 50;
    return 100;
  },
  dependency(raw) {
    if (raw === 'none' || raw === '无' || !raw) return 0;
    if (raw === 'sequential' || raw === '顺序') return 50;
    return 100; // cross / 交叉
  },
  techStack(raw) {
    const n = Number(raw) || 1;
    if (n <= 1) return 0;
    if (n === 2) return 50;
    return 100;
  },
  security(raw) {
    if (raw === true || raw === 'sensitive' || raw === '敏感') return 100;
    if (raw === 'normal' || raw === '普通') return 50;
    return 0; // false / 'none' / '无'
  },
  crossSystem(raw) {
    return raw === true || raw === 'cross' || raw === '是' ? 100 : 0;
  },
};

// 验证级别映射（见设计文档「验证级别映射」，角色 ID 与 state.js 拼音体系一致）
const VERIFICATION_MAP = {
  simple:   { level: null,       label: '无', verifiers: [],                 maxIterations: 0 },
  medium:   { level: 'level_1',  label: 'L1', verifiers: ['jiji'],           maxIterations: 1 },
  complex:  { level: 'level_2',  label: 'L2', verifiers: ['laoe', 'xiaoli'], maxIterations: 2 },
  security: { level: 'level_3',  label: 'L3', verifiers: ['tiezhang'],       maxIterations: 3 },
};

const STRATEGY_MAP = {
  simple:   '快速通道（总裁直接处理）',
  medium:   '拆解顺序执行 + Level 1 验证',
  complex:  '拆解 + 并行派发 + Level 2 验证',
  security: '拆解 + 并行派发 + Level 3 强对抗验证',
};

function normalizeMetrics(input = {}) {
  return {
    fileCount: input.fileCount ?? input.files ?? 1,
    moduleCount: input.moduleCount ?? input.modules ?? 1,
    dependency: input.dependency ?? input.dependencies ?? 'none',
    techStack: input.techStack ?? input.techStacks ?? 1,
    security: input.security ?? input.securitySensitive ?? false,
    crossSystem: input.crossSystem ?? false,
  };
}

function finalize(level, securitySensitive, dimensions, score, basis) {
  if (securitySensitive) {
    return {
      score, level: 'complex', securitySensitive: true, dimensions, basis,
      strategy: STRATEGY_MAP.security,
      verification: VERIFICATION_MAP.security,
    };
  }
  return {
    score, level, securitySensitive: false, dimensions, basis,
    strategy: STRATEGY_MAP[level],
    verification: VERIFICATION_MAP[level],
  };
}

/**
 * 结构化指标评估
 * @param {object} input - { files, modules, dependency, techStacks, security, crossSystem }
 *   支持别名：fileCount/moduleCount/techStack/securitySensitive/dependencies
 */
function evaluate(input) {
  const metrics = normalizeMetrics(input);
  const dimensions = {};
  let score = 0;
  for (const [name, fn] of Object.entries(DIMENSION_SCORES)) {
    const dimScore = fn(metrics[name]);
    dimensions[name] = { raw: metrics[name], score: dimScore };
    score += dimScore * WEIGHTS[name];
  }
  const level = score <= 30 ? 'simple' : score <= 65 ? 'medium' : 'complex';
  return finalize(level, dimensions.security.score === 100, dimensions, Math.round(score * 10) / 10, 'metrics');
}

// 关键词启发式规则（优先级：安全 > 复杂 > 简单 > 中等；均不命中默认中等——宁可多验证）
const SECURITY_RE = /登录|认证|授权|密码|token|会话|session|jwt|oauth|支付|加密|鉴权|安全|隐私|脱敏|login|password|payment|encrypt|privacy/i;
const COMPLEX_RE = /跨模块|跨系统|系统级|重构|架构|迁移|全栈|微服务|多模块|refactor|architect|migrat|fullstack|microservice/i;
const SIMPLE_RE = /改文案|文案|错别字|拼写|typo|改配置|修改配置|重命名|改标题|改个字|rename/i;
const MEDIUM_RE = /新增|添加|实现|开发|功能|页面|接口|模块|修复|优化/i;

/**
 * 需求文本启发式评估
 * @param {string} text - 需求描述
 */
function evaluateFromText(text) {
  const s = String(text || '');
  const securitySensitive = SECURITY_RE.test(s);
  let level = 'medium';
  if (securitySensitive || COMPLEX_RE.test(s)) level = 'complex';
  else if (SIMPLE_RE.test(s)) level = 'simple';
  else if (MEDIUM_RE.test(s)) level = 'medium';
  const finalLevel = securitySensitive ? 'complex' : level;
  const representative = { simple: 15, medium: 50, complex: 85 }[finalLevel];
  return finalize(finalLevel, securitySensitive, null, representative, 'text');
}

/**
 * 自动分派：字符串走文本评估，对象走指标评估
 */
function evaluateAuto(input) {
  if (typeof input === 'string') return evaluateFromText(input);
  if (input && typeof input === 'object') return evaluate(input);
  return evaluateFromText('');
}

module.exports = { evaluate, evaluateFromText, evaluateAuto, WEIGHTS, VERIFICATION_MAP };
