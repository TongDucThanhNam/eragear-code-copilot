import type { CapabilityRegistrySnapshot } from "./capability-registry.js";

export type DesktopRuntimeMode = "main-thread" | "client-only";
export type RuntimeHostMode = DesktopRuntimeMode | "server";
export type RuntimeTransportKind =
  | "electron-ipc"
  | "desktop-service"
  | "local-http-fallback"
  | "ssh"
  | "relay"
  | "remote-http"
  | "http-trpc-ws";
export type RuntimeHealthState =
  | "not-started"
  | "starting"
  | "ready"
  | "degraded"
  | "stopping"
  | "stopped"
  | "error";
export type RuntimeChildProcessState =
  | "not-started"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "exited"
  | "error";
export type AgentCliId = "codex" | "claude" | "gemini" | "opencode";

export interface RuntimeEndpoint {
  kind: RuntimeTransportKind;
  runtimeUrl?: string;
  healthUrl?: string;
  channelName?: string;
  host?: string;
  port?: number;
  boundToLoopback?: boolean;
  networkExposed: boolean;
  description?: string;
}

export interface RuntimeHealth {
  state: RuntimeHealthState;
  ready: boolean;
  checkedAt: string;
  message?: string;
}

export interface RuntimeChildProcessDiagnostics {
  role: "runtime-host" | "server-process" | "agent-process";
  status: RuntimeChildProcessState;
  pid?: number;
  exitCode?: number | null;
  signal?: string | null;
  startedAt?: string;
  stoppedAt?: string;
  message?: string;
}

export interface AgentCliAvailability {
  id: AgentCliId;
  displayName: string;
  command: string;
  available: boolean;
  executablePath?: string;
  version?: string;
  message: string;
  installHint: string;
}

export interface RuntimeSecurityPosture {
  status: "hardened" | "development-warning" | "attention";
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  preloadBridge: boolean;
  contentSecurityPolicy: "enforced" | "development-warning" | "missing";
  endpointNetworkExposed: boolean;
  localAuthTokenRedacted: boolean;
  diagnostics: string[];
}

export interface RuntimeDiagnostics {
  mode: RuntimeHostMode;
  endpoint: RuntimeEndpoint;
  health: RuntimeHealth;
  childProcess: RuntimeChildProcessDiagnostics;
  cliAvailability: AgentCliAvailability[];
  capabilityRegistry?: CapabilityRegistrySnapshot;
  securityPosture?: RuntimeSecurityPosture;
  messages: string[];
  updatedAt: string;
}

export type DesktopAutoUpdateState =
  | "not-configured"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "error";

export interface DesktopAutoUpdateStatus {
  state: DesktopAutoUpdateState;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  manifestUrl?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  checkedAt?: string;
  error?: string;
  notificationShown?: boolean;
}

export interface DesktopRuntimeBootstrap {
  platform: "electron";
  mode: DesktopRuntimeMode;
  transport: RuntimeEndpoint;
  serverUrl?: string;
  localAuthToken?: string;
  apiKey?: string;
  runtimeReady: boolean;
  diagnostics: string[];
  runtimeDiagnostics?: RuntimeDiagnostics;
  autoUpdate?: DesktopAutoUpdateStatus;
}

export type RuntimeProcedureType = "query" | "mutation" | "subscription";

export interface RuntimeServiceOperation {
  id: number;
  type: RuntimeProcedureType;
  path: string;
  input?: unknown;
}

export interface RuntimeServiceAuth {
  localAuthToken?: string;
  apiKey?: string;
}

export interface RuntimeServiceRequestMessage {
  kind: "request";
  id: string;
  auth?: RuntimeServiceAuth;
  operation: RuntimeServiceOperation;
}

export interface RuntimeServiceSubscribeMessage {
  kind: "subscribe";
  id: string;
  auth?: RuntimeServiceAuth;
  operation: RuntimeServiceOperation;
}

export interface RuntimeServiceUnsubscribeMessage {
  kind: "unsubscribe";
  id: string;
}

export interface RuntimeServiceDiagnosticsMessage {
  kind: "diagnostics";
  id: string;
}

export interface RuntimeServiceShutdownMessage {
  kind: "shutdown";
  id: string;
  reason?: string;
}

export type RuntimeServiceClientMessage =
  | RuntimeServiceRequestMessage
  | RuntimeServiceSubscribeMessage
  | RuntimeServiceUnsubscribeMessage
  | RuntimeServiceDiagnosticsMessage
  | RuntimeServiceShutdownMessage;

export interface RuntimeServiceReadyMessage {
  kind: "ready";
  diagnostics: RuntimeDiagnostics;
}

export interface RuntimeServiceFatalMessage {
  kind: "fatal";
  error: RuntimeServiceErrorPayload;
}

export interface RuntimeServiceResponseMessage {
  kind: "response";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: RuntimeServiceErrorPayload;
}

export type RuntimeSubscriptionEventType =
  | "started"
  | "data"
  | "error"
  | "complete";

export interface RuntimeServiceSubscriptionEventMessage {
  kind: "subscription-event";
  id: string;
  event: {
    type: RuntimeSubscriptionEventType;
    data?: unknown;
    error?: RuntimeServiceErrorPayload;
  };
}

export type RuntimeServiceServerMessage =
  | RuntimeServiceReadyMessage
  | RuntimeServiceFatalMessage
  | RuntimeServiceResponseMessage
  | RuntimeServiceSubscriptionEventMessage;

export interface RuntimeServiceErrorPayload {
  message: string;
  code?: number | string;
  data?: unknown;
  name?: string;
  stack?: string;
}

export interface RuntimeHost<TBootstrap = unknown> {
  start(): Promise<RuntimeDiagnostics>;
  stop(reason?: string): Promise<void>;
  health(): RuntimeHealth | Promise<RuntimeHealth>;
  diagnostics(): RuntimeDiagnostics | Promise<RuntimeDiagnostics>;
  getBootstrap?(): TBootstrap;
}
