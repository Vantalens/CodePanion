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
git clone https://github.com/Vantalens/RemindAI.git
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

#### 4. 全局安装 CLI 工具

```bash
cd packages/daemon
npm link
cd ../..
```

验证安装：
```bash
remindai --version
# 应输出: 0.1.0
```

#### 5. 构建 GUI

```bash
npm run gui:build
```

验证构建：
```bash
ls packages/gui/bin/Debug/net8.0-windows/
# 应看到: RemindAI.Gui.exe, wwwroot/, Assets/ 等
```

#### 6. 配置（可选）

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

### 1. 测试 CLI 命令

```bash
# 查看版本
remindai --version
# 应输出: 0.1.0

# 查看帮助
remindai --help
```

### 2. 测试 Daemon

```bash
# 启动 daemon
remindai start
# 应输出: [remindai] daemon ready (pid=XXXXX)

# 检查状态
remindai status
# 应输出: [remindai] daemon running (pid=XXXXX, port=7777)

# 停止 daemon（稍后测试）
# remindai stop
```

### 3. 测试 GUI

```bash
# 开发环境启动 GUI
npm run gui:run
```

**预期结果**:
- ✅ 窗口打开
- ✅ 显示 "已连接" 状态
- ✅ WebView2 加载成功
- ✅ 左侧显示会话列表（空）
- ✅ 右侧显示欢迎界面

### 4. 测试通知功能

```bash
# 发送测试通知
remindai notify "测试通知" -m "RemindAI 安装成功！"
```

**预期结果**:
- ✅ 系统托盘显示通知
- ✅ GUI 中显示通知记录

### 5. 可选：安装 VS Code 监控扩展

**VS Code 扩展**

1. 在 VS Code 中打开 `packages/vscode-extension/`。
2. 使用开发模式加载扩展。
3. 扩展会读取 `~/.remindai/config.json` 中的 `port` 和 `token`，每个 VS Code 窗口都会注册为独立监控源。

### 6. 测试交互式命令

```bash
# 运行一个需要输入的命令
remindai run -- bash -c 'read -p "请输入你的名字: " name && echo "你好, $name!"'
```

**预期结果**:
1. ✅ GUI 左侧显示新会话
2. ✅ 右侧显示提示消息 "请输入你的名字:"
3. ✅ 可以在输入框中输入并发送
4. ✅ 命令继续执行并显示结果

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

### 方法 1: 双击便携版 EXE（普通用户推荐）

运行打包命令：

```bash
npm run package:windows
```

打开发布目录：

```text
dist/RemindAI-win-x64/
```

双击：

```text
RemindAI.Gui.exe
```

GUI 会自动启动本地 daemon。普通使用不需要手动输入 `remindai start`、`npm run gui:run` 或 `dotnet run`。

### 方法 2: 使用 CLI 命令（开发者）

```bash
# 启动 daemon
remindai start

# 启动 GUI
npm run gui:run
```

### 方法 3: 手动启动（开发者调试）

```bash
# 终端 1: 启动 daemon
node packages/daemon/dist/index.js start

# 终端 2: 启动 GUI
packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe
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

### 问题 1: `remindai` 命令未找到

**症状**: `'remindai' 不是内部或外部命令`

**解决方案**:
```bash
# 进入 daemon 目录
cd packages/daemon

# 全局链接 CLI 工具
npm link

# 验证安装
remindai --version
```

### 问题 2: Daemon 启动失败

**症状**: `daemon not running`

**解决方案**:
1. 检查端口是否被占用：
   ```bash
   netstat -ano | findstr :7777
   ```
2. 修改配置文件中的端口
3. 检查 Node.js 版本：
   ```bash
   node --version  # 应该 >= 18.0.0
   ```

### 问题 3: GUI 无法连接

**症状**: 显示 "未连接" 或 "连接失败"

**解决方案**:
1. 确认 daemon 正在运行：
   ```bash
   remindai status
   ```
2. 检查配置文件 `~/.remindai/config.json` 中的端口和 token
3. 检查防火墙设置（允许 127.0.0.1:7777）

### 问题 4: WebView2 加载失败

**症状**: GUI 显示空白或错误

**解决方案**:
1. 安装 WebView2 Runtime：
   - 访问 https://developer.microsoft.com/microsoft-edge/webview2/
   - 下载并安装 "Evergreen Standalone Installer"
2. 检查 wwwroot 文件是否存在：
   ```bash
   ls packages/gui/bin/Debug/net8.0-windows/wwwroot/
   ```
3. 重新构建 GUI：
   ```bash
   npm run gui:build
   ```

### 问题 5: 提示检测不工作

**症状**: 运行命令后没有提示显示

**解决方案**:
1. 增加 `promptIdleMs` 值（编辑 `~/.remindai/config.json`）：
   ```json
   {
     "promptIdleMs": 1500
   }
   ```
2. 重启 daemon：
   ```bash
   remindai restart
   ```
3. 查看 daemon 日志（检查是否检测到提示）

### 问题 6: npm install 失败

**症状**: Git 权限错误或依赖下载失败

**解决方案**:
1. 确保网络连接正常
2. 清理缓存：
   ```bash
   npm cache clean --force
   rm -rf node_modules
   npm install
   ```
3. 使用国内镜像（可选）：
   ```bash
   npm config set registry https://registry.npmmirror.com
   ```

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
2. 搜索 [Issues](https://github.com/Vantalens/RemindAI/issues)
3. 提交新 Issue
4. 加入社区讨论

---

**祝你使用愉快！** 🎉
