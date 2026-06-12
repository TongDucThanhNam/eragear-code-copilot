import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  DesktopRuntimeMode,
  RuntimeServiceAuth,
  RuntimeServiceOperation,
  RuntimeSecurityPosture,
} from "@repo/shared";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent, WebContents } from "electron";
import { DesktopRuntimeHost } from "./runtime-host.js";
import {
  createRendererContentSecurityPolicy,
  withRendererContentSecurityPolicyHeaders,
} from "./security.js";

const DEFAULT_REMOTE_RUNTIME_PORT = 443;
const DEFAULT_RENDERER_URL_PORT = 3001;
const DEFAULT_RENDERER_URL = "http://127.0.0.1:3001";

let mainWindow: BrowserWindow | null = null;

const desktopMode: DesktopRuntimeMode =
  process.env.ERAGEAR_DESKTOP_MODE === "client-only"
    ? "client-only"
    : "main-thread";
const localAuthToken = randomBytes(32).toString("base64url");
const runtimePort = parsePort(
  process.env.ERAGEAR_DESKTOP_RUNTIME_PORT,
  DEFAULT_REMOTE_RUNTIME_PORT
);
const rendererUrl =
  process.env.ERAGEAR_DESKTOP_RENDERER_URL ?? DEFAULT_RENDERER_URL;
configureDevelopmentUserDataPath(rendererUrl);
const remoteRuntimeUrl = normalizeRemoteRuntimeUrl(
  process.env.ERAGEAR_REMOTE_SERVER_URL
);
const webPreferences: NonNullable<BrowserWindowConstructorOptions["webPreferences"]> = {
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(app.getAppPath(), "dist", "preload.cjs"),
  sandbox: false,
};
const securityPosture = createSecurityPosture({
  rendererUrl,
  webPreferences,
});
const runtimeHost = new DesktopRuntimeHost({
  mode: desktopMode,
  repoRoot: resolveRepoRoot(),
  rendererUrl,
  runtimePort,
  localAuthToken,
  remoteRuntimeUrl,
  securityPosture,
  ...(process.env.ERAGEAR_REMOTE_API_KEY
    ? { remoteApiKey: process.env.ERAGEAR_REMOTE_API_KEY }
    : {}),
});

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_536) {
    return parsed;
  }
  return fallback;
}

function normalizeRemoteRuntimeUrl(rawValue: string | undefined): string {
  const value = rawValue?.trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value.includes("://") ? value : `wss://${value}`);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:") {
      url.protocol = "ws:";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    console.warn(`[desktop] Remote runtime URL is invalid: ${value}`);
    return "";
  }
}

function configureDevelopmentUserDataPath(currentRendererUrl: string): void {
  if (app.isPackaged) {
    return;
  }
  const override = process.env.ERAGEAR_DESKTOP_USER_DATA_DIR?.trim();
  const port = parsePortFromUrl(currentRendererUrl);
  const basePath = override
    ? path.resolve(override)
    : path.join(
        os.tmpdir(),
        `eragear-code-copilot-electron-dev-${port}-${process.pid}`
      );
  app.setPath("userData", basePath);
}

function parsePortFromUrl(value: string): number {
  try {
    const parsed = new URL(value);
    return parsePort(parsed.port, DEFAULT_RENDERER_URL_PORT);
  } catch {
    return DEFAULT_RENDERER_URL_PORT;
  }
}

function resolveRepoRoot(): string {
  const override = process.env.ERAGEAR_REPO_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(app.getAppPath(), "..", "..");
}

function rendererContentSecurityPolicy(): string {
  return createRendererContentSecurityPolicy({
    appIsPackaged: app.isPackaged,
    rendererUrl,
  });
}

function configureRendererSecurityHeaders(): void {
  const csp = rendererContentSecurityPolicy();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: withRendererContentSecurityPolicyHeaders(
        details.responseHeaders ?? {},
        csp
      ),
    });
  });
}

function createSecurityPosture(params: {
  rendererUrl: string;
  webPreferences: NonNullable<BrowserWindowConstructorOptions["webPreferences"]>;
}): RuntimeSecurityPosture {
  const isDevelopmentRenderer =
    !app.isPackaged || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i.test(params.rendererUrl);
  const cspStatus = isDevelopmentRenderer
    ? "development-warning"
    : "enforced";
  const diagnostics = [
    "Renderer uses Electron preload IPC instead of direct Node integration.",
    "Runtime service uses a private desktop-service channel and is not network exposed.",
    "Desktop local auth token is generated per process and redacted from diagnostics.",
    cspStatus === "development-warning"
      ? "Development renderer CSP allows Vite React dev tooling; packaged builds should report enforced CSP."
      : "Renderer CSP is enforced without development eval allowances.",
    params.webPreferences.sandbox === false
      ? "Renderer sandbox is disabled because the preload bridge owns runtime IPC; this is reported explicitly."
      : "Renderer sandbox is enabled.",
  ];
  const status =
    params.webPreferences.contextIsolation === true &&
    params.webPreferences.nodeIntegration === false &&
    cspStatus === "enforced"
      ? "hardened"
      : "development-warning";
  return {
    status,
    contextIsolation: params.webPreferences.contextIsolation === true,
    nodeIntegration: params.webPreferences.nodeIntegration === true,
    sandbox: params.webPreferences.sandbox === true,
    preloadBridge: Boolean(params.webPreferences.preload),
    contentSecurityPolicy: cspStatus,
    endpointNetworkExposed: false,
    localAuthTokenRedacted: true,
    diagnostics,
  };
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    title: "Eragear Copilot",
    webPreferences,
  });

  mainWindow.webContents.on("console-message", (_event, level, message) => {
    const label = level >= 2 ? "renderer:err" : "renderer";
    console.log(`[${label}] ${message}`);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    console.log(`[desktop] Renderer loaded: ${rendererUrl}`);
    const smokeExitMs = parsePort(process.env.ERAGEAR_DESKTOP_SMOKE_EXIT_MS, 0);
    if (smokeExitMs > 0) {
      setTimeout(() => app.quit(), smokeExitMs);
    }
  });

  void mainWindow.loadURL(rendererUrl);
}

ipcMain.handle("eragear:getBootstrap", () => runtimeHost.getBootstrap());
ipcMain.handle("eragear:getRuntimeDiagnostics", () =>
  runtimeHost.diagnostics()
);
ipcMain.handle(
  "eragear:runtimeRequest",
  async (
    _event,
    input: { auth?: RuntimeServiceAuth; operation: RuntimeServiceOperation }
  ) => runtimeHost.requestOperation(input)
);
ipcMain.handle(
  "eragear:runtimeSubscribe",
  async (
    event: IpcMainInvokeEvent,
    input: { auth?: RuntimeServiceAuth; operation: RuntimeServiceOperation }
  ) => {
    const sender = event.sender;
    let subscriptionId = "";
    const result = await runtimeHost.subscribeOperation({
      ...input,
      onEvent: (runtimeEvent) => {
        if (sender.isDestroyed()) {
          return;
        }
        sender.send("eragear:runtimeSubscriptionEvent", {
          subscriptionId,
          event: runtimeEvent,
        });
      },
    });
    subscriptionId = result.subscriptionId;
    registerSenderSubscriptionCleanup(sender, result.subscriptionId);
    return result;
  }
);
ipcMain.handle(
  "eragear:runtimeUnsubscribe",
  async (_event, input: { subscriptionId: string }) => {
    await runtimeHost.unsubscribeOperation(input.subscriptionId);
  }
);

const subscriptionsByWebContents = new WeakMap<WebContents, Set<string>>();

function registerSenderSubscriptionCleanup(
  sender: WebContents,
  subscriptionId: string
): void {
  let subscriptions = subscriptionsByWebContents.get(sender);
  if (!subscriptions) {
    subscriptions = new Set<string>();
    subscriptionsByWebContents.set(sender, subscriptions);
    sender.once("destroyed", () => {
      for (const id of subscriptions ?? []) {
        runtimeHost.unsubscribeOperation(id).catch((error) => {
          console.warn(
            `[desktop] Failed to clean renderer subscription ${id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
    });
  }
  subscriptions.add(subscriptionId);
}

app.on("window-all-closed", () => {
  app.quit();
});

let quitAfterRuntimeStop = false;
app.on("before-quit", (event) => {
  if (quitAfterRuntimeStop) {
    return;
  }
  event.preventDefault();
  quitAfterRuntimeStop = true;
  runtimeHost
    .stop()
    .catch((error) => {
      console.warn(
        `[desktop] Local runtime cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    })
    .finally(() => app.quit());
});

app
  .whenReady()
  .then(async () => {
    console.log(`[desktop] Starting Eragear desktop on ${os.platform()}.`);
    configureRendererSecurityHeaders();
    const diagnostics = await runtimeHost.start();
    console.log("[desktop] Runtime diagnostics", {
      mode: diagnostics.mode,
      channel: diagnostics.endpoint.kind,
      ready: diagnostics.health.ready,
      processState: diagnostics.childProcess.status,
      securityPosture: diagnostics.securityPosture?.status,
    });
    createMainWindow();
  })
  .catch((error) => {
    console.warn(
      `[desktop] Desktop startup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    createMainWindow();
  });
