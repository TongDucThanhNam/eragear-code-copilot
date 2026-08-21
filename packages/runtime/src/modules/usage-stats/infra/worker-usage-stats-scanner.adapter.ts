import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";
import { LocalCliUsageScannerAdapter } from "./local-cli-usage-scanner.adapter";
import type {
  UsageStatsScanWorkerRequest,
  UsageStatsScanWorkerResponse,
} from "./usage-stats-scan.worker.protocol";
import { USAGE_STATS_SCAN_WORKER_KIND } from "./usage-stats-scan.worker.protocol";

const EMBEDDED_WORKER_ENTRYPOINT =
  "src/bootstrap/usage-stats-scan.worker.entry.ts";
const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

interface PendingScan {
  resolve: (result: UsageStatsCliSummary) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface UsageWorker extends Worker {
  unref?: () => void;
}

export class WorkerUsageStatsScannerAdapter implements UsageStatsScannerPort {
  private readonly fallback: UsageStatsScannerPort;
  private readonly requestTimeoutMs: number;
  private readonly entrypointResolver: () => string | URL;
  private worker?: UsageWorker;
  private requestId = 0;
  private readonly pending = new Map<number, PendingScan>();

  constructor(
    options: {
      fallback?: UsageStatsScannerPort;
      requestTimeoutMs?: number;
      entrypointResolver?: () => string | URL;
    } = {}
  ) {
    this.fallback = options.fallback ?? new LocalCliUsageScannerAdapter();
    this.requestTimeoutMs = Math.max(
      1000,
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );
    this.entrypointResolver =
      options.entrypointResolver ?? resolveWorkerEntrypoint;
  }

  async scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    let worker: UsageWorker;
    try {
      worker = this.ensureWorker();
    } catch {
      return await this.fallback.scan(input);
    }

    const id = ++this.requestId;
    return await new Promise<UsageStatsCliSummary>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(new Error("Usage statistics worker scan timed out."));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      const request: UsageStatsScanWorkerRequest = {
        kind: USAGE_STATS_SCAN_WORKER_KIND,
        id,
        input,
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    const worker = this.worker;
    this.worker = undefined;
    this.rejectPending(new Error("Usage statistics worker closed."));
    worker?.terminate();
  }

  private ensureWorker(): UsageWorker {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(this.entrypointResolver(), {
      type: "module",
    }) as UsageWorker;
    worker.onmessage = (event: MessageEvent<UsageStatsScanWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      this.failWorker(
        new Error(event.message || "Usage statistics worker failed.")
      );
    };
    worker.unref?.();
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: UsageStatsScanWorkerResponse): void {
    if (response?.kind !== USAGE_STATS_SCAN_WORKER_KIND) {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if (response.result) {
      pending.resolve(response.result);
      return;
    }
    pending.reject(
      new Error(response.error || "Usage statistics worker returned no result.")
    );
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private failWorker(error: Error): void {
    const worker = this.worker;
    this.worker = undefined;
    this.rejectPending(error);
    worker?.terminate();
  }
}

function isStandaloneExecutable(): boolean {
  const bunRuntime = Reflect.get(globalThis, "Bun") as
    | { isStandaloneExecutable?: boolean }
    | undefined;
  if (bunRuntime?.isStandaloneExecutable === true) {
    return true;
  }
  const executableName = path.basename(process.execPath).toLowerCase();
  return (
    executableName !== "bun" &&
    executableName !== "bun.exe" &&
    process.versions.bun !== undefined
  );
}

function resolveWorkerEntrypoint(): string | URL {
  if (isStandaloneExecutable()) {
    const runtimeDir = path.dirname(process.execPath);
    for (const candidate of [
      path.join(runtimeDir, "usage-stats-scan.worker.entry.js"),
      path.join(runtimeDir, "bootstrap", "usage-stats-scan.worker.entry.js"),
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return EMBEDDED_WORKER_ENTRYPOINT;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const runtimeDir = path.dirname(process.execPath);
  const candidates = [
    path.resolve(
      moduleDir,
      "../../../bootstrap/usage-stats-scan.worker.entry.ts"
    ),
    path.join(
      process.cwd(),
      "src",
      "bootstrap",
      "usage-stats-scan.worker.entry.ts"
    ),
    path.join(
      process.cwd(),
      "packages",
      "runtime",
      "src",
      "bootstrap",
      "usage-stats-scan.worker.entry.ts"
    ),
    path.join(
      process.cwd(),
      "dist",
      "bootstrap",
      "usage-stats-scan.worker.entry.mjs"
    ),
    path.join(
      process.cwd(),
      "packages",
      "runtime",
      "dist",
      "bootstrap",
      "usage-stats-scan.worker.entry.mjs"
    ),
    path.join(runtimeDir, "bootstrap", "usage-stats-scan.worker.entry.mjs"),
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Usage statistics worker entrypoint was not found.");
}
