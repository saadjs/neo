import { afterEach, describe, expect, it, vi } from "vitest";

const { getPendingUserInputMock } = vi.hoisted(() => ({
  getPendingUserInputMock: vi.fn<any>(),
}));

vi.mock("../telegram/user-input", () => ({
  getPendingUserInput: getPendingUserInputMock,
}));

import { buildResearchPrompt, createResearchHandler, parseResearchArgs } from "./research";

afterEach(() => {
  vi.clearAllMocks();
  getPendingUserInputMock.mockReset();
  getPendingUserInputMock.mockReturnValue(undefined);
});

describe("parseResearchArgs", () => {
  it("parses topic-only input", () => {
    const result = parseResearchArgs("quantum computing advances");
    expect(result.topic).toBe("quantum computing advances");
    expect(result.links).toEqual([]);
  });

  it("separates URLs from topic words", () => {
    const result = parseResearchArgs("rust vs go https://blog.rust-lang.org");
    expect(result.topic).toBe("rust vs go");
    expect(result.links).toEqual(["https://blog.rust-lang.org"]);
  });

  it("handles multiple URLs", () => {
    const result = parseResearchArgs("AI safety https://example.com https://other.org/page");
    expect(result.topic).toBe("AI safety");
    expect(result.links).toEqual(["https://example.com", "https://other.org/page"]);
  });

  it("handles URLs interspersed with topic words", () => {
    const result = parseResearchArgs("https://a.com topic here https://b.com");
    expect(result.topic).toBe("topic here");
    expect(result.links).toEqual(["https://a.com", "https://b.com"]);
  });

  it("handles links-only input", () => {
    const result = parseResearchArgs("https://a.com https://b.com");
    expect(result.topic).toBe("");
    expect(result.links).toEqual(["https://a.com", "https://b.com"]);
  });

  it("handles empty input", () => {
    const result = parseResearchArgs("");
    expect(result.topic).toBe("");
    expect(result.links).toEqual([]);
  });

  it("handles http:// URLs", () => {
    const result = parseResearchArgs("test http://example.com");
    expect(result.topic).toBe("test");
    expect(result.links).toEqual(["http://example.com"]);
  });
});

describe("buildResearchPrompt", () => {
  it("builds a prompt that explicitly invokes the research tool", () => {
    const prompt = buildResearchPrompt("quantum computing", ["https://example.com"]);

    expect(prompt).toContain("Invoke the research tool");
    expect(prompt).toContain('topic="quantum computing"');
    expect(prompt).toContain('source_links=["https://example.com"]');
    expect(prompt).toContain("Treat the plan it returns as mandatory");
    expect(prompt).toContain("do not consider the task done until the final report exists");
  });
});

describe("handleResearch", () => {
  const sendMessage = vi.fn<any>();
  const handleResearch = createResearchHandler(sendMessage as never);

  it("shows usage when no args are provided", async () => {
    const reply = vi.fn<any>();

    await handleResearch({
      message: { text: "/research" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Usage: `/research"), {
      parse_mode: "Markdown",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects links-only input", async () => {
    const reply = vi.fn<any>();

    await handleResearch({
      message: { text: "/research https://a.com https://b.com" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("Please provide a research topic, not just links.");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("blocks research while ask_user input is pending", async () => {
    const reply = vi.fn<any>();
    getPendingUserInputMock.mockReturnValue({
      chatId: 123,
      sessionId: "session-1",
      requestId: "ask-1",
      question: "Proceed?",
      allowFreeform: true,
      createdAt: Date.now(),
    });

    await handleResearch({
      chat: { id: 123 },
      message: { text: "/research quantum computing advances" },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(
      "I’m waiting for a text answer to the pending question before I can continue.",
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("forwards topic-only input into the normal message flow", async () => {
    await handleResearch({
      chat: { id: 123 },
      message: { text: "/research quantum computing advances" },
    } as never);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('topic="quantum computing advances"'),
    );
  });

  it("includes starting links in the forwarded prompt", async () => {
    await handleResearch({
      chat: { id: 123 },
      message: { text: "/research rust vs go https://blog.rust-lang.org" },
    } as never);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('source_links=["https://blog.rust-lang.org"]'),
    );
  });
});
