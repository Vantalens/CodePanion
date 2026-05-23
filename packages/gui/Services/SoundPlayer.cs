using System;
using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Windows;

namespace CodePanion.Gui.Services
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
        // N-21：旧实现读取的注册表路径不再反映真实状态（QuietHours 子键内容已变），
        // 改用 Shell API SHQueryUserNotificationState，覆盖 Focus Assist、专注模式与全屏 D3D。

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

        [DllImport("shell32.dll", SetLastError = false)]
        private static extern int SHQueryUserNotificationState(out QueryUserNotificationState state);

        private enum QueryUserNotificationState
        {
            QUNS_NOT_PRESENT = 1,
            QUNS_BUSY = 2,
            QUNS_RUNNING_D3D_FULL_SCREEN = 3,
            QUNS_PRESENTATION_MODE = 4,
            QUNS_ACCEPTS_NOTIFICATIONS = 5,
            QUNS_QUIET_TIME = 6,
            QUNS_APP = 7,
        }

        public enum FocusAssistState
        {
            Off,           // 关闭：默认接受通知
            PriorityOnly,  // 仅优先级（含 Busy / 演示模式 / D3D 全屏）
            AlarmsOnly     // 仅闹钟（Windows Quiet Hours）
        }

        public static FocusAssistState GetCurrentState()
        {
            try
            {
                if (SHQueryUserNotificationState(out var state) != 0)
                {
                    return FocusAssistState.Off;
                }

                switch (state)
                {
                    case QueryUserNotificationState.QUNS_QUIET_TIME:
                        return FocusAssistState.AlarmsOnly;
                    case QueryUserNotificationState.QUNS_BUSY:
                    case QueryUserNotificationState.QUNS_RUNNING_D3D_FULL_SCREEN:
                    case QueryUserNotificationState.QUNS_PRESENTATION_MODE:
                        return FocusAssistState.PriorityOnly;
                    case QueryUserNotificationState.QUNS_ACCEPTS_NOTIFICATIONS:
                    case QueryUserNotificationState.QUNS_APP:
                    case QueryUserNotificationState.QUNS_NOT_PRESENT:
                    default:
                        return FocusAssistState.Off;
                }
            }
            catch
            {
                return FocusAssistState.Off;
            }
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
