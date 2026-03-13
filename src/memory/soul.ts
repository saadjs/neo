import { readFile, writeFile, appendFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config.js";

export async function loadSoul(): Promise<string> {
  try {
    return await readFile(config.paths.soul, "utf-8");
  } catch {
    return "You are Neo, a personal AI agent.";
  }
}

export async function saveSoul(content: string): Promise<void> {
  await writeFile(config.paths.soul, content, "utf-8");
}
