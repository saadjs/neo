import type { SessionHooks } from "./types";
import { sessionStart } from "./session-start";
import { preToolUse } from "./pre-tool";
import { postToolUse } from "./post-tool";
import { errorOccurred } from "./error";
import { sessionEnd } from "./session-lifecycle";
import { getModelForChat } from "../agent";
import { config } from "../config";

export function buildSessionHooks(chatId: number): SessionHooks {
  return {
    onSessionStart: sessionStart(chatId, () => getModelForChat(chatId)),
    onPreToolUse: preToolUse(chatId, config.service.systemdUnit),
    onPostToolUse: postToolUse(chatId),
    onErrorOccurred: errorOccurred(chatId),
    onSessionEnd: sessionEnd(chatId),
  };
}
