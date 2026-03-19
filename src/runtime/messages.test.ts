import { describe, expect, it } from "vitest";
import { splitMessage } from "./messages";

describe("splitMessage", () => {
  it("returns single-element array for short text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns text as-is when exactly at limit", () => {
    const text = "a".repeat(4096);
    expect(splitMessage(text)).toEqual([text]);
  });

  it("splits long text at newline boundaries", () => {
    const line = "x".repeat(2000);
    const text = `${line}\n${line}\n${line}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("respects a custom maxLength", () => {
    const text = "a".repeat(100);
    const chunks = splitMessage(text, 30);
    expect(chunks.length).toBe(4);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
  });

  it("splits at spaces when no newlines are near the limit", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = splitMessage(text, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
  });

  it("hard-splits when there are no good break points", () => {
    const text = "a".repeat(200);
    const chunks = splitMessage(text, 50);
    expect(chunks.length).toBe(4);
    expect(chunks.join("")).toBe(text);
  });
});
