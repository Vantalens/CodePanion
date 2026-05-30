#!/usr/bin/env node
import { bootDaemon } from './daemon/boot.js';
import { runCli } from './cli/index.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--daemon')) {
    await bootDaemon();
    return;
  }

  await runCli(process.argv);
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
