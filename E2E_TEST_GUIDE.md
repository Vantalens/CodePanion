# RemindAI 端到端测试指南

本文档提供 RemindAI 的端到端测试步骤。

## 前置条件

- ✅ Daemon 已构建
- ✅ GUI 已构建
- ✅ WebView2 Runtime 已安装

## 测试步骤

### 步骤 1: 启动 Daemon

```bash
# 启动 daemon
node packages/daemon/dist/index.js start

# 验证状态
node packages/daemon/dist/index.js status
# 预期输出: [remindai] daemon running (pid=XXXXX, port=7777)
```

### 步骤 2: 启动 GUI

```bash
# 方法 1: 直接运行
packages/gui/bin/Debug/net8.0-windows/RemindAI.Gui.exe

# 方法 2: 使用 dotnet
dotnet run --project packages/gui/RemindAI.Gui.csproj
```

**预期结果**:
- ✅ GUI 窗口打开
- ✅ 顶部显示 "已连接" 状态（绿色指示灯）
- ✅ 左侧显示 "会话列表 (0)"
- ✅ 右侧显示空状态界面（💬 等待会话）

### 步骤 3: 测试简单命令

在新的终端窗口中运行：

```bash
# 测试 1: 简单的 echo 命令
node packages/daemon/dist/index.js run -- echo "Hello RemindAI"

# 预期: 命令立即完成，无提示
```

### 步骤 4: 测试交互式命令

```bash
# 测试 2: 需要确认的命令（模拟）
node packages/daemon/dist/index.js run -- node -e "const readline = require('readline'); const rl = readline.createInterface({input: process.stdin, output: process.stdout}); rl.question('Continue? (y/n): ', (answer) => { console.log('You answered:', answer); rl.close(); });"
```

**预期结果**:
1. ✅ GUI 左侧会话列表显示新会话
2. ✅ 右侧显示提示消息
3. ✅ 显示选项按钮（如果检测到）
4. ✅ 显示自定义输入框
5. ✅ 播放提示音（如果 GUI 不在前台）

### 步骤 5: 测试用户回复

在 GUI 中：
1. 在自定义输入框中输入 `y`
2. 按 Enter 键

**预期结果**:
- ✅ 输入发送到命令
- ✅ 命令继续执行
- ✅ 会话状态更新

### 步骤 6: 测试 Markdown 渲染

创建测试脚本：

```bash
# test-markdown.js
console.log(`
# 测试标题

这是一段**粗体**文本和*斜体*文本。

## 代码示例

\`\`\`javascript
function hello() {
  console.log("Hello World");
}
\`\`\`

- 列表项 1
- 列表项 2
- 列表项 3

Continue? (y/n):
`);

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('', (answer) => {
  console.log('Done!');
  rl.close();
});
```

运行：
```bash
node packages/daemon/dist/index.js run -- node test-markdown.js
```

**预期结果**:
- ✅ Markdown 正确渲染
- ✅ 代码高亮显示
- ✅ 列表格式正确

### 步骤 7: 测试多会话

在多个终端窗口中同时运行命令：

```bash
# 终端 1
node packages/daemon/dist/index.js run -- node test-markdown.js

# 终端 2
node packages/daemon/dist/index.js run -- node test-markdown.js
```

**预期结果**:
- ✅ 左侧显示多个会话
- ✅ 可以切换会话
- ✅ 每个会话独立显示

### 步骤 8: 清理

```bash
# 停止 daemon
node packages/daemon/dist/index.js stop

# 关闭 GUI
# 点击托盘图标 → 退出
```

## 测试检查清单

### 基础功能
- [ ] Daemon 启动成功
- [ ] GUI 启动成功
- [ ] WebView2 加载成功
- [ ] 连接状态显示正确

### 会话管理
- [ ] 新会话自动注册
- [ ] 会话列表显示正确
- [ ] 会话切换正常
- [ ] 会话状态更新

### 提示检测
- [ ] 检测到用户输入请求
- [ ] 提示消息显示在 GUI
- [ ] 完整输出捕获
- [ ] 选项按钮生成

### 用户交互
- [ ] 选项按钮可点击
- [ ] 自定义输入可用
- [ ] Enter 键提交
- [ ] 回复发送到命令

### Markdown 渲染
- [ ] 标题渲染
- [ ] 粗体/斜体
- [ ] 代码块高亮
- [ ] 列表格式
- [ ] 链接可点击

### 通知系统
- [ ] 提示音播放（后台时）
- [ ] 不打扰前台用户
- [ ] Focus Assist 检测

### 错误处理
- [ ] Daemon 断开重连
- [ ] WebView2 加载失败提示
- [ ] 命令执行错误显示

## 已知限制

1. **提示检测准确性**: 依赖正则表达式，可能有误判
2. **提示音文件**: 需要手动添加 WAV 文件
3. **Focus Assist**: 检测可能不完全准确
4. **图标**: 托盘图标暂时缺失

## 故障排查

### GUI 无法连接到 Daemon
- 检查 daemon 是否运行: `node packages/daemon/dist/index.js status`
- 检查端口配置: `~/.remindai/config.json`
- 检查防火墙设置

### WebView2 加载失败
- 确认已安装 WebView2 Runtime
- 检查 wwwroot 文件是否复制到输出目录
- 查看 Debug 输出

### 提示检测不工作
- 检查 `promptIdleMs` 配置（默认 800ms）
- 查看 daemon 日志
- 尝试增加等待时间

## 测试报告模板

```markdown
## 测试结果

**日期**: YYYY-MM-DD
**测试人员**: 
**版本**: v0.2.0

### 通过的测试
- [ ] 项目 1
- [ ] 项目 2

### 失败的测试
- [ ] 项目 1 - 原因

### 发现的问题
1. 问题描述
2. 重现步骤
3. 预期 vs 实际

### 建议
- 建议 1
- 建议 2
```
