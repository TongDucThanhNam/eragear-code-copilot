import { TrafficProxyService } from "#runtime/modules/traffic-proxy";
import { TrafficProxyFileRepository } from "#runtime/modules/traffic-proxy/di";
import type { TrafficProxyUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createTrafficProxyUseCases(): TrafficProxyUseCases {
  const repository = new TrafficProxyFileRepository({
    filePath: () => getStorageFileSync("traffic-proxy.json"),
  });

  return {
    trafficProxy: new TrafficProxyService({ repository }),
  };
}
