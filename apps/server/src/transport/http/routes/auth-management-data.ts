import type {
  ApiKeyCreateResponse,
  ApiKeyItem,
  DeviceSessionItem,
} from "@/presentation/dashboard/dashboard-data";

/**
 * Converts a Better Auth date-like value to the dashboard/admin wire shape.
 */
export function toAuthIsoString(value?: string | Date | null): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/**
 * Normalizes API key item for dashboard/admin responses.
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
    expiresAt: toAuthIsoString(item.expiresAt),
    createdAt: toAuthIsoString(item.createdAt) ?? new Date().toISOString(),
    lastRequest: toAuthIsoString(item.lastRequest),
  };
}

/**
 * Normalizes API key create response.
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
    createdAt: toAuthIsoString(item.createdAt) ?? new Date().toISOString(),
  };
}

/**
 * Normalizes device session item for dashboard/admin responses.
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
        toAuthIsoString(item.session.createdAt) ?? new Date().toISOString(),
      expiresAt:
        toAuthIsoString(item.session.expiresAt) ?? new Date().toISOString(),
    },
    user: item.user,
    isActive: item.isActive,
  };
}
