#!/usr/bin/env node
import { bootDaemon } from './daemon/boot.js';

async function main() {
  await bootDaemon();
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
