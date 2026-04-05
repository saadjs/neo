import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  createReminder,
  listActiveReminders,
  cancelReminder,
  initRemindersTable,
} from "../scheduler/db";
import { createAuditTimer } from "../logging/audit";
import { USER_TIMEZONE } from "../constants";

const RECURRENCE_VALUES = ["once", "daily", "weekly", "monthly", "weekdays"] as const;

export const reminderTool = defineTool("reminder", {
  description: `Manage scheduled reminders: create timed reminders, list active reminders, or cancel existing ones. All times must be ISO 8601 UTC strings. The user's timezone is ${USER_TIMEZONE} — convert their local times to UTC for fire_at, and convert UTC back to ${USER_TIMEZONE} when displaying times. For recurring reminders, use recurrence to specify the interval.`,
  parameters: z.object({
    action: z.enum(["create", "list", "cancel"]).describe("The reminder action to perform"),
    label: z.string().optional().describe("Short label for the reminder (required for create)"),
    message: z
      .string()
      .optional()
      .describe("Full message to send when the reminder fires (required for create)"),
    fire_at: z
      .string()
      .optional()
      .describe("ISO 8601 UTC datetime when the reminder should fire (required for create)"),
    recurrence: z
      .enum(RECURRENCE_VALUES)
      .optional()
      .describe("Recurrence interval (default: once)"),
    id: z.number().optional().describe("Reminder ID (required for cancel)"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(
      invocation.sessionId,
      "reminder",
      args as Record<string, unknown>,
    );

    try {
      initRemindersTable();
      const result = execute(args);
      audit.complete(result);
      return { textResultForLlm: result, resultType: "success" as const };
    } catch (error) {
      const message = `reminder tool error: ${String(error)}`;
      audit.complete(message);
      return {
        textResultForLlm: message,
        resultType: "failure" as const,
        error: String(error),
      };
    }
  },
});

function execute(args: {
  action: "create" | "list" | "cancel";
  label?: string;
  message?: string;
  fire_at?: string;
  recurrence?: (typeof RECURRENCE_VALUES)[number];
  id?: number;
}): string {
  switch (args.action) {
    case "create": {
      if (!args.label) return "Error: label is required for create action.";
      if (!args.message) return "Error: message is required for create action.";
      if (!args.fire_at) return "Error: fire_at is required for create action.";

      const id = createReminder(args.label, args.message, args.fire_at, args.recurrence ?? "once");
      return `Reminder created (id: ${id}). Will fire at ${args.fire_at}${args.recurrence && args.recurrence !== "once" ? ` (${args.recurrence})` : ""}.`;
    }

    case "list": {
      const reminders = listActiveReminders();
      if (reminders.length === 0) return "No active reminders.";

      const lines = reminders.map((r) => `#${r.id} | ${r.label} | ${r.fire_at} | ${r.recurrence}`);
      return `Active reminders:\n${lines.join("\n")}`;
    }

    case "cancel": {
      if (args.id == null) return "Error: id is required for cancel action.";

      const cancelled = cancelReminder(args.id);
      return cancelled
        ? `Reminder #${args.id} cancelled.`
        : `Reminder #${args.id} not found or already inactive.`;
    }
  }
}
