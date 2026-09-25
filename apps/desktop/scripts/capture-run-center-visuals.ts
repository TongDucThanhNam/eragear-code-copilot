// Captures Run Center fixture-harness screenshots with an owned Electron
// instance: starts a dedicated Vite dev server for the renderer, launches
// scripts/run-center-visuals.cjs, and writes PNGs under
// artifacts/supervisos-run-center/screens/. Fixture evidence only — the
// harness mounts synthetic runs; no runtime, ACP session, or provider call
// is involved.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const port = 3399;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = path.join(
  repoRoot,
  "artifacts",
  "supervisos-run-center",
  "screens"
);

interface Scenario {
  name: string;
  search: string;
  width?: number;
  height?: number;
}

const SCENARIOS: Scenario[] = [
  { name: "workspace-overview-dark", search: "scene=workspace&view=overview" },
  { name: "workspace-workflow-dark", search: "scene=workspace&view=workflow" },
  { name: "workspace-tasks-dark", search: "scene=workspace&view=tasks" },
  { name: "workspace-changes-dark", search: "scene=workspace&view=changes" },
  { name: "workspace-evidence-dark", search: "scene=workspace&view=evidence" },
  { name: "workspace-logs-dark", search: "scene=workspace&view=logs" },
  {
    name: "workspace-overview-light",
    search: "scene=workspace&view=overview&theme=light",
  },
  {
    name: "workspace-workflow-light",
    search: "scene=workspace&view=workflow&theme=light",
  },
  {
    name: "workspace-tasks-light",
    search: "scene=workspace&view=tasks&theme=light",
  },
  {
    name: "workspace-evidence-light",
    search: "scene=workspace&view=evidence&theme=light",
  },
  {
    name: "workspace-workflow-narrow-dark",
    search: "scene=workspace&view=workflow",
    width: 780,
    height: 940,
  },
  {
    name: "workspace-tasks-narrow-light",
    search: "scene=workspace&view=tasks&theme=light",
    width: 780,
    height: 940,
  },
  {
    name: "center-running-dark",
    search: "scene=center",
    width: 1360,
    height: 900,
  },
  {
    name: "center-attention-light",
    search: "scene=center&theme=light",
    width: 1360,
    height: 900,
  },
  {
    name: "center-narrow-dark",
    search: "scene=center",
    width: 800,
    height: 940,
  },
  { name: "chat-dark", search: "scene=chat", width: 520, height: 980 },
  {
    name: "chat-light",
    search: "scene=chat&theme=light",
    width: 520,
    height: 980,
  },
  // Narrow-chat responsive audit (overflow measurements emitted alongside
  // when RUN_CENTER_VISUALS_MEASURE=1). 900px shows the max-w-xl chat column
  // on a normal desktop container.
  {
    name: "chat-narrow-360-light",
    search: "scene=chat&theme=light",
    width: 360,
    height: 820,
  },
  {
    name: "chat-narrow-360-dark",
    search: "scene=chat",
    width: 360,
    height: 820,
  },
  {
    name: "chat-narrow-520-light",
    search: "scene=chat&theme=light",
    width: 520,
    height: 980,
  },
  {
    name: "chat-narrow-520-dark",
    search: "scene=chat",
    width: 520,
    height: 980,
  },
  {
    name: "chat-desktop-900-light",
    search: "scene=chat&theme=light",
    width: 900,
    height: 980,
  },
  {
    name: "chat-desktop-900-dark",
    search: "scene=chat",
    width: 900,
    height: 980,
  },
  // The real app renders this surface inside the Supervisos chat rail
  // (aside w-72 = 288px, border-l + px-3), so 288px is the production
  // container width — narrower than every breakpoint audit above.
  {
    name: "chat-rail-288-light",
    search: "scene=chat&theme=light",
    width: 288,
    height: 980,
  },
  {
    name: "chat-rail-288-dark",
    search: "scene=chat",
    width: 288,
    height: 980,
  },
];

const children = new Set<ChildProcess>();
let shuttingDown = false;

function stopChildren() {
  for (const child of children) {
    if (child.killed || child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    if (process.platform === "win32" && child.pid) {
      spawnSyncTaskkill(child.pid);
    } else {
      child.kill("SIGTERM");
    }
  }
}

function spawnSyncTaskkill(pid: number) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
  });
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
    console.error(`[run-center-visuals] vite exited early (${code}).`);
    stopChildren();
    process.exit(1);
  }
});

try {
  await waitForUrl(`${baseUrl}/run-center-harness.html`, 60_000);
  console.log(`[run-center-visuals] harness ready at ${baseUrl}`);
  const electron = spawn(
    "bun",
    ["x", "electron", "scripts/run-center-visuals.cjs"],
    {
      cwd: desktopRoot,
      env: {
        ...process.env,
        RUN_CENTER_VISUALS_URL: baseUrl,
        RUN_CENTER_VISUALS_OUT_DIR: outDir,
        RUN_CENTER_VISUALS_SCENARIOS: JSON.stringify(
          SCENARIOS.filter((scenario) =>
            process.env.RUN_CENTER_VISUALS_ONLY
              ? scenario.name.includes(process.env.RUN_CENTER_VISUALS_ONLY)
              : true
          ).map((scenario) => ({
            ...scenario,
            url: `${baseUrl}/run-center-harness.html?${scenario.search}`,
          }))
        ),
      },
      stdio: "inherit",
    }
  );
  children.add(electron);
  const code = await new Promise<number | null>((resolve) => {
    electron.on("exit", resolve);
  });
  console.log(`[run-center-visuals] electron exit code: ${code}`);
  process.exitCode = code ?? 1;
} finally {
  shuttingDown = true;
  stopChildren();
}
