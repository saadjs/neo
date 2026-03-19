import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { SessionMetadata } from "@github/copilot-sdk";
import {
  createNewSession,
  deletePersistedSession,
  destroySession,
  getSessionForChat,
  listPersistedSessions,
  resumeSessionById,
} from "../agent";
import { getLogger } from "../logging/index";
import { getChatModelContext } from "./model-context";
import {
  SESSIONS_PER_PAGE,
  ACTION_PICKER_TTL_MS,
  ACTION_PICKER_MAX,
  SESSION_LABEL_MAX_CHARS,
  SESSION_SUMMARY_MAX_CHARS,
} from "../constants";

export async function handleNewSession(ctx: Context) {
  const chatId = String(ctx.chat!.id);
  const log = getLogger();

  await destroySession(chatId);
  await createNewSession({ chatId });

  log.info({ chatId }, "New session created via /new");

  const context = getChatModelContext(chatId);
  const message = context.overrideActive
    ? `Fresh session. Default model is \`${context.defaultModel}\`, using \`${context.currentModel}\` for this chat.`
    : `Fresh session. Default model is \`${context.defaultModel}\`, and this chat is using it.`;

  await ctx.reply(message, { parse_mode: "Markdown" });
}

// --- Session picker ---

interface SessionPickerState {
  createdAt: number;
  sessions: SessionMetadata[];
  activeSessionId: string | undefined;
  deleteMode: boolean;
}

const sessionPickers = new Map<string, SessionPickerState>();

function pruneExpiredPickers(now = Date.now()): void {
  for (const [id, picker] of sessionPickers) {
    if (now - picker.createdAt > ACTION_PICKER_TTL_MS) {
      sessionPickers.delete(id);
    }
  }
  while (sessionPickers.size > ACTION_PICKER_MAX) {
    const oldest = sessionPickers.keys().next().value;
    if (!oldest) break;
    sessionPickers.delete(oldest);
  }
}

function createPickerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildSessionLabel(session: SessionMetadata): string {
  const time = formatRelativeTime(session.modifiedTime);
  const summary = session.summary
    ? truncate(session.summary, SESSION_LABEL_MAX_CHARS)
    : "No summary";
  return `${summary} (${time})`;
}

function buildPickerText(
  activeSessionId: string | undefined,
  page: number,
  totalPages: number,
  deleteMode: boolean,
): string {
  const lines = [deleteMode ? "Tap a session to delete it." : "Select a session to resume."];
  if (activeSessionId) {
    lines.push(`Active: \`${activeSessionId.slice(0, 8)}…\``);
  }
  if (totalPages > 1) {
    lines.push(`Page ${page + 1} of ${totalPages}`);
  }
  return lines.join("\n");
}

function buildPickerMarkup(
  pickerId: string,
  picker: SessionPickerState,
  page: number,
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(picker.sessions.length / SESSIONS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * SESSIONS_PER_PAGE;
  const pageSessions = picker.sessions.slice(start, start + SESSIONS_PER_PAGE);
  const keyboard = new InlineKeyboard();
  const action = picker.deleteMode ? "delete" : "resume";

  for (let i = 0; i < pageSessions.length; i++) {
    const session = pageSessions[i];
    const index = start + i;
    const isActive = session.sessionId === picker.activeSessionId;
    const prefix = picker.deleteMode ? "✕ " : isActive ? "● " : "";
    const label = `${prefix}${buildSessionLabel(session)}`;
    keyboard.text(label, `session:${action}:${pickerId}:${index}`);
    keyboard.row();
  }

  if (totalPages > 1) {
    if (safePage > 0) {
      keyboard.text("Prev", `session:page:${pickerId}:${safePage - 1}`);
    }
    if (safePage < totalPages - 1) {
      keyboard.text("Next", `session:page:${pickerId}:${safePage + 1}`);
    }
    keyboard.row();
  }

  if (picker.deleteMode) {
    keyboard.text("Delete All", `session:deleteall:${pickerId}`);
    keyboard.text("Done", `session:mode:${pickerId}`);
  } else {
    keyboard.text("Delete...", `session:mode:${pickerId}`);
  }
  keyboard.row();

  return keyboard;
}

export function isSessionCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith("session:");
}

function parseSessionCallbackData(
  data: string,
):
  | { action: "resume"; pickerId: string; index: number }
  | { action: "delete"; pickerId: string; index: number }
  | { action: "deleteall"; pickerId: string }
  | { action: "mode"; pickerId: string }
  | { action: "page"; pickerId: string; page: number }
  | null {
  const parts = data.split(":");
  if (parts[0] !== "session") return null;

  if (parts[1] === "resume" && parts.length === 4) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { action: "resume", pickerId: parts[2], index };
  }

  if (parts[1] === "delete" && parts.length === 4) {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { action: "delete", pickerId: parts[2], index };
  }

  if (parts[1] === "deleteall" && parts.length === 3) {
    return { action: "deleteall", pickerId: parts[2] };
  }

  if (parts[1] === "mode" && parts.length === 3) {
    return { action: "mode", pickerId: parts[2] };
  }

  if (parts[1] === "page" && parts.length === 4) {
    const page = Number(parts[3]);
    if (!Number.isInteger(page) || page < 0) return null;
    return { action: "page", pickerId: parts[2], page };
  }

  return null;
}

export async function handleSessions(ctx: Context) {
  const chatId = String(ctx.chat!.id);

  try {
    const persisted = await listPersistedSessions();

    if (persisted.length === 0) {
      await ctx.reply("No sessions found.");
      return;
    }

    pruneExpiredPickers();
    const pickerId = createPickerId();
    const activeSession = getSessionForChat(chatId);

    sessionPickers.set(pickerId, {
      createdAt: Date.now(),
      sessions: persisted,
      activeSessionId: activeSession?.sessionId,
      deleteMode: false,
    });

    const totalPages = Math.max(1, Math.ceil(persisted.length / SESSIONS_PER_PAGE));
    const text = buildPickerText(activeSession?.sessionId, 0, totalPages, false);
    const markup = buildPickerMarkup(pickerId, sessionPickers.get(pickerId)!, 0);

    await ctx.reply(text, { reply_markup: markup, parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Failed to list sessions: ${err}`);
  }
}

export async function handleSessionCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery?.data;
  const parsed = data ? parseSessionCallbackData(data) : null;

  if (!callbackQuery || !parsed) return false;

  const message = callbackQuery.message;
  if (!message || !("message_id" in message) || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: "This picker is no longer available." });
    return true;
  }

  const picker = sessionPickers.get(parsed.pickerId);
  if (!picker) {
    await ctx.answerCallbackQuery({ text: "This picker expired. Send /sessions again." });
    return true;
  }

  try {
    if (parsed.action === "resume") {
      const selected = picker.sessions[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That session is no longer available." });
        return true;
      }

      if (selected.sessionId === picker.activeSessionId) {
        await ctx.answerCallbackQuery({ text: "This session is already active." });
        return true;
      }

      await resumeSessionById(String(ctx.chat.id), selected.sessionId);
      sessionPickers.delete(parsed.pickerId);

      const summary = selected.summary
        ? truncate(selected.summary, SESSION_SUMMARY_MAX_CHARS)
        : selected.sessionId.slice(0, 8);
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, `Resumed session: ${summary}`);
      await ctx.answerCallbackQuery({ text: "Session resumed" });
      return true;
    }

    if (parsed.action === "mode") {
      picker.deleteMode = !picker.deleteMode;
      const totalPages = Math.max(1, Math.ceil(picker.sessions.length / SESSIONS_PER_PAGE));
      const text = buildPickerText(picker.activeSessionId, 0, totalPages, picker.deleteMode);
      const markup = buildPickerMarkup(parsed.pickerId, picker, 0);
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
        reply_markup: markup,
        parse_mode: "Markdown",
      });
      await ctx.answerCallbackQuery();
      return true;
    }

    if (parsed.action === "delete") {
      const selected = picker.sessions[parsed.index];
      if (!selected) {
        await ctx.answerCallbackQuery({ text: "That session is no longer available." });
        return true;
      }

      if (selected.sessionId === picker.activeSessionId) {
        await destroySession(String(ctx.chat.id), { deletePersisted: true });
        picker.activeSessionId = undefined;
      } else {
        await deletePersistedSession(selected.sessionId);
      }

      picker.sessions.splice(parsed.index, 1);

      if (picker.sessions.length === 0) {
        sessionPickers.delete(parsed.pickerId);
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, "All sessions deleted.");
        await ctx.answerCallbackQuery({ text: "Session deleted" });
        return true;
      }

      const totalPages = Math.max(1, Math.ceil(picker.sessions.length / SESSIONS_PER_PAGE));
      const safePage = Math.min(Math.floor(parsed.index / SESSIONS_PER_PAGE), totalPages - 1);
      const text = buildPickerText(picker.activeSessionId, safePage, totalPages, picker.deleteMode);
      const markup = buildPickerMarkup(parsed.pickerId, picker, safePage);
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
        reply_markup: markup,
        parse_mode: "Markdown",
      });
      await ctx.answerCallbackQuery({ text: "Session deleted" });
      return true;
    }

    if (parsed.action === "deleteall") {
      const chatId = String(ctx.chat.id);

      for (const session of picker.sessions) {
        try {
          if (session.sessionId === picker.activeSessionId) {
            await destroySession(chatId, { deletePersisted: true });
          } else {
            await deletePersistedSession(session.sessionId);
          }
        } catch {
          // best-effort
        }
      }

      picker.sessions.length = 0;
      picker.activeSessionId = undefined;
      sessionPickers.delete(parsed.pickerId);

      await ctx.api.editMessageText(ctx.chat.id, message.message_id, "All sessions deleted.");
      await ctx.answerCallbackQuery({ text: "All sessions deleted" });
      return true;
    }

    // page action
    const totalPages = Math.max(1, Math.ceil(picker.sessions.length / SESSIONS_PER_PAGE));
    const safePage = Math.min(Math.max(parsed.page, 0), totalPages - 1);
    const text = buildPickerText(picker.activeSessionId, safePage, totalPages, picker.deleteMode);
    const markup = buildPickerMarkup(parsed.pickerId, picker, safePage);

    await ctx.api.editMessageText(ctx.chat.id, message.message_id, text, {
      reply_markup: markup,
      parse_mode: "Markdown",
    });
    await ctx.answerCallbackQuery();
    return true;
  } catch (err) {
    getLogger().warn({ err }, "Session callback failed");
    await ctx.answerCallbackQuery({ text: "Session action failed. Try /sessions again." });
    return true;
  }
}
