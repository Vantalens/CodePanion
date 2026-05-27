import esbuild from 'esbuild';

// S-2：node-pty 是 native binding 包（conpty.node / pty.node + conpty_console_list_agent.js 子进程），
// 强行 bundle 会让 utils.loadNativeModule 的相对路径解析（'../build/Release/<name>.node'）失效，
// 并把 forked agent 脚本路径写死成 bundle 内的虚拟模块，运行时直接报 MODULE_NOT_FOUND。
// 解决方案：声明 external，运行时由 Node 走 require resolution 命中相邻的 node_modules（开发模式
// 走仓库根 node_modules；portable 包由 package-windows.ps1 拷贝 node-pty 子集到 daemon 旁边）。
//
// 关键 external 列表：
//   - node-pty           native binding + forked agent
//   - pino / pino-pretty / sonic-boom / thread-stream
//       pino transport / sonic-boom worker 在 bundle 后会丢失 Worker 入口脚本路径。
//       daemon 当前 dest 走 sync:false 仍能跑，但保持 external 让 pino 内部 path 解析维持原状，
//       未来切到 transport 不会爆炸。
//   - bufferutil / utf-8-validate
//       ws 的可选 native 加速；缺失时 ws 自己降级，但 bundle 把 require 静态化会让降级路径失活。
const externals = [
  'node-pty',
  'pino',
  'pino-pretty',
  'sonic-boom',
  'thread-stream',
  'bufferutil',
  'utf-8-validate',
];

await esbuild.build({
  entryPoints: ['packages/daemon/src/daemon-entry.ts'],
  outfile: 'packages/daemon/bundle/daemon.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  external: externals,
});
