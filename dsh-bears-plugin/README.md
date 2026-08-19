# 熊出没集团 DeepSeek Harness 插件

## 安装

```bash
# 方式1：从本地目录安装
dsh plugin --profile demo add ./dsh-bears-plugin

# 方式2：从 GitHub 安装
dsh plugin --profile demo add github:T-ctrl-web/bears-appearing-ee
```

## 前置条件

熊出没集团本地服务器必须在运行：

```bash
cd server
node server.js
# 服务器启动在 http://localhost:3120
```

## 注册的 8 个工具

| 工具名 | 说明 | 状态转换 |
|--------|------|----------|
| `bears.start` | 启动任务，Leader评估拆解 | IDLE → DRAFTING → DISPATCHING |
| `bears.dispatch` | 派发Worker执行 | DISPATCHING → EXECUTING |
| `bears.complete-worker` | Worker完成 | EXECUTING → VERIFYING |
| `bears.verify` | 验证（通过或驳回） | VERIFYING → DELIVERING 或 → ITERATING |
| `bears.iterate` | 修复完成重派 | ITERATING → DISPATCHING |
| `bears.deliver` | 交付结果 | DELIVERING → COMPLETED |
| `bears.status` | 查询当前状态 | — |
| `bears.reset` | 重置所有状态 | → IDLE |

## 配置

在 `cordis.patch.yml` 中可配置：

```yaml
- insert:
  - id: bears-appearing-ee
    name: dsh-bears-appearing-ee
    config:
      serverUrl: 'http://localhost:3120'  # 本地服务器地址
      defaultComplexity: 'medium'        # 默认复杂度
      maxIterations: 3                    # 最大驳回重跑次数
```

## 角色ID参考

| ID | 角色 | 职责 |
|----|------|------|
| xiongda | 熊大 | 总裁（Leader） |
| guangtouqiang | 光头强 | 架构 |
| xionger | 熊二 | 开发 |
| bengbeng | 蹦蹦 | 测试 |
| luobotou | 萝卜头 | 调试 |
| feibo | 肥波 | 文档 |
| cuihua | 翠花 | 界面 |
| tutu | 涂涂 | 视觉 |
| tuotuo | 拖拖 | 运维 |
| maomao | 毛毛 | 调研 |
| jiji | 吉吉国王 | L1代码质检 |
| laoe | 老鳄 | L2设计质检 |
| xiaoli | 小狸 | 质量门禁 |
| tiezhang | 铁掌大师 | L3安全审查 |

## 使用示例

DeepSeek 调用示例：

```
用户：帮我做一个计算器
DeepSeek：调用 bears.start → 启动任务
DeepSeek：调用 bears.dispatch → 派发光头强设计架构
DeepSeek：调用 bears.complete-worker → 光头强完成
DeepSeek：调用 bears.dispatch → 派发熊二写代码
DeepSeek：调用 bears.complete-worker → 熊二完成
DeepSeek：调用 bears.verify → 吉吉国王验证通过
DeepSeek：调用 bears.deliver → 交付计算器
```
