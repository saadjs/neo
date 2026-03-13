import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAuditTimer } from "../logging/audit.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 30_000;
const MAX_BUFFER = 5 * 1024 * 1024;

function getCliBinary(): string {
  return process.env.GOOGLE_WORKSPACE_CLI_PATH || "gws";
}

function formatOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(stdout.trim());
  if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
  return parts.join("\n\n") || "(no output)";
}

export const googleWorkspaceTool = defineTool("google_workspace", {
  description:
    "Execute a Google Workspace CLI command (e.g. Gmail, Drive, Calendar, Sheets). " +
    "Pass the full sub-command string such as 'gmail send --to user@example.com --subject Hello'.",

  parameters: z.object({
    command: z
      .string()
      .describe(
        "The workspace CLI command to run, e.g. 'gmail send --to user@example.com'",
      ),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe("Command timeout in milliseconds (default: 30000)"),
  }),

  handler: async (args, invocation) => {
    const timer = createAuditTimer(invocation.sessionId, "google_workspace", {
      command: args.command,
      timeout: args.timeout,
    });

    const timeout = args.timeout ?? DEFAULT_TIMEOUT;
    const binary = getCliBinary();
    const argv = args.command.split(/\s+/).filter(Boolean);

    try {
      const { stdout, stderr } = await execFileAsync(binary, argv, {
        timeout,
        maxBuffer: MAX_BUFFER,
      });

      const output = formatOutput(stdout, stderr);
      timer.complete(output);
      return output;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const output = `Command failed: ${message}`;
      timer.complete(output);
      return output;
    }
  },
});
