import { describe, it, expect } from "vitest";
import {
  getIsoWeek,
  getLastCompletedIsoWeekEnd,
  groupByWeek,
  summarizeWeek,
} from "./decay-utils.js";

const makeDailyFile = (date: string, content: string) => ({
  filename: `MEMORY-${date}.md`,
  date,
  content,
});

describe("memory decay", () => {
  describe("getIsoWeek", () => {
    it("returns correct ISO week for a Monday", () => {
      // 2026-03-02 is a Monday in W10
      expect(getIsoWeek("2026-03-02")).toBe("2026-W10");
    });

    it("returns correct ISO week for a Sunday", () => {
      // 2026-03-08 is a Sunday, still W10
      expect(getIsoWeek("2026-03-08")).toBe("2026-W10");
    });

    it("handles year boundary weeks", () => {
      // 2025-12-29 is a Monday in W01 of 2026
      expect(getIsoWeek("2025-12-29")).toBe("2026-W01");
    });
  });

  describe("groupByWeek", () => {
    it("groups files by ISO week", () => {
      const files = [
        makeDailyFile("2026-03-02", "# Memory — 2026-03-02\n- Did stuff"),
        makeDailyFile("2026-03-03", "# Memory — 2026-03-03\n- More stuff"),
        makeDailyFile("2026-03-09", "# Memory — 2026-03-09\n- Next week"),
      ];
      const groups = groupByWeek(files);
      expect(groups.size).toBe(2);
    });

    it("sorts files within a week by date", () => {
      const files = [
        makeDailyFile("2026-03-05", "content"),
        makeDailyFile("2026-03-03", "content"),
        makeDailyFile("2026-03-04", "content"),
      ];
      const groups = groupByWeek(files);
      const week = [...groups.values()][0];
      expect(week[0].date).toBe("2026-03-03");
      expect(week[2].date).toBe("2026-03-05");
    });
  });

  describe("getLastCompletedIsoWeekEnd", () => {
    it("includes the prior Sunday when the current ISO week is still in progress", () => {
      expect(getLastCompletedIsoWeekEnd(new Date("2026-03-15T07:00:00Z"))).toBe("2026-03-08");
    });

    it("returns the immediate prior Sunday on Monday", () => {
      expect(getLastCompletedIsoWeekEnd(new Date("2026-03-16T12:00:00Z"))).toBe("2026-03-15");
    });
  });

  describe("summarizeWeek", () => {
    it("extracts bullet points from daily files", () => {
      const files = [
        makeDailyFile("2026-03-02", "# Memory — 2026-03-02\n- Fixed the bug\n- Deployed v2"),
        makeDailyFile("2026-03-03", "# Memory — 2026-03-03\n- Had a meeting"),
      ];
      const summary = summarizeWeek("2026-W10", files);
      expect(summary).toContain("Weekly Summary — 2026-W10");
      expect(summary).toContain("- Fixed the bug");
      expect(summary).toContain("- Deployed v2");
      expect(summary).toContain("- Had a meeting");
    });

    it("deduplicates identical bullets", () => {
      const files = [
        makeDailyFile("2026-03-02", "# Memory\n- Same thing"),
        makeDailyFile("2026-03-03", "# Memory\n- Same thing"),
      ];
      const summary = summarizeWeek("2026-W10", files);
      const matches = summary.match(/- Same thing/g);
      expect(matches).toHaveLength(1);
    });

    it("skips compaction metadata lines", () => {
      const files = [
        makeDailyFile(
          "2026-03-02",
          "# Memory\n- Timestamp: 2026-03-02\n- Chat ID: 123\n- Session ID: abc\n- Tokens Before: 5000\n- Real content here",
        ),
      ];
      const summary = summarizeWeek("2026-W10", files);
      expect(summary).not.toContain("Timestamp:");
      expect(summary).not.toContain("Chat ID:");
      expect(summary).not.toContain("Tokens Before:");
    });

    it("skips summarized markers when rebuilding a weekly summary", () => {
      const files = [
        makeDailyFile(
          "2026-03-02",
          "<!-- summarized -->\n# Memory — 2026-03-02\n- Fixed login bug",
        ),
        makeDailyFile("2026-03-03", "# Memory — 2026-03-03\n- Shipped audit fix"),
      ];
      const summary = summarizeWeek("2026-W10", files);
      expect(summary).not.toContain("<!-- summarized -->");
      expect(summary).toContain("- Fixed login bug");
      expect(summary).toContain("- Shipped audit fix");
    });

    it("handles empty files gracefully", () => {
      const files = [makeDailyFile("2026-03-02", "# Memory — 2026-03-02\n")];
      const summary = summarizeWeek("2026-W10", files);
      expect(summary).toContain("No notable entries");
    });

    it("preserves compaction summary body text", () => {
      const files = [
        makeDailyFile(
          "2026-03-02",
          [
            "# Memory — 2026-03-02",
            "## Session Context Summary",
            "- Timestamp: 2026-03-02T10:00:00Z",
            "- Chat ID: 123",
            "- Session ID: abc",
            "",
            "### Summary",
            "Investigated the deployment rollback.",
            "Kept the mitigation active until metrics recovered.",
            "",
          ].join("\n"),
        ),
      ];
      const summary = summarizeWeek("2026-W10", files);
      expect(summary).toContain("Investigated the deployment rollback.");
      expect(summary).toContain("Kept the mitigation active until metrics recovered.");
      expect(summary).not.toContain("### Summary");
    });
  });
});
