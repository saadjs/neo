import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Api } from "grammy";
import { config } from "../config.js";
import { getLogger } from "../logging/index.js";

const DOWNLOADS_DIR = join(config.paths.data, "downloads");

/**
 * Download a file from Telegram by file_id and save it locally.
 * Returns the absolute path to the downloaded file.
 */
export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  fileName?: string,
): Promise<string> {
  const log = getLogger();

  await mkdir(DOWNLOADS_DIR, { recursive: true });

  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file_path");
  }

  const ext = extFromPath(file.file_path);
  const localName = fileName ?? `${randomUUID()}${ext}`;
  const localPath = join(DOWNLOADS_DIR, localName);

  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(localPath, buffer);

  log.info({ fileId, localPath, size: buffer.length }, "Downloaded Telegram file");
  return localPath;
}

function extFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : "";
}
