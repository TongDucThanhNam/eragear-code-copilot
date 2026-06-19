import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

const requestedRendererPort = parsePort(
  process.env.ERAGEAR_DESKTOP_RENDERER_PORT,
  3001
);
const rendererPort = String(await findAvailablePort(requestedRendererPort));
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const smokeExitMs = parsePositiveInteger(
  process.env.ERAGEAR_DESKTOP_SMOKE_EXIT_MS,
  0
);

const children = new Set<ChildProcess>();
let shuttingDown = false;

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_536) {
    return parsed;
  }
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function canBindPort(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await canBindPort(port)) {
      if (port !== startPort) {
        console.log(
          `[desktop-dev] Port ${startPort} is busy; using ${port} instead.`
        );
      }
      return port;
    }
  }
  throw new Error(`No available loopback port found from ${startPort}.`);
}

function runRequiredCommand(name: string, args: string[], cwd: string) {
  const result = spawnSync("bun", args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[desktop-dev] ${name} failed to start`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startChild(name: string, args: string[], cwd: string, env = {}) {
  const child = spawn("bun", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopChildren();
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`[desktop-dev] ${name} failed`, error);
  });

  return child;
}

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for ${url}: ${message}`);
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

runRequiredCommand("desktop main build", ["run", "build:main"], desktopRoot);

console.log(`[desktop-dev] Renderer URL: ${rendererUrl}`);
console.log(
  "[desktop-dev] Runtime channel: electron-ipc renderer bridge -> desktop-service runtime core"
);

startChild(
  "desktop renderer",
  [
    "run",
    "dev:renderer",
    "--host",
    "127.0.0.1",
    "--port",
    rendererPort,
    "--strictPort",
  ],
  desktopRoot,
  { ERAGEAR_DESKTOP_RENDERER: "true" }
);

try {
  await waitForUrl(rendererUrl, 30_000);
} catch (error) {
  shuttingDown = true;
  stopChildren();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log("[desktop-dev] Launching Electron.");
startChild("electron", ["run", "electron:start"], desktopRoot, {
  ERAGEAR_DESKTOP_RENDERER_URL: rendererUrl,
  ERAGEAR_REPO_ROOT: repoRoot,
});

if (smokeExitMs > 0) {
  const fallbackMs = smokeExitMs + 15_000;
  setTimeout(() => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(
      `[desktop-dev] Smoke exit fallback reached after ${fallbackMs}ms; stopping dev children.`
    );
    stopChildren();
    process.exit(0);
  }, fallbackMs).unref();
}
