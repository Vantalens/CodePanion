using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Threading.Tasks;
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
        // N-20：WebView2 → native 消息白名单，未列入的 type 一律 warn 并丢弃。
        // W-20 重建：webview 已改为工作流控制台，旧监听态输入（reply/event-reply/task-action/
        // handoff-launch）的发送方已随旧 UI 一并删除，故从白名单移除。保留中性 ready/open-external，
        // 其余全部是工作流控制台请求。
        private static readonly HashSet<string> AllowedWebMessageTypes = new HashSet<string>
        {
            "ready",
            "open-external",
            "request-workflow-board",
            "request-workflow-run",
            "request-workflow-launch",
            "request-gate-resolve",
            "request-run-cancel",
            "request-delivery",
            "set-workspace",
        };

        private readonly DaemonClient _daemonClient;
        private readonly ObservableCollection<SessionViewModel> _sessions;
        private readonly SoundPlayer _soundPlayer;
        private readonly DispatcherTimer _reconnectTimer;
        private Hardcodet.Wpf.TaskbarNotification.TaskbarIcon? _trayIcon;
        private bool _isConnected;
        private bool _isReconnectInProgress;
        private int _reconnectAttempts;
        // 用户右键 → 刷新 WebView 时 JS state 会清空。daemon WebSocket 不会重发 snapshot，
        // 于是页面看起来一片空。这里缓存最后一次拿到的 workflow-snapshot / sources-snapshot
        // / sessions snapshot，WebView ready 时一次性 replay，保证刷新后任务列表立刻回来。
        private JToken? _cachedWorkflowSnapshot;
        private MonitorSourceInfo[]? _cachedSourcesSnapshot;
        private readonly object _snapshotCacheLock = new object();

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
            // W-20 重建：实时 run 事件转发给工作流控制台 webview。
            _daemonClient.WorkflowRunEventReceived += OnWorkflowRunEventReceived;
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
                AddLog("正在连接到 CodePanion daemon...");
                var connectTask = ConnectToDaemon();
                await InitializeWebView();
                await connectTask;
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
                // N-19：拦截导航与新窗口，markdown / 助手输出里的链接不能让 WebView2 直接跳走。
                ChatWebView.CoreWebView2.NavigationStarting += OnWebViewNavigationStarting;
                ChatWebView.CoreWebView2.NewWindowRequested += OnWebViewNewWindowRequested;

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
                // N-20：先解析顶层 type；只有命中白名单的 type 才会进入对应 handler。
                JObject message;
                try
                {
                    message = JObject.Parse(e.WebMessageAsJson);
                }
                catch (Exception parseEx)
                {
                    AddLog($"WebView 消息 JSON 解析失败：{parseEx.Message}");
                    return;
                }

                var type = message["type"]?.Value<string>();
                if (string.IsNullOrWhiteSpace(type) || !AllowedWebMessageTypes.Contains(type))
                {
                    AddLog($"丢弃未知 WebView 消息 type：{type ?? "<empty>"}");
                    return;
                }

                switch (type)
                {
                    case "ready":
                        // W-20 重建：webview 起来后只回连接状态；旧的 ReplayCachedSnapshots（会话/来源/旧快照）
                        // 不再调用，控制台自己按需拉 /workflow/board。
                        SendMessageToWeb(new { type = "connection-status", connected = _isConnected });
                        break;

                    // J-09：前端 click 拦截后把外链 href 转给 host 端，统一走 OpenExternalLink
                    // （仍复用 N-19 弹确认 + http(s) 白名单的兜底逻辑）。
                    case "open-external":
                    {
                        var href = message["href"]?.Value<string>();
                        if (!string.IsNullOrWhiteSpace(href) && Uri.TryCreate(href, UriKind.Absolute, out var uri))
                        {
                            OpenExternalLink(uri);
                        }
                        else
                        {
                            AddLog($"忽略非法 open-external href：{href ?? "<empty>"}");
                        }
                        break;
                    }

                    // W-20：拉一次 /workflow/board，单方向 push 回 webview。
                    case "request-workflow-board":
                    {
                        var workspace = message["workspace"]?.Value<string>();
                        _ = HandleWorkflowBoardRequestAsync(workspace);
                        break;
                    }

                    // W-20 重建：拉单次 run 详情（含 step output），push workflow-run 回 webview。
                    case "request-workflow-run":
                    {
                        var runId = message["runId"]?.Value<string>();
                        var workspace = message["workspace"]?.Value<string>();
                        if (string.IsNullOrWhiteSpace(runId)) { AddLog("丢弃 request-workflow-run：runId 缺失"); break; }
                        _ = HandleWorkflowRunDetailAsync(runId!, workspace);
                        break;
                    }

                    // W-20 重建：从 board 启动 workflow run。成功后自动重拉 board。
                    case "request-workflow-launch":
                    {
                        var workflow = message["workflow"]?.Value<string>();
                        var workspace = message["workspace"]?.Value<string>();
                        if (string.IsNullOrWhiteSpace(workflow)) { AddLog("丢弃 request-workflow-launch：workflow 缺失"); break; }
                        _ = HandleWorkflowLaunchAsync(workflow!, workspace);
                        break;
                    }

                    // W-20 重建：对 paused gate 做 approve/reject/retry 决策（可带 constraints/message）。
                    case "request-gate-resolve":
                    {
                        var runId = message["runId"]?.Value<string>();
                        var stepId = message["stepId"]?.Value<string>();
                        var decision = message["decision"]?.Value<string>();
                        var workspace = message["workspace"]?.Value<string>();
                        var gateMessage = message["message"]?.Value<string>();
                        var constraints = message["constraints"]?.ToObject<string[]>();
                        if (string.IsNullOrWhiteSpace(runId) || string.IsNullOrWhiteSpace(stepId) || string.IsNullOrWhiteSpace(decision))
                        { AddLog("丢弃 request-gate-resolve：runId/stepId/decision 缺失"); break; }
                        _ = HandleGateResolveAsync(runId!, stepId!, decision!, workspace, gateMessage, constraints);
                        break;
                    }

                    // W-20 重建：取消运行中的 run。
                    case "request-run-cancel":
                    {
                        var runId = message["runId"]?.Value<string>();
                        if (string.IsNullOrWhiteSpace(runId)) { AddLog("丢弃 request-run-cancel：runId 缺失"); break; }
                        _ = HandleRunCancelAsync(runId!);
                        break;
                    }

                    // W-20 重建：拉 delivery 文本（markdown|handoff），push workflow-delivery 回 webview。
                    case "request-delivery":
                    {
                        var runId = message["runId"]?.Value<string>();
                        var format = message["format"]?.Value<string>() ?? "markdown";
                        var workspace = message["workspace"]?.Value<string>();
                        if (string.IsNullOrWhiteSpace(runId)) { AddLog("丢弃 request-delivery：runId 缺失"); break; }
                        _ = HandleDeliveryAsync(runId!, format, workspace);
                        break;
                    }

                    // W-20 重建：webview 切换 workspace 后只记日志；后续 board/run 请求自带 workspace 参数。
                    case "set-workspace":
                    {
                        var workspace = message["workspace"]?.Value<string>();
                        AddLog($"workspace 切换为：{(string.IsNullOrWhiteSpace(workspace) ? "<全局>" : workspace)}");
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                AddLog($"处理 WebView 消息失败：{ex.Message}");
            }
        }

        // N-19：除 wwwroot 内部页面外，其余链接一律不让 WebView2 自己导航；
        // http(s) 链接交给系统默认浏览器（且只在 codepanion.local 之外触发），其它协议直接拒绝。
        private void OnWebViewNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
        {
            try
            {
                if (string.IsNullOrEmpty(e.Uri)) return;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;

                if (uri.Scheme == Uri.UriSchemeHttps &&
                    uri.Host.Equals("codepanion.local", StringComparison.OrdinalIgnoreCase))
                {
                    return; // 应用自身静态资源
                }

                if (string.Equals(uri.AbsoluteUri, "about:blank", StringComparison.OrdinalIgnoreCase))
                {
                    return; // WebView 空占位页
                }

                e.Cancel = true;
                OpenExternalLink(uri);
            }
            catch (Exception ex)
            {
                AddLog($"NavigationStarting 处理失败：{ex.Message}");
            }
        }

        private void OnWebViewNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            try
            {
                e.Handled = true;
                if (!string.IsNullOrEmpty(e.Uri) && Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri))
                {
                    OpenExternalLink(uri);
                }
            }
            catch (Exception ex)
            {
                AddLog($"NewWindowRequested 处理失败：{ex.Message}");
            }
        }

        private void OpenExternalLink(Uri uri)
        {
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            {
                AddLog($"拒绝非 http(s) 外链：{uri.Scheme}");
                return;
            }

            var confirm = MessageBox.Show(
                this,
                $"是否在系统默认浏览器打开：\n{uri}",
                "CodePanion 外链确认",
                MessageBoxButton.OKCancel,
                MessageBoxImage.Question,
                MessageBoxResult.Cancel);
            if (confirm != MessageBoxResult.OK)
            {
                AddLog($"已拒绝外链：{uri}");
                return;
            }

            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = uri.ToString(),
                    UseShellExecute = true,
                });
                AddLog($"已通过系统浏览器打开外链：{uri}");
            }
            catch (Exception ex)
            {
                AddLog($"打开外链失败：{ex.Message}");
            }
        }

        private async void HandleUserReply(string sessionId, string value, string mode = "option")
        {
            try
            {
                // P2-C：换行注入集中在 CLI 侧 replyTextForPromptOption，daemon 端 resolvePromptOption
                // 已 trim 末尾 \r?\n。GUI 不再追加 \n，避免出现 daemon outputChunks 多吞一个换行。
                var ok = await _daemonClient.SendReplyAsync(sessionId, value, mode);
                AddLog(ok ? $"[回复 {mode}] {sessionId}: {value}" : $"[回复失败] {sessionId}: {value}");
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

        private async void HandleTaskAction(string threadId, JObject message)
        {
            try
            {
                var payload = new JObject();
                if (message["pinned"] != null) payload["pinned"] = message["pinned"]!;
                if (message["archived"] != null) payload["archived"] = message["archived"]!;
                if (message["snoozedUntil"] != null) payload["snoozedUntil"] = message["snoozedUntil"]!;
                if (message["priority"] != null) payload["priority"] = message["priority"]!;
                if (message["sortOrder"] != null) payload["sortOrder"] = message["sortOrder"]!;
                if (message["handoffStatus"] != null) payload["handoffStatus"] = message["handoffStatus"]!;
                if (message["handoffTarget"] != null) payload["handoffTarget"] = message["handoffTarget"]!;
                if (message["handoffSessionId"] != null) payload["handoffSessionId"] = message["handoffSessionId"]!;

                var ok = await _daemonClient.UpdateWorkflowTaskStateAsync(threadId, payload);
                AddLog(ok ? $"[任务状态] {threadId}" : $"[任务状态失败] {threadId}");
                if (!ok)
                {
                    SendStatusMessage("error", "任务状态更新失败", $"目标任务不可用或 daemon 未连接：{threadId}");
                }
            }
            catch (Exception ex)
            {
                AddLog($"任务状态更新异常：{ex.GetType().Name} - {ex.Message}");
            }
        }

        private async void HandleHandoffLaunch(string threadId, JObject message)
        {
            try
            {
                var payload = new JObject
                {
                    ["target"] = message["target"]?.Value<string>() ?? "generic",
                    ["prompt"] = message["prompt"]?.Value<string>() ?? "",
                    ["preview"] = message["preview"]?.Value<string>() ?? ""
                };

                var ok = await _daemonClient.LaunchHandoffAsync(threadId, payload);
                AddLog(ok ? $"[任务转交] {threadId}" : $"[任务转交失败] {threadId}");
                if (!ok)
                {
                    SendStatusMessage("error", "任务转交启动失败", $"目标任务无法创建接力会话：{threadId}");
                }
            }
            catch (Exception ex)
            {
                AddLog($"处理任务转交失败：{ex.Message}");
                SendStatusMessage("error", "任务转交启动失败", ex.Message);
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
                        threadId = e.ThreadId,
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
                lock (_snapshotCacheLock) { _cachedSourcesSnapshot = sources; }
                SendMessageToWeb(new { type = "sources-snapshot", sources });
            });
        }

        private void OnWorkflowSnapshotReceived(object? sender, JToken snapshot)
        {
            Dispatcher.Invoke(() =>
            {
                lock (_snapshotCacheLock) { _cachedWorkflowSnapshot = snapshot?.DeepClone(); }
                SendMessageToWeb(new
                {
                    type = "workflow-snapshot",
                    snapshot
                });
            });
        }

        // WebView 刷新（右键 / F5）后 JS 状态被清空，daemon WS 没断不会重推。
        // 两步策略：
        //   1) 先 replay host 端缓存的最近一份 snapshot，让 UI 立刻有内容，不黑屏；
        //   2) 然后异步走 daemon REST 重拉一次权威 snapshot 覆盖。这一步关键 ——
        //      host 缓存可能跟 daemon 真实状态脱节（用户在 GUI 启动后启停了工具），
        //      只 replay cache 会出现"我刷新了也没用"的状态滞后。
        private void ReplayCachedSnapshots()
        {
            JToken? workflow;
            MonitorSourceInfo[]? sources;
            lock (_snapshotCacheLock)
            {
                workflow = _cachedWorkflowSnapshot;
                sources = _cachedSourcesSnapshot;
            }
            if (sources != null && sources.Length > 0)
            {
                SendMessageToWeb(new { type = "sources-snapshot", sources });
            }
            if (workflow != null)
            {
                SendMessageToWeb(new { type = "workflow-snapshot", snapshot = workflow });
            }

            // 异步刷新：fire-and-forget，REST 失败时保留 cache replay 的结果，不让 UI 倒退到空。
            _ = RefreshSnapshotsFromDaemonAsync();
        }

        private async Task RefreshSnapshotsFromDaemonAsync()
        {
            try
            {
                var sourcesJson = await _daemonClient.FetchSourcesSnapshotJsonAsync();
                if (!string.IsNullOrWhiteSpace(sourcesJson))
                {
                    var sources = JsonConvert.DeserializeObject<MonitorSourceInfo[]>(sourcesJson!);
                    if (sources != null)
                    {
                        lock (_snapshotCacheLock) { _cachedSourcesSnapshot = sources; }
                        await Dispatcher.InvokeAsync(() =>
                            SendMessageToWeb(new { type = "sources-snapshot", sources }));
                    }
                }

                var workflowJson = await _daemonClient.FetchWorkflowSnapshotJsonAsync();
                if (!string.IsNullOrWhiteSpace(workflowJson))
                {
                    var snapshot = JToken.Parse(workflowJson!);
                    lock (_snapshotCacheLock) { _cachedWorkflowSnapshot = snapshot.DeepClone(); }
                    await Dispatcher.InvokeAsync(() =>
                        SendMessageToWeb(new { type = "workflow-snapshot", snapshot }));
                }
            }
            catch (Exception ex)
            {
                AddLog($"刷新 daemon 快照失败：{ex.Message}");
            }
        }

        // W-20：响应 webview 端 request-workflow-board，按 workspace 拉 /workflow/board，
        // 解析后单向 push 一条 workflow-board 消息回 webview。失败时 push null 让前端展示空状态。
        private async Task HandleWorkflowBoardRequestAsync(string? workspace)
        {
            try
            {
                var json = await _daemonClient.FetchWorkflowBoardJsonAsync(workspace);
                JToken? board = null;
                if (!string.IsNullOrWhiteSpace(json))
                {
                    board = JToken.Parse(json!);
                }
                await Dispatcher.InvokeAsync(() =>
                    SendMessageToWeb(new { type = "workflow-board", workspace, board }));
            }
            catch (Exception ex)
            {
                AddLog($"处理 request-workflow-board 失败：{ex.Message}");
                await Dispatcher.InvokeAsync(() =>
                    SendMessageToWeb(new { type = "workflow-board", workspace, board = (object?)null, error = ex.Message }));
            }
        }

        // W-20 重建：拉单次 run 详情（含 step output），push workflow-run 回 webview。找不到 → run=null。
        private async Task HandleWorkflowRunDetailAsync(string runId, string? workspace)
        {
            string? json = null;
            try { json = await _daemonClient.FetchWorkflowRunJsonAsync(runId, workspace); }
            catch (Exception ex) { AddLog($"处理 request-workflow-run 失败：{ex.Message}"); }
            JToken? run = null;
            if (!string.IsNullOrWhiteSpace(json))
            {
                try { run = JToken.Parse(json!)["run"]; } catch { /* 非法 JSON 视作无详情 */ }
            }
            await Dispatcher.InvokeAsync(() =>
                SendMessageToWeb(new { type = "workflow-run", runId, run }));
        }

        // W-20 重建：拉 delivery 文本，push workflow-delivery 回 webview。
        private async Task HandleDeliveryAsync(string runId, string format, string? workspace)
        {
            string? json = null;
            try { json = await _daemonClient.FetchDeliveryJsonAsync(runId, format, workspace); }
            catch (Exception ex) { AddLog($"处理 request-delivery 失败：{ex.Message}"); }
            JToken? delivery = null;
            if (!string.IsNullOrWhiteSpace(json))
            {
                try { delivery = JToken.Parse(json!); } catch { /* ignore */ }
            }
            await Dispatcher.InvokeAsync(() =>
                SendMessageToWeb(new { type = "workflow-delivery", runId, format, delivery }));
        }

        // W-20 重建：启动 workflow run，结果走 workflow-action-result；成功后自动重拉 board。
        private async Task HandleWorkflowLaunchAsync(string workflowName, string? workspace)
        {
            var (ok, body) = await _daemonClient.StartWorkflowRunAsync(workflowName, workspace);
            await Dispatcher.InvokeAsync(() =>
                SendMessageToWeb(new { type = "workflow-action-result", action = "launch", workflow = workflowName, workspace, ok, body }));
            if (ok) await HandleWorkflowBoardRequestAsync(workspace);
        }

        // W-20 重建：gate 决策（approve/reject/retry，可带 constraints/message）；成功后自动重拉 board。
        private async Task HandleGateResolveAsync(string runId, string stepId, string decision, string? workspace, string? message, string[]? constraints)
        {
            var (ok, body) = await _daemonClient.ResolveWorkflowGateAsync(runId, stepId, decision, workspace, message, constraints);
            await Dispatcher.InvokeAsync(() =>
                SendMessageToWeb(new { type = "workflow-action-result", action = "gate-resolve", runId, stepId, decision, workspace, ok, body }));
            if (ok) await HandleWorkflowBoardRequestAsync(workspace);
        }

        // W-20 重建：取消运行中的 run，结果走 workflow-action-result。
        private async Task HandleRunCancelAsync(string runId)
        {
            var (ok, body) = await _daemonClient.CancelRunAsync(runId);
            await Dispatcher.InvokeAsync(() =>
                SendMessageToWeb(new { type = "workflow-action-result", action = "cancel", runId, ok, body }));
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

        // W-20 重建：把 daemon 的实时 run 事件原样转给控制台 webview。
        // event 形如 { action:'run-start'|'step-start'|'step-output'|'step-finish'|'run-finish', runId, ... }。
        private void OnWorkflowRunEventReceived(object? sender, JToken runEvent)
        {
            Dispatcher.Invoke(() =>
            {
                SendMessageToWeb(new
                {
                    type = "workflow-run-event",
                    @event = runEvent
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
            DaemonProcessManager.Stop(AddLog);
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
            DaemonProcessManager.Stop(AddLog);
            _daemonClient.Dispose();
            _trayIcon?.Dispose();
            _soundPlayer.Dispose();
            GuiLogWriter.Instance.Dispose();
            base.OnClosed(e);
        }
    }
}
