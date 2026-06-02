# Workflow 使用的 API

## 答案

**Workflow 使用的是 Anthropic Claude API（官方 API）**

## 证据

从 workflow agent 日志中可以看到：

```json
{
  "model": "claude-opus-4-8",
  "attributionAgent": "workflow-subagent",
  "usage": {
    "input_tokens": 15,
    "cache_creation_input_tokens": 597,
    "cache_read_input_tokens": 18870,
    "output_tokens": 226,
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 597
    }
  }
}
```

## 关键信息

### 1. 模型
- **模型 ID**: `claude-opus-4-8`
- **模型名称**: Claude Opus 4.8
- **服务商**: Anthropic
- **服务等级**: `standard`

### 2. Token 使用
- **输入 tokens**: 15
- **缓存创建**: 597 tokens
- **缓存读取**: 18,870 tokens（大幅节省成本！）
- **输出 tokens**: 226

### 3. 缓存策略
使用 **Prompt Caching**（提示词缓存）：
- `ephemeral_5m_input_tokens`: 597 tokens（5分钟缓存）
- 缓存读取占比极高，显著降低成本

### 4. Agent 类型
- `attributionAgent: "workflow-subagent"`
- 这是 Claude Code 的 workflow 框架创建的子 agent
- 每个 agent 都是独立的 Anthropic API 调用

## Workflow 架构

```
主会话 (你) 
  └─> Workflow 工具
       └─> agent() 函数
            └─> 创建 subagent
                 └─> Anthropic API 调用
                      └─> Claude Opus 4.8
```

## 与你的项目对比

### 你的 CodePanion 架构
```
GUI (WPF + WebView2)
  └─> Rust daemon
       └─> DeepSeek API（外部）
```

### Claude Code Workflow 架构
```
主会话
  └─> Workflow 框架
       └─> Anthropic API（官方）
```

## 关键区别

| 方面 | CodePanion | Claude Code Workflow |
|------|-----------|---------------------|
| **API 提供商** | DeepSeek（第三方） | Anthropic（官方） |
| **模型** | DeepSeek-V3 | Claude Opus 4.8 |
| **架构** | Rust daemon 中转 | 直接调用 Anthropic |
| **缓存** | 需自行实现 | 内置 Prompt Caching |
| **Agent** | 需自行实现 | 框架内置 |

## 记忆更新

根据你的项目定位：
> "模型走外部 API（DeepSeek），agent 架构靠逆向外部工具（Claude Code）进程内复刻"

现在你知道了：
- **外部工具（Claude Code）的 agent 架构**使用 Anthropic Claude API
- **你需要复刻的架构**就是这个 workflow → agent → API 的模式
- **但你会用 DeepSeek API** 替代 Anthropic API

## 实现建议

如果你要在 CodePanion 中实现类似的 workflow 功能：

1. **Workflow 编排层**（Rust）
   - 解析 workflow 脚本
   - 管理 agent 生命周期
   - 处理 pipeline/parallel

2. **Agent 层**（Rust）
   - 创建独立的 agent 实例
   - 调用 DeepSeek API
   - 强制 schema 输出（JSON mode）

3. **API 层**（DeepSeek）
   - 使用 DeepSeek 的 JSON mode
   - 实现类似的 prompt caching（如果支持）
   - 处理 tool calls

## 成本对比

**Anthropic Claude Opus 4.8**:
- 输入: $15/1M tokens
- 输出: $75/1M tokens
- 缓存读取: $1.50/1M tokens（节省 90%）

**DeepSeek-V3**:
- 输入: $0.27/1M tokens（便宜 55 倍）
- 输出: $1.10/1M tokens（便宜 68 倍）
- 缓存: 需自行实现

**成本优势**：用 DeepSeek 替代 Claude 可以节省 50-70 倍成本！
