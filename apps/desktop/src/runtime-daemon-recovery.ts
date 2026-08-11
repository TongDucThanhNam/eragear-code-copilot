import type {
  RuntimeDaemonConnection,
  RuntimeDaemonPublicStatus,
} from "./runtime-daemon-controller.js";

const DEFAULT_RECOVERY_INTERVAL_MS = 5000;

export interface RuntimeDaemonRecoveryController {
  status(): Promise<RuntimeDaemonPublicStatus>;
  start(): Promise<RuntimeDaemonPublicStatus>;
  ensureStarted(): Promise<RuntimeDaemonConnection>;
}

export interface RuntimeDaemonRecoveryResult {
  state: "healthy" | "recovered" | "failed";
  status?: RuntimeDaemonPublicStatus;
  error?: string;
}

export class RuntimeDaemonRecoveryMonitor {
  private readonly controller: RuntimeDaemonRecoveryController;
  private readonly intervalMs: number;
  private readonly onRecovered?: (result: RuntimeDaemonRecoveryResult) => void;
  private readonly onFailure?: (result: RuntimeDaemonRecoveryResult) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<RuntimeDaemonRecoveryResult> | null = null;

  constructor(input: {
    controller: RuntimeDaemonRecoveryController;
    intervalMs?: number;
    onRecovered?: (result: RuntimeDaemonRecoveryResult) => void;
    onFailure?: (result: RuntimeDaemonRecoveryResult) => void;
  }) {
    this.controller = input.controller;
    this.intervalMs = normalizeInterval(input.intervalMs);
    this.onRecovered = input.onRecovered;
    this.onFailure = input.onFailure;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.reconcile().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  reconcile(): Promise<RuntimeDaemonRecoveryResult> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const current = this.reconcileOnce().finally(() => {
      if (this.inFlight === current) {
        this.inFlight = null;
      }
    });
    this.inFlight = current;
    return current;
  }

  private async reconcileOnce(): Promise<RuntimeDaemonRecoveryResult> {
    try {
      const status = await this.controller.status();
      if (status.running) {
        return { state: "healthy", status };
      }
      if (status.installed) {
        await this.controller.start();
      } else {
        await this.controller.ensureStarted();
      }
      const recovered = await this.controller.status();
      if (!recovered.running) {
        throw new Error(
          "User runtime daemon did not become healthy after restart"
        );
      }
      const result: RuntimeDaemonRecoveryResult = {
        state: "recovered",
        status: recovered,
      };
      this.onRecovered?.(result);
      return result;
    } catch (error) {
      const result: RuntimeDaemonRecoveryResult = {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      this.onFailure?.(result);
      return result;
    }
  }
}

function normalizeInterval(value: number | undefined): number {
  if (!(Number.isFinite(value) && Number(value) >= 250)) {
    return DEFAULT_RECOVERY_INTERVAL_MS;
  }
  return Math.floor(Number(value));
}
