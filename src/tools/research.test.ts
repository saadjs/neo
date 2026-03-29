import { describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const { getChatIdForSessionMock, getModelForChatMock } = vi.hoisted(() => ({
  getChatIdForSessionMock: vi.fn(),
  getModelForChatMock: vi.fn(),
}));

vi.mock("../agent.js", () => ({
  getChatIdForSession: getChatIdForSessionMock,
  getModelForChat: getModelForChatMock,
}));

vi.mock("../logging/audit.js", () => ({
  createAuditTimer: () => ({ complete: vi.fn() }),
}));

vi.mock("../config.js", () => ({
  config: {
    paths: {
      researchDir: "/tmp/neo-research",
    },
    copilot: {
      researchWorkerModel: "claude-sonnet-4.6",
      modelShortlist: ["openai:gpt-5.4", "anthropic:claude-sonnet-4.5"],
    },
  },
}));

import { buildReportPath, buildResearchPlan, researchTool, shellEscape, slugify } from "./research";

describe("slugify", () => {
  it("converts text to lowercase hyphenated slug", () => {
    expect(slugify("Quantum Computing")).toBe("quantum-computing");
  });

  it("replaces special characters with hyphens", () => {
    expect(slugify("rust vs. go: a comparison!")).toBe("rust-vs-go-a-comparison");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--hello world--")).toBe("hello-world");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });

  it("caps at 60 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("research");
  });
});

describe("shellEscape", () => {
  it("wraps a simple string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("escapes single quotes within the string", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("neutralises double-quote injection", () => {
    expect(shellEscape('foo"; rm -rf / #')).toBe("'foo\"; rm -rf / #'");
  });

  it("handles empty string", () => {
    expect(shellEscape("")).toBe("''");
  });
});

describe("buildReportPath", () => {
  it("includes the slugified topic and date", () => {
    const path = buildReportPath("Quantum Computing");
    expect(path).toContain("quantum-computing-");
    expect(path).toMatch(/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("ends with .md extension", () => {
    expect(buildReportPath("test topic")).toMatch(/\.md$/);
  });
});

describe("buildResearchPlan", () => {
  const basePlan = {
    topic: "quantum computing",
    destination: "local" as const,
    worker_model: "claude-sonnet-4.6",
    fallback_models: ["openai:gpt-5.4", "anthropic:claude-sonnet-4.5"],
    depth: "standard" as const,
  };

  it("includes the topic in the plan", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("quantum computing");
  });

  it("includes query intent classification guidance", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("Phase 0: Classify Query Intent");
    expect(plan).toContain("Process / how-to");
    expect(plan).toContain("Technical deep-dive");
  });

  it("includes source links section when links are provided", () => {
    const plan = buildResearchPlan({
      ...basePlan,
      source_links: ["https://example.com", "https://other.com"],
    });
    expect(plan).toContain("Phase 1: Pre-fetch Provided Sources");
    expect(plan).toContain("https://example.com");
    expect(plan).toContain("https://other.com");
  });

  it("omits source links section when no links provided", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).not.toContain("Pre-fetch Provided Sources");
  });

  it("adjusts worker count for quick depth", () => {
    const plan = buildResearchPlan({ ...basePlan, depth: "quick" });
    expect(plan).toContain("2 worker agents");
    expect(plan).toContain("3-5 sources");
  });

  it("adjusts worker count for deep depth", () => {
    const plan = buildResearchPlan({ ...basePlan, depth: "deep" });
    expect(plan).toContain("5+ worker agents");
    expect(plan).toContain("15+ sources");
  });

  it("includes the worker model in the plan", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("claude-sonnet-4.6");
    expect(plan).toContain("openai:gpt-5.4 -> anthropic:claude-sonnet-4.5");
    expect(plan).toContain("task");
  });

  it("limits model fallback instructions to actual copilot worker failures", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("Only switch away from `claude-sonnet-4.6`");
    expect(plan).toContain("stay on Copilot unless Copilot fails");
    expect(plan).toContain("Do not proactively switch models before a Copilot failure occurs");
  });

  it("includes stronger code research methodology guidance", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("Search sparingly, fetch aggressively");
    expect(plan).toContain("Prioritize source code over documentation");
    expect(plan).toContain("Read tests, examples, issues, pull requests, and commit history");
  });

  it("includes local output instructions by default", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("Use the `edit_file` tool to create the file");
  });

  it("includes github output instructions when destination is github", () => {
    const plan = buildResearchPlan({
      ...basePlan,
      destination: "github",
      destination_path: "owner/repo/docs/research.md",
    });
    expect(plan).toContain("edit_file");
    expect(plan).toContain("gh repo clone");
    expect(plan).toContain('TMP_REPO_DIR="$(mktemp -d');
    expect(plan).toContain("owner/repo/docs/research.md");
    expect(plan).not.toContain('gh repo clone "$OWNER_REPO" /tmp/research-repo');
  });

  it("shell-escapes destination_path in github output to prevent injection", () => {
    const plan = buildResearchPlan({
      ...basePlan,
      destination: "github",
      destination_path: 'owner/repo/path"; rm -rf / #',
    });
    expect(plan).toContain("TARGET='owner/repo/path\"; rm -rf / #'");
    expect(plan).not.toContain('TARGET="owner/repo/path"');
  });

  it("shell-escapes destination_path in gdoc output to prevent injection", () => {
    const plan = buildResearchPlan({
      ...basePlan,
      destination: "gdoc",
      destination_path: "My Title'; cat /etc/passwd",
    });
    expect(plan).toContain("--title 'My Title'\\''; cat /etc/passwd'");
    expect(plan).not.toContain('--title "My Title');
  });

  it("includes gdoc output instructions when destination is gdoc", () => {
    const plan = buildResearchPlan({
      ...basePlan,
      destination: "gdoc",
      destination_path: "My Research",
    });
    expect(plan).toContain("edit_file");
    expect(plan).toContain("gws docs create");
    expect(plan).toContain("My Research");
  });

  it("includes citation requirements with code-level citation guidance", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("footnote reference");
    expect(plan).toContain("[^1]");
    expect(plan).toContain("cite specific file paths with line numbers");
    expect(plan).toContain("URL-only citations are a fallback");
    expect(plan).toContain("commit SHAs or pull requests");
  });

  it("includes confidence assessment and technical report sections", () => {
    const plan = buildResearchPlan(basePlan);
    expect(plan).toContain("## Confidence Assessment");
    expect(plan).toContain("## Key Repositories Summary");
    expect(plan).toContain("## Architecture Diagram");
  });
});

describe("researchTool", () => {
  it("uses the configured worker model when none is provided", async () => {
    getChatIdForSessionMock.mockReturnValue(42);
    getModelForChatMock.mockReturnValue("openai:gpt-5.4");

    const result = await researchTool.handler(
      {
        topic: "quantum computing",
        destination: "local",
        depth: "standard",
      },
      { sessionId: "session-1" } as never,
    );

    expect(result).toContain("claude-sonnet-4.6");
    expect(result).toContain("openai:gpt-5.4 -> anthropic:claude-sonnet-4.5");
  });

  it("prefers an explicit worker model override", async () => {
    getChatIdForSessionMock.mockReturnValue(42);
    getModelForChatMock.mockReturnValue("openai:gpt-5.4");

    const result = await researchTool.handler(
      {
        topic: "quantum computing",
        destination: "local",
        depth: "standard",
        worker_model: "openai:gpt-4.1",
      },
      { sessionId: "session-1" } as never,
    );

    expect(result).toContain("openai:gpt-4.1");
  });

  it("uses the invoking chat model as the first fallback when available", async () => {
    getChatIdForSessionMock.mockReturnValue(42);
    getModelForChatMock.mockReturnValue("openai:gpt-5.4");

    const result = await researchTool.handler(
      {
        topic: "quantum computing",
        destination: "local",
        depth: "standard",
      },
      { sessionId: "session-1" } as never,
    );

    expect(getChatIdForSessionMock).toHaveBeenCalledWith("session-1");
    expect(getModelForChatMock).toHaveBeenCalledWith(42);
    expect(result).toContain(
      "**Worker fallback models**: openai:gpt-5.4 -> anthropic:claude-sonnet-4.5",
    );
  });
});
