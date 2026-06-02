# 应用图标

[English](icon-README.md) | [简体中文](icon-README.zh-CN.md)

CodePanion 的窗口、任务栏和托盘图标都从一张源图生成，避免手动维护多套尺寸。

## 文件

| 路径 | 用途 |
| ---- | ---- |
| `Assets/app-icon-source.png` | 图标真相来源，任意 PNG，推荐至少 512x512。 |
| `Assets/app-icon.ico` | WPF 窗口 / 任务栏图标，由 `<ApplicationIcon>` 引用，含 16/24/32/48/64/128/256 帧。 |
| `Assets/tray-icon.ico` | 系统托盘图标，由 `MainWindow.xaml.cs` 加载，含 16/24/32/48 帧。 |
| `Assets/app-icon-64.png` | WPF `Window.Icon` 运行时加载。 |
| `Assets/app-icon-256.png` | 安装包、README 和关于对话框使用。 |

## 重新生成

替换 `Assets/app-icon-source.png` 后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-icon.ps1
```

脚本会：

1. 自动 trim 接近纯白的外边距，同时保留圆角矩形容器；
2. 补 4% 内边距，并扩成正方形画布；
3. 使用 `HighQualityBicubic` 缩放到全部目标尺寸；
4. 把多分辨率帧打包成 ICO，每帧使用 32-bit PNG 编码以支持 Vista+。

生成后运行 `npm run gui:build`，验证图标已嵌入。

## 设计约束

- 在 Windows 11 任务栏 / 托盘的 16-32 px 尺寸下主体仍可辨认。
- 保留浅紫白色圆角矩形容器，与产品整体视觉风格一致。
- 不做单色降级，保留 32-bit RGBA。
