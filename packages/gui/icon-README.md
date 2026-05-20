# 应用图标

CodePanion 的窗口 / 任务栏 / 托盘图标都从一张源图生成，避免手动维护多套尺寸。

## 文件

| 路径 | 用途 |
| ---- | ---- |
| `Assets/app-icon-source.png` | 图标真相来源，任意 PNG（推荐 ≥ 512×512） |
| `Assets/app-icon.ico` | WPF 窗口 / 任务栏图标（`<ApplicationIcon>` 引用），含 16/24/32/48/64/128/256 |
| `Assets/tray-icon.ico` | 系统托盘图标（`MainWindow.xaml.cs` 加载），仅含 16/24/32/48 |
| `Assets/app-icon-64.png` | WPF 窗口 `Window.Icon` 运行时加载 |
| `Assets/app-icon-256.png` | 安装包 / README / 关于对话框使用 |

## 重新生成

替换 `Assets/app-icon-source.png` 后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-icon.ps1
```

脚本会：
1. 自动 trim 接近纯白的外边距（保留圆角矩形容器本体）
2. 补 4% 内边距、扩成正方形
3. 用 `HighQualityBicubic` 缩到全部目标尺寸
4. 把多分辨率帧打成 ICO（每帧用 32-bit PNG 编码，Vista+ 支持）

生成后跑 `npm run gui:build` 验证图标已嵌入。

## 设计约束

- 在 Windows 11 任务栏 / 托盘的 16~32 px 尺寸下主体仍可辨认
- 保留浅紫白色圆角矩形容器（与产品整体视觉风格一致）
- 不做单色降级；32-bit RGBA 全保留
