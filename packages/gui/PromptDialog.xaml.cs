using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace RemindAI.Gui
{
    public partial class PromptDialog : Window
    {
        private readonly string _sessionId;
        private readonly string[]? _options;

        public event EventHandler<string>? ReplySubmitted;

        public PromptDialog(string sessionId, string promptText, string[]? options = null)
        {
            InitializeComponent();

            _sessionId = sessionId;
            _options = options;

            SessionIdText.Text = sessionId;
            PromptTextBox.Text = promptText;

            // 如果有选项，显示选项按钮
            if (options != null && options.Length > 0)
            {
                OptionsPanel.Visibility = Visibility.Visible;
                OptionsItemsControl.ItemsSource = options;
            }

            // 聚焦到输入框
            InputTextBox.Focus();

            // 播放提示音
            System.Media.SystemSounds.Asterisk.Play();
        }

        private void Send_Click(object sender, RoutedEventArgs e)
        {
            SendReply();
        }

        private void Option_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button button && button.Tag is string option)
            {
                // 从选项中提取数字（如果是 "1. xxx" 格式）
                var parts = option.Split(new[] { '.' }, 2);
                if (parts.Length > 0)
                {
                    var reply = parts[0].Trim();
                    ReplySubmitted?.Invoke(this, reply + "\n");
                    Close();
                }
            }
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void InputTextBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
            {
                e.Handled = true;
                SendReply();
            }
        }

        private void SendReply()
        {
            var input = InputTextBox.Text;
            if (string.IsNullOrWhiteSpace(input))
            {
                MessageBox.Show("请输入内容", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            // 自动添加换行符
            if (!input.EndsWith("\n"))
            {
                input += "\n";
            }

            ReplySubmitted?.Invoke(this, input);
            Close();
        }
    }
}
