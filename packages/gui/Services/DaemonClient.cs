using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Websocket.Client;
using RemindAI.Gui.Models;

namespace RemindAI.Gui.Services
{
    public class DaemonClient : IDisposable
    {
        private WebsocketClient? _wsClient;
        private readonly HttpClient _httpClient;
        private string _daemonUrl = "http://127.0.0.1:7777";
        private string _token = "";

        public event EventHandler? Connected;
        public event EventHandler? Disconnected;
        public event EventHandler<SessionInfo>? SessionRegistered;
        public event EventHandler<SessionPromptEventArgs>? SessionPrompt;
        public event EventHandler<SessionExitedEventArgs>? SessionExited;
        public event EventHandler<string>? LogMessage;

        public DaemonClient()
        {
            _httpClient = new HttpClient();
            LoadConfig();
        }

        private void LoadConfig()
        {
            try
            {
                var configPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".remindai",
                    "config.json"
                );

                if (File.Exists(configPath))
                {
                    var json = File.ReadAllText(configPath);
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

        public async Task ConnectAsync()
        {
            try
            {
                // 检查 daemon 健康状态
                var healthUrl = $"{_daemonUrl}/health";
                var response = await _httpClient.GetAsync(healthUrl);

                if (!response.IsSuccessStatusCode)
                {
                    Log("Daemon 未运行");
                    return;
                }

                // 连接 WebSocket
                var wsUrl = $"ws://127.0.0.1:{new Uri(_daemonUrl).Port}/ws?token={_token}&role=observer";
                _wsClient = new WebsocketClient(new Uri(wsUrl));

                _wsClient.ReconnectTimeout = TimeSpan.FromSeconds(30);
                _wsClient.ReconnectionHappened.Subscribe(info =>
                {
                    Log($"WebSocket 重连：{info.Type}");
                    if (info.Type == ReconnectionType.Initial)
                    {
                        Connected?.Invoke(this, EventArgs.Empty);
                    }
                });

                _wsClient.DisconnectionHappened.Subscribe(info =>
                {
                    Log($"WebSocket 断开：{info.Type}");
                    Disconnected?.Invoke(this, EventArgs.Empty);
                });

                _wsClient.MessageReceived.Subscribe(msg =>
                {
                    HandleWebSocketMessage(msg.Text);
                });

                await _wsClient.Start();
                Log("WebSocket 已连接");
            }
            catch (Exception ex)
            {
                Log($"连接失败：{ex.Message}");
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

                    case "session-output":
                        // 可选：处理会话输出
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

        public async Task SendReplyAsync(string sessionId, string text)
        {
            try
            {
                var url = $"{_daemonUrl}/sessions/{sessionId}/reply";
                var payload = new { text };
                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    Encoding.UTF8,
                    "application/json"
                );

                _httpClient.DefaultRequestHeaders.Clear();
                _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {_token}");

                var response = await _httpClient.PostAsync(url, content);

                if (!response.IsSuccessStatusCode)
                {
                    var error = await response.Content.ReadAsStringAsync();
                    Log($"发送回复失败：{error}");
                }
            }
            catch (Exception ex)
            {
                Log($"发送回复异常：{ex.Message}");
            }
        }

        private void Log(string message)
        {
            LogMessage?.Invoke(this, message);
        }

        public void Dispose()
        {
            _wsClient?.Dispose();
            _httpClient?.Dispose();
        }
    }
}
