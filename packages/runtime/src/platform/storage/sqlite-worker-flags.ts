import { isMainThread, workerData } from "node:worker_threads";
import { SQLITE_WORKER_KIND } from "./sqlite-worker.protocol";

export function isSqliteWorkerThread(): boolean {
  if (isMainThread) {
    return false;
  }
  const data = workerData as { kind?: string } | null;
  return data?.kind === SQLITE_WORKER_KIND;
}
