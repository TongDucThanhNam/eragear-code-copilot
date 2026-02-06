/**
 * Background Runner
 *
 * Centralized scheduler for recurring async tasks in API process.
 *
 * @module infra/background/runner
 */

import { ENV } from "@/config/environment";
import { createLogger } from "@/infra/logging/structured-logger";
import type {
  BackgroundRunnerState,
  BackgroundTaskSpec,
  BackgroundTaskState,
} from "@/shared/types/background.types";
import { createId } from "@/shared/utils/id.util";
import { withObservabilityContext } from "@/shared/utils/observability-context.util";

const logger = createLogger("Server");

export class BackgroundRunner {
  private readonly specs = new Map<string, BackgroundTaskSpec>();
  private readonly states = new Map<string, BackgroundTaskState>();
  private readonly tickMs: number;
  private readonly enabled: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt?: number;

  constructor(params?: { enabled?: boolean; tickMs?: number }) {
    this.enabled = params?.enabled ?? ENV.backgroundEnabled;
    this.tickMs = params?.tickMs ?? ENV.backgroundTickMs;
  }

  register(spec: BackgroundTaskSpec): void {
    if (this.specs.has(spec.name)) {
      throw new Error(`Background task already registered: ${spec.name}`);
    }

    const timeoutMs = spec.timeoutMs ?? ENV.backgroundTaskTimeoutMs;
    this.specs.set(spec.name, spec);
    this.states.set(spec.name, {
      name: spec.name,
      intervalMs: spec.intervalMs,
      timeoutMs,
      running: false,
      successCount: 0,
      failureCount: 0,
    });
  }

  start(): void {
    if (!this.enabled || this.timer) {
      return;
    }
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        logger.error("Background runner tick failed", error as Error);
      });
    }, this.tickMs);
    this.timer.unref?.();
    logger.info("Background runner started", {
      tickMs: this.tickMs,
      tasks: Array.from(this.specs.keys()),
    });
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    logger.info("Background runner stopped");
  }

  getState(): BackgroundRunnerState {
    return {
      enabled: this.enabled,
      startedAt: this.startedAt,
      tickMs: this.tickMs,
      tasks: Array.from(this.states.values()).map((state) => ({ ...state })),
    };
  }

  private async tick(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const now = Date.now();
    for (const [name, spec] of this.specs) {
      const state = this.states.get(name);
      if (!state || state.running) {
        continue;
      }
      const lastRunAt = state.lastStartedAt ?? 0;
      if (lastRunAt !== 0 && now - lastRunAt < state.intervalMs) {
        continue;
      }
      await this.runTask(spec, state);
    }
  }

  private async runTask(
    spec: BackgroundTaskSpec,
    state: BackgroundTaskState
  ): Promise<void> {
    const timeoutMs = state.timeoutMs;
    const startedAt = Date.now();
    const taskRunId = createId("task");
    state.running = true;
    state.lastStartedAt = startedAt;

    await withObservabilityContext(
      {
        source: "background",
        taskName: spec.name,
        taskRunId,
      },
      async () => {
        try {
          const result = await this.withTimeout(
            Promise.resolve(spec.run()),
            timeoutMs
          );
          state.successCount += 1;
          state.lastResult = result ?? undefined;
          logger.debug("Background task completed", {
            taskName: spec.name,
            taskRunId,
            durationMs: Date.now() - startedAt,
          });
        } catch (error) {
          state.failureCount += 1;
          state.lastError =
            error instanceof Error ? error.message : String(error);
          logger.error("Background task failed", error as Error, {
            taskName: spec.name,
            taskRunId,
          });
        } finally {
          const finishedAt = Date.now();
          state.running = false;
          state.lastFinishedAt = finishedAt;
          state.lastDurationMs = finishedAt - startedAt;
        }
      }
    );
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Background task timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
