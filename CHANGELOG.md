# Changelog

All notable changes to RemindAI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-12

### Added

#### Core Features
- **完整输出捕获**: 实现 `fullOutput` 数组和 `outputChunks` 结构化存储
- **对话流界面**: 基于 WPF + WebView2 的现代化对话界面
- **Markdown 渲染**: 集成 marked.js 和 highlight.js，支持代码高亮
- **智能通知系统**: 声音提示 + Windows Focus Assist 检测
- **会话管理**: 完整的会话列表和状态跟踪

#### GUI Features
- 会话列表（左侧 250px）
- 对话区域（WebView2）
- 选项按钮界面（编号徽章、推荐高亮）
- 自定义输入框（支持 Enter 键提交）
- 空状态显示
- 系统托盘图标
- 连接状态指示器

#### Notification System
- 提示音播放（需要输入时）
- 完成音播放（任务完成时）
- Focus Assist 状态检测
- 前台/后台应用检测
- 智能提示逻辑（避免打扰用户）

#### API Enhancements
- `GET /sessions/:id/output` - 获取会话完整输出
- `fullOutput` 字段 - 完整输出历史
- `outputChunks` 字段 - 结构化输出块

#### Testing & Documentation
- 早期功能验证、端到端和交互式测试材料曾用于阶段性验收；这些旧脚本已在后续清理中移除，当前质量门禁以 `DEVELOPMENT_TASKS.md` 和 `docs/DEVELOPMENT.md` 为准

### Changed
- 项目名称统一为 RemindAI（驼峰命名）
- GUI 从简单界面重构为对话流界面
- Markdown 样式优化（标题、代码块、表格等）
- 选项按钮样式改进（类似 Claude Code）

### Fixed
- C# nullable 引用类型警告（MainWindow.xaml.cs, DaemonClient.cs）
- 测试脚本端口配置（从配置文件动态读取）
- WebView2 资源复制配置
- Assets 目录自动复制

### Documentation
- 统一项目名称为 RemindAI
- 更新所有文档中的项目结构
- 添加图标文件说明（icon-README.md）
- 添加提示音文件说明（Assets/README.md）
- 旧路线阶段性报告已在后续清理中移除，当前状态以 README、产品路线和开发任务清单为准

### Technical Improvements
- 构建状态: 0 个警告，0 个错误
- 测试通过率: 100% (18/18)
- 代码质量提升
- 完整的错误处理

---

## [0.1.0] - 2024-XX-XX

### Added
- 初始版本
- Daemon 守护进程
- 基础 CLI 命令（start, stop, status, run）
- PTY 命令包装
- 提示检测
- HTTP + WebSocket API
- 基础 GUI 界面
- 桌面通知

---

## 版本说明

### 版本号规则
- **主版本号**: 重大架构变更或不兼容的 API 变更
- **次版本号**: 新增功能，向后兼容
- **修订号**: Bug 修复，向后兼容

### 发布周期
- **稳定版**: 每 2-3 个月
- **补丁版**: 根据需要随时发布

---

## 即将推出 (Roadmap)

当前路线以 [产品路线](docs/PRODUCT_ROADMAP.md) 和 [开发任务清单](DEVELOPMENT_TASKS.md) 为准。旧版本号路线不再维护，避免和 Windows Alpha / Beta / GA 路线重复。

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

请参阅 [DEVELOPMENT.md](docs/DEVELOPMENT.md) 了解开发指南。

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
