import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const completeAudit = vi.fn<any>();
const createAuditTimer = vi.fn<any>(() => ({ complete: completeAudit }));

vi.mock("../logging/audit.js", () => ({
  createAuditTimer,
}));

const startBrowserSession = vi.fn<any>();
const getBrowserSession = vi.fn<any>();
const closeBrowserSession = vi.fn<any>();
const closeAllBrowserSessions = vi.fn<any>();
const listBrowserSessions = vi.fn<any>(() => []);
const resolveBrowserCredential = vi.fn<any>();

vi.mock("./browser-runtime.js", () => ({
  startBrowserSession,
  getBrowserSession,
  closeBrowserSession,
  closeAllBrowserSessions,
  listBrowserSessions,
  resolveBrowserCredential,
}));

const getChatIdForSession = vi.fn<any>();
vi.mock("../agent.js", () => ({
  getChatIdForSession,
}));

const sendPhotoFromPath = vi.fn<any>();
vi.mock("../telegram/runtime.js", () => ({
  sendPhotoFromPath,
}));

vi.mock("../config.js", () => ({
  config: {
    paths: {
      browserScreenshots: "/tmp/neo-browser-screenshots",
    },
  },
}));

function invocation() {
  return {
    sessionId: "session-1",
    toolCallId: "tool-call-1",
    toolName: "browser",
    arguments: {},
  };
}

interface ToolResult {
  textResultForLlm: string;
  resultType: "success" | "failure";
  error?: string;
}

describe("browserTool", () => {
  beforeEach(() => {
    vi.resetModules();
    completeAudit.mockReset();
    createAuditTimer.mockClear();
    startBrowserSession.mockReset();
    getBrowserSession.mockReset();
    closeBrowserSession.mockReset();
    closeAllBrowserSessions.mockReset();
    listBrowserSessions.mockReset();
    listBrowserSessions.mockReturnValue([]);
    resolveBrowserCredential.mockReset();
    getChatIdForSession.mockReset();
    sendPhotoFromPath.mockReset();
  });

  it("starts a session and redacts credential references in audit logs", async () => {
    startBrowserSession.mockResolvedValue({
      headless: true,
      credentialKey: "github",
      page: {
        url: () => "https://example.com",
      },
    });

    const { browserTool } = await import("./browser");
    const result = (await browserTool.handler(
      {
        action: "start_session",
        session_name: "main",
        credential_key: "github",
      },
      invocation(),
    )) as ToolResult;

    expect(startBrowserSession).toHaveBeenCalledWith("session-1", "main", {
      headless: undefined,
      credentialKey: "github",
    });
    expect(createAuditTimer).toHaveBeenCalledWith(
      "session-1",
      "browser",
      expect.objectContaining({ credential_key: "[REDACTED]" }),
    );
    expect(result.textResultForLlm).toContain('"session_name": "main"');
    expect(result.textResultForLlm).toContain('"credential_key": "[REDACTED]"');
  });

  it("captures a screenshot and sends it to Telegram", async () => {
    getBrowserSession.mockResolvedValue({
      page: {
        url: () => "https://example.com/dashboard",
        screenshot: vi.fn<any>().mockResolvedValue(undefined),
        viewportSize: () => ({ width: 1280, height: 720 }),
      },
    });
    getChatIdForSession.mockReturnValue(42);

    const { browserTool } = await import("./browser");
    const result = (await browserTool.handler(
      {
        action: "screenshot",
        session_name: "main",
        full_page: true,
      },
      invocation(),
    )) as ToolResult;

    expect(sendPhotoFromPath).toHaveBeenCalledWith(
      42,
      expect.stringContaining("/tmp/neo-browser-screenshots/main-"),
      "Browser screenshot: https://example.com/dashboard",
    );
    expect(result.textResultForLlm).toContain('"delivered_to_telegram": true');
    expect(result.textResultForLlm).toContain('"width": 1280');
  });

  it("returns a manual-intervention error when login triggers a captcha", async () => {
    const locator = vi.fn<any>((selector: string) => {
      if (selector === "body") {
        return {
          innerText: vi.fn<any>().mockResolvedValue("Please solve the CAPTCHA to continue"),
        };
      }

      if (selector === "#success") {
        return {
          waitFor: vi.fn<any>().mockRejectedValue(new Error("timeout")),
        };
      }

      return {
        fill: vi.fn<any>().mockResolvedValue(undefined),
        click: vi.fn<any>().mockResolvedValue(undefined),
        press: vi.fn<any>().mockResolvedValue(undefined),
      };
    });

    getBrowserSession.mockResolvedValue({
      page: {
        locator,
        url: () => "https://example.com/login",
      },
    });
    resolveBrowserCredential.mockReturnValue({
      username: "neo@example.com",
      password: "secret",
    });

    const { browserTool } = await import("./browser");
    const result = (await browserTool.handler(
      {
        action: "login",
        session_name: "main",
        credential_key: "github",
        username_selector: "#username",
        password_selector: "#password",
        submit_selector: "#submit",
        success_selector: "#success",
      },
      invocation(),
    )) as ToolResult;

    expect(resolveBrowserCredential).toHaveBeenCalledWith("github");
    expect(result.textResultForLlm).toBe(
      "Error: CAPTCHA detected. Manual intervention is required.",
    );
    expect(result.resultType).toBe("failure");
  });

  it("waits for navigation after click when wait_until is requested", async () => {
    const click = vi.fn<any>().mockResolvedValue(undefined);
    const waitForNavigation = vi.fn<any>().mockResolvedValue(null);
    getBrowserSession.mockResolvedValue({
      page: {
        locator: vi.fn<any>(() => ({ click })),
        waitForNavigation,
        url: () => "https://example.com/after",
      },
    });

    const { browserTool } = await import("./browser");
    const result = (await browserTool.handler(
      {
        action: "click",
        session_name: "main",
        selector: "a.next",
        wait_until: "load",
        timeout_ms: 5000,
      },
      invocation(),
    )) as ToolResult;

    expect(getBrowserSession).toHaveBeenCalledWith("session-1", "main");
    expect(waitForNavigation).toHaveBeenCalledWith({
      waitUntil: "load",
      timeout: 5000,
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(result.textResultForLlm).toContain('"url": "https://example.com/after"');
  });
});
