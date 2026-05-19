using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using CodePanion.Gui.Models;
using CodePanion.Gui.Services;

namespace CodePanion.Gui
{
    public partial class MainWindow : Window
    {
        private readonly DaemonClient _daemonClient;
        private readonly ObservableCollection<SessionViewModel> _sessions;
        private readonly SoundPlayer _soundPlayer;
        private Hardcodet.Wpf.TaskbarNotification.TaskbarIcon? _trayIcon;
        private bool _isConnected;

        public MainWindow()
        {
            InitializeComponent();

            _trayIcon = (Hardcodet.Wpf.TaskbarNotification.TaskbarIcon?)FindResource("TrayIcon");
            TryLoadRuntimeIcons();
            _soundPlayer = new SoundPlayer();
            _sessions = new ObservableCollection<SessionViewModel>();
            SessionListView.ItemsSource = _sessions;

            _daemonClient = new DaemonClient();
            _daemonClient.Connected += OnDaemonConnected;
            _daemonClient.Disconnected += OnDaemonDisconnected;
            _daemonClient.SessionRegistered += OnSessionRegistered;
            _daemonClient.SessionOutput += OnSessionOutput;
            _daemonClient.SessionPrompt += OnSessionPrompt;
            _daemonClient.SessionExited += OnSessionExited;
            _daemonClient.NotificationReceived += OnNotificationReceived;
            _daemonClient.SourceRegistered += OnSourceRegistered;
            _daemonClient.MonitorEventReceived += OnMonitorEventReceived;
            _daemonClient.WorkflowSnapshotReceived += OnWorkflowSnapshotReceived;
            _daemonClient.WorkflowEventReceived += OnWorkflowEventReceived;
            _daemonClient.LogMessage += OnLogMessage;

            Loaded += MainWindow_Loaded;
        }

        private void TryLoadRuntimeIcons()
        {
            try
            {
                var assetDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets");
                var pngPath = Path.Combine(assetDir, "app-icon-64.png");
                var icoPath = Path.Combine(assetDir, "tray-icon.ico");

                if (File.Exists(pngPath))
                {
                    Icon = BitmapFrame.Create(new Uri(pngPath, UriKind.Absolute));
                }

                if (_trayIcon != null && File.Exists(icoPath))
                {
                    _trayIcon.Icon = new System.Drawing.Icon(icoPath);
                }
            }
            catch (Exception ex)
            {
                AddLog($"加载图标失败，已继续启动：{ex.Message}");
            }
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            await InitializeWebView();
            AddLog("正在连接到 CodePanion daemon...");
            await ConnectToDaemon();
        }

        private async System.Threading.Tasks.Task InitializeWebView()
        {
            try
            {
                await ChatWebView.EnsureCoreWebView2Async();
                ChatWebView.CoreWebView2.Settings.IsScriptEnabled = true;
                ChatWebView.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false;
                ChatWebView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                ChatWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

                var wwwrootPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot");
                ChatWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "codepanion.local",
                    wwwrootPath,
                    CoreWebView2HostResourceAccessKind.Allow
                );
                ChatWebView.CoreWebView2.Navigate("https://codepanion.local/chat.html");
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

        private async System.Threading.Tasks.Task ConnectToDaemon()
        {
            var connected = await _daemonClient.ConnectAsync();
            if (connected) return;

            AddLog("未检测到 daemon，正在后台自动启动...");
            var started = await DaemonProcessManager.EnsureStartedAsync(_daemonClient.DaemonUrl, AddLog);
            if (!started)
            {
                AddLog("daemon 自动启动失败，请检查 Node.js 或发布包完整性。");
                return;
            }

            _daemonClient.ReloadConfig();
            await _daemonClient.ConnectAsync();
        }

        private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var message = JObject.Parse(e.WebMessageAsJson);
                var type = message["type"]?.Value<string>();
                if (type == "ready")
                {
                    SendMessageToWeb(new { type = "connection-status", connected = _isConnected });
                    return;
                }

                if (type == "reply")
                {
                    var sessionId = message["sessionId"]?.Value<string>();
                    var value = message["value"]?.Value<string>();
                    if (!string.IsNullOrWhiteSpace(sessionId) && !string.IsNullOrWhiteSpace(value))
                    {
                        HandleUserReply(sessionId, value);
                    }
                    return;
                }

                if (type == "event-reply")
                {
                    var eventId = message["eventId"]?.Value<string>();
                    var value = message["value"]?.Value<string>();
                    if (!string.IsNullOrWhiteSpace(eventId) && !string.IsNullOrWhiteSpace(value))
                    {
                        HandleMonitorEventReply(eventId, value);
                    }
                    return;
                }

                AddLog($"未知 WebView 消息：{type}");
            }
            catch (Exception ex)
            {
                AddLog($"处理 WebView 消息失败：{ex.Message}");
            }
        }

        private async void HandleUserReply(string sessionId, string value)
        {
            var reply = value.EndsWith("\n", StringComparison.Ordinal) ? value : value + "\n";
            await _daemonClient.SendReplyAsync(sessionId, reply);
            AddLog($"[回复] {sessionId}: {value}");
        }

        private async void HandleMonitorEventReply(string eventId, string value)
        {
            var reply = value.EndsWith("\n", StringComparison.Ordinal) ? value : value + "\n";
            await _daemonClient.SendMonitorEventReplyAsync(eventId, reply);
            AddLog($"[事件回复] {eventId}: {value}");
        }

        private void SendMessageToWeb(object message)
        {
            try
            {
                if (ChatWebView?.CoreWebView2 == null) return;
                var json = JsonConvert.SerializeObject(message, new JsonSerializerSettings
                {
                    StringEscapeHandling = StringEscapeHandling.Default
                });
                ChatWebView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch (Exception ex)
            {
                AddLog($"发送 WebView 消息失败：{ex.Message}");
            }
        }

        private void OnDaemonConnected(object? sender, EventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                _isConnected = true;
                StatusIndicator.Fill = new SolidColorBrush(Colors.Green);
                StatusText.Text = "已连接";
                StatusBarText.Text = "已连接到 daemon";
                ReconnectButton.Visibility = Visibility.Collapsed;
                SendMessageToWeb(new { type = "connection-status", connected = true });
                AddLog("已连接到 daemon");
            });
        }

        private void OnDaemonDisconnected(object? sender, EventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                _isConnected = false;
                StatusIndicator.Fill = new SolidColorBrush(Colors.Gray);
                StatusText.Text = "未连接";
                StatusBarText.Text = "与 daemon 断开连接";
                ReconnectButton.Visibility = Visibility.Visible;
                SendMessageToWeb(new { type = "connection-status", connected = false });
                AddLog("与 daemon 断开连接");
            });
        }

        private void OnSessionRegistered(object? sender, SessionInfo session)
        {
            Dispatcher.Invoke(() =>
            {
                _sessions.Add(new SessionViewModel(session));
                UpdateSessionCount();
                if (_sessions.Count == 1) SessionListView.SelectedIndex = 0;
                SendMessageToWeb(new { type = "session-registered", session });
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

                if (!FocusAssistDetector.IsCurrentAppInForeground())
                {
                    _soundPlayer.PlayPromptSound();
                }

                SendMessageToWeb(new
                {
                    type = "add-message",
                    data = new
                    {
                        id = Guid.NewGuid().ToString(),
                        type = "prompt",
                        source = session?.Source ?? "cli",
                        sourceId = session?.SourceId,
                        sessionId = e.SessionId,
                        windowTitle = session?.WindowTitle,
                        workspace = session?.Workspace,
                        timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                        content = e.FullOutput ?? e.LastLines,
                        options = e.Options
                    }
                });
            });
        }

        private void OnSessionOutput(object? sender, SessionOutputEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                if (string.IsNullOrWhiteSpace(e.Chunk)) return;

                var session = FindSession(e.SessionId);
                SendMessageToWeb(new
                {
                    type = "add-message",
                    data = new
                    {
                        id = Guid.NewGuid().ToString(),
                        type = "output",
                        source = session?.Source ?? "cli",
                        sourceId = session?.SourceId,
                        sessionId = e.SessionId,
                        windowTitle = session?.WindowTitle,
                        workspace = session?.Workspace,
                        timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                        content = e.Chunk
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
                SendMessageToWeb(new
                {
                    type = "add-message",
                    data = new
                    {
                        id = Guid.NewGuid().ToString(),
                        type = e.ExitCode == 0 ? "done" : "error",
                        source = session?.Source ?? "cli",
                        sourceId = session?.SourceId,
                        sessionId = e.SessionId,
                        windowTitle = session?.WindowTitle,
                        workspace = session?.Workspace,
                        timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                        content = $"会话结束，退出码：{e.ExitCode}"
                    }
                });
            });
        }

        private void OnNotificationReceived(object? sender, NotificationEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new
                {
                    type = "add-message",
                    data = new
                    {
                        id = Guid.NewGuid().ToString(),
                        type = "notification",
                        source = string.IsNullOrWhiteSpace(e.Source) ? "daemon" : e.Source,
                        sourceId = e.SourceId,
                        sessionId = e.SessionId,
                        windowTitle = e.WindowTitle,
                        workspace = e.Workspace,
                        timestamp = e.Timestamp == 0 ? DateTimeOffset.Now.ToUnixTimeMilliseconds() : e.Timestamp,
                        content = $"**{e.Title}**\n\n{e.Message}",
                        level = e.Level
                    }
                });
            });
        }

        private void OnSourceRegistered(object? sender, MonitorSourceEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new { type = "source-registered", source = e.Source });
            });
        }

        private void OnMonitorEventReceived(object? sender, MonitorEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new
                {
                    type = "monitor-event",
                    data = e.Event
                });
            });
        }

        private void OnWorkflowSnapshotReceived(object? sender, JToken snapshot)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new
                {
                    type = "workflow-snapshot",
                    snapshot
                });
            });
        }

        private void OnWorkflowEventReceived(object? sender, JToken workflowEvent)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new
                {
                    type = "workflow-event",
                    data = workflowEvent
                });
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
                if (session.Id == sessionId) return session;
            }
            return null;
        }

        private void UpdateSessionCount()
        {
            var activeCount = 0;
            foreach (var session in _sessions)
            {
                if (session.Status != "exited") activeCount++;
            }
            SessionCountText.Text = activeCount.ToString();
        }

        private void AddLog(string message)
        {
            var logMessage = $"[{DateTime.Now:HH:mm:ss}] {message}";
            System.Diagnostics.Debug.WriteLine(logMessage);

            try
            {
                var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codepanion");
                Directory.CreateDirectory(logDir);
                File.AppendAllText(Path.Combine(logDir, "gui.log"), logMessage + Environment.NewLine, System.Text.Encoding.UTF8);
            }
            catch
            {
            }
        }

        private void SessionListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (SessionListView.SelectedItem is SessionViewModel session)
            {
                AddLog($"切换到会话：{session.Command}");
            }
        }

        private void Settings_Click(object sender, RoutedEventArgs e)
        {
            var settingsWindow = new SettingsWindow { Owner = this };
            settingsWindow.ShowDialog();
        }

        private async void Reconnect_Click(object sender, RoutedEventArgs e)
        {
            ReconnectButton.IsEnabled = false;
            StatusBarText.Text = "正在重新连接...";
            try
            {
                await _daemonClient.ReconnectAsync();
            }
            finally
            {
                ReconnectButton.IsEnabled = true;
            }
        }

        private void TrayIcon_TrayMouseDoubleClick(object sender, RoutedEventArgs e) => ShowWindow();

        private void ShowWindow_Click(object sender, RoutedEventArgs e) => ShowWindow();

        private void ShowWindow()
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
        }

        private void Exit_Click(object sender, RoutedEventArgs e)
        {
            _daemonClient.Dispose();
            _trayIcon?.Dispose();
            Application.Current.Shutdown();
        }

        private void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            e.Cancel = true;
            Hide();
        }

        protected override void OnClosed(EventArgs e)
        {
            _daemonClient.Dispose();
            _trayIcon?.Dispose();
            _soundPlayer.Dispose();
            base.OnClosed(e);
        }
    }
}
