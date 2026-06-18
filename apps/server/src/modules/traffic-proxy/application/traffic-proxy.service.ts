import type {
  TrafficProxyConfig,
  TrafficProxyStatus,
  UpdateTrafficProxyConfigInput,
} from "./contracts/traffic-proxy.contract";
import type {
  TrafficProxyConfigSnapshot,
  TrafficProxyRepositoryPort,
} from "./ports/traffic-proxy-repository.port";

const DEFAULT_CONFIG: TrafficProxyConfig = {
  enabled: false,
  applyToAgents: true,
  httpProxy: "",
  httpsProxy: "",
  noProxy: "localhost,127.0.0.1,::1",
  useSystemCa: true,
  caBundlePath: "",
  updatedAt: 0,
};

interface TrafficProxyServiceDeps {
  repository: TrafficProxyRepositoryPort;
  now?: () => number;
}

export class TrafficProxyService {
  private readonly repository: TrafficProxyRepositoryPort;
  private readonly now: () => number;
  private cachedConfig: TrafficProxyConfig | null = null;

  constructor(deps: TrafficProxyServiceDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? Date.now;
  }

  getStatus(): TrafficProxyStatus {
    const config = this.getConfig();
    return {
      config,
      agentEnvironmentPreview: buildAgentEnvironment(config),
    };
  }

  updateConfig(input: UpdateTrafficProxyConfigInput): TrafficProxyStatus {
    const existing = this.getConfig();
    const next: TrafficProxyConfig = {
      ...existing,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.applyToAgents !== undefined
        ? { applyToAgents: input.applyToAgents }
        : {}),
      ...(input.httpProxy !== undefined
        ? { httpProxy: input.httpProxy.trim() }
        : {}),
      ...(input.httpsProxy !== undefined
        ? { httpsProxy: input.httpsProxy.trim() }
        : {}),
      ...(input.noProxy !== undefined ? { noProxy: input.noProxy.trim() } : {}),
      ...(input.useSystemCa !== undefined
        ? { useSystemCa: input.useSystemCa }
        : {}),
      ...(input.caBundlePath !== undefined
        ? { caBundlePath: input.caBundlePath.trim() }
        : {}),
      updatedAt: this.now(),
    };
    this.cachedConfig = this.repository.mutateConfig((snapshot) => {
      snapshot.set(next);
      return next;
    });
    return this.getStatus();
  }

  getAgentEnvironment(): Record<string, string> {
    return buildAgentEnvironment(this.getConfig());
  }

  private getConfig(): TrafficProxyConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    this.cachedConfig = this.repository.readConfig((snapshot) =>
      this.resolveConfig(snapshot)
    );
    return this.cachedConfig;
  }

  private resolveConfig(
    snapshot: TrafficProxyConfigSnapshot
  ): TrafficProxyConfig {
    return (
      snapshot.get() ?? {
        ...DEFAULT_CONFIG,
        updatedAt: this.now(),
      }
    );
  }
}

export function buildAgentEnvironment(
  config: TrafficProxyConfig
): Record<string, string> {
  if (!(config.enabled && config.applyToAgents)) {
    return {};
  }
  const env: Record<string, string> = {};
  if (config.httpProxy) {
    env.HTTP_PROXY = config.httpProxy;
    env.http_proxy = config.httpProxy;
  }
  if (config.httpsProxy) {
    env.HTTPS_PROXY = config.httpsProxy;
    env.https_proxy = config.httpsProxy;
  }
  if (config.noProxy) {
    env.NO_PROXY = config.noProxy;
    env.no_proxy = config.noProxy;
  }
  if (config.caBundlePath) {
    env.NODE_EXTRA_CA_CERTS = config.caBundlePath;
    env.SSL_CERT_FILE = config.caBundlePath;
    env.REQUESTS_CA_BUNDLE = config.caBundlePath;
  }
  if (config.useSystemCa) {
    env.NODE_OPTIONS = "--use-system-ca";
  }
  return env;
}
