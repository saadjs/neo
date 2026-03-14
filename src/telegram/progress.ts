export const TYPING_REFRESH_MS = 3000;
export const PROGRESS_REFRESH_MS = 8000;
export const PROGRESS_EDIT_DEBOUNCE_MS = 1500;

export function formatProgressName(value?: string) {
  return String(value || "work")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildProgressText(
  phase: "thinking" | "reasoning" | "tool" | "done-tool" | "skill" | "compacting",
  detail: string,
  startedAt: number,
) {
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const elapsed = elapsedSeconds >= 8 ? ` (${elapsedSeconds}s)` : "";

  if (phase === "tool" && detail) return `Working… using ${detail}${elapsed}`;
  if (phase === "skill" && detail) return `Working… running ${detail}${elapsed}`;
  if (phase === "compacting") return `Tidying context, then answering${elapsed}`;
  if (phase === "reasoning") return `Thinking… still on it${elapsed}`;
  if (phase === "done-tool" && detail) return `Still working… finished ${detail}${elapsed}`;

  return `Thinking…${elapsed}`;
}
