import { afterEach, describe, expect, test } from "bun:test";
import type {
  RuntimeServiceAuth,
  RuntimeServiceOperation,
} from "@eragear-code-copilot/shared";
import {
  buildCloudflaredArgs,
  DesktopRemoteConnectHost,
  parseTryCloudflareUrl,
  type RemoteConnectRuntime,
  resolveRemoteConnectConfig,
} from "./remote-connect.js";

const token = "remote-connect-token-12345678901234567890";
const localAuthToken = "desktop-local-auth-token-12345678901234567890";
const runningHosts: DesktopRemoteConnectHost[] = [];

afterEach(async () => {
  await Promise.all(runningHosts.splice(0).map((host) => host.stop()));
});

describe("resolveRemoteConnectConfig", () => {
  test("requires loopback binding and a strong token when enabled", () => {
    const config = resolveRemoteConnectConfig({
      ERAGEAR_REMOTE_CONNECT_ENABLED: "1",
      ERAGEAR_REMOTE_CONNECT_HOST: "0.0.0.0",
      ERAGEAR_REMOTE_CONNECT_TOKEN: "short",
    });

    expect(config.enabled).toBe(true);
    expect(config.validationErrors).toContain(
      "ERAGEAR_REMOTE_CONNECT_HOST must be loopback-only."
    );
    expect(config.validationErrors.join("\n")).toContain(
      "ERAGEAR_REMOTE_CONNECT_TOKEN must be at least"
    );
  });

  test("builds quick and named cloudflared arguments without logging secrets", () => {
    const quick = resolveRemoteConnectConfig({
      ERAGEAR_REMOTE_CONNECT_ENABLED: "1",
      ERAGEAR_REMOTE_CONNECT_TOKEN: token,
      ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE: "quick",
    });
    expect(buildCloudflaredArgs(quick.tunnel, "http://127.0.0.1:4123")).toEqual(
      ["tunnel", "--url", "http://127.0.0.1:4123", "--no-autoupdate"]
    );

    const named = resolveRemoteConnectConfig({
      ERAGEAR_REMOTE_CONNECT_ENABLED: "1",
      ERAGEAR_REMOTE_CONNECT_TOKEN: token,
      ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE: "named",
      ERAGEAR_CLOUDFLARED_TUNNEL_TOKEN: token,
    });
    expect(buildCloudflaredArgs(named.tunnel, "http://127.0.0.1:4123")).toEqual(
      ["tunnel", "--no-autoupdate", "run", "--token", token]
    );
  });
});

describe("parseTryCloudflareUrl", () => {
  test("extracts the generated quick tunnel URL from cloudflared output", () => {
    expect(
      parseTryCloudflareUrl(
        "INF Requesting new quick Tunnel\nhttps://sample-bridge.trycloudflare.com"
      )
    ).toBe("https://sample-bridge.trycloudflare.com");
  });
});

describe("DesktopRemoteConnectHost", () => {
  test("authenticates remote requests and injects trusted local runtime auth", async () => {
    let receivedAuth: RuntimeServiceAuth | undefined;
    let receivedOperation: RuntimeServiceOperation | undefined;
    const runtime: RemoteConnectRuntime = {
      requestOperation(input) {
        receivedAuth = input.auth;
        receivedOperation = input.operation;
        return Promise.resolve({
          kind: "response",
          id: "test",
          ok: true,
          data: { ok: true },
        });
      },
      subscribeOperation() {
        return Promise.resolve({ subscriptionId: "sub-test" });
      },
      unsubscribeOperation() {
        return Promise.resolve();
      },
    };
    const config = resolveRemoteConnectConfig({
      ERAGEAR_REMOTE_CONNECT_ENABLED: "1",
      ERAGEAR_REMOTE_CONNECT_TOKEN: token,
      ERAGEAR_REMOTE_CONNECT_PORT: "0",
    });
    const host = new DesktopRemoteConnectHost({
      config,
      runtime,
      trustedRuntimeAuth: { localAuthToken },
      now: () => new Date("2026-06-18T00:00:00.000Z"),
    });
    runningHosts.push(host);

    const status = await host.start();
    const response = await fetch(
      `${status.bridge.localUrl}/api/remote-connect/request`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: {
            id: 1,
            type: "query",
            path: "runtime.diagnostics",
          },
        }),
      }
    );

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      kind: "response",
      id: "test",
      ok: true,
      data: { ok: true },
    });
    expect(receivedAuth).toEqual({ localAuthToken });
    expect(receivedOperation).toEqual({
      id: 1,
      type: "query",
      path: "runtime.diagnostics",
    });
  });
});
