import type { PostToolUseHandler } from "./types";
import { getLogger } from "../logging/index";

export function postToolUse(chatId: string): PostToolUseHandler {
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
