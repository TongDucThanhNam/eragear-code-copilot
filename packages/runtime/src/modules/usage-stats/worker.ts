import { LocalCliUsageScannerAdapter } from "./infra/local-cli-usage-scanner.adapter";
import type {
  UsageStatsScanWorkerRequest,
  UsageStatsScanWorkerResponse,
} from "./infra/usage-stats-scan.worker.protocol";
import { USAGE_STATS_SCAN_WORKER_KIND } from "./infra/usage-stats-scan.worker.protocol";

export function installUsageStatsScanWorker(): void {
  const scanner = new LocalCliUsageScannerAdapter();
  let scanQueue = Promise.resolve();

  self.onmessage = (event: MessageEvent<UsageStatsScanWorkerRequest>) => {
    const request = event.data;
    if (
      request?.kind !== USAGE_STATS_SCAN_WORKER_KIND ||
      !Number.isInteger(request.id)
    ) {
      return;
    }

    scanQueue = scanQueue
      .then(async () => {
        let response: UsageStatsScanWorkerResponse;
        try {
          response = {
            kind: USAGE_STATS_SCAN_WORKER_KIND,
            id: request.id,
            result: await scanner.scan(request.input),
          };
        } catch (error) {
          response = {
            kind: USAGE_STATS_SCAN_WORKER_KIND,
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        self.postMessage(response);
      })
      .catch(() => {
        // Each request posts its own failure response. Keep the serial queue
        // alive if an unexpected worker-level error escapes that boundary.
      });
  };
}
