using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using CodePanion.Gui.Models;
using CodePanion.Gui.Services;

namespace CodePanion.Gui
{
    public partial class MainWindow : Window
    {
        // P1-A：长跑后限制 _sessions 中已退出会话条数，避免无限增长。
        private const int MaxExitedSessions = 50;
        // P1-F：重连退避上限，与 SessionManager 60s 删除窗口同量级。
        private const int ReconnectMinSeconds = 2;
        private const int ReconnectMaxSeconds = 30;

        private readonly DaemonClient _daemonClient;
        private readonly ObservableCollection<SessionViewModel> _sessions;
        private readonly SoundPlayer _soundPlayer;
        private readonly DispatcherTimer _reconnectTimer;
        private Hardcodet.Wpf.TaskbarNotification.TaskbarIcon? _trayIcon;
        private bool _isConnected;
        private bool _isReconnectInProgress;
        private int _reconnectAttempts;

        public MainWindow()
        {
            InitializeComponent();

            _trayIcon = (Hardcodet.Wpf.TaskbarNotification.TaskbarIcon?)FindResource("TrayIcon");
            TryLoadRuntimeIcons();
            _soundPlayer = new SoundPlayer();
            _sessions = new ObservableCollection<SessionViewModel>();
            SessionListView.ItemsSource = _sessions;
            _reconnectTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(ReconnectMinSeconds)
            };
            _reconnectTimer.Tick += AutoReconnectTimer_Tick;

            _daemonClient = new DaemonClient();
            _daemonClient.Connected += OnDaemonConnected;
            _daemonClient.Disconnected += OnDaemonDisconnected;
            _daemonClient.SessionRegistered += OnSessionRegistered;
            _daemonClient.SessionOutput += OnSessionOutput;
            _daemonClient.SessionPrompt += OnSessionPrompt;
            _daemonClient.SessionExited += OnSessionExited;
            _daemonClient.NotificationReceived += OnNotificationReceived;
            _daemonClient.SourceRegistered += OnSourceRegistered;
            _daemonClient.SourceDisconnected += OnSourceDisconnected;
            _daemonClient.MonitorEventReceived += OnMonitorEventReceived;
            _daemonClient.WorkflowSnapshotReceived += OnWorkflowSnapshotReceived;
            _daemonClient.WorkflowEventReceived += OnWorkflowEventReceived;
            _daemonClient.SessionsSnapshotReceived += OnSessionsSnapshotReceived;
            _daemonClient.SourcesSnapshotReceived += OnSourcesSnapshotReceived;
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

        // P1-C：async void 整体兜底，未捕获异常不再让 WPF 进程崩溃。
        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            try
            {
                await InitializeWebView();
                AddLog("正在连接到 CodePanion daemon...");
                await ConnectToDaemon();
            }
            catch (Exception ex)
            {
                AddLog($"窗口加载失败：{ex.GetType().Name} - {ex.Message}");
            }
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
            if (_isReconnectInProgress) return;
            _isReconnectInProgress = true;
            _reconnectTimer.Stop();
            try
            {
                var connected = await _daemonClient.ConnectAsync();
                if (connected) return;

                AddLog("未检测到 daemon，正在后台自动启动...");
                var started = await DaemonProcessManager.EnsureStartedAsync(_daemonClient.DaemonUrl, AddLog);
                if (!started)
                {
                    AddLog("daemon 自动启动失败，请检查 Node.js 或发布包完整性。");
                    StartAutoReconnect();
                    return;
                }

                _daemonClient.ReloadConfig();
                _reconnectTimer.Stop();
                await _daemonClient.ConnectAsync();
            }
            finally
            {
                _isReconnectInProgress = false;
            }
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
            try
            {
                // P2-C：换行注入集中在 CLI 侧 replyTextForPromptOption，daemon 端 resolvePromptOption
                // 已 trim 末尾 \r?\n。GUI 不再追加 \n，避免出现 daemon outputChunks 多吞一个换行。
                var ok = await _daemonClient.SendReplyAsync(sessionId, value);
                AddLog(ok ? $"[回复] {sessionId}: {value}" : $"[回复失败] {sessionId}: {value}");
                if (!ok)
                {
                    SendStatusMessage("error", "回复发送失败", $"目标会话不可用或 daemon 未连接：{sessionId}");
                }
            }
            catch (Exception ex)
            {
                AddLog($"回复处理异常：{ex.GetType().Name} - {ex.Message}");
            }
        }

        private async void HandleMonitorEventReply(string eventId, string value)
        {
            try
            {
                // P2-C：监控事件回复同样不再补尾换行，由 daemon/CLI 侧统一处理。
                var ok = await _daemonClient.SendMonitorEventReplyAsync(eventId, value);
                AddLog(ok ? $"[事件回复] {eventId}: {value}" : $"[事件回复失败] {eventId}: {value}");
                if (!ok)
                {
                    SendStatusMessage("error", "事件回复失败", $"目标事件不可用或 daemon 未连接：{eventId}");
                }
            }
            catch (Exception ex)
            {
                AddLog($"事件回复处理异常：{ex.GetType().Name} - {ex.Message}");
            }
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
                _reconnectAttempts = 0;
                _isReconnectInProgress = false;
                _reconnectTimer.Stop();
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
                StatusBarText.Text = "与 daemon 断开连接，正在后台重试...";
                ReconnectButton.Visibility = Visibility.Visible;
                SendMessageToWeb(new { type = "connection-status", connected = false });
                StartAutoReconnect();
                AddLog("与 daemon 断开连接");
            });
        }

        private void StartAutoReconnect()
        {
            if (_reconnectTimer.IsEnabled) return;
            _reconnectTimer.Interval = TimeSpan.FromSeconds(ReconnectMinSeconds);
            _reconnectTimer.Start();
        }

        // P1-F：指数退避，2s → 4s → 8s → 16s → 30s（封顶），避免 daemon 长时间不可用时 2s 刷屏重试。
        // P1-C：async void + try/catch 兜底，避免未捕获异常崩溃 WPF 进程。
        private async void AutoReconnectTimer_Tick(object? sender, EventArgs e)
        {
            if (_isConnected || _isReconnectInProgress) return;
            _isReconnectInProgress = true;
            _reconnectAttempts++;
            StatusBarText.Text = $"正在自动重连 daemon... 第 {_reconnectAttempts} 次";
            AddLog($"自动重连 daemon，第 {_reconnectAttempts} 次");
            try
            {
                _daemonClient.ReloadConfig();
                var connected = await _daemonClient.ConnectAsync();
                if (!connected && _reconnectAttempts == 1)
                {
                    var started = await DaemonProcessManager.EnsureStartedAsync(_daemonClient.DaemonUrl, AddLog);
                    if (started)
                    {
                        await _daemonClient.ConnectAsync();
                    }
                }
            }
            catch (Exception ex)
            {
                AddLog($"自动重连异常：{ex.GetType().Name} - {ex.Message}");
            }
            finally
            {
                _isReconnectInProgress = false;
                if (!_isConnected)
                {
                    var shift = Math.Min(_reconnectAttempts, 4); // 1<<4 == 16，再乘 base 仍 ≤ 32s
                    var nextSecs = Math.Min(ReconnectMaxSeconds, ReconnectMinSeconds * (1 << shift));
                    _reconnectTimer.Interval = TimeSpan.FromSeconds(nextSecs);
                }
            }
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
                    session.ExitedAt = DateTimeOffset.Now.ToUnixTimeMilliseconds();
                }
                PruneExitedSessions();
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

        private void OnSourceDisconnected(object? sender, SourceDisconnectedEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new { type = "source-disconnected", sourceId = e.SourceId });
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

        private void OnSessionsSnapshotReceived(object? sender, SessionInfo[] snapshot)
        {
            Dispatcher.Invoke(() =>
            {
                // P0.1：按 id 做差量更新，避免 Clear+Add 抖动选中与重建 ViewModel 引用。
                var snapshotIds = new HashSet<string>();
                foreach (var session in snapshot)
                {
                    if (string.IsNullOrEmpty(session.Id)) continue;
                    snapshotIds.Add(session.Id);
                    var existing = FindSession(session.Id);
                    if (existing != null) existing.UpdateFrom(session);
                    else _sessions.Add(new SessionViewModel(session));
                }
                for (int i = _sessions.Count - 1; i >= 0; i--)
                {
                    if (!snapshotIds.Contains(_sessions[i].Id)) _sessions.RemoveAt(i);
                }
                UpdateSessionCount();
                if (_sessions.Count > 0 && SessionListView.SelectedIndex < 0)
                {
                    SessionListView.SelectedIndex = 0;
                }
            });
        }

        private void OnSourcesSnapshotReceived(object? sender, MonitorSourceInfo[] sources)
        {
            Dispatcher.Invoke(() =>
            {
                // 一次性投递整份 snapshot，让 web 端做 reset+merge，
                // 否则只发 source-registered 会保留已下线但 disconnect 事件丢失的来源。
                SendMessageToWeb(new { type = "sources-snapshot", sources });
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

        private void SendStatusMessage(string type, string title, string content)
        {
            SendMessageToWeb(new
            {
                type = "add-message",
                data = new
                {
                    id = Guid.NewGuid().ToString(),
                    type,
                    source = "daemon",
                    timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                    content = $"**{title}**\n\n{content}"
                }
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

        // P1-A：仅裁剪 exited 会话，活跃会话永远保留；超出 MaxExitedSessions 时按 ExitedAt 升序删最老。
        private void PruneExitedSessions()
        {
            var exited = new List<SessionViewModel>();
            foreach (var session in _sessions)
            {
                if (session.Status == "exited") exited.Add(session);
            }
            if (exited.Count <= MaxExitedSessions) return;
            exited.Sort((a, b) => a.ExitedAt.CompareTo(b.ExitedAt));
            var dropCount = exited.Count - MaxExitedSessions;
            for (int i = 0; i < dropCount; i++)
            {
                _sessions.Remove(exited[i]);
            }
        }

        private void AddLog(string message)
        {
            var logMessage = $"[{DateTime.Now:HH:mm:ss}] {message}";
            System.Diagnostics.Debug.WriteLine(logMessage);
            // P1-D：走异步队列 + 滚动写入，不在 Dispatcher 线程同步 File.AppendAllText。
            GuiLogWriter.Instance.Enqueue(logMessage);
        }

        private void SessionListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (SessionListView.SelectedItem is SessionViewModel session)
            {
                AddLog($"切换到会话：{session.Command}");
            }
        }

        private async void Settings_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var settingsWindow = new SettingsWindow { Owner = this };
                if (settingsWindow.ShowDialog() == true)
                {
                    AddLog("设置已更新，正在重新加载 daemon 连接配置...");
                    _reconnectTimer.Stop();
                    _daemonClient.ReloadConfig();
                    await _daemonClient.ReconnectAsync();
                }
            }
            catch (Exception ex)
            {
                AddLog($"设置应用失败：{ex.GetType().Name} - {ex.Message}");
            }
        }

        private async void Reconnect_Click(object sender, RoutedEventArgs e)
        {
            ReconnectButton.IsEnabled = false;
            StatusBarText.Text = "正在重新连接...";
            try
            {
                _reconnectTimer.Stop();
                var connected = await _daemonClient.ReconnectAsync();
                if (!connected)
                {
                    StartAutoReconnect();
                }
            }
            catch (Exception ex)
            {
                AddLog($"手动重连异常：{ex.GetType().Name} - {ex.Message}");
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
            GuiLogWriter.Instance.Dispose();
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
            GuiLogWriter.Instance.Dispose();
            base.OnClosed(e);
        }
    }
}
