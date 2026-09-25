// Runs interactive Run Center verification against the actual application
// renderer: starts a dedicated Vite dev server, launches
// scripts/run-center-interactions.cjs (Electron main) with the mocked
// transport preload, and writes evidence under
// artifacts/supervisos-run-center/. Fixture data only.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const port = 3399;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = path.join(repoRoot, "artifacts", "supervisos-run-center");

const children = new Set<ChildProcess>();
let shuttingDown = false;

function stopChildren() {
  for (const child of children) {
    if (child.killed || child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || response.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

process.on("SIGINT", () => {
  shuttingDown = true;
  stopChildren();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shuttingDown = true;
  stopChildren();
  process.exit(0);
});

const vite = spawn(
  "bun",
  [
    "run",
    "dev:renderer",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: desktopRoot,
    env: { ...process.env, ERAGEAR_DESKTOP_RENDERER: "true" },
    stdio: "inherit",
  }
);
children.add(vite);
vite.on("exit", (code) => {
  children.delete(vite);
  if (!shuttingDown) {
    console.error(`[run-center-interactions] vite exited early (${code}).`);
    stopChildren();
    process.exit(1);
  }
});

try {
  await waitForUrl(baseUrl, 60_000);
  console.log(`[run-center-interactions] app ready at ${baseUrl}`);
  const electron = spawn(
    "bun",
    ["x", "electron", "scripts/run-center-interactions.cjs"],
    {
      cwd: desktopRoot,
      env: {
        ...process.env,
        RUN_CENTER_INTERACTIONS_URL: baseUrl,
        RUN_CENTER_INTERACTIONS_OUT_DIR: outDir,
      },
      stdio: "inherit",
    }
  );
  children.add(electron);
  const code = await new Promise<number | null>((resolve) => {
    electron.on("exit", resolve);
  });
  console.log(`[run-center-interactions] electron exit code: ${code}`);
  process.exitCode = code ?? 1;
} finally {
  shuttingDown = true;
  stopChildren();
}
