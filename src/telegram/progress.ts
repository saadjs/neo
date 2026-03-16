export type ProgressPhase =
  | "thinking"
  | "reasoning"
  | "tool"
  | "done-tool"
  | "skill"
  | "compacting"
  | "waiting"
  | "streaming";

export function formatProgressName(value?: string) {
  return String(value || "work")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildProgressText(phase: ProgressPhase, detail: string, startedAt: number) {
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const elapsed = elapsedSeconds >= 8 ? ` (${elapsedSeconds}s)` : "";

  if (phase === "tool" && detail) return `Working… using ${detail}${elapsed}`;
  if (phase === "skill" && detail) return `Working… running ${detail}${elapsed}`;
  if (phase === "compacting") return `Tidying context, then answering${elapsed}`;
  if (phase === "waiting") return `Waiting for your answer${elapsed}`;
  if (phase === "reasoning") return `Thinking… still on it${elapsed}`;
  if (phase === "done-tool" && detail) return `Still working… finished ${detail}${elapsed}`;

  return `Thinking…${elapsed}`;
}
