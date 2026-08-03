// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import type {
  DesktopAutoUpdateStatus,
  DesktopRemoteConnectCloudflareAccessCredentials,
  DesktopRemoteConnectStatus,
  DesktopRuntimeBootstrap,
  DesktopRuntimeMode,
  RuntimeDiagnostics,
  RuntimeEndpoint,
  RuntimeServiceAuth,
  RuntimeServiceOperation,
  RuntimeServiceResponseMessage,
  RuntimeServiceSubscriptionEventMessage,
} from "@eragear-code-copilot/shared";
import { normalizeServerUrl } from "@/lib/server-url";

export type EragearDesktopBootstrap = DesktopRuntimeBootstrap;

export type ExternalProjectAppTarget =
  | "zed"
  | "vscode"
  | "antigravity"
  | "warp"
  | "github-desktop"
  | "file-explorer"
  | "terminal"
  | "git-bash";

export interface OpenProjectExternallyResult {
  method: string;
  projectPath: string;
  target: ExternalProjectAppTarget;
}

export interface DesktopWindowState {
  isFullScreen: boolean;
  isMaximized: boolean;
}

export interface IntegratedBrowserConsoleMessage {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  sourceId?: string;
  line?: number;
  timestamp: string;
}

export interface IntegratedBrowserInstrumentationState {
  reactGrab: boolean;
  reactScan: boolean;
  allowed: boolean;
  diagnostics: string[];
}

export interface IntegratedBrowserState {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  isFullScreen: boolean;
  isDevToolsOpened: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  instrumentation: IntegratedBrowserInstrumentationState;
  recentConsoleMessages: IntegratedBrowserConsoleMessage[];
  updatedAt: string;
}

export interface IntegratedBrowserContextCapture {
  url: string;
  title: string;
  selectedText: string;
  selectedHtml: string;
  hoveredHtml: string;
  hoveredSelector: string;
  activeElementHtml: string;
  visibleText: string;
  reactRendererCount: number;
  recentConsoleMessages: IntegratedBrowserConsoleMessage[];
  capturedAt: string;
}

export interface IntegratedBrowserHtmlFile {
  filePath: string;
  url: string;
  displayName: string;
}

interface DesktopWindowControlsBridge {
  close: () => Promise<void>;
  getState: () => Promise<DesktopWindowState | null>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<DesktopWindowState | null>;
  onStateChange: (callback: (state: DesktopWindowState) => void) => () => void;
}

interface DesktopBrowserControlsBridge {
  captureContext: () => Promise<IntegratedBrowserContextCapture | null>;
  close: () => Promise<void>;
  getState: () => Promise<IntegratedBrowserState | null>;
  goBack: () => Promise<IntegratedBrowserState | null>;
  goForward: () => Promise<IntegratedBrowserState | null>;
  open: (input: {
    url: string;
    title?: string;
    projectRoot?: string;
    injectReactGrab?: boolean;
    injectReactScan?: boolean;
    fullScreen?: boolean;
  }) => Promise<IntegratedBrowserState>;
  openDevTools: () => Promise<IntegratedBrowserState | null>;
  openHtmlFile: (input?: {
    defaultPath?: string;
    projectRoot?: string;
  }) => Promise<IntegratedBrowserHtmlFile | null>;
  reload: () => Promise<IntegratedBrowserState | null>;
  setFullScreen: (input: {
    fullScreen: boolean;
  }) => Promise<IntegratedBrowserState | null>;
  onStateChange: (
    callback: (state: IntegratedBrowserState | null) => void
  ) => () => void;
}

interface EragearDesktopBridge {
  getBootstrap: () => Promise<unknown>;
  getRuntimeDiagnostics?: () => Promise<unknown>;
  getRemoteConnectStatus?: () => Promise<unknown>;
  getDesktopSettings?: () => Promise<unknown>;
  updateRemoteConnectSettings?: (input: unknown) => Promise<unknown>;
  createRemoteConnectToken?: () => Promise<unknown>;
  checkForUpdates?: () => Promise<unknown>;
  openProjectFolder?: (input?: {
    defaultPath?: string;
  }) => Promise<string | null>;
  openProjectExternally?: (input: {
    projectPath: string;
    target: ExternalProjectAppTarget;
  }) => Promise<OpenProjectExternallyResult>;
  browserControls?: DesktopBrowserControlsBridge;
  windowControls?: DesktopWindowControlsBridge;
  requestRuntime?: (input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
  }) => Promise<RuntimeServiceResponseMessage>;
  subscribeRuntime?: (input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
  }) => Promise<{ subscriptionId: string }>;
  unsubscribeRuntime?: (subscriptionId: string) => Promise<void>;
  onRuntimeSubscriptionEvent?: (
    callback: (payload: {
      subscriptionId: string;
      event: RuntimeServiceSubscriptionEventMessage["event"];
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    eragearDesktop?: EragearDesktopBridge;
    __ERAGEAR_DESKTOP_BOOTSTRAP__?: unknown;
  }
}

let cachedBootstrap: EragearDesktopBootstrap | null | undefined;
let bootstrapPromise: Promise<EragearDesktopBootstrap | null> | null = null;

function isDesktopMode(value: unknown): value is DesktopRuntimeMode {
  return value === "main-thread" || value === "client-only";
}

function toDesktopBootstrap(value: unknown): EragearDesktopBootstrap | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EragearDesktopBootstrap>;
  if (candidate.platform !== "electron" || !isDesktopMode(candidate.mode)) {
    return null;
  }
  if (!isRuntimeEndpoint(candidate.transport)) {
    return null;
  }

  const normalizedServerUrl =
    typeof candidate.serverUrl === "string"
      ? normalizeServerUrl(candidate.serverUrl)
      : undefined;
  return {
    platform: "electron",
    mode: candidate.mode,
    transport: candidate.transport,
    ...(normalizedServerUrl ? { serverUrl: normalizedServerUrl } : {}),
    runtimeReady:
      typeof candidate.runtimeReady === "boolean"
        ? candidate.runtimeReady
        : false,
    diagnostics: Array.isArray(candidate.diagnostics)
      ? candidate.diagnostics.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    ...(typeof candidate.localAuthToken === "string" &&
    candidate.localAuthToken.length > 0
      ? { localAuthToken: candidate.localAuthToken }
      : {}),
    ...(typeof candidate.apiKey === "string" && candidate.apiKey.length > 0
      ? { apiKey: candidate.apiKey }
      : {}),
    ...(typeof candidate.remoteConnectToken === "string" &&
    candidate.remoteConnectToken.length > 0
      ? { remoteConnectToken: candidate.remoteConnectToken }
      : {}),
    ...(isCloudflareAccessCredentials(candidate.remoteConnectCloudflareAccess)
      ? {
          remoteConnectCloudflareAccess:
            candidate.remoteConnectCloudflareAccess,
        }
      : {}),
    ...(isDesktopRemoteConnectStatus(candidate.remoteConnect)
      ? { remoteConnect: candidate.remoteConnect }
      : {}),
    ...(isRuntimeDiagnostics(candidate.runtimeDiagnostics)
      ? { runtimeDiagnostics: candidate.runtimeDiagnostics }
      : {}),
    ...(isDesktopAutoUpdateStatus(candidate.autoUpdate)
      ? { autoUpdate: candidate.autoUpdate }
      : {}),
  };
}

function isRuntimeEndpoint(value: unknown): value is RuntimeEndpoint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeEndpoint>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.networkExposed === "boolean"
  );
}

function isRuntimeDiagnostics(value: unknown): value is RuntimeDiagnostics {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeDiagnostics>;
  return (
    typeof candidate.updatedAt === "string" &&
    typeof candidate.endpoint?.kind === "string" &&
    typeof candidate.health?.ready === "boolean" &&
    Array.isArray(candidate.cliAvailability)
  );
}

function isDesktopRemoteConnectStatus(
  value: unknown
): value is DesktopRemoteConnectStatus {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DesktopRemoteConnectStatus>;
  return (
    typeof candidate.enabled === "boolean" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.bridge?.state === "string" &&
    typeof candidate.tunnel?.state === "string"
  );
}

function isCloudflareAccessCredentials(
  value: unknown
): value is DesktopRemoteConnectCloudflareAccessCredentials {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate =
    value as Partial<DesktopRemoteConnectCloudflareAccessCredentials>;
  return (
    typeof candidate.clientId === "string" &&
    candidate.clientId.length > 0 &&
    typeof candidate.clientSecret === "string" &&
    candidate.clientSecret.length > 0
  );
}

function isDesktopAutoUpdateStatus(
  value: unknown
): value is DesktopAutoUpdateStatus {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DesktopAutoUpdateStatus>;
  return (
    typeof candidate.state === "string" &&
    typeof candidate.currentVersion === "string" &&
    typeof candidate.updateAvailable === "boolean"
  );
}

export function getCachedDesktopBootstrap() {
  return cachedBootstrap ?? null;
}

export async function getDesktopBootstrap() {
  if (typeof window === "undefined") {
    return null;
  }

  if (cachedBootstrap !== undefined) {
    return cachedBootstrap;
  }

  bootstrapPromise ??= (async () => {
    try {
      const injected = toDesktopBootstrap(window.__ERAGEAR_DESKTOP_BOOTSTRAP__);
      if (injected) {
        cachedBootstrap = injected;
        return injected;
      }

      const bridge = window.eragearDesktop;
      if (!bridge) {
        cachedBootstrap = null;
        return null;
      }

      const bridged = toDesktopBootstrap(await bridge.getBootstrap());
      cachedBootstrap = bridged;
      return bridged;
    } catch (error) {
      console.warn("[desktop] Failed to read Electron bootstrap", error);
      cachedBootstrap = null;
      return null;
    }
  })();

  return bootstrapPromise;
}

export async function checkForDesktopUpdates(): Promise<DesktopAutoUpdateStatus | null> {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = window.eragearDesktop;
  if (!bridge?.checkForUpdates) {
    return null;
  }
  try {
    const status = await bridge.checkForUpdates();
    return isDesktopAutoUpdateStatus(status) ? status : null;
  } catch (error) {
    console.warn("[desktop] Failed to check for updates", error);
    return null;
  }
}

export function isDesktopLocalBootstrap(
  bootstrap: EragearDesktopBootstrap | null | undefined
) {
  return (
    bootstrap?.mode === "main-thread" &&
    bootstrap.transport.kind === "electron-ipc" &&
    Boolean(bootstrap.localAuthToken)
  );
}

export function hasDesktopTransportCredential(
  bootstrap: EragearDesktopBootstrap | null | undefined
) {
  if (!bootstrap) {
    return false;
  }
  if (bootstrap.mode === "main-thread") {
    return Boolean(bootstrap.localAuthToken);
  }
  return Boolean(bootstrap.apiKey || bootstrap.remoteConnectToken);
}
