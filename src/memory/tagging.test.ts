import { describe, it, expect } from "vitest";
import { extractTags } from "./tagging.js";

describe("extractTags", () => {
  it("extracts coding tags from technical summary", () => {
    const summary =
      "User asked to refactor the API endpoint and fix a bug in the TypeScript code. Deployed changes via git commit.";
    const tags = extractTags(summary);
    expect(tags).toContain("coding");
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it("extracts browser tags from web automation summary", () => {
    const summary =
      "Navigated to the website and took a screenshot of the page using Playwright browser automation.";
    const tags = extractTags(summary);
    expect(tags).toContain("browser");
  });

  it("extracts multiple topic tags", () => {
    const summary =
      "Searched the web for flight prices and created a calendar event for the trip. Also set a reminder for booking.";
    const tags = extractTags(summary);
    expect(tags.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 'general' when no keywords match", () => {
    const summary = "Had a brief exchange about nothing in particular.";
    const tags = extractTags(summary);
    expect(tags).toEqual(["general"]);
  });

  it("returns at most 3 tags", () => {
    const summary =
      "Wrote code to search the web, navigate a browser page, send an email via gmail, and schedule a calendar meeting with a reminder.";
    const tags = extractTags(summary);
    expect(tags.length).toBeLessThanOrEqual(3);
  });
});
