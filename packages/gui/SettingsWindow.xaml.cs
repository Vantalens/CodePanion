using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Navigation;

namespace RemindAI.Gui
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
                    ".remindai",
                    "config.json"
                );

                ConfigPathTextBox.Text = configPath;

                if (File.Exists(configPath))
                {
                    var json = File.ReadAllText(configPath);
                    var config = Newtonsoft.Json.Linq.JObject.Parse(json);

                    if (config["port"] != null)
                    {
                        PortTextBox.Text = config["port"]!.Value<int>().ToString();
                    }

                    if (config["token"] != null)
                    {
                        TokenTextBox.Text = config["token"]!.Value<string>();
                    }

                    if (config["toast"] != null)
                    {
                        var toast = config["toast"];
                        if (toast!["enabled"] != null)
                        {
                            NotificationEnabledCheckBox.IsChecked = toast["enabled"]!.Value<bool>();
                        }
                        if (toast["soundOnPrompt"] != null)
                        {
                            NotificationSoundCheckBox.IsChecked = toast["soundOnPrompt"]!.Value<bool>();
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
                // TODO: 实现保存设置逻辑
                MessageBox.Show(
                    "设置已保存",
                    "成功",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information
                );
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
