/**
 * HTTP Route Helpers
 *
 * Shared utility functions for HTTP route handlers.
 * Provides form data parsing, date normalization, query validation, etc.
 *
 * @module transport/http/routes/helpers
 */

import type { Context } from "hono";
import {
  DEFAULT_LOG_QUERY_LIMIT,
  MAX_LOG_QUERY_LIMIT,
} from "../../../config/constants";
import type { LogLevel, LogQuery } from "../../../shared/types/log.types";
import { LOG_LEVELS } from "../../../shared/types/log.types";
import type {
  ApiKeyCreateResponse,
  ApiKeyItem,
  DeviceSessionItem,
} from "../ui/dashboard-data";

// =============================================================================
// Types
// =============================================================================

export type FormDataRecord = Record<string, string | File | undefined>;

export type LogQueryResult =
  | { ok: true; query: LogQuery }
  | { ok: false; error: string };

// =============================================================================
// Form Data Helpers
// =============================================================================

/**
 * Extracts a string value from form data
 */
export function getFormValue(formData: FormDataRecord, key: string): string {
  const value = formData[key];
  return typeof value === "string" ? value : "";
}

/**
 * Converts a value to ISO string format
 */
export function toIsoString(value?: string | Date | null): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

// =============================================================================
// API Key Normalizers
// =============================================================================

/**
 * Normalizes API key item for response
 */
export function normalizeApiKeyItem(item: {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt?: string | Date | null;
  createdAt: string | Date;
  lastRequest?: string | Date | null;
}): ApiKeyItem {
  return {
    id: item.id,
    name: item.name,
    prefix: item.prefix,
    start: item.start,
    enabled: item.enabled,
    expiresAt: toIsoString(item.expiresAt),
    createdAt: toIsoString(item.createdAt) ?? new Date().toISOString(),
    lastRequest: toIsoString(item.lastRequest),
  };
}

/**
 * Normalizes API key create response
 */
export function normalizeApiKeyCreateResponse(item: {
  id: string;
  key: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string | Date;
}): ApiKeyCreateResponse {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    prefix: item.prefix,
    start: item.start,
    createdAt: toIsoString(item.createdAt) ?? new Date().toISOString(),
  };
}

/**
 * Normalizes device session item for response
 */
export function normalizeDeviceSessionItem(item: {
  session: {
    token: string;
    createdAt: string | Date;
    expiresAt: string | Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  user: { id: string; email: string; name: string };
  isActive?: boolean;
}): DeviceSessionItem {
  return {
    session: {
      ...item.session,
      createdAt:
        toIsoString(item.session.createdAt) ?? new Date().toISOString(),
      expiresAt:
        toIsoString(item.session.expiresAt) ?? new Date().toISOString(),
    },
    user: item.user,
    isActive: item.isActive,
  };
}

// =============================================================================
// Log Query Parser
// =============================================================================

const LOG_LEVEL_SET = new Set(LOG_LEVELS);

/**
 * Parses and validates log query parameters
 */
export function parseLogQueryParams(
  params: Record<string, string | undefined>
): LogQueryResult {
  const levelsRaw = params.levels?.trim();
  let levels: LogLevel[] | undefined;
  if (levelsRaw) {
    const parsed = levelsRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const invalid = parsed.filter(
      (value) => !LOG_LEVEL_SET.has(value as LogLevel)
    );
    if (invalid.length) {
      return {
        ok: false,
        error: `Invalid log levels: ${invalid.join(", ")}`,
      };
    }
    levels = parsed as LogLevel[];
  }

  const limitRaw = params.limit;
  let limit = DEFAULT_LOG_QUERY_LIMIT;
  if (limitRaw) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return { ok: false, error: "limit must be a positive number" };
    }
    limit = Math.min(parsed, MAX_LOG_QUERY_LIMIT);
  }

  const fromRaw = params.from;
  const from = fromRaw ? Number(fromRaw) : undefined;
  if (fromRaw && from !== undefined && (!Number.isFinite(from) || from < 0)) {
    return { ok: false, error: "from must be a positive timestamp" };
  }

  const toRaw = params.to;
  const to = toRaw ? Number(toRaw) : undefined;
  if (toRaw && to !== undefined && (!Number.isFinite(to) || to < 0)) {
    return { ok: false, error: "to must be a positive timestamp" };
  }

  if (from !== undefined && to !== undefined && from > to) {
    return { ok: false, error: "from must be <= to" };
  }

  const order = params.order;
  if (order && order !== "asc" && order !== "desc") {
    return { ok: false, error: "order must be asc or desc" };
  }

  const search = params.search?.trim();
  if (search && search.length > 200) {
    return { ok: false, error: "search is too long" };
  }

  return {
    ok: true,
    query: {
      levels,
      search: search || undefined,
      from,
      to,
      limit,
      order: (order as LogQuery["order"]) ?? "desc",
    },
  };
}

// =============================================================================
// Redirect Helpers
// =============================================================================

/**
 * Redirects to root with optional query parameters
 */
export function redirectWithParams(
  c: Context,
  params: Record<string, string | undefined>
): Response {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return c.redirect(query ? `/?${query}` : "/");
}
