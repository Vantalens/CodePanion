import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['packages/daemon/src/daemon-entry.ts'],
  outfile: 'packages/daemon/bundle/daemon.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
});
