# Changelog

All notable changes to RemindAI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- GUI 界面完善
- 更多提示检测模式
- 插件系统
- 远程会话支持（SSH）
- 移动端通知

## [0.1.0] - 2026-05-12

### Added
- 初始版本发布
- 守护进程核心功能
  - HTTP REST API
  - WebSocket 实时通信
  - 会话管理
  - PID 文件管理
- CLI 工具
  - `start` - 启动守护进程
  - `stop` - 停止守护进程
  - `status` - 查看状态
  - `run` - 运行命令并监控
  - `notify` - 发送通知
  - `reply` - 发送响应
  - `install` - 安装为系统服务
- PTY (伪终端) 支持
  - 命令包装执行
  - 输入输出捕获
  - TTY 特性保留
- 提示检测系统
  - Yes/No 问题检测 `(y/n)`, `[Y/n]`, `[y/N]`
  - 按键继续检测 `Press Enter to continue`
  - 自定义输入检测 `Enter your name:`
  - 可配置的正则表达式模式
  - 滑动窗口缓冲区
- 通知系统
  - 跨平台桌面通知（Windows/macOS/Linux）
  - 可配置通知声音和超时
  - 通知类型支持（info/warning/error）
- 配置系统
  - JSON 配置文件
  - Zod 模式验证
  - 默认配置生成
- 日志系统
  - 结构化日志（Pino）
  - 多级别日志（debug/info/warn/error）
  - 日志文件持久化
- GUI 框架（C# .NET）
  - 基础项目结构
  - WebSocket 客户端连接

### Documentation
- README.md - 项目概述和快速开始
- ARCHITECTURE.md - 架构设计文档
- API.md - API 参考文档
- USER_GUIDE.md - 用户使用指南
- DEVELOPMENT.md - 开发者指南
- CHANGELOG.md - 版本更新日志

### Technical
- TypeScript 5.7
- Node.js 18+ 支持
- ES Modules (ESM)
- Monorepo 结构（npm workspaces）
- 依赖项：
  - express 5.1.0
  - ws 8.20.0
  - node-pty 1.1.0
  - node-notifier 10.0.1
  - pino 10.3.1
  - yargs 18.0.0
  - zod 4.4.3

[Unreleased]: https://github.com/yourusername/remindai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/remindai/releases/tag/v0.1.0
