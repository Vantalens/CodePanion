using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace CodePanion.Gui.Services
{
    // P1-D：异步消费 + 按大小滚动的 gui.log 写入器。
    // - 队列 bounded(10_000) + DropOldest，避免日志风暴时无限挤占内存；
    // - 后台单 Worker 写盘，UI 线程不再被 File.AppendAllText 同步阻塞；
    // - 文件超过 MaxBytes 时滚动为 gui.log.1/.2/.3，最旧的被覆盖。
    internal sealed class GuiLogWriter : IDisposable
    {
        private const long MaxBytes = 5 * 1024 * 1024;
        private const int MaxRolled = 3;

        public static GuiLogWriter Instance { get; } = new GuiLogWriter();

        private readonly string _logPath;
        private readonly Channel<string> _channel;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly Task _worker;
        private long _currentBytes;

        private GuiLogWriter()
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".codepanion"
            );
            try { Directory.CreateDirectory(dir); } catch { }
            _logPath = Path.Combine(dir, "gui.log");

            try
            {
                var info = new FileInfo(_logPath);
                _currentBytes = info.Exists ? info.Length : 0;
            }
            catch
            {
                _currentBytes = 0;
            }

            _channel = Channel.CreateBounded<string>(new BoundedChannelOptions(10_000)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false
            });
            _worker = Task.Run(ConsumeAsync);
        }

        public void Enqueue(string message)
        {
            if (string.IsNullOrEmpty(message)) return;
            _channel.Writer.TryWrite(message);
        }

        private async Task ConsumeAsync()
        {
            try
            {
                await foreach (var message in _channel.Reader.ReadAllAsync(_cts.Token))
                {
                    try
                    {
                        WriteOne(message);
                    }
                    catch
                    {
                        // 单条写入失败不应让后台 worker 终止。
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // shutdown 路径，下面 Flush 收尾。
            }
        }

        private void WriteOne(string message)
        {
            var line = message + Environment.NewLine;
            var bytes = Encoding.UTF8.GetByteCount(line);
            if (_currentBytes + bytes > MaxBytes)
            {
                Rotate();
                _currentBytes = 0;
            }
            File.AppendAllText(_logPath, line, Encoding.UTF8);
            _currentBytes += bytes;
        }

        private void Rotate()
        {
            try
            {
                for (int i = MaxRolled; i >= 1; i--)
                {
                    var src = i == 1 ? _logPath : $"{_logPath}.{i - 1}";
                    var dst = $"{_logPath}.{i}";
                    if (!File.Exists(src)) continue;
                    if (File.Exists(dst)) File.Delete(dst);
                    File.Move(src, dst);
                }
            }
            catch
            {
                // 任何 rotation 失败都不应阻塞写入；下一次 WriteOne 会再尝试覆盖写。
            }
        }

        public void Dispose()
        {
            try
            {
                _channel.Writer.TryComplete();
                _cts.Cancel();
                _worker.Wait(TimeSpan.FromSeconds(2));
            }
            catch
            {
            }
            finally
            {
                _cts.Dispose();
            }
        }
    }
}
