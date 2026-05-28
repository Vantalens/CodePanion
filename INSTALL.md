# CodePanion 安装指南

本指南将帮助你在 Windows 系统上安装和配置 CodePanion。

---

## 📋 系统要求

### 必需
- **操作系统**: Windows 10/11 (64-bit)
- **Node.js**: >= 24.0.0（Windows 便携包当前固定 `node.exe` 为 v24.14.1，并校验 SHA256）
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

访问 [Node.js 官网](https://nodejs.org/) 下载并安装 24.x 版本。Windows 便携包发布脚本会固定校验 v24.14.1 的 `node.exe` 版本与 SHA256。

验证安装：
```bash
node --version
# 应输出: v24.x.x 或更高
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

## 📦 安装 CodePanion

### 方法 1: 从源码安装（推荐）

#### 1. 克隆项目

```bash
git clone https://github.com/Vantalens/CodePanion.git
cd CodePanion
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

#### 4. 全局安装 CLI 工具

```bash
cd packages/daemon
npm link
cd ../..
```

验证安装：
```bash
codepanion --version
# 应输出: 0.1.0
```

#### 5. 构建 GUI

```bash
npm run gui:build
```

验证构建：
```bash
ls packages/gui/bin/Debug/net8.0-windows/
# 应看到: CodePanion.Gui.exe, wwwroot/, Assets/ 等
```

#### 6. 配置（可选）

创建配置文件：
```bash
mkdir -p ~/.codepanion
```

编辑 `~/.codepanion/config.json`：
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

### 方法 2: 使用 Windows 便携版

执行 `npm run package:windows`（参见下方"启动 CodePanion / 方法 1"）后，
`dist/CodePanion-win-x64/` 即是完整便携版：包含固定版本的 `node.exe`、
daemon dist 产物与 GUI 可执行文件，直接拷走整个目录到目标机器即可。

发布脚本会校验 `node.exe` 的 SHA256，hash 不匹配时直接打包失败，
保证用户拿到的运行时与开发环境一致。

---

## ✅ 验证安装

### 1. 测试 CLI 命令

```bash
# 查看版本
codepanion --version
# 应输出: 0.1.0

# 查看帮助
codepanion --help
```

### 2. 测试 Daemon

```bash
# 启动 daemon
codepanion start
# 应输出: [codepanion] daemon ready (pid=XXXXX)

# 检查状态
codepanion status
# 应输出: [codepanion] daemon running (pid=XXXXX, port=7777)

# 停止 daemon（稍后测试）
# codepanion stop
```

### 3. 测试 GUI

```bash
# 开发环境启动 GUI
npm run gui:run
```

**预期结果**:
- ✅ 窗口打开
- ✅ 显示"已连接"状态
- ✅ WebView2 加载成功
- ✅ 左侧显示任务队列（无任务时显示"当前没有可显示的任务"）
- ✅ 主视图显示"暂无任务"占位
- ✅ 顶部计数器显示 0 等待 / 0 运行 / 0 失败

### 4. 测试通知功能

```bash
# 发送测试通知
codepanion notify "测试通知" -m "CodePanion 安装成功！"
```

**预期结果**:
- ✅ 系统托盘显示通知
- ✅ GUI 中显示通知记录

### 5. 测试交互式命令

```bash
# 运行一个需要输入的命令
codepanion run -- bash -c 'read -p "请输入你的名字: " name && echo "你好, $name!"'
```

**预期结果**:
1. ✅ GUI 左侧出现一个任务，状态显示为"等待我"并置顶
2. ✅ 顶部计数器：1 等待
3. ✅ 主视图显示提示"请输入你的名字:"
4. ✅ 底部 omnibar 展开为可输入区，输入文本后回车发送
5. ✅ 命令继续执行，任务状态从"等待我"切换为"运行中"→"完成"

---

## 🔧 配置选项

### Daemon 配置

编辑 `~/.codepanion/config.json`：

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

GUI 配置存储在 `~/.codepanion/gui-settings.json`（自动生成）。

---

## 🎨 资源文件

应用图标已经内置于 `packages/gui/Assets/`，包括 `app-icon.ico`、`tray-icon.ico`
和不同尺寸的 PNG。需要替换图标时：

1. 将新设计的 1024×1024 PNG 放到 `packages/gui/Assets/app-icon-source.png`。
2. 在 PowerShell 中执行 `powershell -ExecutionPolicy Bypass -File scripts\install-icon.ps1`
   （PowerShell 7 用户可直接 `pwsh scripts/install-icon.ps1`），
   脚本会自动裁剪空白、生成多分辨率 ICO 和导出 PNG。
3. 重新构建 GUI。

详细规范见 [packages/gui/icon-README.md](packages/gui/icon-README.md)。

---

## 🚀 启动 CodePanion

### 方法 1: 双击便携版 EXE（普通用户推荐）

运行打包命令：

```bash
npm run package:windows
```

打开发布目录：

```text
dist/CodePanion-win-x64/
```

双击：

```text
CodePanion.Gui.exe
```

GUI 会自动启动本地 daemon。普通使用不需要手动输入 `codepanion start`、`npm run gui:run` 或 `dotnet run`。

### 方法 2: 使用 CLI 命令（开发者）

```bash
# 启动 daemon
codepanion start

# 启动 GUI
npm run gui:run
```

### 方法 3: 手动启动（开发者调试）

```bash
# 终端 1: 启动 daemon
node packages/daemon/dist/index.js start

# 终端 2: 启动 GUI
packages/gui/bin/Debug/net8.0-windows/CodePanion.Gui.exe
```

### 方法 4: 使用脚本

双击运行仓库根目录的 `start.bat`。该脚本用于开发环境，会启动 daemon 并打开 GUI；如果 GUI 已经运行，会跳过重复启动。

### 方法 5: 开机自启动（可选）

1. 按 `Win + R`，输入 `shell:startup`
2. 创建 `start.bat` 的快捷方式
3. 将快捷方式放入启动文件夹

---

## 🧪 测试安装

运行一个内联交互式命令，不需要额外测试脚本：

```bash
# 启动 daemon 和 GUI 后，在新终端运行
node packages/daemon/dist/index.js run -- node -e "const readline=require('readline');const rl=readline.createInterface({input:process.stdin,output:process.stdout});rl.question('Continue? (y/n): ',a=>{console.log('answer:',a);rl.close();});"
```

**预期结果**:
1. GUI 左侧显示新会话
2. 右侧显示提示消息
3. 可以输入回复
4. 命令继续执行

---

## 🐛 故障排查

安装阶段最常见的问题：

- **`codepanion` 命令未找到**：在 `packages/daemon/` 下执行 `npm link`，
  然后用 `codepanion --version` 验证。
- **`npm install` 失败**：先确认网络，再 `npm cache clean --force` 并删除
  `node_modules` 后重试。国内可选择 `npm config set registry https://registry.npmmirror.com`。
- **Node 版本不匹配**：发布脚本固定 `node.exe` v24.14.1。本地开发建议同版本，
  否则可能因原生模块 `node-pty` ABI 不一致导致构建失败。
- **WebView2 缺失**：安装 [Evergreen Standalone Installer](https://developer.microsoft.com/microsoft-edge/webview2/) 后重启 GUI。

运行期问题请先确认当前构建产物与 [README.md](README.md) 中的入口一致。

---

## 📚 下一步

安装完成后，建议：

1. 阅读 [项目概述](README.md)
2. 查看 [API 文档](docs/API.md)
3. 了解 [架构设计](docs/ARCHITECTURE.md)
4. 运行示例命令

---

## 💡 提示

- 首次运行可能需要下载依赖，请耐心等待。
- daemon 只绑定 `127.0.0.1`，**不需要**管理员权限。
- `~/.codepanion/config.json` 由 daemon 在 owner-only 权限下写入，
  替换前先备份。
- 定期更新 WebView2 Runtime 以获得最新渲染修复。

---

## 📞 获取帮助

如遇到问题：
1. 查看 [故障排查](#-故障排查) 部分
2. 搜索 [Issues](https://github.com/Vantalens/CodePanion/issues)
3. 提交新 Issue
4. 加入社区讨论
