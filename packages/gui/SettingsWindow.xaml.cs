using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Navigation;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace CodePanion.Gui
{
    public partial class SettingsWindow : Window
    {
        public SettingsWindow()
        {
            InitializeComponent();
            LoadSettings();
        }

        private void LoadSettings()
        {
            try
            {
                var configPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".codepanion",
                    "config.json"
                );

                ConfigPathTextBox.Text = configPath;

                if (File.Exists(configPath))
                {
                    var json = File.ReadAllText(configPath, Encoding.UTF8);
                    var config = JObject.Parse(json);

                    if (config["port"] != null)
                    {
                        PortTextBox.Text = config["port"]!.ToObject<int>().ToString();
                    }

                    if (config["token"] != null)
                    {
                        TokenTextBox.Text = config["token"]!.ToObject<string>();
                    }

                    if (config["toast"] != null)
                    {
                        var toast = config["toast"];
                        if (toast!["enabled"] != null)
                        {
                            NotificationEnabledCheckBox.IsChecked = toast["enabled"]!.ToObject<bool>();
                        }
                        if (toast["soundOnPrompt"] != null)
                        {
                            NotificationSoundCheckBox.IsChecked = toast["soundOnPrompt"]!.ToObject<bool>();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"加载设置失败：{ex.Message}",
                    "错误",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
            }
        }

        private void Save_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var configPath = ConfigPathTextBox.Text;
                if (string.IsNullOrWhiteSpace(configPath))
                {
                    configPath = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        ".codepanion",
                        "config.json"
                    );
                }

                if (!int.TryParse(PortTextBox.Text.Trim(), out var port) || port < 1024 || port > 65535)
                {
                    MessageBox.Show(
                        "端口必须是 1024 到 65535 之间的数字。",
                        "设置无效",
                        MessageBoxButton.OK,
                        MessageBoxImage.Warning
                    );
                    return;
                }

                var config = LoadOrCreateConfig(configPath);
                config["port"] = port;

                var toast = config["toast"] as JObject ?? new JObject();
                toast["enabled"] = NotificationEnabledCheckBox.IsChecked == true;
                toast["soundOnPrompt"] = NotificationSoundCheckBox.IsChecked == true;
                if (toast["soundOnDone"] == null) toast["soundOnDone"] = true;
                config["toast"] = toast;

                var dir = Path.GetDirectoryName(configPath);
                if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(configPath, config.ToString(Formatting.Indented), Encoding.UTF8);

                MessageBox.Show(
                    "设置已保存",
                    "成功",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information
                );
                DialogResult = true;
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"保存设置失败：{ex.Message}",
                    "错误",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
            }
        }

        private static JObject LoadOrCreateConfig(string configPath)
        {
            if (File.Exists(configPath))
            {
                return JObject.Parse(File.ReadAllText(configPath, Encoding.UTF8));
            }

            return new JObject
            {
                ["port"] = 7777,
                ["token"] = Guid.NewGuid().ToString("N"),
                ["promptIdleMs"] = 800,
                ["toast"] = new JObject
                {
                    ["enabled"] = true,
                    ["soundOnPrompt"] = true,
                    ["soundOnDone"] = true
                },
                ["monitors"] = new JObject
                {
                    ["cli"] = true,
                    ["vscode"] = true,
                    ["codexDesktop"] = true,
                    ["aiTools"] = true
                }
            };
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void Hyperlink_RequestNavigate(object sender, RequestNavigateEventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = e.Uri.AbsoluteUri,
                    UseShellExecute = true
                });
                e.Handled = true;
            }
            catch
            {
                // 忽略错误
            }
        }
    }
}
