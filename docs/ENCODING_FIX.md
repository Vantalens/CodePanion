# 中文编码问题修复说明

## 问题描述

RemindAI 在显示中文时出现乱码，主要原因是：

1. **C# 文件读写默认编码**：Windows 上 `File.ReadAllText` 和 `File.AppendAllText` 默认使用系统编码（GBK），而不是 UTF-8
2. **HTTP 响应头缺失**：Node.js daemon 没有明确指定 UTF-8 编码
3. **JSON 序列化设置**：C# 的 JSON 序列化可能转义 Unicode 字符

## 修复内容

### 1. C# GUI 编码修复

#### MainWindow.xaml.cs
- 添加 `using System.Text;`
- 修改日志写入：`File.AppendAllText(logPath, logMessage + Environment.NewLine, Encoding.UTF8)`

#### DaemonClient.cs
- 修改配置读取：`File.ReadAllText(configPath, Encoding.UTF8)`
- 修改日志写入：`File.AppendAllText(logPath, logMessage + Environment.NewLine, Encoding.UTF8)`

#### JSON 序列化设置
已在 `SendMessageToWeb` 方法中使用：
```csharp
var settings = new JsonSerializerSettings
{
    StringEscapeHandling = StringEscapeHandling.Default
};
var json = JsonConvert.SerializeObject(message, settings);
```

### 2. Node.js Daemon 编码修复

#### server.ts
添加全局 UTF-8 响应头：
```typescript
app.use((_req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});
```

### 3. HTML/JavaScript 编码设置

#### chat.html
已包含正确的编码声明：
```html
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
```

#### chat.js
- 使用 `String()` 确保内容是字符串类型
- Marked.js 配置中设置 `mangle: false` 防止字符被编码

## 验证步骤

### 1. 重新构建项目

```bash
# 构建 daemon
cd packages/daemon
npm run build

# 构建 GUI
cd ../gui
dotnet build
```

### 2. 重启服务

```bash
# 停止旧的 daemon
remindai stop

# 启动新的 daemon
remindai start

# 运行 GUI
npm run gui:run
```

### 3. 运行编码测试

```bash
node test-encoding.js
```

测试脚本会：
- 检查 daemon 是否运行
- 发送包含中文的测试通知
- 验证响应是否正确

### 4. 手动测试

```bash
# 发送中文通知
remindai notify "测试通知" -m "这是一条中文消息"

# 运行包含中文输出的命令
remindai run -- echo "你好世界"
```

## 常见问题

### Q: 重新构建后仍然乱码？

A: 确保：
1. 完全关闭旧的 GUI 进程
2. 重启 daemon：`remindai restart`
3. 清除浏览器缓存（WebView2 缓存）
4. 检查 Windows 系统区域设置

### Q: 日志文件中的中文乱码？

A: 使用支持 UTF-8 的文本编辑器打开日志文件：
- VS Code（默认 UTF-8）
- Notepad++（设置编码为 UTF-8）
- 避免使用 Windows 记事本（默认 ANSI）

### Q: 终端中的中文乱码？

A: 设置终端编码：
```bash
# PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# CMD
chcp 65001
```

### Q: WebView2 中的中文乱码？

A: 检查：
1. HTML 文件的 `<meta charset="UTF-8">` 是否存在
2. HTTP 响应头是否包含 `charset=utf-8`
3. JavaScript 中是否正确处理字符串

## 技术细节

### Windows 编码问题

Windows 系统默认使用以下编码：
- **系统编码**：GBK/GB2312（中文 Windows）
- **控制台编码**：CP936（代码页 936）
- **文件系统**：NTFS 支持 Unicode，但 API 默认使用系统编码

### .NET 编码处理

.NET 的文件 I/O 方法：
- `File.ReadAllText(path)`：使用系统默认编码
- `File.ReadAllText(path, Encoding.UTF8)`：明确使用 UTF-8
- `File.WriteAllText(path, content, Encoding.UTF8)`：明确使用 UTF-8

### Node.js 编码处理

Node.js 默认使用 UTF-8：
- `fs.readFileSync(path, 'utf8')`：UTF-8 编码
- `Buffer.from(str, 'utf8')`：UTF-8 编码
- HTTP 响应需要明确设置 `Content-Type: application/json; charset=utf-8`

### JSON 编码

JSON 标准（RFC 8259）要求：
- 默认编码为 UTF-8
- 可以使用 `\uXXXX` 转义 Unicode 字符
- 但不应该转义非 ASCII 字符（除非必要）

## 相关文件

修改的文件：
- `packages/gui/MainWindow.xaml.cs`
- `packages/gui/Services/DaemonClient.cs`
- `packages/daemon/src/daemon/server.ts`

测试文件：
- `test-encoding.js`

文档：
- `docs/ENCODING_FIX.md`（本文件）

## 参考资料

- [.NET Encoding Class](https://docs.microsoft.com/en-us/dotnet/api/system.text.encoding)
- [Node.js Buffer and Character Encodings](https://nodejs.org/api/buffer.html#buffer_buffers_and_character_encodings)
- [RFC 8259 - JSON Specification](https://tools.ietf.org/html/rfc8259)
- [WebView2 Character Encoding](https://docs.microsoft.com/en-us/microsoft-edge/webview2/)

