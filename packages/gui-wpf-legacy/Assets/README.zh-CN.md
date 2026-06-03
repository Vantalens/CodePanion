# CodePanion GUI Assets

[English](README.md) | [简体中文](README.zh-CN.md)

本目录保存 CodePanion Windows GUI 使用的静态资源，包括提示音和生成后的图标文件。

## 提示音文件

- `prompt.wav`：需要用户输入时使用的短提示音。
- `done.wav`：任务完成时使用的柔和提示音。

## 生成提示音

如果文件不存在，可以用以下方法重新生成：

### 方法 1：在线资源

从可信资源站点下载免费的短提示音，例如 SoundJay。

### 方法 2：Audacity

1. 打开 Audacity。
2. 使用 Generate -> Tone。
3. 设置频率：prompt `800Hz`，done `400Hz`。
4. 设置持续时间为 `0.2s`。
5. 导出为 WAV。

### 方法 3：PowerShell

```powershell
[console]::beep(800, 200)
```

## 备用方案

如果提示音文件不可用，应用会退回系统默认 Beep 声音。
