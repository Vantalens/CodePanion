# CodePanion HTTP API 文档

> 本文档记录 CodePanion Rust daemon 的 HTTP API 规范。

## 基本信息

- **端口**: 8318
- **API 版本**: `/api/v1`
- **风格**: RESTful + OpenAI 兼容格式

## 错误响应格式

```json
{
  "error": {
    "message": "Project not found",
    "type": "not_found_error",
    "code": "project_not_found",
    "param": "id"
  }
}
```

## Project API

### POST /api/v1/projects
创建新项目。

### GET /api/v1/projects
列出所有项目。支持 `?tag=rust&sort=lastActiveAt` 查询参数。

### GET /api/v1/projects/:id
获取单个项目详情。

### PUT /api/v1/projects/:id
更新项目信息。

### DELETE /api/v1/projects/:id
删除项目。

### POST /api/v1/projects/:id/activate
激活项目（更新 lastActiveAt）。

### GET /api/v1/projects/:id/status
获取项目健康状态和统计信息。

## Provider API

### POST /api/v1/providers
添加 provider 配置。

### GET /api/v1/providers
列出所有 providers。

### GET /api/v1/providers/:id
获取单个 provider。

### PUT /api/v1/providers/:id
更新 provider 配置。

### DELETE /api/v1/providers/:id
删除 provider。

### POST /api/v1/providers/:id/test
测试 provider 连接。

### GET /api/v1/providers/:id/models
列出 provider 支持的模型。

### POST /api/v1/providers/:id/activate
激活 provider（设置为当前活跃）。

### GET /api/v1/providers/active
获取当前活跃的 provider。

### GET /v1/models
列出所有 provider 的所有模型（OpenAI 兼容格式）。

## Workflow API

### GET /workflow/board
列出所有 workflow 定义。

### GET /workflow/runs
列出所有 workflow runs。

### GET /workflow/runs/:id
获取单个 run 详情。

### GET /workflow/runs/:id/artifacts
获取 run 的 artifacts。

### GET /workflow/runs/:id/delivery
获取 delivery note。

### GET /workflow/gates
列出等待决策的 gates。

### POST /workflow/gates/:runId/:stepId/resolve
解决 gate。

## 全局视图 API

### GET /api/v1/global/runs
获取所有 runs（跨项目）。

### GET /api/v1/global/runs/queued
获取所有队列中的 runs。

### GET /api/v1/global/runs/running
获取所有运行中的 runs。

### GET /api/v1/global/runs/completed
获取所有已完成的 runs。

### GET /api/v1/global/stats
获取全局统计信息。

## WebSocket API

### WS /ws
WebSocket 连接端点，用于实时推送 workflow 事件。

**事件类型**:
- `queued`: workflow 进入队列
- `running`: workflow 开始执行
- `completed`: workflow 执行完成
- `failed`: workflow 执行失败
- `cancelled`: workflow 被取消
- `paused`: workflow 被暂停
