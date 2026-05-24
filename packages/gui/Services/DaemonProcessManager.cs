using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace CodePanion.Gui.Services
{
    public static class DaemonProcessManager
    {
        public static async Task<bool> EnsureStartedAsync(string daemonUrl, Action<string> log)
        {
            if (await IsHealthyAsync(daemonUrl)) return true;

            var daemonPath = FindDaemonEntry();
            if (daemonPath == null)
            {
                log("未找到随软件发布的 daemon 文件，无法自动启动。");
                return false;
            }

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = FindNodeExecutable(),
                    Arguments = $"\"{daemonPath}\" --daemon",
                    WorkingDirectory = Path.GetDirectoryName(daemonPath) ?? AppDomain.CurrentDomain.BaseDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                startInfo.Environment["CODEPANION_STARTED_BY_GUI"] = "1";

                var process = Process.Start(startInfo);
                log($"已在后台启动 daemon：PID={process?.Id}");

                for (var i = 0; i < 40; i++)
                {
                    await Task.Delay(250);
                    if (await IsHealthyAsync(daemonUrl)) return true;
                }

                log("daemon 已启动但健康检查未及时通过。");
                return false;
            }
            catch (Exception ex)
            {
                log($"自动启动 daemon 失败：{ex.Message}");
                return false;
            }
        }

        private static async Task<bool> IsHealthyAsync(string daemonUrl)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(600) };
                var response = await client.GetAsync($"{daemonUrl}/health");
                return response.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        private static string FindNodeExecutable()
        {
            var configured = Environment.GetEnvironmentVariable("CODEPANION_NODE_PATH");
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

            var localNode = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime", "node.exe");
            if (File.Exists(localNode)) return localNode;

            return "node.exe";
        }

        private static string? FindDaemonEntry()
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var bundled = Path.Combine(baseDir, "daemon", "daemon.cjs");
            if (File.Exists(bundled)) return bundled;

            var dir = new DirectoryInfo(baseDir);
            while (dir != null)
            {
                var bundle = Path.Combine(dir.FullName, "packages", "daemon", "bundle", "daemon.cjs");
                if (File.Exists(bundle)) return bundle;

                var compiled = Path.Combine(dir.FullName, "packages", "daemon", "dist", "daemon-entry.js");
                if (File.Exists(compiled)) return compiled;

                dir = dir.Parent;
            }

            return null;
        }
    }
}
