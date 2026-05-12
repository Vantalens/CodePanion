const pty = require('node-pty');
const term = pty.spawn('C:\\Windows\\System32\\cmd.exe', ['/c', 'echo hi from cmd'], {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
});
let buf = '';
term.onData((d) => {
  buf += d;
});
term.onExit(({ exitCode }) => {
  console.log('OUTPUT:', JSON.stringify(buf));
  console.log('EXIT:', exitCode);
  process.exit(0);
});
