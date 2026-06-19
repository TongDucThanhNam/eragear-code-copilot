import { describe, expect, test } from "bun:test";
import {
  buildHttpApiUrl,
  buildTrpcWsUrl,
  resolveLocalDevBrowserProxyOrigin,
} from "./server-url";

describe("server-url local dev proxy", () => {
  test("uses same-origin proxy for local browser dev against another local port", () => {
    expect(
      resolveLocalDevBrowserProxyOrigin(
        "ws://localhost:3010",
        "http://localhost:3001",
        true
      )
    ).toBe("ws://localhost:3001");
  });

  test("does not proxy when target already matches browser origin port", () => {
    expect(
      resolveLocalDevBrowserProxyOrigin(
        "ws://localhost:3001",
        "http://localhost:3001",
        true
      )
    ).toBeNull();
  });

  test("does not proxy remote targets", () => {
    expect(
      resolveLocalDevBrowserProxyOrigin(
        "wss://demo.example.com",
        "http://localhost:3001",
        true
      )
    ).toBeNull();
  });

  test("buildHttpApiUrl keeps explicit backend URL outside browser-proxy context", () => {
    expect(buildHttpApiUrl("ws://localhost:3010", "/api/auth")).toBe(
      "http://127.0.0.1:3010/api/auth"
    );
  });

  test("buildTrpcWsUrl keeps explicit backend URL outside browser-proxy context", () => {
    expect(buildTrpcWsUrl("ws://localhost:3010")).toBe(
      "ws://127.0.0.1:3010/trpc"
    );
  });
});
