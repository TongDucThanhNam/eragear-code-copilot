import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { RuntimeSecurityPosture } from "@repo/shared";
import { DesktopRuntimeHost } from "./runtime-host.js";

const posture: RuntimeSecurityPosture = {
  status: "development-warning",
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  preloadBridge: true,
  contentSecurityPolicy: "development-warning",
  endpointNetworkExposed: false,
  localAuthTokenRedacted: true,
  diagnostics: [
    "Renderer uses Electron preload IPC instead of direct Node integration.",
    "Runtime service uses a private desktop-service channel and is not network exposed.",
  ],
};

describe("DesktopRuntimeHost security posture diagnostics", () => {
  test("exposes explicit desktop security posture without leaking the local token", async () => {
    const token = "desktop-security-test-token";
    const host = new DesktopRuntimeHost({
      mode: "main-thread",
      repoRoot: path.resolve(process.cwd(), "..", ".."),
      rendererUrl: "http://127.0.0.1:3001",
      runtimePort: 443,
      localAuthToken: token,
      remoteRuntimeUrl: "",
      securityPosture: posture,
    });

    const diagnostics = await host.diagnostics();
    const bootstrap = host.getBootstrap();

    expect(diagnostics.securityPosture).toEqual(posture);
    expect(diagnostics.securityPosture?.contextIsolation).toBe(true);
    expect(diagnostics.securityPosture?.nodeIntegration).toBe(false);
    expect(diagnostics.securityPosture?.endpointNetworkExposed).toBe(false);
    expect(diagnostics.securityPosture?.localAuthTokenRedacted).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(token);
    expect(bootstrap.runtimeDiagnostics?.securityPosture).toEqual(posture);
  });
});
