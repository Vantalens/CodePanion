import { postReply } from '../shared/client.js';

export async function replyCommand(args: { sessionId: string; text: string; newline?: boolean }) {
  const text = args.newline === false ? args.text : args.text + '\n';
  await postReply(args.sessionId, text);
  console.log(`[codepanion] replied to ${args.sessionId}`);
}
