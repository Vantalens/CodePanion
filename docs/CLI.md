# CodePanion CLI

CodePanion 命令行工具，用于管理 AI provider、模型和配置。

## 安装

```bash
cd codepanion-rust
cargo build --release --bin codepanion
# 二进制文件位于 target/release/codepanion
```

## 使用

### Provider 管理

#### 列出所有 provider
```bash
codepanion provider list
```

输出示例：
```
ID                   NAME                           TYPE            STATUS
---------------------------------------------------------------------------
deepseek-main        DeepSeek API                   deepseek        active
claude-api           Claude API                     anthropic       inactive
```

#### 查看当前活跃的 provider
```bash
codepanion provider active
```

输出示例：
```
Active provider: DeepSeek API (deepseek-main)
Type: deepseek
Status: active
```

#### 切换 provider
```bash
codepanion provider switch <provider-id>
```

示例：
```bash
codepanion provider switch claude-api
# ✓ Activated provider: Claude API (claude-api)
```

#### 添加新 provider
```bash
codepanion provider add <id> \
  --name "Provider Name" \
  --provider-type <type> \
  --api-key <key> \
  --base-url <url> \
  --default-model <model>
```

示例：
```bash
codepanion provider add my-deepseek \
  --name "My DeepSeek" \
  --provider-type deepseek \
  --api-key sk-xxx \
  --base-url https://api.deepseek.com \
  --default-model deepseek-chat
```

#### 删除 provider
```bash
codepanion provider remove <provider-id>
```

#### 测试 provider 连接
```bash
codepanion provider test <provider-id>
```

#### 导入配置

从 CC Switch 导入：
```bash
codepanion provider import --source ccm
# 或指定自定义路径
codepanion provider import --source ccm --file ~/.ccm_config
```

从 Claude Code 导入：
```bash
codepanion provider import --source claude
# 或指定自定义路径
codepanion provider import --source claude --file ~/.claude/settings.json
```

自动检测并导入：
```bash
codepanion provider import --source auto
```

输出示例：
```
✓ Import completed:
  Providers imported: 2
  Aliases imported: 5
  Env vars imported: 3
  Active provider: deepseek
```

### Model 管理

#### 列出所有可用模型
```bash
codepanion model list
```

输出示例：
```
MODEL ID                                 PROVIDER
----------------------------------------------------------------------
claude-opus-4-20250514                   Claude API
claude-sonnet-4-20250514                 Claude API
deepseek-chat                            DeepSeek API
deepseek-coder                           DeepSeek API
```

#### 设置模型别名
```bash
codepanion model alias <alias> <model-id>
```

示例：
```bash
codepanion model alias gpt4 gpt-4-turbo
```

注意：当前需要手动编辑 `~/.codepanion/config.json` 来设置别名。API 端点即将实现。

### 配置管理

#### 设置默认模型
```bash
codepanion config set-model <model>
```

示例：
```bash
codepanion config set-model opus
```

#### 设置努力级别
```bash
codepanion config set-effort <level>
```

支持的级别：`low`, `medium`, `high`, `xhigh`, `max`

示例：
```bash
codepanion config set-effort high
```

注意：当前需要手动编辑 `~/.codepanion/config.json` 来设置配置。API 端点即将实现。

## 全局选项

### 自定义 API URL
```bash
codepanion --api-url http://localhost:9000 provider list
```

默认 API URL：`http://127.0.0.1:8318`

## 环境变量

CLI 工具支持以下环境变量：

- `ANTHROPIC_MODEL` - 覆盖默认模型
- `ANTHROPIC_BASE_URL` - API 端点 URL
- `ANTHROPIC_AUTH_TOKEN` - API 密钥
- `ANTHROPIC_DEFAULT_OPUS_MODEL` - Opus 别名映射
- `ANTHROPIC_DEFAULT_SONNET_MODEL` - Sonnet 别名映射
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` - Haiku 别名映射
- `ANTHROPIC_EFFORT_LEVEL` - 努力级别

示例：
```bash
export ANTHROPIC_MODEL=sonnet
export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5
codepanion provider active
```

## 配置文件

### 全局配置
位置：`~/.codepanion/config.json`

示例：
```json
{
  "version": 1,
  "activeProviderId": "deepseek-main",
  "defaultModel": "opus",
  "modelAliases": {
    "opus": "claude-opus-4-20250514",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-haiku-4-20250301"
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  },
  "availableModels": ["opus", "sonnet", "haiku"],
  "effortLevel": "high"
}
```

### Provider 配置
位置：`~/.codepanion/providers.json`

示例：
```json
{
  "version": 1,
  "providers": {
    "deepseek-main": {
      "id": "deepseek-main",
      "name": "DeepSeek API",
      "type": "deepseek",
      "config": {
        "apiKey": "sk-xxx",
        "baseUrl": "https://api.deepseek.com",
        "defaultModel": "deepseek-chat"
      },
      "models": [
        {
          "id": "deepseek-chat",
          "name": "DeepSeek Chat",
          "contextWindow": 32768,
          "maxOutputTokens": 4096
        }
      ],
      "capabilities": ["chat", "streaming"],
      "status": "active",
      "createdAt": 1735689600000
    }
  }
}
```

## 常见工作流

### 快速切换 API
```bash
# 查看当前 provider
codepanion provider active

# 切换到 Claude
codepanion provider switch claude-api

# 切换到 DeepSeek
codepanion provider switch deepseek-main
```

### 从 CC Switch 迁移
```bash
# 1. 导入 CC Switch 配置
codepanion provider import --source ccm

# 2. 查看导入的 provider
codepanion provider list

# 3. 切换到导入的 provider
codepanion provider switch <imported-provider-id>
```

### 添加新的 API provider
```bash
# 1. 添加 provider
codepanion provider add my-openai \
  --name "My OpenAI" \
  --provider-type openai \
  --api-key sk-xxx \
  --base-url https://api.openai.com/v1 \
  --default-model gpt-4

# 2. 测试连接
codepanion provider test my-openai

# 3. 激活
codepanion provider switch my-openai
```

## 故障排查

### API 服务器未运行
```bash
# 启动 daemon
codepanion-daemon --serve

# 或指定端口
codepanion-daemon --serve 9000
```

### 自定义 API URL
```bash
# 如果 daemon 运行在不同端口
codepanion --api-url http://localhost:9000 provider list
```

### 查看详细错误
CLI 会显示详细的错误信息。如果遇到问题：
1. 确认 daemon 正在运行
2. 检查 API URL 是否正确
3. 查看 `~/.codepanion/` 目录下的配置文件

## 开发

### 构建
```bash
cargo build --bin codepanion
```

### 运行
```bash
cargo run --bin codepanion -- provider list
```

### 测试
```bash
cargo test --workspace
```
