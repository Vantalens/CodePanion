#!/usr/bin/env node
import { bootDaemon } from './daemon/boot.js';
import { runHandoffRunner } from './pty/handoffRunner.js';

const argv = process.argv.slice(2);

async function main() {
  if (argv[0] === '__handoff-runner') {
    const configPath = argv[1];
    if (!configPath) {
      console.error('usage: codepanion daemon-entry __handoff-runner <config-path>');
      process.exit(2);
    }
    const exitCode = await runHandoffRunner(configPath);
    process.exit(exitCode);
  }

  await bootDaemon();
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
