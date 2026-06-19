import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DesktopRemoteConnectTunnelMode } from "@eragear-code-copilot/shared";

const DESKTOP_SETTINGS_FILE = "desktop-settings.json";
const DEFAULT_REMOTE_CONNECT_BODY_LIMIT_BYTES = 512 * 1024;

export interface DesktopRemoteConnectSettings {
  enabled: boolean;
  host: string;
  port: number;
  accessToken: string;
  allowedOrigins: string[];
  bodyLimitBytes: number;
  tunnelMode: DesktopRemoteConnectTunnelMode;
  tunnelToken: string;
  tunnelPublicUrl: string;
  cloudflaredPath: string;
  cloudflaredNoAutoupdate: boolean;
  cloudflareAccessClientId: string;
  cloudflareAccessClientSecret: string;
}

export interface DesktopSettings {
  remoteConnect: DesktopRemoteConnectSettings;
}

export type DesktopRemoteConnectSettingsPatch =
  Partial<DesktopRemoteConnectSettings>;

export const DEFAULT_DESKTOP_REMOTE_CONNECT_SETTINGS: DesktopRemoteConnectSettings =
  {
    enabled: false,
    host: "127.0.0.1",
    port: 0,
    accessToken: "",
    allowedOrigins: ["*"],
    bodyLimitBytes: DEFAULT_REMOTE_CONNECT_BODY_LIMIT_BYTES,
    tunnelMode: "off",
    tunnelToken: "",
    tunnelPublicUrl: "",
    cloudflaredPath: "cloudflared",
    cloudflaredNoAutoupdate: true,
    cloudflareAccessClientId: "",
    cloudflareAccessClientSecret: "",
  };

export function loadDesktopSettings(input: {
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
}): DesktopSettings {
  const fallback = createDefaultDesktopSettings(input.env ?? process.env);
  const filePath = resolveDesktopSettingsPath(input.userDataPath);
  if (!existsSync(filePath)) {
    return fallback;
  }
  try {
    return normalizeDesktopSettings(
      JSON.parse(readFileSync(filePath, "utf8")),
      fallback
    );
  } catch (error) {
    console.warn(
      `[desktop] Failed to read desktop settings: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return fallback;
  }
}

export function saveDesktopSettings(input: {
  userDataPath: string;
  settings: DesktopSettings;
}): DesktopSettings {
  const normalized = normalizeDesktopSettings(input.settings);
  mkdirSync(input.userDataPath, { recursive: true });
  writeFileSync(
    resolveDesktopSettingsPath(input.userDataPath),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8"
  );
  return normalized;
}

export function applyDesktopRemoteConnectSettingsPatch(
  settings: DesktopSettings,
  patch: DesktopRemoteConnectSettingsPatch
): DesktopSettings {
  return normalizeDesktopSettings({
    ...settings,
    remoteConnect: {
      ...settings.remoteConnect,
      ...patch,
    },
  });
}

export function createDefaultDesktopSettings(
  env: NodeJS.ProcessEnv = process.env
): DesktopSettings {
  return normalizeDesktopSettings({
    remoteConnect: {
      enabled: toBoolean(env.ERAGEAR_REMOTE_CONNECT_ENABLED, false),
      host:
        env.ERAGEAR_REMOTE_CONNECT_HOST?.trim() ||
        DEFAULT_DESKTOP_REMOTE_CONNECT_SETTINGS.host,
      port: toPort(env.ERAGEAR_REMOTE_CONNECT_PORT, 0),
      accessToken: env.ERAGEAR_REMOTE_CONNECT_TOKEN?.trim() ?? "",
      allowedOrigins: toList(env.ERAGEAR_REMOTE_CONNECT_ALLOWED_ORIGINS),
      bodyLimitBytes: toPositiveInteger(
        env.ERAGEAR_REMOTE_CONNECT_BODY_LIMIT_BYTES,
        DEFAULT_REMOTE_CONNECT_BODY_LIMIT_BYTES
      ),
      tunnelMode: toTunnelMode(env.ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE),
      tunnelToken: env.ERAGEAR_CLOUDFLARED_TUNNEL_TOKEN?.trim() ?? "",
      tunnelPublicUrl: env.ERAGEAR_REMOTE_CONNECT_PUBLIC_URL?.trim() ?? "",
      cloudflaredPath:
        env.ERAGEAR_CLOUDFLARED_PATH?.trim() ||
        DEFAULT_DESKTOP_REMOTE_CONNECT_SETTINGS.cloudflaredPath,
      cloudflaredNoAutoupdate: toBoolean(
        env.ERAGEAR_CLOUDFLARED_NO_AUTOUPDATE,
        true
      ),
      cloudflareAccessClientId:
        env.ERAGEAR_REMOTE_CONNECT_CF_ACCESS_CLIENT_ID?.trim() ?? "",
      cloudflareAccessClientSecret:
        env.ERAGEAR_REMOTE_CONNECT_CF_ACCESS_CLIENT_SECRET?.trim() ?? "",
    },
  });
}

export function createRandomRemoteConnectToken(): string {
  return randomBytes(32).toString("base64url");
}

function resolveDesktopSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, DESKTOP_SETTINGS_FILE);
}

function normalizeDesktopSettings(
  value: unknown,
  fallback: DesktopSettings = {
    remoteConnect: DEFAULT_DESKTOP_REMOTE_CONNECT_SETTINGS,
  }
): DesktopSettings {
  const record = isRecord(value) ? value : {};
  return {
    remoteConnect: normalizeRemoteConnectSettings(
      record.remoteConnect,
      fallback.remoteConnect
    ),
  };
}

function normalizeRemoteConnectSettings(
  value: unknown,
  fallback: DesktopRemoteConnectSettings
): DesktopRemoteConnectSettings {
  const record = isRecord(value) ? value : {};
  return {
    enabled: toBoolean(record.enabled, fallback.enabled),
    host: toTrimmedString(record.host, fallback.host),
    port: toPort(record.port, fallback.port),
    accessToken: toTrimmedString(record.accessToken, fallback.accessToken),
    allowedOrigins: toStringList(
      record.allowedOrigins,
      fallback.allowedOrigins
    ),
    bodyLimitBytes: toPositiveInteger(
      record.bodyLimitBytes,
      fallback.bodyLimitBytes
    ),
    tunnelMode: toTunnelMode(record.tunnelMode, fallback.tunnelMode),
    tunnelToken: toTrimmedString(record.tunnelToken, fallback.tunnelToken),
    tunnelPublicUrl: toTrimmedString(
      record.tunnelPublicUrl,
      fallback.tunnelPublicUrl
    ),
    cloudflaredPath: toTrimmedString(
      record.cloudflaredPath,
      fallback.cloudflaredPath
    ),
    cloudflaredNoAutoupdate: toBoolean(
      record.cloudflaredNoAutoupdate,
      fallback.cloudflaredNoAutoupdate
    ),
    cloudflareAccessClientId: toTrimmedString(
      record.cloudflareAccessClientId,
      fallback.cloudflareAccessClientId
    ),
    cloudflareAccessClientSecret: toTrimmedString(
      record.cloudflareAccessClientSecret,
      fallback.cloudflareAccessClientSecret
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toTrimmedString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toStringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? [...new Set(entries)] : fallback;
  }
  if (typeof value === "string") {
    const entries = toList(value);
    return entries.length > 0 ? entries : fallback;
  }
  return fallback;
}

function toList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toPort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 65_536) {
    return parsed;
  }
  return fallback;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function toTunnelMode(
  value: unknown,
  fallback: DesktopRemoteConnectTunnelMode = "off"
): DesktopRemoteConnectTunnelMode {
  return value === "quick" || value === "named" || value === "off"
    ? value
    : fallback;
}
