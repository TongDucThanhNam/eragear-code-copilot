import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { LOCAL_DESKTOP_USER_ID } from "#runtime/platform/auth/local-desktop-user";

interface BootstrapApiKeyFile {
  key: string;
}

interface RuntimeDaemonManifest {
  schemaVersion: 1;
  host: "127.0.0.1";
  port: number;
  runtimeUrl: string;
  healthUrl: string;
  tokenPath: string;
  pid: number;
  startedAt: string;
}

const PRIVATE_FILE_MODE = 0o600;

function requiredPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the user runtime daemon.`);
  }
  return path.resolve(value);
}

function acquireSingleInstance(lockPath: string): number {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, "wx", PRIVATE_FILE_MODE);
      writeFileSync(descriptor, String(process.pid), "utf8");
      return descriptor;
    } catch (error) {
      if (attempt === 0 && isStaleLock(lockPath)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      throw new Error(
        `Another Eragear runtime daemon owns ${lockPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  throw new Error(`Unable to acquire runtime daemon lock ${lockPath}.`);
}

function isStaleLock(lockPath: string): boolean {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (!(Number.isInteger(pid) && pid > 0)) {
      return true;
    }
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ESRCH" || code === "ENOENT";
  }
}

function readBootstrapKey(filePath: string): string {
  const parsed = JSON.parse(
    readFileSync(filePath, "utf8")
  ) as Partial<BootstrapApiKeyFile>;
  const key = parsed.key?.trim();
  if (!key || key.length < 32) {
    throw new Error("Runtime bootstrap API key is missing or invalid.");
  }
  return key;
}

function writePrivateFile(filePath: string, value: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, value, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });
  chmodSync(temporaryPath, PRIVATE_FILE_MODE);
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, PRIVATE_FILE_MODE);
  restrictFileToCurrentUser(filePath);
}

function restrictFileToCurrentUser(filePath: string): void {
  if (process.platform !== "win32") {
    return;
  }
  const username = process.env.USERNAME?.trim();
  if (!username) {
    throw new Error("USERNAME is required to secure daemon credentials.");
  }
  const domain = process.env.USERDOMAIN?.trim();
  const principal = domain ? `${domain}\\${username}` : username;
  execFileSync(
    "icacls.exe",
    [filePath, "/inheritance:r", "/grant:r", `${principal}:(R,W)`],
    { stdio: "ignore", windowsHide: true }
  );
}

async function main(): Promise<void> {
  const manifestPath = requiredPath("ERAGEAR_DAEMON_MANIFEST_PATH");
  const tokenPath = requiredPath("ERAGEAR_DAEMON_TOKEN_PATH");
  const lockPath = requiredPath("ERAGEAR_DAEMON_LOCK_PATH");
  const authApiKeyPath = requiredPath("ERAGEAR_DAEMON_AUTH_API_KEY_PATH");
  const port = Number(process.env.WS_PORT);
  if (!(Number.isInteger(port) && port > 0 && port < 65_536)) {
    throw new Error("WS_PORT must be a valid loopback port.");
  }
  if (process.env.WS_HOST !== "127.0.0.1") {
    throw new Error("The user runtime daemon must bind to 127.0.0.1.");
  }

  const lockDescriptor = acquireSingleInstance(lockPath);
  const cleanup = () => {
    try {
      closeSync(lockDescriptor);
    } catch {
      // The descriptor may already be closed during process teardown.
    }
    rmSync(lockPath, { force: true });
    rmSync(manifestPath, { force: true });
  };
  process.once("exit", cleanup);

  const { startServer } = await import("#runtime/bootstrap/server");
  const { runtimeCore } = await startServer();
  await runtimeCore.composition.deps.useCases.agent.ensureDefaults.execute(
    LOCAL_DESKTOP_USER_ID
  );

  if (!existsSync(authApiKeyPath)) {
    throw new Error(
      `Runtime did not create its private API key at ${authApiKeyPath}.`
    );
  }
  writePrivateFile(tokenPath, `${readBootstrapKey(authApiKeyPath)}\n`);

  const manifest: RuntimeDaemonManifest = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port,
    runtimeUrl: `ws://127.0.0.1:${port}`,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    tokenPath,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `[daemon] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exit(1);
});
