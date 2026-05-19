import { runWithPty } from '../pty/runner.js';

export async function runCommand(argv: { _: (string | number)[] }) {
  // After 'run', everything after `--` is the command. yargs collects them in `_`.
  const rest = argv._.slice(1).map(String);
  if (rest.length === 0) {
    console.error('usage: codepanion run -- <command> [args...]');
    process.exit(2);
  }
  const [command, ...args] = rest;
  console.error(`[codepanion-debug] command=${JSON.stringify(command)} args=${JSON.stringify(args)}`);
  const exitCode = await runWithPty({ command, args });
  process.exit(exitCode);
}
