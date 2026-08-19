# Harness 适配器：多引擎调度

## 用途

熊大（总裁）通过 harness 适配器统一调度 Worker，Worker 不感知底层引擎差异（TRAE Agent 或 DeepSeek API）。

## 架构

```
熊大（总裁）
  ↓
harness 适配器（路由层）
  ├─→ TRAE Agent（本地执行）
  └─→ DeepSeek API（远程推理）
        ↓
     统一结果格式 → 验证流程
```

## 派发接口

### 输入（统一格式）
```json
{
  "step": 3,
  "assignee": "光头强",
  "role": "架构",
  "task": "设计登录看板架构",
  "context": "技术方案需求，参考调研报告",
  "output_format": "spec.md",
  "engine_hint": "deepseek"
}
```

### 路由逻辑
```
1. 检查 engine_hint，如果有指定引擎，直接路由
2. 否则按 routing_strategy 规则匹配
3. 如果匹配到 DeepSeek 但不可用，回退到 TRAE
4. 如果匹配到 TRAE，直接执行
```

### 输出（统一格式）
```json
{
  "step": 3,
  "assignee": "光头强",
  "engine": "deepseek",
  "status": "success",
  "output": "产出内容或文件路径",
  "duration_ms": 15000,
  "error": null
}
```

## DeepSeek 调用规范

### 请求格式
```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "你是熊出没集团的架构师光头强...（角色定义全文）"},
    {"role": "user", "content": "任务描述 + 上下文 + 输出格式要求"}
  ],
  "max_tokens": 8192,
  "temperature": 0.7
}
```

### 响应处理
1. 提取 `choices[0].message.content` 作为产出
2. 如果产出包含文件内容，写入指定路径
3. 如果 API 返回错误，标记为 `status: "failed"`，触发错误恢复

## 降级方案

```
DeepSeek API 不可用（超时/限流/认证失败）
  ↓
harness 自动回退到 TRAE Agent
  ↓
总裁收到降级通知："DeepSeek 不可用，已回退到 TRAE 执行"
  ↓
继续正常流程（TRAE Agent 替代执行）
```

## 成本对比

| 维度 | TRAE Agent | DeepSeek API |
|------|-----------|--------------|
| 执行速度 | 中（需要 subagent 启动） | 快（直接 API 调用） |
| 文件操作 | 支持 | 不支持（需 Leader 中转） |
| 推理深度 | 中 | 高 |
| 并发能力 | 最多 3 个 | 无限制（受 API 限流） |
| 成本 | TRAE 额度 | API 调用费 |
