import type { PostToolUseHandler } from "./types.js";
import { getLogger } from "../logging/index.js";

export function postToolUse(chatId: number): PostToolUseHandler {
  return (input) => {
    const log = getLogger();

    if (input.toolName === "browser") {
      const args = input.toolArgs as Record<string, unknown> | null;
      if (args && args.action === "screenshot") {
        log.debug({ chatId }, "hook:post-tool-use browser screenshot taken");
      }
    }
  };
}
