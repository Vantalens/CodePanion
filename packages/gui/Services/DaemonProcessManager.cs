using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace CodePanion.Gui.Services
{
    public static class DaemonProcessManager
    {
        // GUI-owned daemon. Only populated by EnsureStartedAsync; never reaches user's
        // pre-existing CLI daemon (IsHealthyAsync short-circuits before we Start).
        private static Process? _managedProcess;

        // JobObject handle stays open in the GUI process for its full lifetime. When
        // the GUI dies for any reason (clean exit, crash, taskkill /f), Windows closes
        // this handle, and JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE causes the child daemon
        // to be killed automatically — eliminating orphans even when our Stop() never runs.
        private static IntPtr _jobHandle = IntPtr.Zero;
        private static readonly object _jobLock = new();

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
                if (process != null)
                {
                    Interlocked.Exchange(ref _managedProcess, process)?.Dispose();
                    TryBindToJobObject(process, log);
                }
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

        public static void Stop(Action<string>? log = null)
        {
            var process = Interlocked.Exchange(ref _managedProcess, null);
            if (process == null) return;
            try
            {
                if (process.HasExited)
                {
                    return;
                }
                log?.Invoke($"正在停止 GUI 启动的 daemon（PID={process.Id}）");
                process.Kill(entireProcessTree: true);
                if (!process.WaitForExit(3000))
                {
                    log?.Invoke("daemon 在 3 秒内未退出。");
                }
            }
            catch (Exception ex)
            {
                log?.Invoke($"停止 daemon 失败：{ex.Message}");
            }
            finally
            {
                try { process.Dispose(); } catch { }
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

        private static void TryBindToJobObject(Process process, Action<string> log)
        {
            if (!OperatingSystem.IsWindows()) return;
            try
            {
                IntPtr job;
                lock (_jobLock)
                {
                    if (_jobHandle == IntPtr.Zero)
                    {
                        _jobHandle = CreateJobObject(IntPtr.Zero, null);
                        if (_jobHandle == IntPtr.Zero)
                        {
                            log($"JobObject 创建失败（Win32 错误 {Marshal.GetLastWin32Error()}），GUI 异常退出时 daemon 可能成为孤儿");
                            return;
                        }

                        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                        {
                            BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                            {
                                LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                            }
                        };
                        var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
                        var buffer = Marshal.AllocHGlobal(size);
                        try
                        {
                            Marshal.StructureToPtr(info, buffer, false);
                            if (!SetInformationJobObject(_jobHandle, JobObjectExtendedLimitInformation, buffer, (uint)size))
                            {
                                log($"JobObject 配置失败（Win32 错误 {Marshal.GetLastWin32Error()}）");
                                CloseHandle(_jobHandle);
                                _jobHandle = IntPtr.Zero;
                                return;
                            }
                        }
                        finally
                        {
                            Marshal.FreeHGlobal(buffer);
                        }
                    }
                    job = _jobHandle;
                }

                if (!AssignProcessToJobObject(job, process.Handle))
                {
                    log($"将 daemon 绑定到 JobObject 失败（Win32 错误 {Marshal.GetLastWin32Error()}），GUI 异常退出时 daemon 可能成为孤儿");
                }
            }
            catch (Exception ex)
            {
                log($"JobObject 绑定异常：{ex.Message}");
            }
        }

        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);
    }
}
