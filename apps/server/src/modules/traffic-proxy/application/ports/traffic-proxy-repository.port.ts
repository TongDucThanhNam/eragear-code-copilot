import type { TrafficProxyConfig } from "../contracts/traffic-proxy.contract";

export interface TrafficProxyConfigSnapshot {
  get(): TrafficProxyConfig | null;
}

export interface MutableTrafficProxyConfigSnapshot
  extends TrafficProxyConfigSnapshot {
  set(config: TrafficProxyConfig): void;
}

export interface TrafficProxyRepositoryPort {
  readConfig<T>(reader: (snapshot: TrafficProxyConfigSnapshot) => T): T;
  mutateConfig<T>(
    mutator: (snapshot: MutableTrafficProxyConfigSnapshot) => T
  ): T;
}
