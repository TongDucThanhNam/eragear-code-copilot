import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const TEMP_PREFIX = "eragear-daemon-smoke-";
const packageRoot = path.resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
const resolvedTemporaryRoot = path.resolve(temporaryRoot);
if (
  path.dirname(resolvedTemporaryRoot) !== path.resolve(os.tmpdir()) ||
  !path.basename(resolvedTemporaryRoot).startsWith(TEMP_PREFIX)
) {
  throw new Error(
    `Refusing unsafe daemon smoke path: ${resolvedTemporaryRoot}`
  );
}
const manifestPath = path.join(temporaryRoot, "endpoint.json");
const tokenPath = path.join(temporaryRoot, "token");
const lockPath = path.join(temporaryRoot, "runtime.lock");
const apiKeyPath = path.join(temporaryRoot, "api-key.json");
const port = await reserveLoopbackPort();
let stderr = "";

const child = spawn(
  process.execPath,
  ["run", "src/runtime/daemon-service.ts"],
  {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      ALLOW_INSECURE_DEV_DEFAULTS: "true",
      AUTH_SECRET: randomBytes(32).toString("base64url"),
      AUTH_DB_PATH: path.join(temporaryRoot, "auth.sqlite"),
      ERAGEAR_STORAGE_DIR: path.join(temporaryRoot, "storage"),
      STORAGE_ALLOW_UNKNOWN_FS: "true",
      WS_HOST: "127.0.0.1",
      WS_PORT: String(port),
      ERAGEAR_RUNTIME_TRANSPORT: "user-daemon",
      ERAGEAR_DAEMON_MANIFEST_PATH: manifestPath,
      ERAGEAR_DAEMON_TOKEN_PATH: tokenPath,
      ERAGEAR_DAEMON_LOCK_PATH: lockPath,
      ERAGEAR_DAEMON_AUTH_API_KEY_PATH: apiKeyPath,
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  }
);
child.stderr?.on("data", (chunk) => {
  stderr = `${stderr}${String(chunk)}`.slice(-16_000);
});

try {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  await waitUntilReady(healthUrl, child);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  const token = (await readFile(tokenPath, "utf8")).trim();
  const result = {
    ready: true,
    host: manifest.host,
    port: manifest.port,
    pid: manifest.pid,
    tokenEmbedded: Object.hasOwn(manifest, "token"),
    tokenPathMatches:
      path.resolve(String(manifest.tokenPath)) === path.resolve(tokenPath),
    tokenLength: token.length,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  throw new Error(
    `User daemon smoke failed: ${
      error instanceof Error ? error.message : String(error)
    }\n${stderr}`
  );
} finally {
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  await rm(resolvedTemporaryRoot, { recursive: true, force: true });
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const selected = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!(Number.isInteger(selected) && selected > 0)) {
    throw new Error("Unable to reserve a loopback port for daemon smoke.");
  }
  return selected;
}

async function waitUntilReady(
  healthUrl: string,
  processHandle: ReturnType<typeof spawn>
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Daemon exited with code ${processHandle.exitCode}.`);
    }
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Daemon health endpoint did not become ready in 60 seconds.");
}
