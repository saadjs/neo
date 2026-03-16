import type { SessionConfig } from "@github/copilot-sdk";

/**
 * Re-derive hook types from the SDK's SessionConfig since the individual
 * handler types are not re-exported from the package entry point.
 */
export type SessionHooks = NonNullable<SessionConfig["hooks"]>;
export type PreToolUseHandler = NonNullable<SessionHooks["onPreToolUse"]>;
export type PostToolUseHandler = NonNullable<SessionHooks["onPostToolUse"]>;
export type ErrorOccurredHandler = NonNullable<SessionHooks["onErrorOccurred"]>;
export type SessionStartHandler = NonNullable<SessionHooks["onSessionStart"]>;
export type SessionEndHandler = NonNullable<SessionHooks["onSessionEnd"]>;
