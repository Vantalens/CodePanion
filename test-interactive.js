const readline = require('readline');

console.log('RemindAI 测试脚本');
console.log('==================');
console.log('');
console.log('这是一个测试提示检测的脚本。');
console.log('');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('请选择一个选项 (1/2/3): ', (answer) => {
  console.log('');
  console.log('你选择了:', answer);
  console.log('');

  rl.question('确认继续? (y/n): ', (confirm) => {
    console.log('');
    if (confirm.toLowerCase() === 'y') {
      console.log('✓ 测试完成！');
    } else {
      console.log('✗ 测试取消');
    }
    rl.close();
  });
});
