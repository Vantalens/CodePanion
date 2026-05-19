#!/usr/bin/env node
import { bootDaemon } from './daemon/boot.js';
import { runCli } from './cli/index.js';
import { runWithPty } from './pty/runner.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--daemon')) {
    await bootDaemon();
    return;
  }

  // Special-case: `codepanion run -- <command> [args...]`
  // We bypass yargs to keep argv pristine and avoid strict-mode conflicts with `--` separator.
  if (argv[0] === 'run') {
    const sep = argv.indexOf('--');
    const rest = sep >= 0 ? argv.slice(sep + 1) : argv.slice(1);
    if (rest.length === 0) {
      console.error('usage: codepanion run -- <command> [args...]');
      process.exit(2);
    }
    const [command, ...args] = rest;
    const exitCode = await runWithPty({ command, args });
    process.exit(exitCode);
  }

  await runCli(process.argv);
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
