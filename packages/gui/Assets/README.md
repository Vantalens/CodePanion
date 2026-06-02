# CodePanion GUI Assets

[English](README.md) | [简体中文](README.zh-CN.md)

This directory stores static assets used by the CodePanion Windows GUI, including notification sounds and generated icon files.

## Sound Files

- `prompt.wav`: short prompt sound used when user input is required.
- `done.wav`: soft completion sound used when a task finishes.

## Generate Sounds

If the files are missing, they can be recreated with one of these methods:

### Option 1: Online Assets

Download free short notification sounds from a trusted source such as SoundJay.

### Option 2: Audacity

1. Open Audacity.
2. Use Generate -> Tone.
3. Set frequency: prompt `800Hz`, done `400Hz`.
4. Set duration to `0.2s`.
5. Export as WAV.

### Option 3: PowerShell

```powershell
[console]::beep(800, 200)
```

## Fallback

If the sound files are unavailable, the application falls back to the system default beep.
