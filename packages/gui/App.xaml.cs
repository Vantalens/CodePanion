using System.Windows;

namespace RemindAI.Gui
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // 全局异常处理
            DispatcherUnhandledException += (sender, args) =>
            {
                MessageBox.Show(
                    $"发生错误：{args.Exception.Message}",
                    "RemindAI 错误",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
                args.Handled = true;
            };
        }
    }
}
