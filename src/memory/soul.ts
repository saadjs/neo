import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config";
import { replaceMemorySource } from "./db";

export async function loadSoul(): Promise<string> {
  try {
    return await readFile(config.paths.soul, "utf-8");
  } catch {
    return "You are Neo, a personal AI agent.";
  }
}

export async function saveSoul(content: string): Promise<void> {
  await writeFile(config.paths.soul, content, "utf-8");
  replaceMemorySource("soul", [{ content }]);
}
