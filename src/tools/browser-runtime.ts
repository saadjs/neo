import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config, type BrowserCredential } from "../config";
import { getLogger } from "../logging/index";

export interface BrowserSession {
  scopeId: string;
  name: string;
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  downloadDir: string;
  headless: boolean;
  credentialKey?: string;
  createdAt: string;
  lastUsedAt: string;
}

const sessions = new Map<string, BrowserSession>();

function sanitizeSessionName(name: string): string {
  return Buffer.from(name, "utf8").toString("base64url");
}

function sessionKey(scopeId: string, name: string): string {
  return `${scopeId}:${name}`;
}

function sessionUserDataDir(scopeId: string, name: string): string {
  return join(
    config.paths.browserSessions,
    sanitizeSessionName(scopeId),
    sanitizeSessionName(name),
  );
}

function sessionDownloadDir(scopeId: string, name: string): string {
  return join(
    config.paths.browserDownloads,
    sanitizeSessionName(scopeId),
    sanitizeSessionName(name),
  );
}

async function launchSession(
  scopeId: string,
  name: string,
  headless: boolean,
  credentialKey?: string,
): Promise<BrowserSession> {
  const key = sessionKey(scopeId, name);
  const userDataDir = sessionUserDataDir(scopeId, name);
  const downloadDir = sessionDownloadDir(scopeId, name);
  await mkdir(userDataDir, { recursive: true });
  await mkdir(downloadDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true,
    downloadsPath: downloadDir,
    args: config.browser.launchArgs,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const now = new Date().toISOString();
  const session: BrowserSession = {
    scopeId,
    name,
    context,
    page,
    userDataDir,
    downloadDir,
    headless,
    credentialKey,
    createdAt: now,
    lastUsedAt: now,
  };

  sessions.set(key, session);
  getLogger().info(
    { scopeId, sessionName: name, headless, userDataDir },
    "Browser session started",
  );
  return session;
}

export function resolveBrowserCredential(key: string): BrowserCredential {
  const credential = config.browser.credentials[key];
  if (!credential) {
    throw new Error(`Browser credential "${key}" not found in NEO_BROWSER_CREDENTIALS_JSON.`);
  }
  return credential;
}

export async function startBrowserSession(
  scopeId: string,
  name: string,
  opts?: { headless?: boolean; credentialKey?: string },
): Promise<BrowserSession> {
  const key = sessionKey(scopeId, name);
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsedAt = new Date().toISOString();
    if (opts?.credentialKey) {
      existing.credentialKey = opts.credentialKey;
    }
    return existing;
  }

  if (opts?.credentialKey) {
    resolveBrowserCredential(opts.credentialKey);
  }

  return launchSession(
    scopeId,
    name,
    opts?.headless ?? config.browser.defaultHeadless,
    opts?.credentialKey,
  );
}

export async function getBrowserSession(scopeId: string, name: string): Promise<BrowserSession> {
  const key = sessionKey(scopeId, name);
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsedAt = new Date().toISOString();
    if (existing.page.isClosed()) {
      sessions.delete(key);
    } else {
      return existing;
    }
  }

  const userDataDir = sessionUserDataDir(scopeId, name);
  if (!existsSync(userDataDir)) {
    throw new Error(`Browser session "${name}" does not exist. Start it first.`);
  }

  return launchSession(scopeId, name, config.browser.defaultHeadless);
}

export function listBrowserSessions(scopeId: string) {
  return Array.from(sessions.values())
    .filter((session) => session.scopeId === scopeId)
    .map((session) => ({
      name: session.name,
      url: session.page.url(),
      headless: session.headless,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      credentialKey: session.credentialKey ? "[REDACTED]" : undefined,
    }));
}

export async function closeBrowserSession(scopeId: string, name: string): Promise<boolean> {
  const key = sessionKey(scopeId, name);
  const session = sessions.get(key);
  if (!session) return false;

  await session.context.close();
  sessions.delete(key);
  getLogger().info({ scopeId, sessionName: name }, "Browser session closed");
  return true;
}

export async function closeAllBrowserSessions(scopeId?: string): Promise<number> {
  const targets = Array.from(sessions.values()).filter((session) =>
    scopeId ? session.scopeId === scopeId : true,
  );
  for (const session of targets) {
    await closeBrowserSession(session.scopeId, session.name);
  }
  return targets.length;
}
