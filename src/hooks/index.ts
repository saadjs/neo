import type { SessionHooks } from "./types.js";
import { sessionStart } from "./session-start.js";
import { preToolUse } from "./pre-tool.js";
import { postToolUse } from "./post-tool.js";
import { errorOccurred } from "./error.js";
import { sessionEnd } from "./session-lifecycle.js";
import { getModelForChat } from "../agent.js";

export function buildSessionHooks(chatId: number): SessionHooks {
  return {
    onSessionStart: sessionStart(chatId, () => getModelForChat(chatId)),
    onPreToolUse: preToolUse(chatId),
    onPostToolUse: postToolUse(chatId),
    onErrorOccurred: errorOccurred(chatId),
    onSessionEnd: sessionEnd(chatId),
  };
}
