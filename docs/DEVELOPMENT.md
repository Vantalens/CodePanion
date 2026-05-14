# RemindAI 开发指南

本文档面向希望参与 RemindAI 开发或基于 RemindAI 进行二次开发的开发者。

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

- **Node.js**: >= 18.0.0
- **.NET SDK**: >= 6.0 (GUI 开发)
- **Git**: 最新版本
- **编辑器**: VS Code (推荐) 或其他

### 克隆项目

```bash
git clone https://github.com/Vantalens/RemindAI.git
cd RemindAI
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
RemindAI/
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
│   │   │   ├── daemon/        # 守护进程核心
│   │   │   │   ├── boot.ts    # 守护进程启动
│   │   │   │   ├── server.ts  # HTTP/WebSocket 服务器
│   │   │   │   ├── sessionManager.ts  # 会话管理
│   │   │   │   ├── notifier.ts        # 通知系统
│   │   │   │   └── pidfile.ts         # PID 文件管理
│   │   │   ├── pty/           # 伪终端管理
│   │   │   │   ├── runner.ts          # PTY 运行器
│   │   │   │   └── promptDetector.ts  # 提示检测
│   │   │   ├── shared/        # 共享模块
│   │   │   │   ├── client.ts  # API 客户端
│   │   │   │   └── types.ts   # 类型定义
│   │   │   ├── config.ts      # 配置管理
│   │   │   ├── logger.ts      # 日志系统
│   │   │   └── index.ts       # 主入口
│   │   ├── test/              # 测试文件
│   │   ├── dist/              # 构建输出
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── gui/                   # C# .NET GUI
│       ├── App.xaml           # 应用程序定义
│       ├── MainWindow.xaml    # 主窗口
│       ├── ViewModels/        # MVVM 视图模型
│       ├── Services/          # 服务层
│       └── RemindAI.Gui.csproj
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
dotnet build packages/gui/RemindAI.Gui.csproj -c Release
git diff --check
```

涉及通知、编码或 WebView 的变更还必须手动验证：

- 中文通知标题和正文在 daemon 日志、GUI 日志、WebView 中不乱码。
- GUI 在线时同时收到系统通知和 GUI 时间线消息。
- GUI 离线时系统通知仍可触发，失败时日志有明确 warning。
- WebView 断网后仍能加载本地 `chat.html`、`chat.css`、`chat.js` 和 `vendor/remindai-markdown.js`。
- Markdown 内容必须经过安全渲染，不能执行 `<script>`、`onerror=` 等 HTML。

### 多源监控开发边界

新增监控来源时优先使用 `/sources/register` 和 `/events`，不要直接复用 PTY 会话协议。来源应提供 `kind`、`name`、`windowTitle` 或 `workspace`，GUI 依靠这些字段区分多窗口。

默认禁止系统级 OCR、全局窗口内容读取或无 allowlist 的浏览器全文采集。需要更强监控能力时，应先为具体工具实现插件、扩展或外部适配器。

### 1. 创建功能分支

```bash
git checkout -b feature/your-feature-name
```

### 2. 开发

编写代码，遵循[代码规范](#代码规范)。

### 3. 测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- promptDetector.test.ts

# 运行测试并生成覆盖率报告
npm run test:coverage
```

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
  throw new RemindAIError('Failed to ...', ErrorCode.OPERATION_FAILED);
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
export class RemindAIError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = 'RemindAIError';
  }
}

// 使用
throw new RemindAIError(
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

### 测试框架

使用 **Jest** 进行单元测试和集成测试。

### 测试文件组织

```
packages/daemon/
├── src/
│   ├── pty/
│   │   ├── promptDetector.ts
│   │   └── promptDetector.test.ts  # 测试文件与源文件同目录
│   └── daemon/
│       ├── sessionManager.ts
│       └── sessionManager.test.ts
└── test/
    ├── integration/               # 集成测试
    │   └── api.test.ts
    └── fixtures/                  # 测试数据
        └── sample-output.txt
```

### 单元测试示例

```typescript
// promptDetector.test.ts
import { PromptDetector } from './promptDetector.js';

describe('PromptDetector', () => {
  let detector: PromptDetector;

  beforeEach(() => {
    detector = new PromptDetector();
  });

  describe('yesno pattern', () => {
    it('should detect (y/n) pattern', () => {
      const result = detector.feed('Continue? (y/n)');
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('yesno');
      expect(result?.text).toContain('(y/n)');
    });

    it('should detect [Y/n] pattern', () => {
      const result = detector.feed('Proceed? [Y/n]');
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('yesno');
    });

    it('should not detect false positives', () => {
      const result = detector.feed('This is just text');
      
      expect(result).toBeNull();
    });
  });

  describe('buffer management', () => {
    it('should handle large output', () => {
      const largeText = 'x'.repeat(10000);
      detector.feed(largeText);
      
      // 应该不会内存溢出
      expect(detector.getBufferSize()).toBeLessThan(5000);
    });
  });
});
```

### 集成测试示例

```typescript
// api.test.ts
import request from 'supertest';
import { createServer } from '../src/daemon/server.js';

describe('API Integration', () => {
  let server: any;

  beforeAll(async () => {
    server = await createServer({ port: 0 });  // 随机端口
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /notify', () => {
    it('should send notification', async () => {
      const response = await request(server)
        .post('/notify')
        .send({ message: 'Test notification' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.notificationId).toBeDefined();
    });

    it('should validate request body', async () => {
      await request(server)
        .post('/notify')
        .send({})  // 缺少 message
        .expect(400);
    });
  });
});
```

### Mock 和 Stub

```typescript
// 使用 Jest mock
jest.mock('node-notifier', () => ({
  notify: jest.fn()
}));

import notifier from 'node-notifier';

test('should send notification', async () => {
  await sendNotification('Test');
  
  expect(notifier.notify).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Test'
    })
  );
});
```

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式
npm test -- --watch

# 覆盖率报告
npm run test:coverage

# 运行特定测试文件
npm test -- promptDetector.test.ts

# 运行特定测试用例
npm test -- -t "should detect yesno pattern"
```

---

## 调试

### VS Code 调试

使用上面配置的 `.vscode/launch.json`，按 F5 启动调试。

### 日志调试

```bash
# 启用 debug 日志
remindai start --log-level debug

# 查看日志文件
tail -f ~/.remindai/logs/daemon.log
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
   - RemindAI 版本

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

4. **确保测试通过**
   ```bash
   npm test
   npm run lint
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

4. **测试**
   ```bash
   npm test
   npm run test:e2e
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
- [Jest 测试框架](https://jestjs.io/)
- [Express.js 文档](https://expressjs.com/)

### 相关项目

- [node-pty](https://github.com/microsoft/node-pty) - 伪终端库
- [node-notifier](https://github.com/mikaelbr/node-notifier) - 跨平台通知
- [ws](https://github.com/websockets/ws) - WebSocket 库

### 社区

- GitHub Issues: 报告 bug 和功能请求
- GitHub Discussions: 讨论和问答

---

## 许可证

RemindAI 使用 MIT 许可证。贡献代码即表示同意以相同许可证发布。

---

感谢你对 RemindAI 的贡献！🎉
