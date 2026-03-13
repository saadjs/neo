import { z } from "zod";
import { resolve, join } from "node:path";

const PROJECT_ROOT = resolve(".");

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_OWNER_ID: z.coerce
    .number()
    .int()
    .positive("TELEGRAM_OWNER_ID must be a positive integer"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  COPILOT_MODEL: z.string().default("gpt-4.1"),
  NEO_DATA_DIR: z.string().default(join(PROJECT_ROOT, "data")),
  NEO_LOG_DIR: z.string().default(join(PROJECT_ROOT, "logs")),
  NEO_LOG_LEVEL: z.enum(["error", "warn", "info", "debug", "trace"]).default("info"),
});

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`❌ Configuration error:\n${errors}`);
    process.exit(1);
  }
  return {
    telegram: {
      botToken: result.data.TELEGRAM_BOT_TOKEN,
      ownerId: result.data.TELEGRAM_OWNER_ID,
    },
    github: {
      token: result.data.GITHUB_TOKEN,
    },
    copilot: {
      model: result.data.COPILOT_MODEL,
    },
    paths: {
      root: PROJECT_ROOT,
      data: resolve(result.data.NEO_DATA_DIR),
      logs: resolve(result.data.NEO_LOG_DIR),
      soul: join(resolve(result.data.NEO_DATA_DIR), "SOUL.md"),
      preferences: join(resolve(result.data.NEO_DATA_DIR), "PREFERENCES.md"),
      memoryDir: join(resolve(result.data.NEO_DATA_DIR), "memory"),
    },
    logging: {
      level: result.data.NEO_LOG_LEVEL as LogLevel,
    },
  };
}

export const config = loadConfig();
export type Config = typeof config;
