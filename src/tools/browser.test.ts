import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (_name: string, definition: unknown) => definition,
}));

const completeAudit = vi.fn();
const createAuditTimer = vi.fn(() => ({ complete: completeAudit }));

vi.mock("../logging/audit.js", () => ({
  createAuditTimer,
}));

const startBrowserSession = vi.fn();
const getBrowserSession = vi.fn();
const closeBrowserSession = vi.fn();
const closeAllBrowserSessions = vi.fn();
const listBrowserSessions = vi.fn(() => []);
const resolveBrowserCredential = vi.fn();

vi.mock("./browser-runtime.js", () => ({
  startBrowserSession,
  getBrowserSession,
  closeBrowserSession,
  closeAllBrowserSessions,
  listBrowserSessions,
  resolveBrowserCredential,
}));

const getConversationRefForSession = vi.fn();
vi.mock("../agent.js", () => ({
  getConversationRefForSession,
}));

const notifyPhoto = vi.fn();
vi.mock("../transport/notifier.js", () => ({
  notifyPhoto,
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
    getConversationRefForSession.mockReset();
    notifyPhoto.mockReset();
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
    const result = await browserTool.handler(
      {
        action: "start_session",
        session_name: "main",
        credential_key: "github",
      },
      invocation(),
    );

    expect(startBrowserSession).toHaveBeenCalledWith("session-1", "main", {
      headless: undefined,
      credentialKey: "github",
    });
    expect(createAuditTimer).toHaveBeenCalledWith(
      "session-1",
      "browser",
      expect.objectContaining({ credential_key: "[REDACTED]" }),
    );
    expect(result).toContain('"session_name": "main"');
    expect(result).toContain('"credential_key": "[REDACTED]"');
  });

  it("captures a screenshot and sends it to the session conversation", async () => {
    getBrowserSession.mockResolvedValue({
      page: {
        url: () => "https://example.com/dashboard",
        screenshot: vi.fn().mockResolvedValue(undefined),
        viewportSize: () => ({ width: 1280, height: 720 }),
      },
    });
    getConversationRefForSession.mockReturnValue({
      platform: "discord",
      id: "thread-42",
      kind: "channel",
    });

    const { browserTool } = await import("./browser");
    const result = await browserTool.handler(
      {
        action: "screenshot",
        session_name: "main",
        full_page: true,
      },
      invocation(),
    );

    expect(notifyPhoto).toHaveBeenCalledWith(
      {
        conversation: expect.objectContaining({
          id: "thread-42",
          platform: "discord",
          kind: "channel",
        }),
      },
      expect.stringContaining("/tmp/neo-browser-screenshots/main-"),
      "Browser screenshot: https://example.com/dashboard",
    );
    expect(result).toContain('"delivered_to_conversation": true');
    expect(result).toContain('"width": 1280');
  });

  it("returns a manual-intervention error when login triggers a captcha", async () => {
    const locator = vi.fn((selector: string) => {
      if (selector === "body") {
        return {
          innerText: vi.fn().mockResolvedValue("Please solve the CAPTCHA to continue"),
        };
      }

      if (selector === "#success") {
        return {
          waitFor: vi.fn().mockRejectedValue(new Error("timeout")),
        };
      }

      return {
        fill: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
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
    const result = await browserTool.handler(
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
    );

    expect(resolveBrowserCredential).toHaveBeenCalledWith("github");
    expect(result).toBe("Error: CAPTCHA detected. Manual intervention is required.");
  });

  it("waits for navigation after click when wait_until is requested", async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const waitForNavigation = vi.fn().mockResolvedValue(null);
    getBrowserSession.mockResolvedValue({
      page: {
        locator: vi.fn(() => ({ click })),
        waitForNavigation,
        url: () => "https://example.com/after",
      },
    });

    const { browserTool } = await import("./browser");
    const result = await browserTool.handler(
      {
        action: "click",
        session_name: "main",
        selector: "a.next",
        wait_until: "load",
        timeout_ms: 5000,
      },
      invocation(),
    );

    expect(getBrowserSession).toHaveBeenCalledWith("session-1", "main");
    expect(waitForNavigation).toHaveBeenCalledWith({
      waitUntil: "load",
      timeout: 5000,
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(result).toContain('"url": "https://example.com/after"');
  });
});
