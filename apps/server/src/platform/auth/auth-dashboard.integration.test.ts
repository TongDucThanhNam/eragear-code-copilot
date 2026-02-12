import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface AppWithFetch {
  fetch: (request: Request) => Promise<Response>;
}

const TEST_ADMIN_USERNAME = "admin";
const TEST_ADMIN_PASSWORD = "admin123";
const TEST_BASE_URL = "http://127.0.0.1:3010";

let app: AppWithFetch;
let tempDir = "";

function buildUrl(pathname: string): string {
  return `${TEST_BASE_URL}${pathname}`;
}

function extractCookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as unknown as {
      getSetCookie?: () => string[];
    }
  ).getSetCookie;

  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(response.headers);
    if (values.length > 0) {
      return values.map((value) => value.split(";")[0]).join("; ");
    }
  }

  const merged = response.headers.get("set-cookie");
  if (!merged) {
    return "";
  }

  return merged
    .split(",")
    .map((value) => value.trim().split(";")[0])
    .join("; ");
}

function signIn(username: string, password: string): Promise<Response> {
  return app.fetch(
    new Request(buildUrl("/api/auth/sign-in/username"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_BASE_URL,
      },
      body: JSON.stringify({ username, password }),
    })
  );
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "eragear-auth-dashboard-"));
  const bootConfigPath = path.join(tempDir, "settings.json");
  writeFileSync(
    bootConfigPath,
    JSON.stringify(
      {
        boot: {
          mode: "standard",
          ALLOWED_AGENT_COMMANDS: ["bun"],
          ALLOWED_TERMINAL_COMMANDS: ["bun"],
          ALLOWED_ENV_KEYS: ["PATH"],
          WS_HOST: "127.0.0.1",
          WS_PORT: 3010,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  process.env.NODE_ENV = "development";
  process.env.ERAGEAR_BOOT_CONFIG_PATH = bootConfigPath;
  process.env.AUTH_DB_PATH = path.join(tempDir, "auth.sqlite");
  process.env.ERAGEAR_STORAGE_DIR = path.join(tempDir, "storage");
  process.env.AUTH_ADMIN_USERNAME = TEST_ADMIN_USERNAME;
  process.env.AUTH_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
  process.env.AUTH_BASE_URL = TEST_BASE_URL;
  process.env.AUTH_TRUSTED_ORIGINS = TEST_BASE_URL;
  process.env.AUTH_ALLOW_SIGNUP = "false";
  process.env.AUTH_SECRET = "auth-dashboard-integration-secret";
  process.env.LOG_FILE_ENABLED = "false";

  const stamp = Date.now().toString();
  const compositionBootstrap = await import(
    `../../bootstrap/composition.ts?integration=${stamp}`
  );
  const serverBootstrap = await import(
    `../../bootstrap/server.ts?integration=${stamp}`
  );

  const composition =
    await compositionBootstrap.createAppCompositionFromSettings();
  await composition.deps.lifecycle.prepareStartup();
  app = (await serverBootstrap.createApp(composition)) as AppWithFetch;
});

afterAll(() => {
  process.env.ERAGEAR_BOOT_CONFIG_PATH = undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("auth + dashboard integration", () => {
  test("redirects anonymous dashboard requests to /login", async () => {
    const response = await app.fetch(new Request(buildUrl("/_/dashboard")));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("sets session cookie on successful username/password sign-in", async () => {
    const response = await signIn(TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD);
    expect(response.status).toBe(200);
    const cookie = extractCookieHeader(response);
    expect(cookie.length).toBeGreaterThan(0);
    expect(cookie).toContain("better-auth.session_token=");
  });

  test("grants dashboard access with valid session cookie", async () => {
    const signInResponse = await signIn(
      TEST_ADMIN_USERNAME,
      TEST_ADMIN_PASSWORD
    );
    const cookie = extractCookieHeader(signInResponse);
    expect(cookie.length).toBeGreaterThan(0);

    const dashboard = await app.fetch(
      new Request(buildUrl("/_/dashboard"), {
        headers: { cookie },
      })
    );

    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get("location")).toBeNull();
  });

  test("rejects invalid credentials and does not return session cookie", async () => {
    const response = await signIn(TEST_ADMIN_USERNAME, "wrong-password");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    const cookie = extractCookieHeader(response);
    expect(cookie).not.toContain("better-auth.session_token=");
  });

  test("revokes dashboard access after sign-out", async () => {
    const signInResponse = await signIn(
      TEST_ADMIN_USERNAME,
      TEST_ADMIN_PASSWORD
    );
    const cookie = extractCookieHeader(signInResponse);
    expect(cookie.length).toBeGreaterThan(0);

    const signOut = await app.fetch(
      new Request(buildUrl("/api/auth/sign-out"), {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: TEST_BASE_URL,
        },
        body: "{}",
      })
    );

    expect(signOut.status).toBe(200);

    const dashboard = await app.fetch(
      new Request(buildUrl("/_/dashboard"), {
        headers: { cookie },
      })
    );
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.get("location")).toBe("/login");
  });
});
