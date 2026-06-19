import { describe, expect, test } from "bun:test";
import {
  normalizeApiKeyCreateResponse,
  normalizeApiKeyItem,
  normalizeDeviceSessionItem,
} from "./auth-management-data";

describe("auth management data normalizers", () => {
  test("normalizes API key list items with date-like fields", () => {
    const item = normalizeApiKeyItem({
      id: "key-1",
      name: "Deploy",
      prefix: "eg",
      start: "eg_",
      enabled: true,
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      lastRequest: null,
    });

    expect(item).toEqual({
      id: "key-1",
      name: "Deploy",
      prefix: "eg",
      start: "eg_",
      enabled: true,
      expiresAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastRequest: null,
    });
  });

  test("normalizes API key creation response", () => {
    const item = normalizeApiKeyCreateResponse({
      id: "key-1",
      key: "secret",
      name: null,
      prefix: null,
      start: "sec",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    expect(item).toEqual({
      id: "key-1",
      key: "secret",
      name: null,
      prefix: null,
      start: "sec",
      createdAt: "2025-01-01T00:00:00.000Z",
    });
  });

  test("normalizes device session date fields without changing auth identity", () => {
    const item = normalizeDeviceSessionItem({
      session: {
        token: "session-token",
        createdAt: new Date("2025-02-01T00:00:00.000Z"),
        expiresAt: "2025-03-01T00:00:00.000Z",
        ipAddress: "127.0.0.1",
      },
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
      },
      isActive: true,
    });

    expect(item).toEqual({
      session: {
        token: "session-token",
        createdAt: "2025-02-01T00:00:00.000Z",
        expiresAt: "2025-03-01T00:00:00.000Z",
        ipAddress: "127.0.0.1",
      },
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
      },
      isActive: true,
    });
  });
});
