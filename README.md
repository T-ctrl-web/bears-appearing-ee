# 熊出没集团

> 仿 MAVIS 多 Agent 协作系统 — 以《熊出没》动画角色为原型的团队引擎

## 项目简介

熊出没集团是一个基于 TRAE 平台的多 Agent 协作系统，灵感来源于 MAVIS（Multi-Agent Verification & Implementation System）。系统通过 Leader-Worker-Verifier 三层角色体系，实现任务拆解、执行与验证的完整闭环。

每个功能角色映射到《熊出没》动画中的一个常驻角色，利用角色性格特征匹配岗位职责。

## 当前阶段

**Phase 3 — 多引擎 + IM 集成 + 可视化（完成）**

### 全阵容（1 + 9 + 4 = 14 角色）

| 层级 | 角色 | 动物 | 职责 | 验证级别 |
|------|------|------|------|----------|
| Leader | 熊大 | 棕熊 | 总裁 — 接收需求、评估、拆解、并行调度 | — |
| Worker | 光头强 | 人类·伐木工 | 架构 — 技术方案设计 | — |
| Worker | 熊二 | 棕熊 | 开发 — 代码实现 | — |
| Worker | 蹦蹦 | 松鼠 | 测试 — 测试用例与Bug报告 | — |
| Worker | 萝卜头 | 鼹鼠 | 调试 — Bug定位与修复 | — |
| Worker | 肥波 | 肥猫 | 文档 — 文档编写 | — |
| Worker | 翠花 | 母熊 | 界面 — UI设计 | — |
| Worker | 涂涂 | 猫头鹰 | 视觉 — 像素级视觉审查 | — |
| Worker | 拖拖 | 乌龟 | 运维 — 基础设施守护 | — |
| Worker | 毛毛 | 金色小猴 | 调研 — 情报搜集 | — |
| Verifier | 吉吉国王 | 猴子 | 代码质检 — Level 1柔性审查 | L1 |
| Verifier | 老鳄 | 鳄鱼 | 设计质检 — Level 2标准审查 | L2 |
| Verifier | 小狸 | 狐狸 | 质量门禁 — 交付前最终把关 | L2 |
| Verifier | 铁掌大师 | 东北虎 | 安全 — Level 3强对抗审查 | L3 |

## 目录结构

```
熊出没集团/
├── requirements-spec/           # 需求说明书
│   ├── requirements-spec.html
│   └── assets/                  # 14张角色图片
├── config/                      # 系统配置
│   ├── team-engine.json         # 团队引擎配置（14角色+并行+优先级+复杂度评估）
│   ├── verification-rules.json  # 验证规则（三级）
│   ├── memory-config.json       # 记忆系统配置（三层）
│   ├── cost-control.json        # 成本控制
│   └── harness-config.example.json  # DeepSeek harness 接入配置示例
├── engine/                      # 核心引擎
│   ├── complexity-evaluator.md  # 复杂度评估（设计文档）
│   ├── complexity-evaluator.js  # 复杂度评估实现（六维加权 + 文本启发式）
│   ├── harness-adapter.md       # 多引擎适配器（设计文档）
│   ├── harness-adapter.js       # Worker 真实执行闭环（DeepSeek API / mock 演示）
│   ├── state-machine.js         # 任务状态机（确定性流程控制）
│   ├── team-runner.js           # 团队调度引擎（驱动状态机 + harness 执行）
│   ├── tests/                   # 自动化测试（node --test "engine/tests/*.test.js"）
│   ├── parallel-scheduler.md   # 并行调度
│   ├── priority-queue.md        # 优先级队列
│   ├── cost-controller.md      # 成本控制
│   ├── error-recovery.md        # 错误恢复
│   ├── verification-engine.md   # 验证引擎
│   ├── memory-engine.md         # 记忆引擎
│   ├── harness-adapter.md       # 多引擎适配器
│   └── lark-bridge.md           # 飞书桥接引擎
├── roles/                       # 角色定义（14个）
│   ├── leader/                  # 1个 Leader
│   ├── workers/                 # 9个 Workers
│   └── verifiers/               # 4个 Verifiers
├── skills/                      # Skill 工具库
│   ├── SKILL-INDEX.md           # 26个Skill索引
│   └── engineering/             # 3个本地Skill
├── memory/                      # 记忆系统
│   ├── session/                 # 会话记忆
│   ├── project_memory.md        # 项目记忆
│   └── experience/              # 经验记忆
├── demo/                        # Phase 1 验证示例
├── demo2/                       # Phase 2 集成验证示例
├── dashboard.html               # 纸片人工作看板（Phase 3）
├── phase2-plan.md               # Phase 2 规划
├── phase3-plan.md               # Phase 3 规划
└── README.md
```

## 工作流程

1. 用户向熊大（总裁）提出需求（可通过飞书 IM）
2. 熊大秒回确认，评估复杂度（文件数/模块数/依赖/安全敏感度）：
   - **简单** → 快速通道，熊大直接处理
   - **中等** → 拆解为步骤，顺序派发 Worker，Level 1 验证
   - **复杂** → 拆解+并行派发独立子任务，Level 2/3 验证
3. Worker 通过 harness 适配器调度（TRAE Agent 或 DeepSeek API）
4. Worker 产出经 Verifier 审查：
   - Level 1 柔性（吉吉国王）— 提建议，不强制驳回
   - Level 2 标准（老鳄/小狸）— 驳回重跑，最多 2 轮
   - Level 3 强对抗（铁掌大师）— 凶猛驳回，最多 3 轮
5. 通过验证后交付用户，飞书通知，记录经验记忆
6. 全程在纸片人看板上可视化展示角色工作状态

## Phase 3 新增能力

- **DeepSeek harness**：多引擎调度，TRAE + DeepSeek API 路由，自动降级
- **Worker 真实执行闭环**：`autoExecute` 模式下派发波次后由 harness 真实调用 LLM（角色 MD 全文作为 system prompt），完成后自动进入验证，最多 3 并发
- **Verifier 真实对抗审查闭环**：Worker 完成后由对应级别 Verifier 真实 LLM 审查产出（角色人设 + verification-rules 清单），结构化结论 `{passed, issues, verdict}`；驳回自动重跑（携带问题上下文）、多波次自动流水、末波自动交付、迭代超限终审 FAILED
- **飞书 IM 集成**：秒回确认 + 任务派发 + 进度通知 + 交付通知
- **纸片人工作模式**：14角色可视化看板，实时状态展示，任务流程演示

## Worker 真实执行闭环使用

```bash
# 1. 配置（二选一）
export DEEPSEEK_API_KEY=sk-xxx          # 环境变量
cp config/harness-config.example.json config/harness-config.json  # 或配置文件填 api_key

# 2. 启动
cd server && npm start                  # 启动横幅会显示 harness 状态

# 3. 触发真实闭环（autoExecute: true）
curl -X POST localhost:3121/api/sm/start -H "Content-Type: application/json" \
  -d '{"requirement":"实现登录页","autoExecute":true}'
curl -X POST localhost:3121/api/sm/complete-draft -H "Content-Type: application/json" -d '{}'
curl -X POST localhost:3121/api/sm/dispatch -H "Content-Type: application/json" \
  -d '{"waveIndex":0,"waveData":{"roles":["guangtouqiang","xionger"],"task":"设计并实现登录页"}}'
# Worker 并行真实调用 DeepSeek，全部完成后自动进入 VERIFYING
# Verifier（按复杂度选级：medium→吉吉国王L1 / complex→老鳄L2 / 安全→铁掌大师L3）
# 真实 LLM 对抗审查，驳回自动重跑、末波自动交付，全程无需人工干预
# 产出快照：GET /api/sm/snapshot（waveOutputs + task.verification）；引擎状态：GET /api/harness/status
```

未配置 API Key 时自动降级 **mock 演示模式**（确定性产出，不发真实请求）。

## Phase 1-2 能力回顾

- **14角色全阵容**：1 Leader + 9 Workers + 4 Verifiers
- **并行调度**：独立子任务并行执行，最多 3 个同时
- **优先级队列**：P0 紧急插队 / P1 常规 / P2 后台
- **三级验证**：L1 柔性 / L2 标准 / L3 强对抗 + 驳回重跑
- **成本控制**：subagent 上限 + 迭代上限，超限暂停
- **错误恢复**：超时检测 + 重试 + 换角色 + 升级用户
- **三层记忆**：会话 + 项目 + 经验，跨会话检索
- **复杂度评估**：自动判断任务复杂度并选验证级别
- **26个Skill**：3个本地 + 23个引用

## 相关文档

- [需求说明书](requirements-spec/requirements-spec.html)
- [纸片人工作看板](dashboard.html)
- [Phase 2 规划](phase2-plan.md)
- [Phase 3 规划](phase3-plan.md)
