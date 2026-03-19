import type { SessionHooks } from "./types";
import { sessionStart } from "./session-start";
import { preToolUse } from "./pre-tool";
import { postToolUse } from "./post-tool";
import { errorOccurred } from "./error";
import { sessionEnd } from "./session-lifecycle";
import { getModelForChat } from "../agent";

export function buildSessionHooks(chatId: string): SessionHooks {
  return {
    onSessionStart: sessionStart(chatId, () => getModelForChat(chatId)),
    onPreToolUse: preToolUse(chatId),
    onPostToolUse: postToolUse(chatId),
    onErrorOccurred: errorOccurred(chatId),
    onSessionEnd: sessionEnd(chatId),
  };
}
