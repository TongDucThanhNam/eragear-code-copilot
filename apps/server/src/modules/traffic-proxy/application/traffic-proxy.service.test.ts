import { describe, expect, it } from "bun:test";
import type { TrafficProxyConfig } from "./contracts/traffic-proxy.contract";
import type { TrafficProxyRepositoryPort } from "./ports/traffic-proxy-repository.port";
import { TrafficProxyService } from "./traffic-proxy.service";

class MemoryTrafficProxyRepository implements TrafficProxyRepositoryPort {
  config: TrafficProxyConfig | null = null;

  getConfig(): TrafficProxyConfig | null {
    return this.config;
  }

  saveConfig(config: TrafficProxyConfig): TrafficProxyConfig {
    this.config = config;
    return config;
  }
}

describe("TrafficProxyService", () => {
  it("returns an empty agent environment while disabled", () => {
    const service = new TrafficProxyService({
      repository: new MemoryTrafficProxyRepository(),
      now: () => 1_000,
    });

    expect(service.getStatus().config.enabled).toBe(false);
    expect(service.getAgentEnvironment()).toEqual({});
  });

  it("builds proxy and CA environment for agent processes", () => {
    const service = new TrafficProxyService({
      repository: new MemoryTrafficProxyRepository(),
      now: () => 2_000,
    });

    const status = service.updateConfig({
      enabled: true,
      httpProxy: "http://proxy.example.com:8080",
      httpsProxy: "https://proxy.example.com:8443",
      noProxy: "localhost,.internal",
      caBundlePath: "C:/certs/internal.pem",
      useSystemCa: true,
    });

    expect(status.config.updatedAt).toBe(2_000);
    expect(service.getAgentEnvironment()).toMatchObject({
      HTTP_PROXY: "http://proxy.example.com:8080",
      HTTPS_PROXY: "https://proxy.example.com:8443",
      NO_PROXY: "localhost,.internal",
      NODE_EXTRA_CA_CERTS: "C:/certs/internal.pem",
      SSL_CERT_FILE: "C:/certs/internal.pem",
      REQUESTS_CA_BUNDLE: "C:/certs/internal.pem",
      NODE_OPTIONS: "--use-system-ca",
    });
  });

  it("can keep saved proxy config from applying to agents", () => {
    const service = new TrafficProxyService({
      repository: new MemoryTrafficProxyRepository(),
    });

    service.updateConfig({
      enabled: true,
      applyToAgents: false,
      httpsProxy: "https://proxy.example.com:8443",
    });

    expect(service.getStatus().config.enabled).toBe(true);
    expect(service.getAgentEnvironment()).toEqual({});
  });
});
