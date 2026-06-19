import { describe, expect, it } from "bun:test";
import type { TrafficProxyConfig } from "./contracts/traffic-proxy.contract";
import type {
  MutableTrafficProxyConfigSnapshot,
  TrafficProxyConfigSnapshot,
  TrafficProxyRepositoryPort,
} from "./ports/traffic-proxy-repository.port";
import { TrafficProxyService } from "./traffic-proxy.service";

class MemoryTrafficProxyRepository implements TrafficProxyRepositoryPort {
  config: TrafficProxyConfig | null = null;

  readConfig<T>(reader: (snapshot: TrafficProxyConfigSnapshot) => T): T {
    return reader(createConfigSnapshot(this.config));
  }

  mutateConfig<T>(
    mutator: (snapshot: MutableTrafficProxyConfigSnapshot) => T
  ): T {
    const snapshot = createMutableConfigSnapshot(this.config);
    const result = mutator(snapshot);
    this.config = snapshot.getNext();
    return result;
  }
}

function createConfigSnapshot(
  config: TrafficProxyConfig | null
): TrafficProxyConfigSnapshot {
  return {
    get() {
      return config ? { ...config } : null;
    },
  };
}

function createMutableConfigSnapshot(
  config: TrafficProxyConfig | null
): MutableTrafficProxyConfigSnapshot & {
  getNext(): TrafficProxyConfig | null;
} {
  let next = config ? { ...config } : null;
  return {
    get() {
      return next ? { ...next } : null;
    },
    set(config) {
      next = { ...config };
    },
    getNext() {
      return next ? { ...next } : null;
    },
  };
}

describe("TrafficProxyService", () => {
  it("returns an empty agent environment while disabled", () => {
    const service = new TrafficProxyService({
      repository: new MemoryTrafficProxyRepository(),
      now: () => 1000,
    });

    expect(service.getStatus().config.enabled).toBe(false);
    expect(service.getAgentEnvironment()).toEqual({});
  });

  it("builds proxy and CA environment for agent processes", () => {
    const service = new TrafficProxyService({
      repository: new MemoryTrafficProxyRepository(),
      now: () => 2000,
    });

    const status = service.updateConfig({
      enabled: true,
      httpProxy: "http://proxy.example.com:8080",
      httpsProxy: "https://proxy.example.com:8443",
      noProxy: "localhost,.internal",
      caBundlePath: "C:/certs/internal.pem",
      useSystemCa: true,
    });

    expect(status.config.updatedAt).toBe(2000);
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
