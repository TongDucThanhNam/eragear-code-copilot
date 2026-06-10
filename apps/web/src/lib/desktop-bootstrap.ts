import { normalizeServerUrl } from "@/lib/server-url";
import type {
  DesktopRuntimeBootstrap,
  DesktopRuntimeMode,
  RuntimeDiagnostics,
  RuntimeEndpoint,
  RuntimeServiceAuth,
  RuntimeServiceOperation,
  RuntimeServiceResponseMessage,
  RuntimeServiceSubscriptionEventMessage,
} from "@repo/shared";

export type EragearDesktopBootstrap = DesktopRuntimeBootstrap;

interface EragearDesktopBridge {
  getBootstrap: () => Promise<unknown>;
  getRuntimeDiagnostics?: () => Promise<unknown>;
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

function toDesktopBootstrap(
  value: unknown
): EragearDesktopBootstrap | null {
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
    ...(isRuntimeDiagnostics(candidate.runtimeDiagnostics)
      ? { runtimeDiagnostics: candidate.runtimeDiagnostics }
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
      const injected = toDesktopBootstrap(
        window.__ERAGEAR_DESKTOP_BOOTSTRAP__
      );
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
  return Boolean(bootstrap.apiKey);
}
