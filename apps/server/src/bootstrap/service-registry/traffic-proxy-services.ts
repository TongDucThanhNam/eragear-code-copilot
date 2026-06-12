import {
  TrafficProxyFileRepository,
  TrafficProxyService,
} from "@/modules/traffic-proxy";
import type { TrafficProxyUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createTrafficProxyUseCases(): TrafficProxyUseCases {
  const repository = new TrafficProxyFileRepository({
    filePath: () => getStorageFileSync("traffic-proxy.json"),
  });

  return {
    trafficProxy: new TrafficProxyService({ repository }),
  };
}
