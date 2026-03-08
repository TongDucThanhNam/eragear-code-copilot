/**
 * HTTP Route Helpers
 *
 * Shared utility functions for HTTP route handlers.
 * Provides form data parsing, date normalization, query validation, etc.
 *
 * @module transport/http/routes/helpers
 */

import type {
  ApiKeyCreateResponse,
  ApiKeyItem,
  DeviceSessionItem,
} from "@/presentation/dashboard/dashboard-data";
import {
  DEFAULT_LOG_QUERY_LIMIT,
  DEFAULT_SESSION_LIST_PAGE_LIMIT,
  MAX_LOG_QUERY_LIMIT,
} from "../../../config/constants";
import type { LogLevel, LogQuery } from "../../../shared/types/log.types";
import { LOG_LEVELS } from "../../../shared/types/log.types";

export type LogQueryResult =
  | { ok: true; query: LogQuery }
  | { ok: false; error: string };

export type SessionPaginationResult =
  | { ok: true; pagination: { limit: number; offset: number } }
  | { ok: false; error: string };

const JSON_BODY_DECODER = new TextDecoder();

export class JsonBodyParseError extends Error {
  readonly statusCode: 400 | 413;

  constructor(message: string, statusCode: 400 | 413) {
    super(message);
    this.name = "JsonBodyParseError";
    this.statusCode = statusCode;
  }
}

export function isJsonBodyParseError(
  error: unknown
): error is JsonBodyParseError {
  return error instanceof JsonBodyParseError;
}

function parseContentLengthHeader(contentLength: string | null): number | null {
  if (!contentLength) {
    return null;
  }
  const parsed = Number(contentLength);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
}

async function readBodyUtf8WithLimit(
  request: Request,
  maxBodyBytes: number
): Promise<string> {
  const normalizedMaxBodyBytes = Math.max(1, Math.trunc(maxBodyBytes));
  const contentLength = parseContentLengthHeader(
    request.headers.get("content-length")
  );
  if (
    typeof contentLength === "number" &&
    contentLength > normalizedMaxBodyBytes
  ) {
    throw new JsonBodyParseError(
      `Request payload exceeds limit (${contentLength} > ${normalizedMaxBodyBytes} bytes)`,
      413
    );
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > normalizedMaxBodyBytes) {
        throw new JsonBodyParseError(
          `Request payload exceeds limit (${totalBytes} > ${normalizedMaxBodyBytes} bytes)`,
          413
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON_BODY_DECODER.decode(merged);
}

export async function parseJsonBodyWithLimit<T>(
  request: Request,
  maxBodyBytes: number
): Promise<T> {
  const rawBody = await readBodyUtf8WithLimit(request, maxBodyBytes);
  if (rawBody.trim().length === 0) {
    throw new JsonBodyParseError("Request JSON body is required", 400);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch (error) {
    throw new JsonBodyParseError(
      `Invalid JSON payload: ${
        error instanceof Error ? error.message : String(error)
      }`,
      400
    );
  }
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
const LOG_BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LOG_BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off"]);

type ParseParamResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parseLogLevelsParam(
  raw: string | undefined
): ParseParamResult<LogLevel[] | undefined> {
  const levelsRaw = raw?.trim();
  if (!levelsRaw) {
    return { ok: true, value: undefined };
  }
  const parsed = levelsRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = parsed.filter(
    (value) => !LOG_LEVEL_SET.has(value as LogLevel)
  );
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Invalid log levels: ${invalid.join(", ")}`,
    };
  }
  return { ok: true, value: parsed as LogLevel[] };
}

function parseLogLimitParam(raw: string | undefined): ParseParamResult<number> {
  if (!raw) {
    return { ok: true, value: DEFAULT_LOG_QUERY_LIMIT };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { ok: false, error: "limit must be a positive number" };
  }
  return { ok: true, value: Math.min(parsed, MAX_LOG_QUERY_LIMIT) };
}

function parseTimestampParam(
  name: "from" | "to",
  raw: string | undefined
): ParseParamResult<number | undefined> {
  if (!raw) {
    return { ok: true, value: undefined };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: `${name} must be a positive timestamp` };
  }
  return { ok: true, value: parsed };
}

function parseOrderParam(
  raw: string | undefined
): ParseParamResult<LogQuery["order"] | undefined> {
  if (!raw) {
    return { ok: true, value: undefined };
  }
  if (raw !== "asc" && raw !== "desc") {
    return { ok: false, error: "order must be asc or desc" };
  }
  return { ok: true, value: raw };
}

function parseSearchParam(
  raw: string | undefined
): ParseParamResult<string | undefined> {
  const search = raw?.trim();
  if (!search) {
    return { ok: true, value: undefined };
  }
  if (search.length > 200) {
    return { ok: false, error: "search is too long" };
  }
  return { ok: true, value: search };
}

function parseSourcesParam(
  raw: string | undefined
): ParseParamResult<string[] | undefined> {
  const sourcesRaw = raw?.trim();
  if (!sourcesRaw) {
    return { ok: true, value: undefined };
  }
  const parsed = sourcesRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!parsed.length) {
    return { ok: false, error: "sources must contain at least one value" };
  }
  return {
    ok: true,
    value: [...new Set(parsed.map((value) => value.toLowerCase()))],
  };
}

function parseAcpOnlyParam(
  raw: string | undefined
): ParseParamResult<boolean | undefined> {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return { ok: true, value: undefined };
  }
  if (LOG_BOOLEAN_TRUE_VALUES.has(normalized)) {
    return { ok: true, value: true };
  }
  if (LOG_BOOLEAN_FALSE_VALUES.has(normalized)) {
    return { ok: true, value: false };
  }
  return {
    ok: false,
    error: "acpOnly must be one of: 1,0,true,false,yes,no,on,off",
  };
}

/**
 * Parses and validates log query parameters
 */
export function parseLogQueryParams(
  params: Record<string, string | undefined>
): LogQueryResult {
  const levelsResult = parseLogLevelsParam(params.levels);
  if (!levelsResult.ok) {
    return levelsResult;
  }
  const limitResult = parseLogLimitParam(params.limit);
  if (!limitResult.ok) {
    return limitResult;
  }
  const fromResult = parseTimestampParam("from", params.from);
  if (!fromResult.ok) {
    return fromResult;
  }
  const toResult = parseTimestampParam("to", params.to);
  if (!toResult.ok) {
    return toResult;
  }
  if (
    fromResult.value !== undefined &&
    toResult.value !== undefined &&
    fromResult.value > toResult.value
  ) {
    return { ok: false, error: "from must be <= to" };
  }
  const orderResult = parseOrderParam(params.order);
  if (!orderResult.ok) {
    return orderResult;
  }
  const searchResult = parseSearchParam(params.search);
  if (!searchResult.ok) {
    return searchResult;
  }
  const sourcesResult = parseSourcesParam(params.sources);
  if (!sourcesResult.ok) {
    return sourcesResult;
  }
  const acpOnlyResult = parseAcpOnlyParam(params.acpOnly);
  if (!acpOnlyResult.ok) {
    return acpOnlyResult;
  }

  return {
    ok: true,
    query: {
      levels: levelsResult.value,
      sources: sourcesResult.value,
      acpOnly: acpOnlyResult.value,
      search: searchResult.value,
      from: fromResult.value,
      to: toResult.value,
      limit: limitResult.value,
      order: orderResult.value ?? "desc",
    },
  };
}

/**
 * Parses pagination parameters for session list endpoints.
 */
export function parseSessionPaginationParams(
  params: Record<string, string | undefined>,
  maxLimit: number
): SessionPaginationResult {
  const limitRaw = params.limit;
  const offsetRaw = params.offset;
  const normalizedMaxLimit = Math.max(1, Math.trunc(maxLimit));

  let limit = DEFAULT_SESSION_LIST_PAGE_LIMIT;
  if (limitRaw !== undefined) {
    const parsedLimit = Number(limitRaw);
    if (Number.isFinite(parsedLimit) && parsedLimit >= 1) {
      limit = Math.min(Math.trunc(parsedLimit), normalizedMaxLimit);
    }
  }

  let offset = 0;
  if (offsetRaw !== undefined) {
    const parsedOffset = Number(offsetRaw);
    if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
      offset = Math.trunc(parsedOffset);
    }
  }

  return { ok: true, pagination: { limit, offset } };
}
