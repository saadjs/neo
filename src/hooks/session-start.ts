import type { SessionStartHandler } from "./types";
import { getLogger } from "../logging/index";
import { logSession, setActiveSession } from "../logging/conversations";
import { readDailyMemory, isChannelChat } from "../memory/daily";
import { getRuntimeContextSection } from "../runtime/state";
import { formatAnomaliesForContext } from "../logging/anomalies";

export function sessionStart(chatId: string, getModel: () => string): SessionStartHandler {
  return async (input, invocation) => {
    const log = getLogger();
    log.info(
      { chatId, source: input.source, sessionId: invocation.sessionId },
      "hook:session-start",
    );

    // --- Bookkeeping (migrated from agent.ts) ---
    try {
      setActiveSession(chatId, invocation.sessionId);
    } catch (err) {
      log.warn({ chatId, err }, "hook:session-start failed to set active session");
    }

    if (input.source === "new") {
      try {
        logSession(invocation.sessionId, chatId, getModel());
      } catch (err) {
        log.warn({ chatId, err }, "hook:session-start failed to log session");
      }
    }

    // --- Dynamic context injection ---
    try {
      const parts: string[] = [];
      const isChannel = isChannelChat(chatId);

      const todayMemory = await readDailyMemory();
      if (todayMemory.trim()) {
        parts.push(`## Today's Memory\n\n${todayMemory}`);
      }

      if (isChannel) {
        const channelTodayMemory = await readDailyMemory(undefined, chatId);
        if (channelTodayMemory.trim()) {
          parts.push(`## Channel Memory (Today)\n\n${channelTodayMemory}`);
        }
      }

      const runtimeContext = getRuntimeContextSection();
      if (runtimeContext) {
        parts.push(runtimeContext);
      }

      const anomalies = formatAnomaliesForContext();
      if (anomalies) {
        parts.push(anomalies);
      }

      if (parts.length > 0) {
        return { additionalContext: parts.join("\n\n---\n\n") };
      }
    } catch (err) {
      log.warn({ chatId, err }, "hook:session-start failed to build dynamic context");
    }
  };
}
