import { describe, expect, test } from "bun:test";
import {
  parseCreateApiKeyRouteInput,
  parseDeleteApiKeyRouteInput,
  parseDeviceSessionRouteInput,
} from "./admin-route-input";

describe("admin route input", () => {
  test("parses create API key payload fields", () => {
    expect(
      parseCreateApiKeyRouteInput({
        name: "Deploy key",
        prefix: "erg",
        expiresIn: 3600,
      })
    ).toEqual({
      ok: true,
      input: {
        name: "Deploy key",
        prefix: "erg",
        expiresIn: 3600,
      },
    });
  });

  test("drops malformed optional create API key fields", () => {
    expect(
      parseCreateApiKeyRouteInput({
        name: 12,
        prefix: null,
        expiresIn: Number.NaN,
      })
    ).toEqual({
      ok: true,
      input: {
        name: undefined,
        prefix: undefined,
        expiresIn: undefined,
      },
    });
  });

  test("treats non-object create API key payloads as an empty body", () => {
    expect(parseCreateApiKeyRouteInput(null)).toEqual({
      ok: true,
      input: {},
    });
  });

  test("parses delete API key payload with keyId", () => {
    expect(parseDeleteApiKeyRouteInput({ keyId: "key-1" })).toEqual({
      ok: true,
      input: { keyId: "key-1" },
    });
  });

  test("falls back to id for delete API key payloads", () => {
    expect(parseDeleteApiKeyRouteInput({ id: "key-1" })).toEqual({
      ok: true,
      input: { keyId: "key-1" },
    });
  });

  test("keeps explicit keyId ahead of id", () => {
    expect(parseDeleteApiKeyRouteInput({ keyId: "", id: "key-1" })).toEqual({
      ok: false,
      error: "keyId is required",
    });
  });

  test("returns existing delete API key required-field error", () => {
    expect(parseDeleteApiKeyRouteInput({})).toEqual({
      ok: false,
      error: "keyId is required",
    });
  });

  test("parses device session action payloads", () => {
    expect(
      parseDeviceSessionRouteInput({ sessionToken: "session-token" })
    ).toEqual({
      ok: true,
      input: { sessionToken: "session-token" },
    });
  });

  test("returns existing device session required-field error", () => {
    expect(parseDeviceSessionRouteInput({})).toEqual({
      ok: false,
      error: "sessionToken is required",
    });
  });
});
