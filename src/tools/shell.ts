import { execFile } from "node:child_process";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { createAuditTimer } from "../logging/audit.js";

export const shellTool = defineTool("run_shell", {
  description: "Run a shell command via /bin/bash and return its stdout, stderr, and exit code.",
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z
      .number()
      .optional()
      .default(30_000)
      .describe("Timeout in milliseconds (default 30 000)"),
    cwd: z.string().optional().describe("Working directory for the command"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(invocation.sessionId, "run_shell", {
      command: args.command,
      cwd: args.cwd,
    });

    const result = await new Promise<string>((resolve) => {
      const child = execFile(
        "/bin/bash",
        ["-c", args.command],
        {
          timeout: args.timeout,
          cwd: args.cwd,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && error.killed) {
            resolve(
              `stdout:\n${stdout}\nstderr:\n${stderr}\n[exit code: timeout after ${args.timeout}ms]`,
            );
            return;
          }

          const exitCode = error
            ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1)
            : 0;
          resolve(`stdout:\n${stdout}\nstderr:\n${stderr}\n[exit code: ${exitCode}]`);
        },
      );

      child.on("error", (err) => {
        resolve(`stderr:\n${err.message}\n[exit code: 1]`);
      });
    });

    audit.complete(result);
    return result;
  },
});
