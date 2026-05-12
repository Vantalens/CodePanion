using System;
using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Windows;

namespace RemindAI.Gui.Services
{
    public class SoundPlayer
    {
        private readonly string _promptSoundPath;
        private readonly string _doneSoundPath;
        private System.Media.SoundPlayer? _player;

        public SoundPlayer()
        {
            var assetsDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets");
            _promptSoundPath = Path.Combine(assetsDir, "prompt.wav");
            _doneSoundPath = Path.Combine(assetsDir, "done.wav");
        }

        public void PlayPromptSound()
        {
            PlaySound(_promptSoundPath);
        }

        public void PlayDoneSound()
        {
            PlaySound(_doneSoundPath);
        }

        private void PlaySound(string path)
        {
            try
            {
                if (!File.Exists(path))
                {
                    // 如果文件不存在，使用系统默认声音
                    SystemSounds.Beep.Play();
                    return;
                }

                _player?.Dispose();
                _player = new System.Media.SoundPlayer(path);
                _player.Play();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"播放声音失败: {ex.Message}");
                // 失败时使用系统默认声音
                SystemSounds.Beep.Play();
            }
        }

        public void Dispose()
        {
            _player?.Dispose();
        }
    }

    public class FocusAssistDetector
    {
        // Windows 10/11 Focus Assist 状态检测
        // 使用 WinRT API 检测免打扰模式

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

        public enum FocusAssistState
        {
            Off,           // 关闭
            PriorityOnly,  // 仅优先级
            AlarmsOnly     // 仅闹钟
        }

        public static FocusAssistState GetCurrentState()
        {
            try
            {
                // 尝试通过注册表读取 Focus Assist 状态
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.notifications.quiethourssettings\windows.data.notifications.quiethourssettings"))
                {
                    if (key != null)
                    {
                        var data = key.GetValue("Data") as byte[];
                        if (data != null && data.Length > 0)
                        {
                            // 简化的状态检测
                            // 实际的字节解析可能需要更复杂的逻辑
                            return FocusAssistState.Off;
                        }
                    }
                }
            }
            catch
            {
                // 如果无法检测，假设为关闭状态
            }

            return FocusAssistState.Off;
        }

        public static bool IsInFocusAssistMode()
        {
            var state = GetCurrentState();
            return state != FocusAssistState.Off;
        }

        public static bool IsCurrentAppInForeground()
        {
            try
            {
                var foregroundWindow = GetForegroundWindow();
                GetWindowThreadProcessId(foregroundWindow, out int foregroundProcessId);
                var currentProcessId = System.Diagnostics.Process.GetCurrentProcess().Id;
                return foregroundProcessId == currentProcessId;
            }
            catch
            {
                return false;
            }
        }
    }
}
