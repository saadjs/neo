import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { join } from "node:path";
import { getChatIdForSession, getModelForChat } from "../agent";
import { config } from "../config";
import { createAuditTimer } from "../logging/audit";

const DESTINATION_VALUES = ["local", "github", "gdoc"] as const;
const DEPTH_VALUES = ["quick", "standard", "deep"] as const;

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "research";
}

export function buildReportPath(topic: string): string {
  const slug = slugify(topic);
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return join(config.paths.researchDir, `${slug}-${date}.md`);
}

function workerCount(depth: (typeof DEPTH_VALUES)[number]): string {
  switch (depth) {
    case "quick":
      return "2";
    case "standard":
      return "3-4";
    case "deep":
      return "5+";
  }
}

function sourceTarget(depth: (typeof DEPTH_VALUES)[number]): string {
  switch (depth) {
    case "quick":
      return "3-5";
    case "standard":
      return "8-12";
    case "deep":
      return "15+";
  }
}

function buildOutputInstructions(
  destination: (typeof DESTINATION_VALUES)[number],
  reportPath: string,
  destinationPath: string | undefined,
): string {
  const fileName = reportPath.split("/").pop() ?? "research-report.md";

  switch (destination) {
    case "local":
      return `Write the final report to: ${reportPath}
Use the \`edit_file\` tool to create the file. If \`edit_file\` is unavailable, fall back to \`bash\` with a heredoc: \`cat > "${reportPath}" << 'REPORT'\`.`;
    case "github": {
      const safeTarget = shellEscape(destinationPath ?? `owner/repo/research/${fileName}`);
      const safeReportPath = shellEscape(reportPath);
      return `1. Write the markdown report to: ${reportPath} using \`edit_file\` (or \`bash\` with a heredoc if \`edit_file\` is unavailable).
2. Then use \`bash\` with the \`gh\` CLI to publish it to GitHub.

Expected destination format: \`owner/repo/path/in/repo.md\`
Use \`${destinationPath ?? `owner/repo/research/${fileName}`}\` as the target path unless you derive a better repo path from context.

\`\`\`bash
TARGET=${safeTarget}
OWNER_REPO="$(printf '%s' "$TARGET" | cut -d/ -f1-2)"
REPO_PATH="$(printf '%s' "$TARGET" | cut -d/ -f3-)"
TMP_REPO_DIR="$(mktemp -d "${join("/tmp", "research-repo.XXXXXX")}")"
gh repo clone "$OWNER_REPO" "$TMP_REPO_DIR"
mkdir -p "$TMP_REPO_DIR/$(dirname "$REPO_PATH")"
cp ${safeReportPath} "$TMP_REPO_DIR/$REPO_PATH"
cd "$TMP_REPO_DIR" && git add "$REPO_PATH" && git commit -m "Add research report" && git push
\`\`\``;
    }
    case "gdoc": {
      const safeTitle = shellEscape(destinationPath ?? "Research Report");
      const safeReportPath = shellEscape(reportPath);
      return `1. Write the markdown report to: ${reportPath} using \`edit_file\` (or \`bash\` with a heredoc if \`edit_file\` is unavailable).
2. Then use \`bash\` with the \`gws\` CLI to publish it to Google Docs.

\`\`\`bash
gws docs create --title ${safeTitle} --body-file ${safeReportPath}
\`\`\``;
    }
  }
}

function buildMethodologySection(): string {
  return `Research methodology:
- Start broad, then narrow into the highest-value subtopics.
- Prefer primary sources, official docs, papers, standards, release notes, and direct statements.
- Use \`web_search\` to map the space, then \`web_fetch\` to read the actual source material.
- If the topic involves code, libraries, or repositories, use GitHub MCP tools for repository facts, issues, PRs, and code search instead of relying only on web summaries.
- Search sparingly, fetch aggressively. Use search to discover sources, then fetch and inspect the actual source material.
- For GitHub/code search, batch intelligently and keep parallel search fan-out modest to avoid rate limits.
- Prioritize internal or organization-specific implementations over public alternatives when the question is about how a company or org does something.
- Prioritize source code over documentation once you know where the implementation lives.
- Read tests, examples, issues, pull requests, and commit history when they clarify behavior, integration patterns, edge cases, or design rationale.
- Capture exact URLs, publication dates, and key evidence while researching so citations are ready during synthesis.
- Follow dependencies, imports, call sites, and integration points so the final report explains how components connect in practice.
- Do not stop at surface summaries. Resolve contradictions, note uncertainty explicitly, and fill obvious gaps before writing.`;
}

function uniqueNonEmptyModels(models: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const model of models) {
    if (!model?.trim()) continue;
    const normalized = model.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function buildWorkerModelFallbacks(preferredModel: string, chatModel?: string): string[] {
  return uniqueNonEmptyModels([chatModel, ...config.copilot.modelShortlist]).filter(
    (model) => model !== preferredModel,
  );
}

function buildWorkerInstructions(
  args: ResearchPlanArgs,
  sources: string,
  fallbackModels: string[],
): string {
  const fallbackInstruction =
    fallbackModels.length > 0
      ? `Model selection rules:
- Prefer \`${args.worker_model}\` for research workers.
- If the \`task\` tool supports explicit model selection, start with \`${args.worker_model}\`.
- Only switch away from \`${args.worker_model}\` when a Copilot-backed worker attempt actually fails.
- Treat Copilot quota/credit exhaustion as one example of such a failure, but the key rule is: stay on Copilot unless Copilot fails.
- If that happens, retry with these fallback chat models in order: ${fallbackModels.map((model) => `\`${model}\``).join(", ")}.
- Do not proactively switch models before a Copilot failure occurs.
- If the \`task\` tool does not support explicit model selection, continue with the default chat model already in effect.`
      : `Model selection rules:
- Prefer \`${args.worker_model}\` for research workers.
- If the \`task\` tool supports explicit model selection, start with \`${args.worker_model}\`.
- If the \`task\` tool does not support explicit model selection, continue with the default chat model already in effect.
- Do not switch models unless a Copilot-backed worker attempt fails.`;

  return `Spawn ${workerCount(args.depth)} \`task\` workers in parallel. Each worker must own a distinct subtopic.

${fallbackInstruction}

Worker prompt template:
\`\`\`
Research the following subtopic thoroughly: [SUBTOPIC]

Use web_search and web_fetch to find ${sources} high-quality sources. Prioritize:
1. Primary sources over commentary
2. Recent sources when recency matters
3. Technical depth over summaries

If the subtopic is codebase-, library-, or repository-related, use GitHub MCP tools where relevant for code search, issues, PRs, commits, and repo metadata.

For each finding, capture:
- Key facts and insights
- Source URL
- Source date when available
- A concrete supporting detail suitable for citation

Search sparingly, fetch aggressively. Once a promising URL is identified, use web_fetch to inspect the source directly.

Return:
- A structured bullet summary
- Open questions or uncertainty
- A complete source list
\`\`\``;
}

interface ResearchPlanArgs {
  topic: string;
  source_links?: string[];
  destination: (typeof DESTINATION_VALUES)[number];
  destination_path?: string;
  worker_model: string;
  fallback_models?: string[];
  depth: (typeof DEPTH_VALUES)[number];
}

export function buildResearchPlan(args: ResearchPlanArgs): string {
  const reportPath = buildReportPath(args.topic);
  const workers = workerCount(args.depth);
  const sources = sourceTarget(args.depth);
  const fallbackModels = args.fallback_models ?? [];
  const outputInstructions = buildOutputInstructions(
    args.destination,
    reportPath,
    args.destination_path,
  );

  const sourceLinksSection =
    args.source_links && args.source_links.length > 0
      ? `
## Phase 1: Pre-fetch Provided Sources

Fetch these URLs first with \`web_fetch\` to establish baseline context before broader research:
${args.source_links.map((url) => `- ${url}`).join("\n")}

Summarize the key findings from each source before proceeding to broader scoping.
`
      : "";

  return `# Research Plan: ${args.topic}

**Depth**: ${args.depth} (target ${sources} sources, ${workers} worker agents)
**Worker model**: ${args.worker_model}
**Worker fallback models**: ${fallbackModels.length > 0 ? fallbackModels.join(" -> ") : "default chat model in effect"}
**Report path**: ${reportPath}

You are a staff-level researcher operating autonomously. Conduct an exhaustive investigation on the topic below, make reasonable assumptions when needed, and produce a report that is specific, evidence-based, and citation-ready.

${buildMethodologySection()}

## Phase 0: Classify Query Intent

Before researching, classify the request into one of these modes and adapt the report accordingly:
- **Process / how-to**: Focus on steps, prerequisites, policies, documentation, and who or what system the user needs.
- **Conceptual / explanatory**: Focus on explanation, context, trade-offs, and how the concept relates to adjacent concepts.
- **Technical deep-dive**: Focus on code, architecture, data flow, integration points, dependencies, deployment or rollout details, and performance characteristics.

Match the final report depth and structure to the query intent. Do not force deep code sections into process questions, and do not give shallow high-level summaries for technical implementation questions.

${sourceLinksSection}
## Phase 2: Scoping

Use \`web_search\` with 3-5 broad queries to understand the landscape:
- Search using multiple query variations (exact names, partial matches, related concepts)
- Identify the main subtopics, key players, and research threads
- Create a mental outline of 3-5 major sections for the report

## Phase 3: Parallel Deep Research

${buildWorkerInstructions(args, sources, fallbackModels)}

## Phase 4: Synthesis

After all workers complete:
1. Collect and deduplicate findings across workers
2. Cross-reference claims that appear in multiple sources
3. Identify gaps — run targeted \`web_search\` queries to fill them
4. Resolve any contradictions between sources
5. Distinguish clearly between verified facts and reasonable inference

## Phase 5: Report Writing

${outputInstructions}

**Report structure (Markdown)**:

\`\`\`markdown
# Research Report: ${args.topic}

*Generated: [date] | Depth: ${args.depth} | Sources: [count]*

## Executive Summary
3-5 sentences covering the most important findings.

## Query Type
State whether this is a Process, Conceptual, or Technical Deep-dive report and tailor the sections below accordingly.

## Key Findings
Bulleted list of the top 5-10 discoveries, each with a footnote citation[^1].

## [Primary Body Sections]
Choose sections appropriate to the query type:
- Process: prerequisites, steps, resources, contacts/systems, caveats
- Conceptual: explanation, background, trade-offs, related concepts
- Technical deep-dive: architecture overview, component sections, integration points, data flow, performance notes

## Key Repositories Summary
Include this table when multiple repositories, services, or codebases are relevant.

| Repository | Purpose | Key Files |
|-----------|---------|-----------|
| ... | ... | ... |

## Architecture Diagram
For technical deep-dives, include a concise ASCII diagram showing the major components and relationships.

## Methodology
Brief description of search strategy, number of sources consulted, and any limitations.

## Confidence Assessment
Separate what is directly verified from source material vs. what is inferred from patterns, naming, or partial evidence.

## Sources
[^1]: [Source title](URL) — brief description of what was cited
[^2]: [Source title](URL) — brief description of what was cited
...
\`\`\`

**Citation requirements**:
- Every factual claim must have a footnote reference
- Use \`[^N]\` inline and list all sources in the Sources section
- Include the URL and a brief description for each source
- Prefer authoritative sources (official docs, papers, established publications)
- **For code/repository research**: cite specific file paths with line numbers (e.g. \`src/client.ts:42\`) as the primary citation form. URL-only citations are a fallback when source code is inaccessible. If you have access to GitHub MCP tools or can fetch raw file contents, you MUST cite at the file-path level, not the repo-URL level.
- When discussing history or changes over time, include commit SHAs or pull requests when available
- When referencing repositories, hyperlink them in markdown instead of using bare names
- Never fabricate file paths, implementations, or citations

## Phase 6: Completion

After saving the report, provide a concise summary to the user that includes:
1. The report file path so they can open it
2. The number of sources consulted
3. The top 3 most important findings
4. Any areas where information was limited or uncertain`;
}

export const researchTool = defineTool("research", {
  description:
    "Conduct deep research on a topic using web search, web fetch, and parallel worker agents. Returns a structured research plan to follow. After receiving the plan, execute it using the built-in task, web_search, web_fetch, and edit_file tools.",
  parameters: z.object({
    topic: z.string().describe("The research topic or question"),
    source_links: z
      .array(z.string())
      .optional()
      .describe("Starting URLs to fetch as initial research context"),
    destination: z
      .enum(DESTINATION_VALUES)
      .optional()
      .default("local")
      .describe("Where to save the report: local (default), github, or gdoc"),
    destination_path: z
      .string()
      .optional()
      .describe("Target path: GitHub 'owner/repo/path' or Google Doc title"),
    worker_model: z
      .string()
      .optional()
      .describe("Model for research workers (default: from RESEARCH_WORKER_MODEL config)"),
    depth: z
      .enum(DEPTH_VALUES)
      .optional()
      .default("standard")
      .describe("Research depth: quick (3-5 sources), standard (8-12), deep (15+)"),
  }),
  handler: async (args, invocation) => {
    const audit = createAuditTimer(
      invocation.sessionId,
      "research",
      args as Record<string, unknown>,
    );

    try {
      const effectiveWorkerModel = args.worker_model || config.copilot.researchWorkerModel;
      const chatId = getChatIdForSession(invocation.sessionId);
      const chatModel = chatId !== undefined ? getModelForChat(chatId) : undefined;
      const fallbackModels = buildWorkerModelFallbacks(effectiveWorkerModel, chatModel);

      const plan = buildResearchPlan({
        topic: args.topic,
        source_links: args.source_links,
        destination: args.destination ?? "local",
        destination_path: args.destination_path,
        worker_model: effectiveWorkerModel,
        fallback_models: fallbackModels,
        depth: args.depth ?? "standard",
      });

      audit.complete(`Research plan generated for: ${args.topic}`);
      return plan;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit.complete(`Error: ${message}`);
      return `Failed to generate research plan: ${message}`;
    }
  },
});
