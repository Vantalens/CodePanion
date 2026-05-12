# RemindAI 安装指南

本指南将帮助你在 Windows 系统上安装和配置 RemindAI。

---

## 📋 系统要求

### 必需
- **操作系统**: Windows 10/11 (64-bit)
- **Node.js**: >= 18.0.0
- **.NET SDK**: >= 8.0
- **WebView2 Runtime**: 最新版本

### 推荐
- **内存**: >= 4GB RAM
- **磁盘空间**: >= 500MB
- **网络**: 用于下载依赖

---

## 🚀 快速安装

### 步骤 1: 安装前置软件

#### 1.1 安装 Node.js

访问 [Node.js 官网](https://nodejs.org/) 下载并安装 LTS 版本。

验证安装：
```bash
node --version
# 应输出: v18.x.x 或更高
```

#### 1.2 安装 .NET SDK

访问 [.NET 官网](https://dotnet.microsoft.com/download) 下载并安装 .NET 8.0 SDK。

验证安装：
```bash
dotnet --version
# 应输出: 8.0.x 或更高
```

#### 1.3 安装 WebView2 Runtime

**方法 1: 自动安装**（推荐）
- Windows 11 已预装
- Windows 10 会在首次运行 GUI 时自动下载

**方法 2: 手动安装**
1. 访问 [WebView2 下载页面](https://developer.microsoft.com/microsoft-edge/webview2/)
2. 下载 "Evergreen Standalone Installer"
3. 运行安装程序

验证安装：
```powershell
# 检查注册表
Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv
```

---

## 📦 安装 RemindAI

### 方法 1: 从源码安装（推荐）

#### 1. 克隆项目

```bash
git clone https://github.com/yourusername/RemindAI.git
cd RemindAI
```

#### 2. 安装依赖

```bash
npm install
```

#### 3. 构建 Daemon

```bash
npm run build
```

验证构建：
```bash
ls packages/daemon/dist/
# 应看到: cli/, daemon/, pty/, shared/, index.js 等
```

#### 4. 构建 GUI

```bash
dotnet build packages/gui/RemindAI.Gui.csproj
```

验证构建：
```bash
ls packages/gui/bin/Debug/net8.0-windows/
# 应看到: RemindAI.Gui.dll, wwwroot/, Assets/ 等
```

#### 5. 配置（可选）

创建配置文件：
```bash
mkdir -p ~/.remindai
```

编辑 `~/.remindai/config.json`：
```json
{
  "port": 7777,
  "token": "your-secure-token-here",
  "promptIdleMs": 800,
  "toast": {
    "enabled": true,
    "soundOnPrompt": true,
    "soundOnDone": true
  },
  "templates": [
    {
      "label": "继续",
      "text": "继续\n"
    },
    {
      "label": "全部接受",
      "text": "1\n"
    },
    {
      "label": "取消",
      "text": "no\n"
    }
  ]
}
```

**注意**: 如果不创建配置文件，daemon 会在首次启动时自动生成。

---

### 方法 2: 使用预编译版本（即将推出）

```bash
# 下载发布包
# 解压到目标目录
# 运行安装脚本
```

---

## ✅ 验证安装

### 1. 测试 Daemon

```bash
# 启动 daemon
node packages/daemon/dist/index.js start

# 检查状态
node packages/daemon/dist/index.js status
# 应输出: [remindai] daemon running (pid=XXXXX, port=7777)

# 停止 daemon
node packages/daemon/dist/index.js stop
```

### 2. 测试 GUI

```bash
# 启动 GUI
packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe
```

**预期结果**:
- ✅ 窗口打开
- ✅ 显示 "已连接" 状态
- ✅ WebView2 加载成功
- ✅ 显示空状态界面

### 3. 运行测试

```bash
# 运行验证测试
bash test-validation.sh

# 运行 E2E 测试
bash test-e2e.sh
```

---

## 🔧 配置选项

### Daemon 配置

编辑 `~/.remindai/config.json`：

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 7777 | HTTP/WebSocket 端口 |
| `token` | string | 随机生成 | API 认证 token |
| `promptIdleMs` | number | 800 | 提示检测等待时间（毫秒） |
| `toast.enabled` | boolean | true | 启用桌面通知 |
| `toast.soundOnPrompt` | boolean | true | 提示时播放声音 |
| `toast.soundOnDone` | boolean | true | 完成时播放声音 |
| `templates` | array | [] | 快捷回复模板 |

### GUI 配置

GUI 配置存储在 `~/.remindai/gui-settings.json`（自动生成）。

---

## 🎨 可选：添加资源文件

### 添加应用图标

1. 创建或下载 `icon.ico` 文件
2. 放置到 `packages/gui/` 目录
3. 取消注释 `RemindAI.Gui.csproj` 中的：
   ```xml
   <ApplicationIcon>icon.ico</ApplicationIcon>
   ```
4. 取消注释 `MainWindow.xaml` 中的：
   ```xml
   IconSource="icon.ico"
   ```
5. 重新构建 GUI

### 添加提示音

1. 创建或下载 WAV 文件：
   - `prompt.wav` - 提示音
   - `done.wav` - 完成音
2. 放置到 `packages/gui/Assets/` 目录
3. 重新构建 GUI

**提示**: 如果不添加，程序会使用系统默认 Beep 声音。

---

## 🚀 启动 RemindAI

### 方法 1: 手动启动

```bash
# 终端 1: 启动 daemon
node packages/daemon/dist/index.js start

# 终端 2: 启动 GUI
packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe
```

### 方法 2: 使用脚本（推荐）

创建 `start.bat`：
```batch
@echo off
echo Starting RemindAI...

REM 启动 daemon
start /B node packages/daemon/dist/index.js start

REM 等待 daemon 启动
timeout /t 2 /nobreak >nul

REM 启动 GUI
start packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe

echo RemindAI started!
```

双击运行 `start.bat`。

### 方法 3: 开机自启动（可选）

1. 按 `Win + R`，输入 `shell:startup`
2. 创建 `start.bat` 的快捷方式
3. 将快捷方式放入启动文件夹

---

## 🧪 测试安装

运行交互式测试：

```bash
# 启动 daemon 和 GUI

# 在新终端运行测试命令
node packages/daemon/dist/index.js run -- node test-interactive.js
```

**预期结果**:
1. GUI 左侧显示新会话
2. 右侧显示提示消息
3. 可以输入回复
4. 命令继续执行

---

## 🐛 故障排查

### 问题 1: Daemon 启动失败

**症状**: `daemon not running`

**解决方案**:
1. 检查端口是否被占用：
   ```bash
   netstat -ano | findstr :7777
   ```
2. 修改配置文件中的端口
3. 检查 Node.js 版本

### 问题 2: GUI 无法连接

**症状**: 显示 "未连接"

**解决方案**:
1. 确认 daemon 正在运行
2. 检查防火墙设置
3. 验证端口和 token 配置

### 问题 3: WebView2 加载失败

**症状**: GUI 显示空白或错误

**解决方案**:
1. 安装 WebView2 Runtime
2. 检查 wwwroot 文件是否存在
3. 查看 Debug 输出

### 问题 4: 提示检测不工作

**症状**: 没有提示显示

**解决方案**:
1. 增加 `promptIdleMs` 值（如 1500）
2. 检查命令输出格式
3. 查看 daemon 日志

---

## 📚 下一步

安装完成后，建议：

1. 阅读 [用户手册](docs/USER_GUIDE.md)
2. 查看 [API 文档](docs/API.md)
3. 了解 [架构设计](docs/ARCHITECTURE.md)
4. 运行示例命令

---

## 💡 提示

- 首次运行可能需要下载依赖，请耐心等待
- 建议使用管理员权限运行（避免权限问题）
- 定期更新 WebView2 Runtime
- 备份配置文件

---

## 📞 获取帮助

如遇到问题：
1. 查看 [故障排查](#-故障排查) 部分
2. 搜索 [Issues](https://github.com/yourusername/RemindAI/issues)
3. 提交新 Issue
4. 加入社区讨论

---

**祝你使用愉快！** 🎉
