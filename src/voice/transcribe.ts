import { DeepgramClient } from "@deepgram/sdk";
import { readFile } from "node:fs/promises";
import { config } from "../config";
import { getLogger } from "../logging/index";
import { LOG_TRANSCRIPT_MAX_CHARS } from "../constants";

let client: DeepgramClient | null = null;

function getClient(): DeepgramClient {
  if (!client) {
    if (!config.deepgram.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }
    client = new DeepgramClient({ apiKey: config.deepgram.apiKey });
  }
  return client;
}

export function isVoiceEnabled(): boolean {
  return !!config.deepgram.apiKey;
}

export async function transcribeFile(filePath: string): Promise<string> {
  const log = getLogger();
  const dg = getClient();

  const audioBuffer = await readFile(filePath);

  log.debug({ filePath, bytes: audioBuffer.length }, "Transcribing audio");

  const response = await dg.listen.v1.media.transcribeFile(
    { data: audioBuffer, contentType: "audio/ogg" },
    { model: "nova-3", smart_format: true, language: "en" },
  );

  const transcript =
    "results" in response
      ? (response.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "")
      : "";

  log.debug(
    { transcript: transcript.slice(0, LOG_TRANSCRIPT_MAX_CHARS) },
    "Transcription complete",
  );
  return transcript;
}
