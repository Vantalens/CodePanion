using System;
using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using RemindAI.Gui.Services;
using RemindAI.Gui.Models;

namespace RemindAI.Gui
{
    public partial class MainWindow : Window
    {
        private readonly DaemonClient _daemonClient;
        private readonly ObservableCollection<SessionViewModel> _sessions;

        public MainWindow()
        {
            InitializeComponent();

            _sessions = new ObservableCollection<SessionViewModel>();
            SessionListView.ItemsSource = _sessions;

            _daemonClient = new DaemonClient();
            _daemonClient.Connected += OnDaemonConnected;
            _daemonClient.Disconnected += OnDaemonDisconnected;
            _daemonClient.SessionRegistered += OnSessionRegistered;
            _daemonClient.SessionPrompt += OnSessionPrompt;
            _daemonClient.SessionExited += OnSessionExited;
            _daemonClient.LogMessage += OnLogMessage;

            Loaded += MainWindow_Loaded;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            AddLog("正在连接到 RemindAI daemon...");
            await _daemonClient.ConnectAsync();
        }

        private void OnDaemonConnected(object? sender, EventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                StatusIndicator.Fill = new SolidColorBrush(Colors.Green);
                StatusText.Text = "已连接";
                ConnectionStatusMenuItem.Header = "✓ 已连接";
                StatusBarText.Text = "已连接到 daemon";
                AddLog("✓ 已连接到 daemon");
            });
        }

        private void OnDaemonDisconnected(object? sender, EventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                StatusIndicator.Fill = new SolidColorBrush(Colors.Gray);
                StatusText.Text = "未连接";
                ConnectionStatusMenuItem.Header = "✗ 未连接";
                StatusBarText.Text = "与 daemon 断开连接";
                AddLog("✗ 与 daemon 断开连接");
            });
        }

        private void OnSessionRegistered(object? sender, SessionInfo session)
        {
            Dispatcher.Invoke(() =>
            {
                var vm = new SessionViewModel(session);
                _sessions.Add(vm);
                UpdateSessionCount();
                AddLog($"新会话：{session.Command} (ID: {session.Id})");
            });
        }

        private void OnSessionPrompt(object? sender, SessionPromptEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                var session = FindSession(e.SessionId);
                if (session != null)
                {
                    session.Status = "waiting";
                    session.LastPrompt = e.LastLines;
                }

                AddLog($"[提示] 会话 {e.SessionId}: {e.LastLines}");

                // 显示提示对话框
                var dialog = new PromptDialog(e.SessionId, e.LastLines, e.Options);
                dialog.Owner = this;
                dialog.ReplySubmitted += async (s, reply) =>
                {
                    await _daemonClient.SendReplyAsync(e.SessionId, reply);
                    AddLog($"[回复] 会话 {e.SessionId}: {reply}");
                };
                dialog.Show();
            });
        }

        private void OnSessionExited(object? sender, SessionExitedEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                var session = FindSession(e.SessionId);
                if (session != null)
                {
                    session.Status = "exited";
                    session.ExitCode = e.ExitCode;
                }

                UpdateSessionCount();
                AddLog($"会话结束：{e.SessionId} (退出码: {e.ExitCode})");
            });
        }

        private void OnLogMessage(object? sender, string message)
        {
            Dispatcher.Invoke(() => AddLog(message));
        }

        private SessionViewModel? FindSession(string sessionId)
        {
            foreach (var session in _sessions)
            {
                if (session.Id == sessionId)
                    return session;
            }
            return null;
        }

        private void UpdateSessionCount()
        {
            int activeCount = 0;
            foreach (var session in _sessions)
            {
                if (session.Status != "exited")
                    activeCount++;
            }
            SessionCountText.Text = activeCount.ToString();
        }

        private void AddLog(string message)
        {
            var timestamp = DateTime.Now.ToString("HH:mm:ss");
            LogTextBox.AppendText($"[{timestamp}] {message}\n");
            LogTextBox.ScrollToEnd();
        }

        private async void Refresh_Click(object sender, RoutedEventArgs e)
        {
            AddLog("刷新会话列表...");
            // TODO: 实现刷新逻辑
        }

        private void Settings_Click(object sender, RoutedEventArgs e)
        {
            var settingsWindow = new SettingsWindow();
            settingsWindow.Owner = this;
            settingsWindow.ShowDialog();
        }

        private void ViewSession_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button button && button.Tag is string sessionId)
            {
                var session = FindSession(sessionId);
                if (session != null)
                {
                    MessageBox.Show(
                        $"会话 ID: {session.Id}\n" +
                        $"命令: {session.Command}\n" +
                        $"状态: {session.StatusText}\n" +
                        $"开始时间: {session.StartedAtText}\n" +
                        $"工作目录: {session.Cwd ?? "N/A"}",
                        "会话详情",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information
                    );
                }
            }
        }

        private void ClearLog_Click(object sender, RoutedEventArgs e)
        {
            LogTextBox.Clear();
        }

        private void TrayIcon_TrayMouseDoubleClick(object sender, RoutedEventArgs e)
        {
            ShowWindow();
        }

        private void ShowWindow_Click(object sender, RoutedEventArgs e)
        {
            ShowWindow();
        }

        private void ShowWindow()
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
        }

        private void Exit_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        private void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // 最小化到托盘而不是关闭
            e.Cancel = true;
            Hide();
        }

        protected override void OnClosed(EventArgs e)
        {
            _daemonClient?.Dispose();
            TrayIcon?.Dispose();
            base.OnClosed(e);
        }
    }
}
