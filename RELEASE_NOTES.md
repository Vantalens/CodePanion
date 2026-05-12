# RemindAI v0.2.0 Release Notes

**发布日期**: 2026-05-12  
**版本**: 0.2.0  
**代号**: "对话流"

---

## 🎉 重大更新

RemindAI v0.2.0 是一个重大更新版本，带来了全新的对话流界面、完整的输出捕获功能和智能通知系统。

---

## ✨ 新增功能

### 1. 对话流界面 🎨

全新设计的 GUI 界面，基于 WPF + WebView2 架构：

- **会话列表**: 左侧显示所有活动会话
- **对话区域**: 右侧显示完整的对话历史
- **Markdown 渲染**: 支持标题、代码块、列表、表格等
- **代码高亮**: 使用 highlight.js，支持多种编程语言
- **选项按钮**: 美观的编号按钮，推荐选项高亮显示
- **自定义输入**: 支持自由文本输入，Enter 键快速提交

**界面特点**:
- 深色主题（#1E1E1E 背景）
- 平滑动画效果
- 响应式设计
- 空状态提示

### 2. 完整输出捕获 📝

现在可以查看命令的完整输出历史：

- **fullOutput 数组**: 保存所有输出行
- **outputChunks 结构**: 带时间戳的结构化输出
- **新 API 端点**: `GET /sessions/:id/output`

**使用场景**:
- 查看完整的命令执行过程
- 调试和问题排查
- 导出会话记录

### 3. 智能通知系统 🔔

更智能的通知体验：

- **声音提示**: 需要输入时播放提示音
- **Focus Assist 检测**: 尊重 Windows 免打扰模式
- **前台/后台检测**: 应用在前台时不播放声音
- **系统托盘**: 最小化到托盘，不占用任务栏

**智能逻辑**:
```
如果应用在前台 → 不播放声音（用户已经看到）
如果应用在后台 → 播放声音（提醒用户）
如果 Focus Assist 开启 → 尊重用户设置
```

### 4. 测试套件 🧪

完整的测试体系：

- **功能验证测试**: 8 个测试，100% 通过
- **端到端测试**: 10 个测试，100% 通过
- **自动化脚本**: 一键运行所有测试
- **详细报告**: 测试结果和性能指标

---

## 🔧 改进

### 用户体验
- 更直观的会话管理
- 更清晰的状态指示
- 更流畅的交互体验
- 更美观的界面设计

### 代码质量
- 修复所有编译警告
- 改进错误处理
- 优化性能
- 增强稳定性

### 文档
- 统一项目名称为 RemindAI
- 更新所有文档
- 添加测试指南
- 完善 API 文档

---

## 🐛 修复

- ✅ 修复 C# nullable 引用类型警告
- ✅ 修复测试脚本端口配置问题
- ✅ 修复 WebView2 资源复制问题
- ✅ 修复 Assets 目录配置

---

## 📊 技术指标

| 指标 | 值 |
|------|-----|
| 代码行数 | 3000+ |
| 提交次数 | 11 |
| 测试通过率 | 100% (18/18) |
| 构建警告 | 0 |
| 构建错误 | 0 |
| 文档数量 | 8 |

---

## 🚀 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/Vantalens/RemindAI.git
cd RemindAI

# 安装依赖
npm install

# 构建 daemon
npm run build

# 构建 GUI
dotnet build packages/gui/RemindAI.Gui.csproj
```

### 使用

```bash
# 1. 启动 daemon
node packages/daemon/dist/index.js start

# 2. 启动 GUI
packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe

# 3. 运行命令
node packages/daemon/dist/index.js run -- claude code
```

---

## 📖 文档

- [README.md](README.md) - 项目介绍
- [CHANGELOG.md](CHANGELOG.md) - 完整变更日志
- [USER_GUIDE.md](docs/USER_GUIDE.md) - 用户手册
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) - 开发指南
- [API.md](docs/API.md) - API 文档
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - 架构设计

---

## 🔮 下一步计划

### v0.3.0 (下一个版本)
- 跨平台支持（macOS, Linux）
- 历史记录查看
- 会话导出功能
- 设置界面

### 长期规划
- 插件系统
- 自定义提示检测规则
- 远程会话支持
- 性能优化

---

## ⚠️ 已知限制

1. **图标文件**: 需要手动添加 icon.ico
2. **提示音**: 需要手动添加 WAV 文件（或使用系统默认声音）
3. **平台支持**: 目前仅支持 Windows
4. **GUI 测试**: 需要手动测试（自动化测试仅覆盖后端）

---

## 🙏 致谢

感谢所有使用和支持 RemindAI 的用户！

特别感谢：
- Claude Code 团队 - 提供灵感和参考
- WebView2 团队 - 提供强大的 Web 渲染引擎
- 开源社区 - 提供优秀的工具和库

---

## 📞 反馈

如有问题或建议，请：
- 提交 Issue: https://github.com/Vantalens/RemindAI/issues
- 发送邮件: [your-email]
- 加入讨论: [Discord/Slack 链接]

---

## 📄 许可证

MIT License

---

**享受 RemindAI v0.2.0！** 🎉
