using System;
using System.IO;
using System.Threading;
using System.Windows;
using CodePanion.Gui.Services;

namespace CodePanion.Gui
{
    public partial class App : Application
    {
        private const string SingleInstanceMutexName = @"Local\CodePanion.Gui.SingleInstance";
        private const string ShowMainWindowEventName = @"Local\CodePanion.Gui.ShowMainWindow";
        private Mutex? _singleInstanceMutex;
        private EventWaitHandle? _showMainWindowEvent;
        private RegisteredWaitHandle? _showMainWindowRegistration;

        protected override void OnStartup(StartupEventArgs e)
        {
            _singleInstanceMutex = new Mutex(true, SingleInstanceMutexName, out var createdNew);
            if (!createdNew)
            {
                try
                {
                    using var signal = EventWaitHandle.OpenExisting(ShowMainWindowEventName);
                    signal.Set();
                }
                catch
                {
                }
                Shutdown();
                return;
            }

            _showMainWindowEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowMainWindowEventName);
            _showMainWindowRegistration = ThreadPool.RegisterWaitForSingleObject(
                _showMainWindowEvent,
                (_, _) => Dispatcher.BeginInvoke(new Action(ShowMainWindowFromSignal)),
                null,
                Timeout.Infinite,
                false);

            base.OnStartup(e);

            // N-21：未捕获异常先落 gui-crash.log（不依赖 MessageBox），再异步弹一个不阻塞主线程的提示框。
            // 这样即便 MessageBox 被用户秒关掉，事故现场也已经写入磁盘，可以事后排查。
            DispatcherUnhandledException += (sender, args) =>
            {
                try
                {
                    WriteCrashLog("Dispatcher", args.Exception);
                }
                catch
                {
                    // 崩溃日志失败时不能再抛
                }

                try
                {
                    GuiLogWriter.Instance.Enqueue(
                        $"[{DateTime.Now:HH:mm:ss}] [致命] {args.Exception.GetType().Name}: {args.Exception.Message}");
                }
                catch
                {
                }

                MessageBox.Show(
                    $"发生错误：{args.Exception.Message}\n\n详情已写入日志目录的 gui-crash.log。",
                    "CodePanion 错误",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
                args.Handled = true;
            };

            AppDomain.CurrentDomain.UnhandledException += (sender, args) =>
            {
                try
                {
                    WriteCrashLog("AppDomain", args.ExceptionObject as Exception ?? new Exception(args.ExceptionObject?.ToString() ?? "unknown"));
                }
                catch
                {
                }
            };
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _showMainWindowRegistration?.Unregister(null);
            _showMainWindowEvent?.Dispose();
            _singleInstanceMutex?.ReleaseMutex();
            _singleInstanceMutex?.Dispose();
            base.OnExit(e);
        }

        private void ShowMainWindowFromSignal()
        {
            if (MainWindow == null) return;
            MainWindow.Show();
            MainWindow.WindowState = WindowState.Normal;
            MainWindow.Activate();
        }

        private static void WriteCrashLog(string source, Exception ex)
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodePanion", "logs");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "gui-crash.log");
            var line = $"[{DateTime.Now:O}] [{source}] {ex.GetType().FullName}: {ex.Message}\n{ex.StackTrace}\n";
            File.AppendAllText(path, line);
        }
    }
}
