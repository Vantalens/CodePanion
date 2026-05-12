const pty = require('node-pty');
const path = require('path');
console.log('STAGE 1: spawning');
const term = pty.spawn('C:\\Windows\\System32\\cmd.exe', ['/c', 'echo hi from pty test'], {
  cols: 100,
  rows: 30,
  cwd: process.cwd(),
});
console.log('STAGE 2: spawned, pid=', term.pid);
let buf = '';
term.onData((d) => {
  process.stdout.write('[OUT] ' + JSON.stringify(d) + '\n');
  buf += d;
});
term.onExit((e) => {
  console.log('STAGE 3: exit', e);
  process.exit(0);
});
process.stdin.on('data', (d) => term.write(d.toString()));
console.log('STAGE 2.5: handlers set');
