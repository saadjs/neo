import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { getConversationRefForSession } from "../agent";
import { config } from "../config";
import { createAuditTimer } from "../logging/audit";
import { notifyPhoto } from "../transport/notifier";
import {
  closeAllBrowserSessions,
  closeBrowserSession,
  getBrowserSession,
  listBrowserSessions,
  resolveBrowserCredential,
  startBrowserSession,
} from "./browser-runtime";

const WAIT_UNTIL_VALUES = ["load", "domcontentloaded", "networkidle"] as const;

const parameters = z.object({
  action: z
    .enum([
      "start_session",
      "list_sessions",
      "close_session",
      "close_all_sessions",
      "navigate",
      "click",
      "fill",
      "press",
      "select",
      "wait_for",
      "extract_text",
      "extract_html",
      "screenshot",
      "login",
    ])
    .describe("Browser action to perform"),
  session_name: z.string().optional().describe("Persistent browser session name"),
  start_url: z.string().optional().describe("Initial URL for a new browser session"),
  url: z.string().optional().describe("URL to navigate to"),
  selector: z.string().optional().describe("CSS selector for page actions"),
  value: z.string().optional().describe("Value to fill or select"),
  values: z.array(z.string()).optional().describe("Multiple values to select"),
  key: z.string().optional().describe("Keyboard key to press"),
  wait_until: z
    .enum(WAIT_UNTIL_VALUES)
    .optional()
    .describe("Load state to wait for after navigation/click"),
  timeout_ms: z.number().positive().optional().describe("Timeout for waits in milliseconds"),
  full_page: z.boolean().optional().describe("Capture a full-page screenshot"),
  credential_key: z
    .string()
    .optional()
    .describe("Credential key from NEO_BROWSER_CREDENTIALS_JSON"),
  headless: z.boolean().optional().describe("Override the default headless browser setting"),
  username_selector: z.string().optional().describe("Selector for username input"),
  password_selector: z.string().optional().describe("Selector for password input"),
  submit_selector: z.string().optional().describe("Selector for login submit button"),
  success_selector: z.string().optional().describe("Selector that indicates login success"),
});

type BrowserArgs = z.infer<typeof parameters>;

function formatResult(result: Record<string, unknown>) {
  return JSON.stringify(result, null, 2);
}

function redactAuditArgs(args: BrowserArgs): Record<string, unknown> {
  return {
    ...args,
    credential_key: args.credential_key ? "[REDACTED]" : undefined,
    value:
      args.action === "fill" || args.action === "login" || args.action === "select"
        ? "[REDACTED]"
        : args.value,
    values: args.values ? ["[REDACTED]"] : undefined,
  };
}

function requireSessionName(args: BrowserArgs) {
  if (!args.session_name?.trim()) {
    throw new Error("session_name is required for this browser action.");
  }
  return args.session_name.trim();
}

function requireSelector(args: BrowserArgs, field = "selector") {
  const selector = field === "selector" ? args.selector : args[field as keyof BrowserArgs];
  if (typeof selector !== "string" || !selector.trim()) {
    throw new Error(`${field} is required for this browser action.`);
  }
  return selector.trim();
}

async function detectManualIntervention(pageText: string): Promise<string | undefined> {
  const normalized = pageText.toLowerCase();
  if (normalized.includes("captcha")) return "CAPTCHA detected. Manual intervention is required.";
  if (normalized.includes("verification code")) {
    return "Verification code prompt detected. Manual intervention is required.";
  }
  if (normalized.includes("two-factor") || normalized.includes("2-factor")) {
    return "Two-factor authentication detected. Manual intervention is required.";
  }
  if (normalized.includes("one-time code") || normalized.includes("mfa")) {
    return "MFA challenge detected. Manual intervention is required.";
  }
  return undefined;
}

async function buildScreenshotPath(sessionName: string) {
  await mkdir(config.paths.browserScreenshots, { recursive: true });
  const safeName = sessionName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return join(config.paths.browserScreenshots, `${safeName}-${Date.now()}-${randomUUID()}.png`);
}

async function execute(args: BrowserArgs, invocationSessionId: string): Promise<string> {
  switch (args.action) {
    case "start_session": {
      const sessionName = requireSessionName(args);
      const session = await startBrowserSession(invocationSessionId, sessionName, {
        headless: args.headless,
        credentialKey: args.credential_key,
      });

      if (args.start_url) {
        await session.page.goto(args.start_url, {
          waitUntil: args.wait_until ?? "load",
        });
      }

      return formatResult({
        action: args.action,
        session_name: sessionName,
        url: session.page.url(),
        headless: session.headless,
        credential_key: session.credentialKey ? "[REDACTED]" : undefined,
      });
    }

    case "list_sessions":
      return formatResult({
        action: args.action,
        sessions: listBrowserSessions(invocationSessionId),
      });

    case "close_session": {
      const sessionName = requireSessionName(args);
      const closed = await closeBrowserSession(invocationSessionId, sessionName);
      return formatResult({
        action: args.action,
        session_name: sessionName,
        closed,
      });
    }

    case "close_all_sessions": {
      const count = await closeAllBrowserSessions(invocationSessionId);
      return formatResult({
        action: args.action,
        closed_count: count,
      });
    }

    case "navigate": {
      const sessionName = requireSessionName(args);
      if (!args.url?.trim()) throw new Error("url is required for navigate.");
      const session = await getBrowserSession(invocationSessionId, sessionName);
      await session.page.goto(args.url, { waitUntil: args.wait_until ?? "load" });
      return formatResult({
        action: args.action,
        session_name: sessionName,
        url: session.page.url(),
        title: await session.page.title(),
      });
    }

    case "click": {
      const sessionName = requireSessionName(args);
      const selector = requireSelector(args);
      const session = await getBrowserSession(invocationSessionId, sessionName);
      if (args.wait_until) {
        await Promise.all([
          session.page.waitForNavigation({
            waitUntil: args.wait_until,
            timeout: args.timeout_ms,
          }),
          session.page.locator(selector).click(),
        ]);
      } else {
        await session.page.locator(selector).click();
      }
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector,
        url: session.page.url(),
      });
    }

    case "fill": {
      const sessionName = requireSessionName(args);
      const selector = requireSelector(args);
      if (args.value === undefined) throw new Error("value is required for fill.");
      const session = await getBrowserSession(invocationSessionId, sessionName);
      await session.page.locator(selector).fill(args.value);
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector,
        filled: true,
      });
    }

    case "press": {
      const sessionName = requireSessionName(args);
      const selector = requireSelector(args);
      if (!args.key?.trim()) throw new Error("key is required for press.");
      const session = await getBrowserSession(invocationSessionId, sessionName);
      await session.page.locator(selector).press(args.key);
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector,
        key: args.key,
      });
    }

    case "select": {
      const sessionName = requireSessionName(args);
      const selector = requireSelector(args);
      const selection = args.values?.length ? args.values : args.value ? [args.value] : [];
      if (selection.length === 0) throw new Error("value or values is required for select.");
      const session = await getBrowserSession(invocationSessionId, sessionName);
      await session.page.locator(selector).selectOption(selection);
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector,
        selected_count: selection.length,
      });
    }

    case "wait_for": {
      const sessionName = requireSessionName(args);
      const session = await getBrowserSession(invocationSessionId, sessionName);
      if (args.selector) {
        await session.page.locator(args.selector).waitFor({
          state: "visible",
          timeout: args.timeout_ms,
        });
      } else if (args.timeout_ms) {
        await session.page.waitForTimeout(args.timeout_ms);
      } else {
        throw new Error("selector or timeout_ms is required for wait_for.");
      }
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector: args.selector,
        timeout_ms: args.timeout_ms,
      });
    }

    case "extract_text": {
      const sessionName = requireSessionName(args);
      const session = await getBrowserSession(invocationSessionId, sessionName);
      const text = args.selector
        ? await session.page.locator(args.selector).innerText()
        : await session.page.locator("body").innerText();
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector: args.selector,
        url: session.page.url(),
        text,
      });
    }

    case "extract_html": {
      const sessionName = requireSessionName(args);
      const session = await getBrowserSession(invocationSessionId, sessionName);
      const html = args.selector
        ? await session.page
            .locator(args.selector)
            .evaluate((element) => (element as { outerHTML: string }).outerHTML)
        : await session.page.content();
      return formatResult({
        action: args.action,
        session_name: sessionName,
        selector: args.selector,
        url: session.page.url(),
        html,
      });
    }

    case "screenshot": {
      const sessionName = requireSessionName(args);
      const session = await getBrowserSession(invocationSessionId, sessionName);
      const path = await buildScreenshotPath(sessionName);
      if (args.selector) {
        await session.page.locator(args.selector).screenshot({ path });
      } else {
        await session.page.screenshot({ path, fullPage: args.full_page ?? true });
      }

      const conversation = getConversationRefForSession(invocationSessionId);
      let deliveredToConversation = false;
      let deliveryError: string | undefined;
      if (conversation) {
        try {
          await notifyPhoto({ conversation }, path, `Browser screenshot: ${session.page.url()}`);
          deliveredToConversation = true;
        } catch (error) {
          deliveryError = error instanceof Error ? error.message : String(error);
        }
      } else {
        deliveryError = "No conversation mapping found for this session.";
      }

      return formatResult({
        action: args.action,
        session_name: sessionName,
        url: session.page.url(),
        path,
        delivered_to_conversation: deliveredToConversation,
        delivery_error: deliveryError,
        viewport: session.page.viewportSize() ?? undefined,
      });
    }

    case "login": {
      const sessionName = requireSessionName(args);
      if (!args.credential_key?.trim()) throw new Error("credential_key is required for login.");
      if (!args.username_selector?.trim()) {
        throw new Error("username_selector is required for login.");
      }
      if (!args.password_selector?.trim()) {
        throw new Error("password_selector is required for login.");
      }

      const credential = resolveBrowserCredential(args.credential_key);
      const session = await getBrowserSession(invocationSessionId, sessionName);
      await session.page.locator(args.username_selector).fill(credential.username);
      await session.page.locator(args.password_selector).fill(credential.password);

      if (args.submit_selector?.trim()) {
        await session.page.locator(args.submit_selector).click();
      } else {
        await session.page.locator(args.password_selector).press("Enter");
      }

      try {
        if (args.success_selector?.trim()) {
          await session.page.locator(args.success_selector).waitFor({
            state: "visible",
            timeout: args.timeout_ms ?? 15_000,
          });
        } else {
          await session.page.waitForLoadState("networkidle", {
            timeout: args.timeout_ms ?? 15_000,
          });
        }
      } catch {
        const pageText = await session.page
          .locator("body")
          .innerText()
          .catch(() => "");
        const manualIntervention = await detectManualIntervention(pageText);
        if (manualIntervention) {
          throw new Error(manualIntervention);
        }
        throw new Error("Login did not reach the expected post-authentication state.");
      }

      session.credentialKey = args.credential_key;
      return formatResult({
        action: args.action,
        session_name: sessionName,
        url: session.page.url(),
        credential_key: "[REDACTED]",
        success_selector: args.success_selector,
        logged_in: true,
      });
    }
  }
}

export const browserTool = defineTool("browser", {
  description:
    "Automate websites with Playwright using persistent named browser sessions. Supports navigation, clicks, forms, extraction, screenshots, and login via stored credentials.",
  parameters,
  handler: async (args, invocation) => {
    const audit = createAuditTimer(invocation.sessionId, "browser", redactAuditArgs(args));

    try {
      const result = await execute(args, invocation.sessionId);
      audit.complete(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit.complete(`Error: ${message}`);
      return `Error: ${message}`;
    }
  },
});
