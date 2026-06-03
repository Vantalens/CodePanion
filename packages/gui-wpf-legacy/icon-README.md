# Application Icons

[English](icon-README.md) | [简体中文](icon-README.zh-CN.md)

CodePanion window, taskbar, and tray icons are generated from one source image so multiple sizes do not need to be maintained manually.

## Files

| Path | Purpose |
| ---- | ------- |
| `Assets/app-icon-source.png` | Source of truth for icons. Use any PNG, preferably at least 512x512. |
| `Assets/app-icon.ico` | WPF window / taskbar icon referenced by `<ApplicationIcon>`, with 16/24/32/48/64/128/256 frames. |
| `Assets/tray-icon.ico` | System tray icon loaded by `MainWindow.xaml.cs`, with 16/24/32/48 frames. |
| `Assets/app-icon-64.png` | Runtime WPF `Window.Icon` image. |
| `Assets/app-icon-256.png` | Installer, README, and About dialog image. |

## Regenerate Icons

After replacing `Assets/app-icon-source.png`, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-icon.ps1
```

The script:

1. trims near-white outer margins while preserving the rounded rectangle container;
2. adds 4% padding and expands the image to a square canvas;
3. resizes all target dimensions with `HighQualityBicubic`;
4. packages multi-resolution frames into ICO files using 32-bit PNG frames for Vista+ support.

After generation, run `npm run gui:build` to verify the icons are embedded.

## Design Constraints

- The main shape must remain recognizable at 16-32 px on the Windows 11 taskbar and tray.
- Keep the light purple-white rounded rectangle container to match the product visual style.
- Do not create a monochrome fallback; preserve 32-bit RGBA.
