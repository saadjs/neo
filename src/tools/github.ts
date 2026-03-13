import { execFile } from "node:child_process";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { createAuditTimer } from "../logging/audit.js";

const TIMEOUT_MS = 30_000;

function runGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export const githubTool = defineTool("github", {
  description:
    "Run GitHub CLI (gh) commands. Supports any gh subcommand such as repo, issue, pr, release, etc.",
  parameters: z.object({
    command: z
      .string()
      .describe('The full gh CLI command (without the leading "gh"), e.g. "repo list" or "issue create --title foo"'),
    repo: z
      .string()
      .optional()
      .describe("Optional owner/repo to scope the command to (adds -R flag)"),
  }),
  handler: async (args, invocation) => {
    const timer = createAuditTimer(invocation.sessionId, "github", args as Record<string, unknown>);

    const cmdArgs = args.command.split(/\s+/).filter(Boolean);
    if (args.repo) {
      cmdArgs.push("-R", args.repo);
    }

    try {
      const { stdout, stderr } = await runGh(cmdArgs);
      const output = formatOutput(stdout, stderr);
      timer.complete(output);
      return output;
    } catch (error: unknown) {
      const err = error as Error & { stdout?: string; stderr?: string; code?: string };
      const detail = err.code === "ETIMEDOUT"
        ? "Command timed out after 30 seconds"
        : formatOutput(err.stdout ?? "", err.stderr ?? err.message);
      timer.complete(`error: ${detail}`);
      return `Error running gh ${cmdArgs.join(" ")}:\n${detail}`;
    }
  },
});

function formatOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(stdout.trim());
  if (stderr.trim()) parts.push(`[stderr] ${stderr.trim()}`);
  return parts.join("\n") || "(no output)";
}
