# 图标文件说明

本目录应包含 RemindAI 的图标文件。

## 所需文件

- `icon.ico` - 应用程序图标（用于窗口和托盘）

## 图标规格

### icon.ico
- **格式**: ICO (Windows Icon)
- **尺寸**: 多尺寸（推荐包含 16x16, 32x32, 48x48, 256x256）
- **颜色深度**: 32-bit (带透明通道)
- **用途**: 
  - 应用程序窗口图标
  - 系统托盘图标
  - 任务栏图标

## 创建图标

### 方法 1: 使用在线工具
1. 访问 https://www.icoconverter.com/
2. 上传 PNG 图片（推荐 256x256）
3. 选择多尺寸输出
4. 下载 ICO 文件

### 方法 2: 使用 GIMP
1. 打开 GIMP
2. 创建或导入图片
3. 文件 → 导出为 → 选择 .ico 格式
4. 选择多个尺寸

### 方法 3: 使用 ImageMagick
```bash
# 从 PNG 转换为 ICO
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

## 设计建议

RemindAI 的图标应该：
- 简洁明了，易于识别
- 在小尺寸下清晰可见
- 使用品牌色彩（蓝色 #0066cc）
- 可能的设计元素：
  - 对话气泡 💬
  - 提醒铃铛 🔔
  - AI 符号 🤖
  - 组合设计

## 临时方案

如果图标文件不存在：
- 托盘图标将不显示（但功能正常）
- 窗口将使用默认图标

## 文件位置

将 `icon.ico` 放在此目录后：
1. 取消注释 `RemindAI.Gui.csproj` 中的 `<ApplicationIcon>` 配置
2. 取消注释 `MainWindow.xaml` 中的 `IconSource` 属性
3. 重新构建项目
