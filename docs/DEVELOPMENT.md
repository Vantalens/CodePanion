# CodePanion 开发指南

本文档面向希望参与 CodePanion 开发或基于 CodePanion 进行二次开发的开发者。CodePanion 当前定位为个人本地 AI 工作流中控台，开发优先级应先服务“统一接入、状态总览、提醒、上下文查看和接管”，再逐步扩展到本地工作流编排。

## 目录

- [开发环境设置](#开发环境设置)
- [项目结构](#项目结构)
- [开发工作流](#开发工作流)
- [代码规范](#代码规范)
- [测试](#测试)
- [调试](#调试)
- [贡献指南](#贡献指南)
- [发布流程](#发布流程)

---

## 开发环境设置

### 前置要求

- **Node.js**: >= 24.0.0（Windows 便携包当前固定 `node.exe` 为 v24.14.1，并校验 SHA256）
- **.NET SDK**: >= 8.0 (GUI 开发)
- **Git**: 最新版本
- **编辑器**: VS Code (推荐) 或其他

### 克隆项目

```bash
git clone https://github.com/Vantalens/CodePanion.git
cd CodePanion
```

### 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装 daemon 依赖
cd packages/daemon
npm install
cd ../..
```

### 开发模式运行

```bash
# 终端 1: 运行 daemon（开发模式）
npm run dev:daemon

# 终端 2: 运行 GUI（开发模式）
npm run gui:run
```

### VS Code 配置

推荐安装以下扩展：

- **ESLint**: 代码检查
- **Prettier**: 代码格式化
- **TypeScript**: TypeScript 支持
- **C# Dev Kit**: C# 开发（GUI）

**`.vscode/settings.json`**:
```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true
  }
}
```

**`.vscode/launch.json`**:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Daemon",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev:daemon"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/packages/daemon/src/index.ts",
      "args": ["run", "--", "echo", "test"],
      "runtimeArgs": ["-r", "tsx/register"],
      "console": "integratedTerminal"
    }
  ]
}
```

---

## 项目结构

```
CodePanion/
├── packages/
│   ├── daemon/                 # Node.js 守护进程和 CLI
│   │   ├── src/
│   │   │   ├── cli/           # CLI 命令实现
│   │   │   │   ├── index.ts   # CLI 入口
│   │   │   │   ├── start.ts   # start 命令
│   │   │   │   ├── stop.ts    # stop 命令
│   │   │   │   ├── status.ts  # status 命令
│   │   │   │   ├── run.ts     # run 命令
│   │   │   │   ├── notify.ts  # notify 命令
│   │   │   │   ├── reply.ts   # reply 命令
│   │   │   │   └── install.ts # install 命令
│   │   │   ├── adapters/      # 本地工作流适配器
│   │   │   ├── daemon/        # 守护进程核心
│   │   │   │   ├── boot.ts    # 守护进程启动
│   │   │   │   ├── server.ts  # HTTP/WebSocket 服务器
│   │   │   │   ├── sessionManager.ts  # CLI 会话管理
│   │   │   │   ├── sourceManager.ts   # 多源注册与事件管理
│   │   │   │   ├── workflowManager.ts # 工作流线程聚合
│   │   │   │   ├── notifier.ts        # 通知系统
│   │   │   │   └── pidfile.ts         # PID 文件管理
│   │   │   ├── pty/           # 伪终端管理
│   │   │   │   ├── runner.ts          # PTY 运行器
│   │   │   │   └── promptDetector.ts  # 提示检测
│   │   │   ├── shared/        # 共享协议与客户端
│   │   │   │   ├── client.ts  # API 客户端
│   │   │   │   └── protocol.ts # 协议与类型定义
│   │   │   ├── config.ts      # 配置管理
│   │   │   ├── logger.ts      # 日志系统
│   │   │   └── index.ts       # 主入口
│   │   ├── test/              # 测试文件
│   │   ├── dist/              # 构建输出
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── gui/                   # C# .NET GUI
│       ├── App.xaml           # 应用程序定义
│       ├── MainWindow.xaml    # 主窗口
│       ├── Models/            # 视图模型
│       ├── Services/          # 服务层
│       └── CodePanion.Gui.csproj
│   └── vscode-extension/      # VS Code 监控源扩展
├── docs/                      # 文档
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── USER_GUIDE.md
│   └── DEVELOPMENT.md
├── .gitignore
├── package.json
└── README.md
```

---

## 开发工作流

### 当前质量门禁

任何涉及 daemon、GUI、扩展或文档的变更，提交前至少运行：

```bash
npm run build
npm run validate:extensions
dotnet build packages/gui/CodePanion.Gui.csproj -c Release
git diff --check
```

涉及通知、编码或 WebView 的变更还必须手动验证：

- 中文通知标题和正文在 daemon 日志、GUI 日志、WebView 中不乱码。
- GUI 在线时同时收到系统通知和 GUI 时间线消息。
- GUI 离线时系统通知仍可触发，失败时日志有明确 warning。
- WebView 断网后仍能加载本地 `chat.html`、`chat.css`、`chat.js` 和 `vendor/codepanion-markdown.js`。
- Markdown 内容必须经过安全渲染，不能执行 `<script>`、`onerror=` 等 HTML。

### 多源监控开发边界

新增监控来源时优先使用 `/sources/register` 和 `/events`，不要直接复用 PTY 会话协议。来源应提供 `kind`、`name`、`windowTitle` 或 `workspace`，GUI 依靠这些字段区分多窗口。

默认禁止系统级 OCR 和全局窗口内容读取。需要更强监控能力时，应先为具体工具实现插件、扩展或外部适配器。

开发时先判断新能力属于哪一层：

- **阶段 1**：是否提升了个人本地控制台的接入质量、可见性、提醒或接管能力。
- **阶段 2**：是否属于工作流模板、任务编排、结果归档或流程复用。
- 不要把多用户、权限、共享空间或企业协作能力引入当前路线。

### 1. 创建功能分支

```bash
git checkout -b feature/your-feature-name
```

### 2. 开发

编写代码，遵循[代码规范](#代码规范)。

### 3. 测试

提交前先运行根目录统一测试命令：

```bash
npm test
```

该命令会先构建 daemon TypeScript，再运行 `packages/daemon/test/*.test.mjs`。如果本次改动涉及协议、会话状态、提示检测、来源事件或 workflow 聚合，应同步补上对应测试后再合并。

### 4. 提交

```bash
git add .
git commit -m "feat: add new feature"
```

**提交消息格式**（遵循 Conventional Commits）：

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建/工具相关

### 5. 推送并创建 PR

```bash
git push origin feature/your-feature-name
```

然后在 GitHub 上创建 Pull Request。

---

## 代码规范

### TypeScript 规范

#### 命名约定

```typescript
// 类名：PascalCase
class SessionManager {}

// 接口：PascalCase，可选 I 前缀
interface Session {}
interface ISessionManager {}

// 函数/变量：camelCase
function startDaemon() {}
const sessionId = 'abc123';

// 常量：UPPER_SNAKE_CASE
const MAX_SESSIONS = 10;
const DEFAULT_PORT = 7777;

// 私有成员：下划线前缀（可选）
class Example {
  private _internalState: string;
}
```

#### 类型注解

```typescript
// 显式类型注解（公共 API）
export function createSession(command: string, args: string[]): Session {
  // ...
}

// 类型推断（内部实现）
const sessions = new Map(); // Map<string, Session> 可推断

// 避免 any，使用 unknown
function handleData(data: unknown) {
  if (typeof data === 'string') {
    // 类型收窄
  }
}
```

#### 异步处理

```typescript
// 使用 async/await
async function startServer(): Promise<void> {
  await initDatabase();
  await startHttpServer();
}

// 错误处理
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error });
  throw new CodePanionError('Failed to ...', ErrorCode.OPERATION_FAILED);
}
```

#### 模块导入

```typescript
// 使用 ES6 模块
import { Session } from './types.js';  // 注意 .js 扩展名（ESM）
import type { Config } from './config.js';  // 类型导入

// 避免循环依赖
// 使用依赖注入或事件系统
```

### 错误处理

```typescript
// 自定义错误类
export class CodePanionError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CodePanionError';
  }
}

// 使用
throw new CodePanionError(
  'Session not found',
  ErrorCode.SESSION_NOT_FOUND,
  { sessionId }
);
```

### 日志记录

```typescript
import { logger } from './logger.js';

// 结构化日志
logger.info('Session started', {
  sessionId,
  command,
  args
});

logger.error('Failed to start session', {
  error,
  sessionId
});

// 日志级别
logger.debug('Detailed debug info');
logger.info('General information');
logger.warn('Warning message');
logger.error('Error message');
```

### 配置管理

```typescript
// 使用 Zod 进行配置验证
import { z } from 'zod';

const ConfigSchema = z.object({
  daemon: z.object({
    port: z.number().min(1024).max(65535),
    host: z.string().ip(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error'])
  }),
  // ...
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return ConfigSchema.parse(raw);  // 自动验证
}
```

---

## 测试

### 当前状态

仓库已经建立根目录统一测试命令：

```bash
npm test
```

当前首方测试覆盖以下核心面：

- `promptDetector`
- `sessionManager`
- `sourceManager`
- `workflowManager`
- 关键 HTTP/WebSocket 协议

仍需继续补齐：

- `codexDesktopAdapter`
- 更完整的 GUI 交互和真实 Windows Alpha 验收记录

### 测试组织方式

仓库使用 Node 内置 `node:test` + `node:assert/strict`，没有 Jest / Mocha / Supertest 依赖。测试文件统一放在每个包的 `test/` 目录下，以 `.test.mjs` 结尾。

```
packages/daemon/test/
├── promptDetector.test.mjs            # 单元：状态机迁移
├── sessionManager.test.mjs            # 单元：retention 裁剪
├── sourceManager.test.mjs             # 单元：事件 / 来源裁剪
├── workflowDefinitionManager.test.mjs # 单元：runWorkflow hooks
├── server.integration.test.mjs        # 集成：真 daemon HTTP/WS 鉴权 + 重连 snapshot
├── codexDesktopAdapter.test.mjs       # 适配器：Codex Desktop 同步
├── aiToolProcessAdapter.test.mjs      # 适配器:Qoder/lingma profile 归属
└── generateCsharpDtos.test.mjs        # 协议契约：C# DTO 与 TS protocol.ts 一致

packages/adapter-sdk/test/
├── adapter.test.mjs                   # SDK 注册 / 事件 / 回复闭环
└── localToolBridge.test.mjs           # bridge classify 规则
```

### 单元测试示例

```javascript
// packages/daemon/test/promptDetector.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PromptDetector } from '../dist/pty/promptDetector.js';

test('PromptDetector 检出 (y/n) 提示', () => {
  const detector = new PromptDetector();
  const result = detector.feed('Continue? (y/n)');
  assert.ok(result, '应返回匹配结果');
  assert.equal(result.type, 'yesno');
  assert.match(result.text, /\(y\/n\)/);
});

test('PromptDetector 处理大缓冲不溢出', () => {
  const detector = new PromptDetector();
  detector.feed('x'.repeat(10_000));
  assert.ok(detector.getBufferSize() < 5_000, '缓冲应被裁剪');
});
```

### 集成测试示例

```javascript
// packages/daemon/test/server.integration.test.mjs（节选）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDaemon } from './helpers/startTestDaemon.mjs';

test('POST /notify 鉴权失败回 401', async (t) => {
  const daemon = await startTestDaemon();
  t.after(() => daemon.stop());

  const res = await fetch(`${daemon.baseUrl}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(res.status, 401);
});
```

集成测试直接启动真 daemon（监听 `127.0.0.1` 随机端口），不使用 supertest。`helpers/startTestDaemon.mjs` 负责注入临时 token 与隔离 `~/.codepanion` 目录。

### Mock 和 Stub

`node:test` 自带 `t.mock`，但 daemon 测试更偏向"用真实组件 + 隔离 IO"。回调 / 钩子接口（如 `WorkflowRunHooks`）允许直接传入闭包断言被调用：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../dist/workflows/workflowDefinitionManager.js';

test('runWorkflow 触发 hooks', async () => {
  const calls = [];
  await runWorkflow({
    workflow: stubDefinition(),
    dryRun: true,
    hooks: {
      onWorkflowStart: () => calls.push('start'),
      onStepFinish: (step) => calls.push(`step:${step.id}`),
      onWorkflowFinish: () => calls.push('finish'),
    },
  });
  assert.deepEqual(calls, ['start', 'step:s1', 'finish']);
});
```

### 运行测试

```bash
npm test                    # 顺序跑 daemon + adapter-sdk + DTO 一致性校验
npm run build               # 编译 daemon + 生成 bundle（daemon test 依赖 dist/）
npm run validate:dtos       # 校验 C# DTO 与 TS protocol.ts 一致
npm run validate:extensions # VS Code 扩展规则校验
dotnet build packages/gui/CodePanion.Gui.csproj -c Release
git diff --check
```

阶段 1 的完整验收边界见 [PHASE1_ACCEPTANCE.md](PHASE1_ACCEPTANCE.md)。

---

## 调试

### VS Code 调试

使用上面配置的 `.vscode/launch.json`，按 F5 启动调试。

### 日志调试

```bash
# 启用 debug 日志
codepanion start --log-level debug

# 查看日志文件
tail -f ~/.codepanion/logs/daemon.log
```

### 网络调试

#### 调试 HTTP API

```bash
# 使用 curl
curl -v http://127.0.0.1:7777/health

# 使用 httpie
http GET http://127.0.0.1:7777/health
```

#### 调试 WebSocket

```bash
# 使用 wscat
npm install -g wscat
wscat -c ws://127.0.0.1:7777

# 发送消息
> {"type":"subscribe"}
```

### PTY 调试

```typescript
// 在 runner.ts 中添加调试日志
pty.onData((data) => {
  logger.debug('PTY output', { data: data.slice(0, 100) });  // 截断长输出
  // ...
});
```

### 性能分析

```bash
# 使用 Node.js 内置 profiler
node --prof packages/daemon/dist/index.js --daemon

# 生成报告
node --prof-process isolate-*.log > profile.txt
```

---

## 贡献指南

### 报告 Bug

在 GitHub Issues 中报告 bug，包含：

1. **环境信息**：
   - 操作系统和版本
   - Node.js 版本
   - CodePanion 版本

2. **复现步骤**：
   - 详细的操作步骤
   - 预期行为
   - 实际行为

3. **日志和错误信息**：
   - 错误堆栈
   - 相关日志

4. **最小复现示例**（如果可能）

### 提交 Pull Request

1. **Fork 项目**

2. **创建功能分支**
   ```bash
   git checkout -b feature/your-feature
   ```

3. **编写代码和测试**

4. **确保质量门禁通过**
   ```bash
   npm test
   npm run build
   npm run validate:extensions
   dotnet build packages/gui/CodePanion.Gui.csproj -c Release
   git diff --check
   ```

5. **提交代码**
   ```bash
   git commit -m "feat: add new feature"
   ```

6. **推送到 Fork**
   ```bash
   git push origin feature/your-feature
   ```

7. **创建 Pull Request**
   - 描述清楚改动内容
   - 关联相关 Issue
   - 等待 Code Review

### Code Review 流程

1. 自动化检查（CI）必须通过
2. 至少一位维护者审核
3. 解决所有评论
4. 合并到 main 分支

---

## 发布流程

### 版本号规则

遵循[语义化版本](https://semver.org/)：

- **主版本号**：不兼容的 API 变更
- **次版本号**：向后兼容的功能添加
- **修订版本号**：向后兼容的问题修复

### 发布步骤

1. **更新版本号**
   ```bash
   npm version patch  # 或 minor, major
   ```

2. **更新 CHANGELOG**
   ```markdown
   ## [0.2.0] - 2026-05-15
   
   ### Added
   - 新功能 A
   - 新功能 B
   
   ### Fixed
   - 修复 bug X
   
   ### Changed
   - 改进 Y
   ```

3. **构建**
   ```bash
   npm run build
   ```

4. **验证**
   ```bash
   npm run build
   npm run validate:extensions
   dotnet build packages/gui/CodePanion.Gui.csproj -c Release
   git diff --check
   ```

5. **提交和打标签**
   ```bash
   git add .
   git commit -m "chore: release v0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```

6. **发布到 npm**
   ```bash
   npm publish
   ```

7. **创建 GitHub Release**
   - 在 GitHub 上创建 Release
   - 附上 CHANGELOG
   - 上传构建产物（如果有）

---

## 常见开发任务

### 添加新的 CLI 命令

1. 在 `src/cli/` 创建新文件，如 `mycommand.ts`：

```typescript
import type { Arguments, CommandBuilder } from 'yargs';

export const command = 'mycommand <arg>';
export const describe = 'Description of my command';

export const builder: CommandBuilder = (yargs) => {
  return yargs.positional('arg', {
    type: 'string',
    describe: 'Argument description'
  });
};

export const handler = async (argv: Arguments) => {
  console.log('Executing mycommand with', argv.arg);
  // 实现逻辑
};
```

2. 在 `src/cli/index.ts` 中注册：

```typescript
import * as mycommand from './mycommand.js';

yargs(hideBin(process.argv))
  .command(mycommand)
  // ... 其他命令
  .parse();
```

### 添加新的提示检测模式

在 `src/pty/promptDetector.ts` 中：

```typescript
const DEFAULT_PATTERNS: PromptPattern[] = [
  // ... 现有模式
  {
    name: 'my-pattern',
    regex: /My custom pattern\?/,
    type: 'yesno',
    extract: (match) => ({
      text: match[0],
      context: extractContext(match)
    })
  }
];
```

### 添加新的 API 端点

在 `src/daemon/server.ts` 中：

```typescript
app.post('/api/myendpoint', async (req, res) => {
  try {
    const { param } = req.body;
    
    // 验证输入
    if (!param) {
      return res.status(400).json({
        error: 'Missing param'
      });
    }
    
    // 处理逻辑
    const result = await doSomething(param);
    
    res.json({ success: true, result });
  } catch (error) {
    logger.error('API error', { error });
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});
```

---

## 资源

### 文档

- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Node.js API 文档](https://nodejs.org/api/)
- [node:test 文档](https://nodejs.org/api/test.html)
- [Express.js 文档](https://expressjs.com/)

### 相关项目

- [node-pty](https://github.com/microsoft/node-pty) - 伪终端库
- [ws](https://github.com/websockets/ws) - WebSocket 库

### 社区

- GitHub Issues: 报告 bug 和功能请求
- GitHub Discussions: 讨论和问答

---

## 许可证

CodePanion 使用 MIT 许可证。贡献代码即表示同意以相同许可证发布。

---

贡献前请先确认当前任务是否符合 [产品定位契约](POSITIONING.md) 和根目录 [开发任务清单](../DEVELOPMENT_TASKS.md)。
