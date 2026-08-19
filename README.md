# 熊出没集团

> 仿 MAVIS 多 Agent 协作系统 — 以《熊出没》动画角色为原型的团队引擎

## 项目简介

熊出没集团是一个基于 TRAE 平台的多 Agent 协作系统，灵感来源于 MAVIS（Multi-Agent Verification & Implementation System）。系统通过 Leader-Worker-Verifier 三层角色体系，实现任务拆解、执行与验证的完整闭环。

每个功能角色映射到《熊出没》动画中的一个常驻角色，利用角色性格特征匹配岗位职责。

## 当前阶段

**Phase 2 — 完整版（进行中）**

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
│   └── assets/                  # 角色图片
├── config/                      # 系统配置
│   ├── team-engine.json         # 团队引擎配置（14角色+并行+优先级+复杂度评估）
│   ├── verification-rules.json  # 验证规则（三级）
│   ├── memory-config.json       # 记忆系统配置（三层）
│   └── cost-control.json        # 成本控制
├── roles/                       # 角色定义
│   ├── leader/
│   │   └── bear-ceo.md          # 熊大
│   ├── workers/
│   │   ├── architect-bear.md    # 光头强
│   │   ├── implementer-bear.md   # 熊二
│   │   ├── test-engineer-bear.md # 蹦蹦
│   │   ├── debugger-bear.md     # 萝卜头
│   │   ├── documentation-bear.md # 肥波
│   │   ├── ui-designer-bear.md   # 翠花
│   │   ├── visual-designer-bear.md # 涂涂
│   │   ├── sysadmin-bear.md     # 拖拖
│   │   └── research-bear.md     # 毛毛
│   └── verifiers/
│       ├── code-reviewer-bear.md # 吉吉国王
│       ├── design-reviewer-bear.md # 老鳄
│       ├── quality-gate-bear.md  # 小狸
│       └── security-bear.md      # 铁掌大师
├── skills/                      # Skill 工具库
│   └── engineering/
│       ├── scaffold.md          # 项目脚手架
│       ├── code-review.md       # 代码审查
│       └── test-gen.md           # 测试生成
├── memory/                      # 记忆系统
│   ├── session/                 # 会话记忆（JSONL）
│   ├── project_memory.md        # 项目记忆
│   └── experience/              # 经验记忆
│       └── topics.md
├── demo/                        # Phase 1 验证示例
│   ├── roster.html              # 花名册页面
│   ├── roster-spec.md           # 技术方案
│   ├── test-report.md           # 测试报告
│   ├── review-report.md         # 审查报告
│   └── README.md                # 使用说明
├── phase2-plan.md               # Phase 2 规划文档
└── README.md
```

## 工作流程

1. 用户向熊大（总裁）提出需求
2. 熊大评估复杂度（文件数/模块数/依赖/安全敏感度）：
   - **简单** → 快速通道，熊大直接处理
   - **中等** → 拆解为步骤，顺序派发 Worker，Level 1 验证
   - **复杂** → 拆解+并行派发独立子任务，Level 2/3 验证
3. Worker 产出经 Verifier 审查：
   - Level 1 柔性（吉吉国王）— 提建议，不强制驳回
   - Level 2 标准（老鳄/小狸）— 驳回重跑，最多 2 轮
   - Level 3 强对抗（铁掌大师）— 凶猛驳回，最多 3 轮
4. 通过验证后交付用户，记录经验记忆

## Phase 2 新增能力

- **并行调度**：独立子任务并行执行，最多 3 个同时
- **优先级队列**：P0 紧急插队 / P1 常规 / P2 后台
- **三级验证**：L1 柔性 / L2 标准 / L3 强对抗
- **成本控制**：subagent 上限 + 迭代上限，超限暂停
- **错误恢复**：超时检测 + 重试 + 换角色 + 升级用户
- **三层记忆**：会话 + 项目 + 经验，跨会话检索
- **复杂度评估**：自动判断任务复杂度并选验证级别

## 后续阶段

- **Phase 3**：接入 DeepSeek harness、IM 集成（飞书秒回）、纸片人工作模式

## 相关文档

- [需求说明书](requirements-spec/requirements-spec.html)
- [Phase 2 规划](phase2-plan.md)
