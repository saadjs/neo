import { beforeEach, describe, expect, it, vi } from "vitest";

const launchPersistentContext = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext,
  },
}));

vi.mock("../logging/index.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
  }),
}));

vi.mock("../config.js", () => ({
  config: {
    browser: {
      defaultHeadless: true,
      launchArgs: ["--disable-dev-shm-usage"],
      credentials: {
        github: {
          username: "neo@example.com",
          password: "secret",
        },
      },
    },
    paths: {
      browserSessions: "/tmp/neo-browser-sessions",
      browserDownloads: "/tmp/neo-browser-downloads",
    },
  },
}));

describe("browser runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    launchPersistentContext.mockReset();
  });

  it("resolves configured credentials and rejects missing keys", async () => {
    const runtime = await import("./browser-runtime.js");

    expect(runtime.resolveBrowserCredential("github")).toEqual({
      username: "neo@example.com",
      password: "secret",
    });
    expect(() => runtime.resolveBrowserCredential("missing")).toThrow(
      'Browser credential "missing" not found in NEO_BROWSER_CREDENTIALS_JSON.',
    );
  });

  it("starts, lists, and closes persistent sessions", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const page = {
      isClosed: () => false,
      url: () => "https://example.com",
    };
    launchPersistentContext.mockResolvedValue({
      pages: () => [page],
      newPage: vi.fn().mockResolvedValue(page),
      close,
    });

    const runtime = await import("./browser-runtime.js");
    const session = await runtime.startBrowserSession("session-1", "main", {
      credentialKey: "github",
    });

    expect(launchPersistentContext).toHaveBeenCalledWith(
      "/tmp/neo-browser-sessions/c2Vzc2lvbi0x/bWFpbg",
      expect.objectContaining({
        headless: true,
        downloadsPath: "/tmp/neo-browser-downloads/c2Vzc2lvbi0x/bWFpbg",
        args: ["--disable-dev-shm-usage"],
      }),
    );
    expect(session.name).toBe("main");
    expect(runtime.listBrowserSessions("session-1")).toEqual([
      expect.objectContaining({
        name: "main",
        url: "https://example.com",
        credentialKey: "[REDACTED]",
      }),
    ]);
    expect(runtime.listBrowserSessions("session-2")).toEqual([]);

    await expect(runtime.closeAllBrowserSessions("session-1")).resolves.toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("isolates sessions with the same name across different scopes", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const firstPage = {
      isClosed: () => false,
      url: () => "https://one.example.com",
    };
    const secondPage = {
      isClosed: () => false,
      url: () => "https://two.example.com",
    };
    launchPersistentContext
      .mockResolvedValueOnce({
        pages: () => [firstPage],
        newPage: vi.fn().mockResolvedValue(firstPage),
        close,
      })
      .mockResolvedValueOnce({
        pages: () => [secondPage],
        newPage: vi.fn().mockResolvedValue(secondPage),
        close,
      });

    const runtime = await import("./browser-runtime.js");
    await runtime.startBrowserSession("session-1", "main");
    await runtime.startBrowserSession("session-2", "main");

    expect(runtime.listBrowserSessions("session-1")).toEqual([
      expect.objectContaining({ name: "main", url: "https://one.example.com" }),
    ]);
    expect(runtime.listBrowserSessions("session-2")).toEqual([
      expect.objectContaining({ name: "main", url: "https://two.example.com" }),
    ]);
  });

  it("uses distinct profile paths for names containing literal escape-like sequences", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const page = {
      isClosed: () => false,
      url: () => "https://example.com",
    };
    launchPersistentContext
      .mockResolvedValueOnce({
        pages: () => [page],
        newPage: vi.fn().mockResolvedValue(page),
        close,
      })
      .mockResolvedValueOnce({
        pages: () => [page],
        newPage: vi.fn().mockResolvedValue(page),
        close,
      });

    const runtime = await import("./browser-runtime.js");
    await runtime.startBrowserSession("scope", "foo/bar");
    await runtime.startBrowserSession("scope", "foo~2Fbar");

    expect(launchPersistentContext).toHaveBeenNthCalledWith(
      1,
      "/tmp/neo-browser-sessions/c2NvcGU/Zm9vL2Jhcg",
      expect.any(Object),
    );
    expect(launchPersistentContext).toHaveBeenNthCalledWith(
      2,
      "/tmp/neo-browser-sessions/c2NvcGU/Zm9vfjJGYmFy",
      expect.any(Object),
    );
  });
});
