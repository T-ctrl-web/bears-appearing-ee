# 熊出没集团 — 项目记忆

## 项目规则

- 初始实现使用纯 TRAE 平台（Agent + Skill + MCP）
- IM 集成（Lark 插件）在后续阶段实现，不在 MVP 中
- 任务复杂度决定验证强度：简单=灵活审查，复杂=强对抗验证
- 并行执行仅限独立子任务；主工作流顺序执行
- Phase 2：局部并行（最多 3 个 subagent 同时），三级验证全部启用

## 工程约定

- 项目名称：熊出没集团
- 核心架构：1 Leader + 9 Workers + 4 Verifiers（共 14 角色）
- Phase 2 阵容：全部 14 角色
- 角色映射到《熊出没》动画角色
- 需求说明书：requirements-spec/requirements-spec.html
- 每个角色定义文件使用 Markdown frontmatter 格式（name/role/role_type/character/tools/model/color）
- Verifier 定义额外字段：verification_level / max_iterations

## 验证策略

- 默认级别：Level 1（吉吉国王柔性审查）
- 安全敏感任务：Level 3（铁掌大师强对抗）
- 复杂任务：Level 2（老鳄设计质检 + 小狸质量门禁）
- 验证级别可自动选择（按复杂度）或用户指定

## 经验教训

- [demo-001] emoji/动态内容必须转义，否则存在 XSS 风险
- [demo-001] 测试和文档步骤可并行（都只依赖开发产出，互不依赖）
- [demo-001] Level 1 柔性审查发现的问题也要修——P1 安全问题不能放过
- [demo-001] 注释与实现要保持一致，避免误导维护者
