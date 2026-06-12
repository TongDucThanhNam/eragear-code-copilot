import type { AgentConfig } from "@/shared/types/agent.types";

export type FetchLike = typeof fetch;

export function hasEnvValue(keys: readonly string[]): boolean {
  return keys.some((key) => getEnvValue(key) !== null);
}

export function getEnvValue(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function agentsMatchProvider(
  agents: readonly AgentConfig[],
  needles: readonly string[]
): boolean {
  const normalizedNeedles = needles
    .map((needle) => normalizeForMatch(needle))
    .filter((needle) => needle.length > 0);
  if (normalizedNeedles.length === 0) {
    return false;
  }

  return agents.some((agent) => {
    const values = [
      agent.name,
      agent.type,
      agent.command,
      ...(agent.args ?? []),
      ...Object.keys(agent.env ?? {}),
    ];
    return values.some((value) => {
      const normalizedValue = normalizeForMatch(value);
      return normalizedNeedles.some((needle) =>
        normalizedValue.includes(needle)
      );
    });
  });
}

export async function fetchJsonWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Quota request failed with HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Quota request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function readNumber(
  record: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    let numeric = Number.NaN;
    if (typeof value === "number") {
      numeric = value;
    } else if (typeof value === "string") {
      numeric = Number(value);
    }
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export function percentRemainingFromCounts(params: {
  total?: number;
  remaining?: number;
  used?: number;
}): number | undefined {
  const total = params.total;
  if (typeof total !== "number" || total <= 0) {
    return undefined;
  }
  if (typeof params.remaining === "number") {
    return clampPercent((params.remaining / total) * 100);
  }
  if (typeof params.used === "number") {
    return clampPercent(100 - (params.used / total) * 100);
  }
  return undefined;
}

export function parseResetAt(
  value: unknown,
  nowMs: number
): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestampMs = value > 10_000_000_000 ? value : value * 1000;
    return new Date(timestampMs).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return parseResetAt(numeric, nowMs);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof value === "bigint") {
    return parseResetAt(Number(value), nowMs);
  }
  return undefined;
}

export function parseResetAfterSeconds(
  value: unknown,
  nowMs: number
): string | undefined {
  let seconds = Number.NaN;
  if (typeof value === "number") {
    seconds = value;
  } else if (typeof value === "string") {
    seconds = Number(value);
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return new Date(nowMs + seconds * 1000).toISOString();
}

export function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }
  try {
    const padded = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "="
    );
    const decoded = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return asRecord(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}
