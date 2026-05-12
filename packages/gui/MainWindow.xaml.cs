using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RemindAI.Gui.Services;
using RemindAI.Gui.Models;

namespace RemindAI.Gui
{
    public partial class MainWindow : Window
    {
        private readonly DaemonClient _daemonClient;
        private readonly ObservableCollection<SessionViewModel> _sessions;
        private string _currentSessionId = "";
        private Hardcodet.Wpf.TaskbarNotification.TaskbarIcon? _trayIcon;

        public MainWindow()
        {
            InitializeComponent();

            // 从资源获取托盘图标
            _trayIcon = (Hardcodet.Wpf.TaskbarNotification.TaskbarIcon?)FindResource("TrayIcon");

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
            // 初始化 WebView2
            await InitializeWebView();

            // 连接到 daemon
            AddLog("正在连接到 RemindAI daemon...");
            await _daemonClient.ConnectAsync();
        }

        private async System.Threading.Tasks.Task InitializeWebView()
        {
            try
            {
                await ChatWebView.EnsureCoreWebView2Async();

                // 设置 WebView2 消息接收
                ChatWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

                // 加载 HTML 文件
                var htmlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot", "chat.html");
                if (File.Exists(htmlPath))
                {
                    ChatWebView.CoreWebView2.Navigate(new Uri(htmlPath).AbsoluteUri);
                }
                else
                {
                    AddLog($"错误：找不到 chat.html 文件：{htmlPath}");
                }
            }
            catch (Exception ex)
            {
                AddLog($"初始化 WebView2 失败：{ex.Message}");
                MessageBox.Show(
                    $"初始化 WebView2 失败：{ex.Message}\n\n请确保已安装 WebView2 Runtime。",
                    "错误",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var json = e.WebMessageAsJson;
                var message = JObject.Parse(json);
                var type = message["type"]?.Value<string>();

                switch (type)
                {
                    case "ready":
                        AddLog("WebView2 已就绪");
                        break;

                    case "reply":
                        var sessionId = message["sessionId"]?.Value<string>();
                        var value = message["value"]?.Value<string>();
                        if (!string.IsNullOrEmpty(sessionId) && !string.IsNullOrEmpty(value))
                        {
                            HandleUserReply(sessionId, value);
                        }
                        break;

                    default:
                        AddLog($"未知的 WebView 消息类型：{type}");
                        break;
                }
            }
            catch (Exception ex)
            {
                AddLog($"处理 WebView 消息失败：{ex.Message}");
            }
        }

        private async void HandleUserReply(string sessionId, string value)
        {
            try
            {
                // 确保以换行符结尾
                var reply = value.EndsWith("\n") ? value : value + "\n";
                await _daemonClient.SendReplyAsync(sessionId, reply);
                AddLog($"[回复] 会话 {sessionId}: {value}");
            }
            catch (Exception ex)
            {
                AddLog($"发送回复失败：{ex.Message}");
            }
        }

        private void SendMessageToWeb(object message)
        {
            try
            {
                var json = JsonConvert.SerializeObject(message);
                ChatWebView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch (Exception ex)
            {
                AddLog($"发送消息到 WebView 失败：{ex.Message}");
            }
        }

        private void OnDaemonConnected(object? sender, EventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                StatusIndicator.Fill = new SolidColorBrush(Colors.Green);
                StatusText.Text = "已连接";
                // ConnectionStatusMenuItem 在资源中，暂时不更新
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
                // ConnectionStatusMenuItem 在资源中，暂时不更新
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

                // 如果是第一个会话，自动选中
                if (_sessions.Count == 1)
                {
                    SessionListView.SelectedIndex = 0;
                }
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

                // 发送消息到 WebView
                SendMessageToWeb(new
                {
                    type = "add-message",
                    data = new
                    {
                        id = Guid.NewGuid().ToString(),
                        sessionId = e.SessionId,
                        timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                        type = "prompt",
                        content = e.FullOutput ?? e.LastLines,
                        options = e.Options
                    }
                });
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
            System.Diagnostics.Debug.WriteLine($"[{timestamp}] {message}");
        }

        private void SessionListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (SessionListView.SelectedItem is SessionViewModel session)
            {
                _currentSessionId = session.Id;
                // TODO: 加载该会话的历史消息
                AddLog($"切换到会话：{session.Command}");
            }
        }

        private void Settings_Click(object sender, RoutedEventArgs e)
        {
            var settingsWindow = new SettingsWindow();
            settingsWindow.Owner = this;
            settingsWindow.ShowDialog();
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
            _trayIcon?.Dispose();
            base.OnClosed(e);
        }
    }
}

