import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { readFile, writeFile, appendFile, readdir, stat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAuditTimer } from "../logging/audit.js";

export const filesystemTool = defineTool("filesystem", {
  description:
    "Perform filesystem operations: read, write, append, list directory contents, check existence, or create directories.",
  parameters: z.object({
    operation: z
      .enum(["read", "write", "append", "list", "exists", "mkdir"])
      .describe("The filesystem operation to perform"),
    path: z
      .string()
      .describe("Absolute or relative file/directory path"),
    content: z
      .string()
      .optional()
      .describe("Content to write or append (required for write/append operations)"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(invocation.sessionId, "filesystem", {
      operation: args.operation,
      path: args.path,
    });

    try {
      const target = resolve(args.path);

      switch (args.operation) {
        case "read": {
          const data = await readFile(target, "utf-8");
          const result = data;
          audit.complete(result);
          return result;
        }

        case "write": {
          if (args.content === undefined) {
            const result = "Error: content is required for write operation.";
            audit.complete(result);
            return result;
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, args.content, "utf-8");
          const result = `File written: ${target} (${args.content.length} bytes)`;
          audit.complete(result);
          return result;
        }

        case "append": {
          if (args.content === undefined) {
            const result = "Error: content is required for append operation.";
            audit.complete(result);
            return result;
          }
          await appendFile(target, args.content, "utf-8");
          const result = `Content appended to ${target} (${args.content.length} bytes)`;
          audit.complete(result);
          return result;
        }

        case "list": {
          const entries = await readdir(target, { withFileTypes: true });
          const lines = await Promise.all(
            entries.map(async (entry) => {
              const entryPath = resolve(target, entry.name);
              const type = entry.isDirectory() ? "dir" : "file";
              if (entry.isFile()) {
                const info = await stat(entryPath);
                return `${entry.name}  (${type}, ${info.size} bytes)`;
              }
              return `${entry.name}  (${type})`;
            }),
          );
          const result = lines.join("\n") || "(empty directory)";
          audit.complete(result);
          return result;
        }

        case "exists": {
          try {
            const info = await stat(target);
            const type = info.isDirectory() ? "directory" : "file";
            const result = `Exists: ${type}`;
            audit.complete(result);
            return result;
          } catch {
            const result = "Not found";
            audit.complete(result);
            return result;
          }
        }

        case "mkdir": {
          await mkdir(target, { recursive: true });
          const result = `Directory created: ${target}`;
          audit.complete(result);
          return result;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit.complete(`Error: ${message}`);
      throw error;
    }
  },
});
