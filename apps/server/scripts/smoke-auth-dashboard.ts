import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ADMIN_USERNAME = "admin";
const TEST_ADMIN_PASSWORD = "admin123";
const TEST_BASE_URL = "http://127.0.0.1:3011";

interface AppWithFetch {
  fetch: (request: Request) => Promise<Response>;
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

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "eragear-auth-smoke-"));
process.env.NODE_ENV = "development";
process.env.AUTH_DB_PATH = path.join(tempDir, "auth.sqlite");
process.env.ERAGEAR_STORAGE_DIR = path.join(tempDir, "storage");
process.env.AUTH_ADMIN_USERNAME = TEST_ADMIN_USERNAME;
process.env.AUTH_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
process.env.AUTH_BASE_URL = TEST_BASE_URL;
process.env.AUTH_TRUSTED_ORIGINS = TEST_BASE_URL;
process.env.AUTH_ALLOW_SIGNUP = "false";
process.env.BETTER_AUTH_SECRET = "auth-dashboard-smoke-secret";
process.env.LOG_FILE_ENABLED = "false";

const stamp = Date.now().toString();
const authBootstrap = await import(
  `../src/infra/auth/bootstrap.ts?smoke=${stamp}`
);
const serverBootstrap = await import(
  `../src/bootstrap/server.ts?smoke=${stamp}`
);

const run = async () => {
  await authBootstrap.ensureAuthSetup();
  const app = (await serverBootstrap.createApp()) as AppWithFetch;

  const anonymousDashboard = await app.fetch(
    new Request(`${TEST_BASE_URL}/_/dashboard`)
  );
  assert(
    anonymousDashboard.status === 302 &&
      anonymousDashboard.headers.get("location") === "/login",
    "Expected anonymous dashboard access to redirect to /login"
  );

  const signInResponse = await app.fetch(
    new Request(`${TEST_BASE_URL}/api/auth/sign-in/username`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_BASE_URL,
      },
      body: JSON.stringify({
        username: TEST_ADMIN_USERNAME,
        password: TEST_ADMIN_PASSWORD,
      }),
    })
  );

  assert(signInResponse.status === 200, "Expected sign-in to return 200");

  const cookie = extractCookieHeader(signInResponse);
  assert(
    cookie.includes("better-auth.session_token="),
    "Expected sign-in to set better-auth.session_token cookie"
  );

  const authenticatedDashboard = await app.fetch(
    new Request(`${TEST_BASE_URL}/_/dashboard`, {
      headers: { cookie },
    })
  );
  assert(
    authenticatedDashboard.status === 200,
    "Expected authenticated dashboard access to return 200"
  );

  const signOutResponse = await app.fetch(
    new Request(`${TEST_BASE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin: TEST_BASE_URL,
      },
      body: "{}",
    })
  );
  assert(signOutResponse.status === 200, "Expected sign-out to return 200");

  const revokedDashboard = await app.fetch(
    new Request(`${TEST_BASE_URL}/_/dashboard`, {
      headers: { cookie },
    })
  );
  assert(
    revokedDashboard.status === 302 &&
      revokedDashboard.headers.get("location") === "/login",
    "Expected dashboard access to be revoked after sign-out"
  );
};

try {
  await run();
  console.log("[Smoke] Auth + dashboard flow passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
