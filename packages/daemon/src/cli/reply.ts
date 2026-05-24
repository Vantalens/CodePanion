import { postReply } from '../shared/client.js';

export async function replyCommand(args: {
  sessionId: string;
  text: string;
  newline?: boolean;
  freeform?: boolean;
}) {
  if (args.freeform) {
    // freeform 路径：换行由 runner 收到 inject-text 后兜底补，CLI 不再追 \n，
    // 避免与 runner 的 endsWith('\n') 兜底叠加成双换行。--newline 仅对默认 option 路径有效。
    await postReply(args.sessionId, args.text, 'freeform');
    console.log(`[codepanion] replied (freeform) to ${args.sessionId}`);
    return;
  }
  const text = args.newline === false ? args.text : args.text + '\n';
  await postReply(args.sessionId, text);
  console.log(`[codepanion] replied to ${args.sessionId}`);
}
