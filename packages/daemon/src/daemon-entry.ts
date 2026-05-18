#!/usr/bin/env node
import { bootDaemon } from './daemon/boot.js';

bootDaemon().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
