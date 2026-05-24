using System;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Websocket.Client;
using CodePanion.Gui.Models;

namespace CodePanion.Gui.Services
{
    public class DaemonClient : IDisposable
    {
        private WebsocketClient? _wsClient;
        private readonly HttpClient _httpClient;
        private static readonly TimeSpan HealthProbeTimeout = TimeSpan.FromMilliseconds(700);
        private string _daemonUrl = "http://127.0.0.1:7777";
        private string _token = "";

        public event EventHandler? Connected;
        public event EventHandler? Disconnected;
        public event EventHandler<SessionInfo>? SessionRegistered;
        public event EventHandler<SessionOutputEventArgs>? SessionOutput;
        public event EventHandler<SessionPromptEventArgs>? SessionPrompt;
        public event EventHandler<SessionExitedEventArgs>? SessionExited;
        public event EventHandler<NotificationEventArgs>? NotificationReceived;
        public event EventHandler<MonitorSourceEventArgs>? SourceRegistered;
        public event EventHandler<SourceDisconnectedEventArgs>? SourceDisconnected;
        public event EventHandler<MonitorEventArgs>? MonitorEventReceived;
        public event EventHandler<JToken>? WorkflowSnapshotReceived;
        public event EventHandler<JToken>? WorkflowEventReceived;
        public event EventHandler<SessionInfo[]>? SessionsSnapshotReceived;
        public event EventHandler<MonitorSourceInfo[]>? SourcesSnapshotReceived;
        public event EventHandler<string>? LogMessage;

        public DaemonClient()
        {
            _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            LoadConfig();
        }

        public string DaemonUrl => _daemonUrl;

        public void ReloadConfig() => LoadConfig();

        private void LoadConfig()
        {
            try
            {
                var configPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".codepanion",
                    "config.json"
                );

                if (File.Exists(configPath))
                {
                    var json = File.ReadAllText(configPath, Encoding.UTF8);
                    var config = JObject.Parse(json);

                    if (config["port"] != null)
                    {
                        var port = config["port"]!.Value<int>();
                        _daemonUrl = $"http://127.0.0.1:{port}";
                    }

                    if (config["token"] != null)
                    {
                        _token = config["token"]!.Value<string>() ?? "";
                    }

                    Log($"配置已加载：{_daemonUrl}");
                }
                else
                {
                    Log("配置文件不存在，使用默认设置");
                }
            }
            catch (Exception ex)
            {
                Log($"加载配置失败：{ex.Message}");
            }
        }

        public async Task<bool> ConnectAsync()
        {
            try
            {
                if (_wsClient != null)
                {
                    await DisconnectAsync();
                }
                Log($"尝试连接到 daemon: {_daemonUrl}");

                // 检查 daemon 健康状态
                var healthUrl = $"{_daemonUrl}/health";

                try
                {
                    using var cts = new CancellationTokenSource(HealthProbeTimeout);
                    var response = await _httpClient.GetAsync(healthUrl, cts.Token);

                    if (!response.IsSuccessStatusCode)
                    {
                        Log($"Daemon 健康检查失败，状态码: {response.StatusCode}");
                        Disconnected?.Invoke(this, EventArgs.Empty);
                        return false;
                    }

                    var healthContent = await response.Content.ReadAsStringAsync();
                    Log($"Daemon 健康检查成功: {healthContent}");
                }
                catch (HttpRequestException httpEx)
                {
                    Log($"无法连接到 daemon ({_daemonUrl}): {httpEx.Message}");
                    Disconnected?.Invoke(this, EventArgs.Empty);
                    return false;
                }
                catch (TaskCanceledException)
                {
                    Log($"连接 daemon 超时 ({_daemonUrl})");
                    Disconnected?.Invoke(this, EventArgs.Empty);
                    return false;
                }

                // 连接 WebSocket — token 通过 Sec-WebSocket-Protocol 携带，避免出现在 URL / 日志 / referer 中
                var port = new Uri(_daemonUrl).Port;
                var wsUrl = $"ws://127.0.0.1:{port}/ws?role=observer";
                Log($"连接 WebSocket: {wsUrl}（token via subprotocol={MaskToken(_token)}）");

                var tokenSubProtocol = $"codepanion.token.{_token}";
                var factory = new Func<ClientWebSocket>(() =>
                {
                    var client = new ClientWebSocket();
                    client.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
                    client.Options.AddSubProtocol(tokenSubProtocol);
                    return client;
                });

                _wsClient = new WebsocketClient(new Uri(wsUrl), factory)
                {
                    ReconnectTimeout = null, // 禁用自动重连，手动控制
                    ErrorReconnectTimeout = null
                };

                _wsClient.ReconnectionHappened.Subscribe(info =>
                {
                    Log($"WebSocket 连接状态：{info.Type}");
                    Log($"触发 Connected 事件，订阅者数量：{(Connected?.GetInvocationList()?.Length ?? 0)}");
                    // 任何成功的连接都触发 Connected 事件
                    Connected?.Invoke(this, EventArgs.Empty);
                    Log("Connected 事件已触发");
                });

                _wsClient.DisconnectionHappened.Subscribe(info =>
                {
                    Log($"WebSocket 断开：{info.Type} - {info.CloseStatus}");
                    if (info.Type != DisconnectionType.Exit)
                    {
                        Disconnected?.Invoke(this, EventArgs.Empty);
                    }
                });

                _wsClient.MessageReceived.Subscribe(msg =>
                {
                    if (msg.Text != null)
                    {
                        HandleWebSocketMessage(msg.Text);
                    }
                });

                await _wsClient.Start();
                Log("WebSocket 启动成功");
                return true;
            }
            catch (Exception ex)
            {
                Log($"连接失败：{ex.GetType().Name} - {ex.Message}");
                Log($"堆栈跟踪：{ex.StackTrace}");
                _wsClient?.Dispose();
                _wsClient = null;
                Disconnected?.Invoke(this, EventArgs.Empty);
                return false;
            }
        }

        private void HandleWebSocketMessage(string message)
        {
            try
            {
                var json = JObject.Parse(message);
                var type = json["type"]?.Value<string>();

                switch (type)
                {
                    case "hello":
                        var pid = json["pid"]?.Value<int>();
                        var version = json["version"]?.Value<string>();
                        Log($"收到 hello 消息：PID={pid}, Version={version}");
                        break;

                    case "session-registered":
                        var session = json["session"]?.ToObject<SessionInfo>();
                        if (session != null)
                        {
                            SessionRegistered?.Invoke(this, session);
                        }
                        break;

                    case "session-prompt":
                        var promptEvent = new SessionPromptEventArgs
                        {
                            SessionId = json["sessionId"]?.Value<string>() ?? "",
                            LastLines = json["lastLines"]?.Value<string>() ?? "",
                            Options = json["options"]?.ToObject<string[]>(),
                            FullOutput = json["fullOutput"]?.Value<string>()  // 新增
                        };
                        SessionPrompt?.Invoke(this, promptEvent);
                        break;

                    case "session-exited":
                        var exitEvent = new SessionExitedEventArgs
                        {
                            SessionId = json["sessionId"]?.Value<string>() ?? "",
                            ExitCode = json["exitCode"]?.Value<int>() ?? 0,
                            DurationMs = json["durationMs"]?.Value<long>() ?? 0
                        };
                        SessionExited?.Invoke(this, exitEvent);
                        break;

                    case "notification":
                        var data = json["data"];
                        if (data != null)
                        {
                            var notificationEvent = new NotificationEventArgs
                            {
                                Title = data["title"]?.Value<string>() ?? "",
                                Message = data["message"]?.Value<string>() ?? data["content"]?.Value<string>() ?? "",
                                Source = data["source"]?.Value<string>() ?? "",
                                ThreadId = data["threadId"]?.Value<string>() ?? "",
                                SourceId = data["sourceId"]?.Value<string>() ?? "",
                                SessionId = data["sessionId"]?.Value<string>() ?? "",
                                Level = data["level"]?.Value<string>() ?? "",
                                WindowTitle = data["windowTitle"]?.Value<string>() ?? "",
                                Workspace = data["workspace"]?.Value<string>() ?? "",
                                Timestamp = data["timestamp"]?.Value<long>() ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                            };
                            Log($"收到通知：{notificationEvent.Title} - {notificationEvent.Message}");
                            NotificationReceived?.Invoke(this, notificationEvent);
                        }
                        break;

                    case "source-registered":
                        var source = json["source"]?.ToObject<MonitorSourceInfo>();
                        if (source != null)
                        {
                            Log($"监控源上线：{source.Kind}/{source.Name}");
                            SourceRegistered?.Invoke(this, new MonitorSourceEventArgs { Source = source });
                        }
                        break;

                    case "source-disconnected":
                        var sourceId = json["sourceId"]?.Value<string>() ?? "";
                        if (!string.IsNullOrWhiteSpace(sourceId))
                        {
                            Log($"监控源离线：{sourceId}");
                            SourceDisconnected?.Invoke(this, new SourceDisconnectedEventArgs { SourceId = sourceId });
                        }
                        break;

                    case "monitor-event":
                        var monitorEvent = json["event"]?.ToObject<MonitorEventInfo>();
                        if (monitorEvent != null)
                        {
                            Log($"监控事件：{monitorEvent.Type} - {monitorEvent.Title ?? monitorEvent.Content}");
                            MonitorEventReceived?.Invoke(this, new MonitorEventArgs { Event = monitorEvent });
                        }
                        break;

                    case "monitor-event-reply":
                        Log($"监控事件回复：{json["eventId"]?.Value<string>()} - {json["text"]?.Value<string>()}");
                        break;

                    case "workflow-snapshot":
                        if (json["snapshot"] != null)
                        {
                            WorkflowSnapshotReceived?.Invoke(this, json["snapshot"]!);
                        }
                        break;

                    case "sessions-snapshot":
                        var sessions = json["sessions"]?.ToObject<SessionInfo[]>() ?? Array.Empty<SessionInfo>();
                        SessionsSnapshotReceived?.Invoke(this, sessions);
                        break;

                    case "sources-snapshot":
                        var sources = json["sources"]?.ToObject<MonitorSourceInfo[]>() ?? Array.Empty<MonitorSourceInfo>();
                        SourcesSnapshotReceived?.Invoke(this, sources);
                        break;

                    case "workflow-event":
                        if (json["event"] != null)
                        {
                            WorkflowEventReceived?.Invoke(this, json["event"]!);
                        }
                        break;

                    case "session-output":
                        SessionOutput?.Invoke(this, new SessionOutputEventArgs
                        {
                            SessionId = json["sessionId"]?.Value<string>() ?? "",
                            Chunk = json["chunk"]?.Value<string>() ?? ""
                        });
                        break;

                    default:
                        Log($"未知消息类型：{type}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Log($"处理消息失败：{ex.Message}");
            }
        }

        // P1-B：Authorization 走 per-request HttpRequestMessage，不再共享 DefaultRequestHeaders；
        // 即便多个 POST 并发也不会互相 Clear 同一全局集合，杜绝 InvalidOperationException 与头错乱。
        private async Task<HttpResponseMessage> PostJsonAsync(string url, object payload)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    Encoding.UTF8,
                    "application/json"
                )
            };
            request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_token}");
            return await _httpClient.SendAsync(request);
        }

        // C 修复（"刷新就空"）：daemon WebSocket 是长连，只在状态变化时推增量。
        // 用户在 GUI 启动后再启停工具（Codex 关掉 / Claude Code 打开）时，host 端
        // 缓存可能跟实际状态脱节。WebView 右键刷新发回 ready 时，host 用这两个 GET
        // 主动重拉一次权威 snapshot 推给 WebView，比靠 host 端 cache replay 稳。
        public async Task<string?> FetchSourcesSnapshotJsonAsync()
        {
            try
            {
                var url = $"{_daemonUrl}/sources";
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_token}");
                var response = await _httpClient.SendAsync(request);
                if (!response.IsSuccessStatusCode) return null;
                return await response.Content.ReadAsStringAsync();
            }
            catch (Exception ex)
            {
                Log($"刷新来源快照失败：{ex.Message}");
                return null;
            }
        }

        public async Task<string?> FetchWorkflowSnapshotJsonAsync()
        {
            try
            {
                var url = $"{_daemonUrl}/workflow/snapshot";
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_token}");
                var response = await _httpClient.SendAsync(request);
                if (!response.IsSuccessStatusCode) return null;
                return await response.Content.ReadAsStringAsync();
            }
            catch (Exception ex)
            {
                Log($"刷新工作流快照失败：{ex.Message}");
                return null;
            }
        }

        public async Task<bool> SendReplyAsync(string sessionId, string text, string mode = "option")
        {
            try
            {
                var url = $"{_daemonUrl}/sessions/{sessionId}/reply";
                var response = await PostJsonAsync(url, new { text, mode });
                if (!response.IsSuccessStatusCode)
                {
                    var error = await response.Content.ReadAsStringAsync();
                    Log($"发送回复失败：{error}");
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                Log($"发送回复异常：{ex.Message}");
                return false;
            }
        }

        public async Task<bool> SendMonitorEventReplyAsync(string eventId, string text)
        {
            try
            {
                var url = $"{_daemonUrl}/events/{Uri.EscapeDataString(eventId)}/reply";
                var response = await PostJsonAsync(url, new { text });
                if (!response.IsSuccessStatusCode)
                {
                    var error = await response.Content.ReadAsStringAsync();
                    Log($"发送监控事件回复失败：{error}");
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                Log($"发送监控事件回复异常：{ex.Message}");
                return false;
            }
        }

        public async Task<MonitorSourceInfo?> RegisterSourceAsync(object payload)
        {
            try
            {
                var url = $"{_daemonUrl}/sources/register";
                var response = await PostJsonAsync(url, payload);
                var body = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    Log($"注册监控源失败：{body}");
                    return null;
                }
                return JsonConvert.DeserializeObject<MonitorSourceInfo>(body);
            }
            catch (Exception ex)
            {
                Log($"注册监控源异常：{ex.Message}");
                return null;
            }
        }

        public async Task<bool> UpdateWorkflowTaskStateAsync(string threadId, object payload)
        {
            try
            {
                var url = $"{_daemonUrl}/workflow/threads/{Uri.EscapeDataString(threadId)}/task-state";
                var response = await PostJsonAsync(url, payload);
                if (!response.IsSuccessStatusCode)
                {
                    var error = await response.Content.ReadAsStringAsync();
                    Log($"更新任务状态失败：{error}");
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                Log($"更新任务状态异常：{ex.Message}");
                return false;
            }
        }

        public async Task<bool> LaunchHandoffAsync(string threadId, object payload)
        {
            try
            {
                var url = $"{_daemonUrl}/workflow/threads/{Uri.EscapeDataString(threadId)}/handoff";
                var response = await PostJsonAsync(url, payload);
                if (!response.IsSuccessStatusCode)
                {
                    var error = await response.Content.ReadAsStringAsync();
                    Log($"启动任务转交失败：{error}");
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                Log($"启动任务转交异常：{ex.Message}");
                return false;
            }
        }

        public async Task DisconnectAsync()
        {
            try
            {
                if (_wsClient != null)
                {
                    await _wsClient.Stop(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "User disconnect");
                    _wsClient.Dispose();
                    _wsClient = null;
                }
                Log("已断开连接");
            }
            catch (Exception ex)
            {
                Log($"断开连接时出错：{ex.Message}");
            }
        }

        public async Task<bool> ReconnectAsync()
        {
            Log("开始重新连接...");
            await DisconnectAsync();
            await Task.Delay(500); // 等待一下再重连
            return await ConnectAsync();
        }

        private void Log(string message)
        {
            var logMessage = $"[{DateTime.Now:HH:mm:ss.fff}] {message}";
            // P1-D：仅触发事件由 MainWindow.AddLog → GuiLogWriter 统一异步落盘，
            // 避免 daemon 网络回调线程同步 File.AppendAllText 阻塞 + 与 AddLog 重复写盘。
            LogMessage?.Invoke(this, logMessage);
        }

        private static string MaskToken(string token)
        {
            if (string.IsNullOrEmpty(token)) return "";
            if (token.Length <= 8) return "********";
            return $"{token[..4]}...{token[^4..]}";
        }

        public void Dispose()
        {
            _wsClient?.Dispose();
            _httpClient?.Dispose();
        }
    }

    public class NotificationEventArgs : EventArgs
    {
        public string Title { get; set; } = "";
        public string Message { get; set; } = "";
        public string Source { get; set; } = "";
        public string ThreadId { get; set; } = "";
        public string SourceId { get; set; } = "";
        public string SessionId { get; set; } = "";
        public string Level { get; set; } = "";
        public string WindowTitle { get; set; } = "";
        public string Workspace { get; set; } = "";
        public long Timestamp { get; set; }
    }

    public class MonitorSourceEventArgs : EventArgs
    {
        public MonitorSourceInfo Source { get; set; } = new MonitorSourceInfo();
    }

    public class SourceDisconnectedEventArgs : EventArgs
    {
        public string SourceId { get; set; } = "";
    }

    public class MonitorEventArgs : EventArgs
    {
        public MonitorEventInfo Event { get; set; } = new MonitorEventInfo();
    }
}
