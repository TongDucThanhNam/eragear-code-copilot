import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 45_179;
const HOST = "127.0.0.1";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(
  baseUrl: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Standalone health check timed out: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const cwd = process.cwd();
const binaryPath = path.resolve(cwd, "dist", "server");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "eragear-standalone-"));
const appPath = path.join(tempDir, "server");
const settingsPath = path.join(tempDir, "settings.json");
const storageDir = path.join(tempDir, "storage");
const logPath = path.join(tempDir, "server.log");
let proc: ChildProcess | null = null;

try {
  await copyFile(binaryPath, appPath);
  await writeFile(
    settingsPath,
    JSON.stringify(
      {
        boot: {
          mode: "compiled",
          WS_HOST: HOST,
          WS_PORT: PORT,
          AUTH_SECRET: "standalone_smoke_secret_12345678901234567890",
          AUTH_TRUSTED_ORIGINS: [`http://${HOST}:${PORT}`],
          AUTH_DB_PATH: path.join(storageDir, "auth.sqlite"),
          STORAGE_WORKER_ENABLED: true,
          LOG_LEVEL: "error",
          ALLOWED_AGENT_COMMAND_POLICIES: [
            { command: "/usr/bin/env", allowAnyArgs: true },
          ],
          ALLOWED_TERMINAL_COMMAND_POLICIES: [
            { command: "/usr/bin/env", allowAnyArgs: true },
          ],
          ALLOWED_ENV_KEYS: ["PATH", "HOME", "USER", "SHELL"],
        },
      },
      null,
      2
    )
  );

  const logWriter = createWriteStream(logPath);
  proc = spawn(appPath, {
    cwd: tempDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? tempDir,
      AUTH_DB_PATH: path.join(storageDir, "auth.sqlite"),
      ERAGEAR_STORAGE_DIR: storageDir,
      STORAGE_ALLOW_UNKNOWN_FS: "true",
    },
  });
  proc.stdout?.on("data", (chunk) => logWriter.write(chunk));
  proc.stderr?.on("data", (chunk) => logWriter.write(chunk));

  const baseUrl = `http://${HOST}:${PORT}`;
  await waitForHealth(baseUrl, 12_000);

  const [styles, client, login] = await Promise.all([
    fetch(`${baseUrl}/_/dashboard/assets/styles.css`),
    fetch(`${baseUrl}/_/dashboard/assets/client.js`),
    fetch(`${baseUrl}/login`),
  ]);
  assert(styles.ok, `styles asset status ${styles.status}`);
  assert(client.ok, `client asset status ${client.status}`);
  assert(login.ok, `login status ${login.status}`);

  const loginHtml = await login.text();
  assert(
    !(
      loginHtml.includes("cdn.jsdelivr.net") ||
      loginHtml.includes("fonts.googleapis.com")
    ),
    "login page must not depend on public CDN assets"
  );

  await stopProcess(proc);
  await new Promise<void>((resolve) => logWriter.end(resolve));
  console.log("[Smoke] Standalone executable flow passed.");
} catch (error) {
  if (proc) {
    await stopProcess(proc);
  }
  try {
    const logs = await readFile(logPath, "utf8");
    console.error(logs);
  } catch {
    // No log file was created.
  }
  throw error;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
