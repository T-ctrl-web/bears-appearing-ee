# 熊出没集团 — Skill 索引

> Phase 2 共 18+ Skill，分为工程类、设计类、运维类三大组。

## 工程类（engineering/）

### 已定义（本地）
| # | Skill | 文件 | 使用角色 | 用途 |
|---|-------|------|----------|------|
| 1 | scaffold | engineering/scaffold.md | 光头强、熊二 | 按项目类型生成标准目录结构 |
| 2 | code-review | engineering/code-review.md | 吉吉国王、老鳄、铁掌大师 | 结构化代码审查 |
| 3 | test-gen | engineering/test-gen.md | 蹦蹦、小狸 | 自动生成测试用例 |

### 可引用（Bears-appearing-ee）
| # | Skill | 来源路径 | 使用角色 | 用途 |
|---|-------|----------|----------|------|
| 4 | bug-report | engineering/bug-report/SKILL.md | 蹦蹦 | Bug报告标准化模板 |
| 5 | doc-gen | engineering/doc-gen/SKILL.md | 肥波 | 文档自动生成 |
| 6 | git-changelog | engineering/git-changelog/SKILL.md | 肥波 | Git变更日志生成 |
| 7 | dependency-check | engineering/dependency-check/SKILL.md | 拖拖、铁掌大师 | 依赖安全检查 |
| 8 | differential-review | engineering/differential-review/.../SKILL.md | 吉吉国王 | 差异代码审查（只审查改动部分） |
| 9 | mutation-testing | engineering/mutation-testing/.../SKILL.md | 蹦蹦 | 变异测试（验证测试有效性） |
| 10 | property-based-testing | engineering/property-based-testing/.../SKILL.md | 蹦蹦 | 属性测试（自动发现边界用例） |
| 11 | modern-python | engineering/modern-python/.../SKILL.md | 熊二 | Python开发规范 |
| 12 | spec-to-code-compliance | engineering/spec-to-code-compliance/.../SKILL.md | 毛毛、老鳄 | 规范与代码一致性检查 |
| 13 | full-output | engineering/full-output/SKILL.md | 全体 | 完整输出控制（不截断） |

## 设计类（design/）

### 可引用（Bears-appearing-ee）
| # | Skill | 来源路径 | 使用角色 | 用途 |
|---|-------|----------|----------|------|
| 14 | design-review | design/design-review/SKILL.md | 老鳄、涂涂 | 设计审查 |
| 15 | frontend-design | design/frontend-design/SKILL.md | 翠花 | 前端设计规范 |
| 16 | minimalist-ui | design/minimalist-ui/SKILL.md | 翠花 | 简约UI设计 |
| 17 | web-design | design/web-design/SKILL.md | 翠花 | Web页面设计 |

## 运维类（logistics/）

### 可引用（Bears-appearing-ee）
| # | Skill | 来源路径 | 使用角色 | 用途 |
|---|-------|----------|----------|------|
| 18 | codex-memory | logistics/codex-memory/SKILL.md | 熊大（总裁） | 记忆管理工具 |
| 19 | git-cleanup | engineering/git-cleanup/.../SKILL.md | 拖拖 | Git分支清理 |
| 20 | devcontainer-setup | engineering/devcontainer-setup/.../SKILL.md | 拖拖 | 开发环境容器配置 |
| 21 | gh-cli | engineering/gh-cli/.../SKILL.md | 拖拖 | GitHub CLI操作 |

## 安全类（铁掌大师专用）

### 可引用（Bears-appearing-ee）
| # | Skill | 来源路径 | 用途 |
|---|-------|----------|------|
| 22 | static-analysis | engineering/static-analysis/ | 静态分析（CodeQL/Semgrep/SARIF） |
| 23 | supply-chain-risk-auditor | engineering/supply-chain-risk-auditor/ | 供应链风险审计 |
| 24 | building-secure-contracts | engineering/building-secure-contracts/ | 安全合约构建 |
| 25 | semgrep-rule-creator | engineering/semgrep-rule-creator/ | Semgrep规则创建 |

## 学习机制

| # | Skill | 来源路径 | 用途 |
|---|-------|----------|------|
| 26 | skill-improver | engineering/skill-improver/ | Skill自我改进（经验→Skill优化） |

## 使用说明

1. **本地定义的 Skill**（#1-3）：直接在 `skills/engineering/` 目录下使用
2. **引用的 Skill**（#4-26）：从 `Bears-appearing-ee/skills/` 引用，总裁派发时在 prompt 中指定 Skill 路径
3. **新增 Skill**：在对应分类目录下创建 `.md` 文件，更新本索引
4. **Skill 更新**：任务完成后，如发现 Skill 可改进，使用 `skill-improver` 更新
