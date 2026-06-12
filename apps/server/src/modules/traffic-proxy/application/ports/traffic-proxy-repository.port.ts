import type { TrafficProxyConfig } from "../contracts/traffic-proxy.contract";

export interface TrafficProxyRepositoryPort {
  getConfig(): TrafficProxyConfig | null;
  saveConfig(config: TrafficProxyConfig): TrafficProxyConfig;
}
