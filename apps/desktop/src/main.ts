import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  DesktopRemoteConnectStatus,
  DesktopRuntimeMode,
  RuntimeSecurityPosture,
  RuntimeServiceAuth,
  RuntimeServiceOperation,
} from "@eragear-code-copilot/shared";
import type {
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  WebContents,
} from "electron";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session,
} from "electron";
import { DesktopAutoUpdateController } from "./auto-update.js";
import {
  IntegratedBrowserController,
  type IntegratedBrowserHtmlFileInput,
  type IntegratedBrowserOpenInput,
} from "./browser-integration.js";
import {
  applyDesktopRemoteConnectSettingsPatch,
  createRandomRemoteConnectToken,
  type DesktopRemoteConnectSettings,
  type DesktopRemoteConnectSettingsPatch,
  type DesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
} from "./desktop-settings.js";
import {
  DesktopRemoteConnectHost,
  resolveRemoteConnectConfigFromSettings,
} from "./remote-connect.js";
import { DesktopRuntimeHost } from "./runtime-host.js";
import {
  createRendererContentSecurityPolicy,
  withRendererContentSecurityPolicyHeaders,
} from "./security.js";

const DEFAULT_REMOTE_RUNTIME_PORT = 443;
const DEFAULT_RENDERER_URL_PORT = 3001;
const DEFAULT_RENDERER_URL = "http://127.0.0.1:3001";
const TRAILING_SLASH_PATTERN = /\/$/;
const DEVELOPMENT_RENDERER_URL_PATTERN =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i;

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
const desktopSettingsUserDataPath = app.getPath("userData");
let desktopSettings: DesktopSettings = loadDesktopSettings({
  userDataPath: desktopSettingsUserDataPath,
  env: process.env,
});
const remoteRuntimeUrl = normalizeRemoteRuntimeUrl(
  process.env.ERAGEAR_REMOTE_SERVER_URL
);
const remoteConnectToken = desktopSettings.remoteConnect.accessToken.trim();
const remoteConnectCloudflareAccess = resolveRemoteConnectCloudflareAccess(
  desktopSettings.remoteConnect
);
const repoRoot = resolveRepoRoot();
const webPreferences: NonNullable<
  BrowserWindowConstructorOptions["webPreferences"]
> = {
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
  repoRoot,
  rendererUrl,
  runtimePort,
  localAuthToken,
  remoteRuntimeUrl,
  securityPosture,
  ...(process.env.ERAGEAR_REMOTE_API_KEY
    ? { remoteApiKey: process.env.ERAGEAR_REMOTE_API_KEY }
    : {}),
  ...(remoteConnectToken ? { remoteConnectToken } : {}),
  ...(remoteConnectCloudflareAccess ? { remoteConnectCloudflareAccess } : {}),
});
const remoteConnectConfig =
  desktopMode === "main-thread"
    ? resolveRemoteConnectConfigFromSettings(desktopSettings.remoteConnect)
    : {
        ...resolveRemoteConnectConfigFromSettings(
          desktopSettings.remoteConnect
        ),
        enabled: false,
      };
const remoteConnectHost = new DesktopRemoteConnectHost({
  config: remoteConnectConfig,
  runtime: runtimeHost,
  trustedRuntimeAuth: { localAuthToken },
});
const integratedBrowser = new IntegratedBrowserController({
  repoRoot,
  notifyStateChange: (state) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("eragear:browserStateChanged", state);
  },
});
const autoUpdateController = new DesktopAutoUpdateController({
  currentVersion: app.getVersion(),
  manifestUrl: process.env.ERAGEAR_DESKTOP_UPDATE_MANIFEST_URL,
  notifyUpdate: (status) => {
    if (!Notification.isSupported()) {
      return;
    }
    const version = status.latestVersion ?? "latest";
    new Notification({
      title: "Eragear update available",
      body: `Version ${version} is available.`,
    }).show();
  },
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
    return url.toString().replace(TRAILING_SLASH_PATTERN, "");
  } catch {
    console.warn(`[desktop] Remote runtime URL is invalid: ${value}`);
    return "";
  }
}

function resolveRemoteConnectCloudflareAccess(
  settings: DesktopRemoteConnectSettings
): { clientId: string; clientSecret: string } | undefined {
  const clientId = settings.cloudflareAccessClientId.trim();
  const clientSecret = settings.cloudflareAccessClientSecret.trim();
  if (!(clientId && clientSecret)) {
    return undefined;
  }
  return { clientId, clientSecret };
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
  webPreferences: NonNullable<
    BrowserWindowConstructorOptions["webPreferences"]
  >;
}): RuntimeSecurityPosture {
  const isDevelopmentRenderer =
    !app.isPackaged ||
    DEVELOPMENT_RENDERER_URL_PATTERN.test(params.rendererUrl);
  const cspStatus = isDevelopmentRenderer ? "development-warning" : "enforced";
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
    autoHideMenuBar: true,
    frame: false,
    webPreferences,
  });

  mainWindow.setMenuBarVisibility(false);

  const notifyWindowState = () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(
      "eragear:windowStateChanged",
      getWindowState(mainWindow)
    );
  };

  mainWindow.on("maximize", notifyWindowState);
  mainWindow.on("unmaximize", notifyWindowState);
  mainWindow.on("enter-full-screen", notifyWindowState);
  mainWindow.on("leave-full-screen", notifyWindowState);

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

  mainWindow.loadURL(rendererUrl).catch((error) => {
    console.error("[desktop] Failed to load renderer", error);
  });
}

function getDesktopBootstrap() {
  const remoteConnect = remoteConnectHost.status();
  const configuredRemoteConnectToken =
    desktopSettings.remoteConnect.accessToken.trim();
  return {
    ...runtimeHost.getBootstrap(),
    ...(remoteConnect.enabled || configuredRemoteConnectToken
      ? { remoteConnect }
      : {}),
    autoUpdate: autoUpdateController.status(),
  };
}

function getWindowFromSender(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function getWindowState(window: BrowserWindow) {
  return {
    isFullScreen: window.isFullScreen(),
    isMaximized: window.isMaximized(),
  };
}

ipcMain.handle("eragear:getBootstrap", () => getDesktopBootstrap());
ipcMain.handle("eragear:getRuntimeDiagnostics", () =>
  runtimeHost.diagnostics()
);
ipcMain.handle("eragear:getRemoteConnectStatus", () =>
  remoteConnectHost.status()
);
ipcMain.handle("eragear:desktopSettings:get", () => desktopSettings);
ipcMain.handle(
  "eragear:desktopSettings:updateRemoteConnect",
  (_event, patch: DesktopRemoteConnectSettingsPatch) => {
    desktopSettings = applyDesktopRemoteConnectSettingsPatch(
      desktopSettings,
      patch
    );
    desktopSettings = saveDesktopSettings({
      userDataPath: desktopSettingsUserDataPath,
      settings: desktopSettings,
    });
    return {
      settings: desktopSettings,
      remoteConnect: remoteConnectHost.status(),
      restartRequired: true,
    };
  }
);
ipcMain.handle("eragear:desktopSettings:createRemoteConnectToken", () =>
  createRandomRemoteConnectToken()
);
ipcMain.handle("eragear:checkForUpdates", () =>
  autoUpdateController.checkForUpdates({ notify: true })
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
ipcMain.handle("eragear:window:getState", (event) => {
  const window = getWindowFromSender(event);
  return window ? getWindowState(window) : null;
});
ipcMain.handle("eragear:window:minimize", (event) => {
  const window = getWindowFromSender(event);
  window?.minimize();
});
ipcMain.handle("eragear:window:toggleMaximize", (event) => {
  const window = getWindowFromSender(event);
  if (!window) {
    return null;
  }
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
  return getWindowState(window);
});
ipcMain.handle("eragear:window:close", (event) => {
  const window = getWindowFromSender(event);
  window?.close();
});
ipcMain.handle(
  "eragear:dialog:openProjectFolder",
  async (event, input?: { defaultPath?: string }) => {
    const window = getWindowFromSender(event);
    const defaultPath = input?.defaultPath?.trim();
    const options: OpenDialogOptions = {
      ...(defaultPath ? { defaultPath } : {}),
      properties: ["openDirectory", "createDirectory"],
      title: "Open Project Folder",
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }
    return result.filePaths[0] ?? null;
  }
);
ipcMain.handle(
  "eragear:browser:openHtmlFile",
  async (event, input?: IntegratedBrowserHtmlFileInput) =>
    integratedBrowser.pickHtmlFile(getWindowFromSender(event), input)
);
ipcMain.handle(
  "eragear:browser:open",
  async (_event, input: IntegratedBrowserOpenInput) =>
    integratedBrowser.open(input)
);
ipcMain.handle("eragear:browser:getState", () => integratedBrowser.state());
ipcMain.handle("eragear:browser:reload", () => integratedBrowser.reload());
ipcMain.handle("eragear:browser:goBack", () => integratedBrowser.goBack());
ipcMain.handle("eragear:browser:goForward", () =>
  integratedBrowser.goForward()
);
ipcMain.handle(
  "eragear:browser:setFullScreen",
  (_event, input?: { fullScreen?: boolean }) =>
    integratedBrowser.setFullScreen(input?.fullScreen === true)
);
ipcMain.handle("eragear:browser:openDevTools", () =>
  integratedBrowser.openDevTools()
);
ipcMain.handle("eragear:browser:captureContext", () =>
  integratedBrowser.captureContext()
);
ipcMain.handle("eragear:browser:close", () => integratedBrowser.close());

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
  Promise.allSettled([remoteConnectHost.stop(), runtimeHost.stop()])
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
    Menu.setApplicationMenu(null);
    configureRendererSecurityHeaders();
    const diagnostics = await runtimeHost.start();
    let remoteConnectStatus: DesktopRemoteConnectStatus | null = null;
    try {
      remoteConnectStatus = await remoteConnectHost.start();
    } catch (error) {
      console.warn(
        `[desktop] Remote Connect startup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      remoteConnectStatus = remoteConnectHost.status();
    }
    console.log("[desktop] Runtime diagnostics", {
      mode: diagnostics.mode,
      channel: diagnostics.endpoint.kind,
      ready: diagnostics.health.ready,
      processState: diagnostics.childProcess.status,
      securityPosture: diagnostics.securityPosture?.status,
      remoteConnect: remoteConnectStatus?.bridge.state,
      remoteTunnel: remoteConnectStatus?.tunnel.state,
    });
    createMainWindow();
    if (process.env.ERAGEAR_DESKTOP_UPDATE_CHECK_ON_STARTUP !== "0") {
      autoUpdateController.checkForUpdates({ notify: true }).catch((error) => {
        console.warn(
          `[desktop] Update check failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
  })
  .catch((error) => {
    console.warn(
      `[desktop] Desktop startup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    createMainWindow();
  });
