/**
 * SDK Surface Smoke Test
 *
 * Validates that the Copilot SDK still exports everything Neo depends on
 * and that critical types/shapes haven't changed incompatibly.
 *
 * Run: node --experimental-vm-modules scripts/sdk-smoke-test.mjs
 */

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

// ── 1. Runtime exports ──────────────────────────────────────────────
console.log("\n📦 Checking runtime exports…");

const sdk = await import("@github/copilot-sdk");

assert(typeof sdk.CopilotClient === "function", "CopilotClient is exported as a class/function");
assert(typeof sdk.CopilotSession === "function", "CopilotSession is exported as a class/function");
assert(typeof sdk.approveAll === "function", "approveAll is exported as a function");
assert(typeof sdk.defineTool === "function", "defineTool is exported as a function");

// ── 2. CopilotClient shape ─────────────────────────────────────────
console.log("\n🔌 Checking CopilotClient shape…");

const client = new sdk.CopilotClient();
assert(typeof client.createSession === "function", "client.createSession exists");
assert(typeof client.resumeSession === "function", "client.resumeSession exists");
assert(typeof client.listModels === "function", "client.listModels exists");
assert(typeof client.deleteSession === "function", "client.deleteSession exists");

// ── 3. defineTool contract ──────────────────────────────────────────
console.log("\n🛠️  Checking defineTool contract…");

// Dynamically import zod — it's a dependency of the SDK
const { z } = await import("zod");

const tool = sdk.defineTool({
  description: "canary test tool",
  parameters: z.object({ input: z.string() }),
  handler: async (params, _invocation) => {
    return { textResultForLlm: `echo: ${params.input}`, resultType: "success" };
  },
});

assert(tool != null, "defineTool returns a tool object");
assert(typeof tool === "object", "defineTool returns an object (tool definition map)");

// defineTool returns { [toolName]: { description, parameters } }
const toolKeys = Object.keys(tool);
assert(toolKeys.length > 0, "defineTool result has at least one key (the tool name)");
const firstTool = tool[toolKeys[0]];
assert(firstTool.description === "canary test tool", "tool.description preserved in definition");

// ── 4. approveAll shape ─────────────────────────────────────────────
console.log("\n✅ Checking approveAll shape…");

const approval = sdk.approveAll();
assert(approval != null, "approveAll returns an object");
assert(approval.kind === "approved", "approveAll().kind is 'approved'");

// ── Summary ─────────────────────────────────────────────────────────
console.log("");
if (failures.length > 0) {
  console.error(`💥 ${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
} else {
  console.log("🎉 All SDK surface checks passed.");
}
