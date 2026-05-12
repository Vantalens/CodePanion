# RemindAI 发布资源清单

本文档列出了发布 RemindAI 所需的所有资源文件。

---

## 📦 必需文件

### 1. 代码和构建产物
- ✅ `packages/daemon/dist/` - Daemon 构建产物
- ✅ `packages/gui/bin/Debug/net8.0-windows/` - GUI 构建产物
- ✅ `packages/gui/wwwroot/` - WebView2 资源
- ✅ `node_modules/` - Node.js 依赖（或使用 npm install）

### 2. 文档
- ✅ `README.md` - 项目介绍
- ✅ `CHANGELOG.md` - 变更日志
- ✅ `RELEASE_NOTES.md` - 发布说明
- ✅ `INSTALL.md` - 安装指南
- ✅ `LICENSE` - MIT 许可证
- ✅ `docs/` - 完整文档目录

### 3. 脚本
- ✅ `start.bat` - 启动脚本
- ✅ `stop.bat` - 停止脚本
- ✅ `test-validation.sh` - 验证测试
- ✅ `test-e2e.sh` - E2E 测试

---

## 🎨 可选资源（需要创建）

### 1. 图标文件
- ⏳ `packages/gui/icon.ico` - 应用图标
  - **规格**: 多尺寸 ICO (16x16, 32x32, 48x48, 256x256)
  - **用途**: 窗口图标、托盘图标、任务栏图标
  - **创建工具**: 
    - 在线: https://www.icoconverter.com/
    - 本地: GIMP, ImageMagick
  - **设计建议**: 简洁、蓝色主题、对话气泡或铃铛元素

### 2. 提示音文件
- ⏳ `packages/gui/Assets/prompt.wav` - 提示音
  - **规格**: WAV 格式，单声道，16-bit，44.1kHz
  - **时长**: 0.2-0.5 秒
  - **音调**: 800Hz（短促的"叮"声）
  
- ⏳ `packages/gui/Assets/done.wav` - 完成音
  - **规格**: WAV 格式，单声道，16-bit，44.1kHz
  - **时长**: 0.3-0.6 秒
  - **音调**: 400Hz（柔和的"咚"声）

**创建方法**:
- 在线工具: https://www.soundjay.com/beep-sounds-1.html
- Audacity: 生成 → 音调 → 导出为 WAV
- 如果不提供，程序会使用系统默认 Beep 声音

### 3. 截图和演示
- ⏳ `docs/screenshots/` - 应用截图
  - `main-window.png` - 主窗口
  - `session-list.png` - 会话列表
  - `chat-view.png` - 对话界面
  - `markdown-render.png` - Markdown 渲染
  - `options-buttons.png` - 选项按钮
  - `tray-icon.png` - 托盘图标

- ⏳ `docs/demo.gif` - 功能演示 GIF
  - **内容**: 完整的使用流程
  - **时长**: 10-30 秒
  - **工具**: ScreenToGif, LICEcap

- ⏳ `docs/demo-video.mp4` - 演示视频（可选）
  - **内容**: 详细的功能介绍
  - **时长**: 2-5 分钟
  - **平台**: YouTube, Bilibili

---

## 📋 发布检查清单

### 代码准备
- [x] 所有代码已提交
- [x] 构建无警告无错误
- [x] 测试全部通过
- [x] 版本号已更新

### 文档准备
- [x] README.md 完整
- [x] CHANGELOG.md 更新
- [x] RELEASE_NOTES.md 创建
- [x] INSTALL.md 创建
- [x] LICENSE 文件存在
- [x] API 文档完整

### 资源准备
- [ ] 应用图标（icon.ico）
- [ ] 提示音文件（prompt.wav, done.wav）
- [ ] 应用截图
- [ ] 演示 GIF/视频

### 测试验证
- [x] 功能验证测试通过
- [x] E2E 测试通过
- [ ] 手动 GUI 测试
- [ ] 在干净环境中测试安装

### 发布准备
- [ ] 创建 GitHub Release
- [ ] 上传构建产物
- [ ] 发布公告
- [ ] 更新项目主页

---

## 🚀 发布流程

### 1. 准备发布包

```bash
# 清理构建
npm run clean
dotnet clean

# 重新构建
npm run build
dotnet build packages/gui/RemindAI.Gui.csproj --configuration Release

# 运行测试
bash test-validation.sh
bash test-e2e.sh
```

### 2. 创建发布包

```bash
# 创建发布目录
mkdir -p release/RemindAI-v0.2.0

# 复制文件
cp -r packages/daemon/dist release/RemindAI-v0.2.0/daemon
cp -r packages/gui/bin/Release/net8.0-windows release/RemindAI-v0.2.0/gui
cp README.md CHANGELOG.md RELEASE_NOTES.md INSTALL.md LICENSE release/RemindAI-v0.2.0/
cp start.bat stop.bat release/RemindAI-v0.2.0/

# 打包
cd release
zip -r RemindAI-v0.2.0-windows-x64.zip RemindAI-v0.2.0/
```

### 3. 创建 GitHub Release

1. 访问 GitHub 仓库
2. 点击 "Releases" → "Create a new release"
3. 标签: `v0.2.0`
4. 标题: `RemindAI v0.2.0 - 对话流`
5. 描述: 复制 `RELEASE_NOTES.md` 内容
6. 上传: `RemindAI-v0.2.0-windows-x64.zip`
7. 发布

### 4. 发布公告

- GitHub Discussions
- 项目主页
- 社交媒体
- 相关社区

---

## 📊 发布后任务

- [ ] 监控 Issues
- [ ] 收集用户反馈
- [ ] 更新文档（根据反馈）
- [ ] 规划下一版本

---

## 💡 提示

- 在发布前在干净的 Windows 环境中测试安装
- 确保所有依赖都已正确打包
- 提供清晰的安装和使用说明
- 准备好回答常见问题

---

**当前状态**: 代码和文档已准备就绪，等待资源文件（图标、截图）
