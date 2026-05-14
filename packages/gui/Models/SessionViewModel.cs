using System;
using System.ComponentModel;

namespace RemindAI.Gui.Models
{
    public class SessionViewModel : INotifyPropertyChanged
    {
        private string _status;
        private string? _lastPrompt;
        private int? _exitCode;

        public string Id { get; set; }
        public string Command { get; set; }
        public string[] Args { get; set; }
        public string? Cwd { get; set; }
        public string? Source { get; set; }
        public string? SourceId { get; set; }
        public string? WindowTitle { get; set; }
        public string? Workspace { get; set; }
        public long StartedAt { get; set; }

        public string Status
        {
            get => _status;
            set
            {
                if (_status != value)
                {
                    _status = value;
                    OnPropertyChanged(nameof(Status));
                    OnPropertyChanged(nameof(StatusText));
                }
            }
        }

        public string? LastPrompt
        {
            get => _lastPrompt;
            set
            {
                if (_lastPrompt != value)
                {
                    _lastPrompt = value;
                    OnPropertyChanged(nameof(LastPrompt));
                }
            }
        }

        public int? ExitCode
        {
            get => _exitCode;
            set
            {
                if (_exitCode != value)
                {
                    _exitCode = value;
                    OnPropertyChanged(nameof(ExitCode));
                }
            }
        }

        public string StatusText
        {
            get
            {
                return Status switch
                {
                    "running" => "运行中",
                    "waiting" => "等待输入",
                    "exited" => "已结束",
                    _ => "未知"
                };
            }
        }

        public string StartedAtText
        {
            get
            {
                var dt = DateTimeOffset.FromUnixTimeMilliseconds(StartedAt).LocalDateTime;
                return dt.ToString("yyyy-MM-dd HH:mm:ss");
            }
        }

        public SessionViewModel(SessionInfo info)
        {
            Id = info.Id;
            Command = info.Command;
            Args = info.Args ?? Array.Empty<string>();
            Cwd = info.Cwd;
            Source = info.Source;
            SourceId = info.SourceId;
            WindowTitle = info.WindowTitle;
            Workspace = info.Workspace;
            StartedAt = info.StartedAt;
            _status = info.Status;
            _lastPrompt = info.LastPrompt;
            _exitCode = info.ExitCode;
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        protected virtual void OnPropertyChanged(string propertyName)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }

    public class SessionInfo
    {
        public string Id { get; set; } = "";
        public string Command { get; set; } = "";
        public string[]? Args { get; set; }
        public string? Cwd { get; set; }
        public string? Source { get; set; }
        public string? SourceId { get; set; }
        public string? WindowTitle { get; set; }
        public string? Workspace { get; set; }
        public long StartedAt { get; set; }
        public string Status { get; set; } = "running";
        public int? ExitCode { get; set; }
        public string? LastPrompt { get; set; }
    }

    public class SessionPromptEventArgs : EventArgs
    {
        public string SessionId { get; set; } = "";
        public string LastLines { get; set; } = "";
        public string[]? Options { get; set; }
        public string? FullOutput { get; set; }  // 新增
    }

    public class SessionExitedEventArgs : EventArgs
    {
        public string SessionId { get; set; } = "";
        public int ExitCode { get; set; }
        public long DurationMs { get; set; }
    }
}
