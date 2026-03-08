import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const tempDir = mkdtempSync(path.join(os.tmpdir(), "eragear-log-auth-smoke-"));

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function reservePort(): Promise<number> {
  const probe = createServer();

  return await new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve an ephemeral test port"));
        return;
      }
      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

const port = await reservePort();
const testBaseUrl = `http://127.0.0.1:${port}`;

process.env.NODE_ENV = "development";
process.env.ERAGEAR_STORAGE_DIR = path.join(tempDir, "storage");
process.env.AUTH_DB_PATH = path.join(tempDir, "auth.sqlite");
process.env.AUTH_ADMIN_USERNAME = "admin";
process.env.AUTH_ADMIN_PASSWORD = "admin123";
process.env.AUTH_BASE_URL = testBaseUrl;
process.env.AUTH_TRUSTED_ORIGINS = testBaseUrl;
process.env.AUTH_ALLOW_SIGNUP = "false";
process.env.AUTH_SECRET = "dashboard-log-auth-smoke-secret";
process.env.LOG_FILE_ENABLED = "false";

const bootConfigPath = path.join(tempDir, "settings.json");
writeFileSync(
  bootConfigPath,
  `${JSON.stringify(
    {
      boot: {
        mode: "standard",
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_HOST: "127.0.0.1",
        WS_PORT: port,
      },
    },
    null,
    2
  )}\n`,
  "utf8"
);
process.env.ERAGEAR_BOOT_CONFIG_PATH = bootConfigPath;

const stamp = Date.now().toString();
const compositionBootstrap = await import(
  `../src/bootstrap/composition.ts?smoke=${stamp}`
);
const serverBootstrap = await import(
  `../src/bootstrap/server.ts?smoke=${stamp}`
);
const bridgeBootstrap = await import(
  `../src/bootstrap/server-http-bridge.ts?smoke=${stamp}`
);

try {
  const composition =
    await compositionBootstrap.createAppCompositionFromSettings();
  await composition.deps.lifecycle.prepareStartup();
  const app = serverBootstrap.createApp(composition) as {
    fetch: (request: Request) => Promise<Response>;
  };
  const server = createServer(async (req, res) => {
    await bridgeBootstrap.handleNodeHttpRequest({
      app,
      req,
      res,
      runtimePolicy: composition.runtimePolicy,
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const { stdout } = await execFileAsync(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        `${testBaseUrl}/api/logs`,
      ],
      {
        encoding: "utf8",
      }
    );
    const status = stdout.trim();

    assert(
      status === "401",
      `Expected /api/logs to return 401, received ${status}`
    );
    console.log("[Smoke] Anonymous /api/logs request returned 401.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          if (
            (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING"
          ) {
            resolve();
            return;
          }
          reject(error);
          return;
        }
        resolve();
      });
    });
    await composition.deps.lifecycle.shutdown();
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
