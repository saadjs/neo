import type { SessionHooks } from "./types.js";
import { preToolUse } from "./pre-tool.js";
import { postToolUse } from "./post-tool.js";
import { errorOccurred } from "./error.js";
import { sessionEnd } from "./session-lifecycle.js";

export function buildSessionHooks(chatId: number): SessionHooks {
  return {
    onPreToolUse: preToolUse(chatId),
    onPostToolUse: postToolUse(chatId),
    onErrorOccurred: errorOccurred(chatId),
    onSessionEnd: sessionEnd(chatId),
  };
}
