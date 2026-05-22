# CodePanion 安装说明

本文档面向最终用户与需要本地部署 CodePanion 的技术用户，说明 Windows 环境下的安装、启动与基础验证方式。

## 1. 安装方式

CodePanion 当前推荐以 Windows 本地图形软件方式使用。

普通用户优先使用便携版；只有在需要自行构建、调试或二次开发时，才建议使用源码安装。

## 2. 系统要求

### 普通用户

- Windows 10 或 Windows 11 64 位
- WebView2 Runtime
  - Windows 11 通常已内置
  - Windows 10 如未安装，请先安装 Evergreen Runtime

### 开发者 / 源码构建用户

- Node.js 24 或更高版本
- .NET SDK 8.0 或更高版本
- Windows 10 或 Windows 11 64 位

## 3. 便携版安装

### 步骤 1：获取发布产物

获取 `CodePanion-win-x64` 发布目录或压缩包。

### 步骤 2：解压到本地目录

建议解压到普通工作目录，例如：

```text
D:\Apps\CodePanion\
```

### 步骤 3：启动软件

双击运行：

```text
CodePanion.Gui.exe
```

首次启动时，图形界面会自动拉起本地 daemon。正常使用不需要手动打开终端。

## 4. 首次启动验证

成功启动后，应看到以下结果：

- 图形界面正常打开
- 左上区域显示 CodePanion 主界面
- 状态区域由“未连接”切换为“已连接”
- 任务列表、任务工作台和任务详情区域正常渲染

如果需要快速验证通知链路，可在开发者模式下使用 CLI 测试通知；普通用户无需执行任何命令即可开始使用 GUI。

## 5. 源码安装与构建

仅在需要参与开发、调试或本地修改时使用本节。

### 步骤 1：获取源码

```bash
git clone https://github.com/Vantalens/CodePanion.git
cd CodePanion
```

### 步骤 2：安装依赖

```bash
npm install
```

### 步骤 3：构建 daemon

```bash
npm run build
```

### 步骤 4：构建 Windows 便携版

```bash
npm run package:windows
```

构建完成后，从以下路径启动：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

## 6. 开发者运行方式

如果需要直接从源码运行：

```bash
npm run gui:run
```

该命令用于开发调试，不是普通用户推荐入口。

## 7. 升级方式

### 便携版升级

1. 关闭当前运行中的 CodePanion
2. 用新版本替换原有发布目录
3. 重新双击 `CodePanion.Gui.exe`

### 源码版本升级

```bash
git pull
npm install
npm run build
```

如需重新生成便携版：

```bash
npm run package:windows
```

## 8. 卸载方式

### 便携版

关闭 CodePanion 后，删除发布目录即可。

如需同时清理本地配置与缓存，可删除：

```text
%USERPROFILE%\.codepanion\
```

### 源码版本

删除源码目录，并按需清理：

```text
%USERPROFILE%\.codepanion\
```

## 9. 常见安装问题

### 启动后界面空白

优先检查 WebView2 Runtime 是否可用。

### 图形界面无法连接本地 daemon

先完全退出软件后重新启动。若问题持续存在，请参考 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

### 源码构建失败

请确认本机已安装符合要求的 Node.js 与 .NET SDK，并参考 [DEVELOPMENT.md](DEVELOPMENT.md)。
