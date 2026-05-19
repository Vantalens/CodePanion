# 提示音文件

本目录包含 CodePanion 使用的提示音文件。

## 文件列表

- `prompt.wav` - 需要用户输入时的提示音（短促的"叮"声）
- `done.wav` - 任务完成时的提示音（柔和的"咚"声）

## 生成提示音

如果文件不存在，可以使用以下方法生成：

### 方法 1: 使用在线工具
访问 https://www.soundjay.com/beep-sounds-1.html 下载免费的提示音

### 方法 2: 使用 Audacity
1. 打开 Audacity
2. 生成 → 音调
3. 设置频率（prompt: 800Hz, done: 400Hz）
4. 持续时间 0.2 秒
5. 导出为 WAV 格式

### 方法 3: 使用 PowerShell 生成
```powershell
# 生成简单的提示音（需要额外工具）
[console]::beep(800, 200)
```

## 备用方案

如果提示音文件不存在，程序会自动使用系统默认的 Beep 声音。
