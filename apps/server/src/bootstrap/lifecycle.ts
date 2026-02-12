import type { SessionServiceFactory } from "@/modules/service-factories";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { AppConfigService } from "@/modules/settings";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import type { AuthRuntime } from "../platform/auth/auth";
import {
  BackgroundRunner,
  createCachePruneTask,
  createSessionIdleCleanupTask,
  createSqliteStorageMaintenanceTask,
} from "../platform/background";
import { createLogger } from "../platform/logging/structured-logger";
import { executeServerShutdown } from "./lifecycle-shutdown";
import { prepareServerStartup } from "./lifecycle-startup";

const logger = createLogger("Server");

export interface ServerLifecyclePolicy {
  sqliteRetentionHotDays: number;
  backgroundTaskTimeoutMs: number;
  sqliteRetentionCompactionBatchSize: number;
  authBootstrapApiKey: boolean;
  authApiKeyPrefix: string | undefined;
}

export interface ServerLifecycle {
  prepareStartup(): Promise<void>;
  startBackground(): void;
  stopBackground(): void;
  shutdown(signal: "SIGTERM" | "SIGINT"): Promise<void>;
}

export interface ServerLifecycleDependencies {
  authRuntime: AuthRuntime;
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
  sessionServices: SessionServiceFactory;
  appConfig: AppConfigService;
  policy: ServerLifecyclePolicy;
  setBackgroundRunnerStateProvider: (
    provider: () => BackgroundRunnerState
  ) => void;
}

class DefaultServerLifecycle implements ServerLifecycle {
  private readonly deps: ServerLifecycleDependencies;
  private readonly backgroundRunner = new BackgroundRunner();
  private backgroundStarted = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(deps: ServerLifecycleDependencies) {
    this.deps = deps;
    this.backgroundRunner.register(
      createSessionIdleCleanupTask({
        sessionRuntime: deps.sessionRuntime,
        sessionRepo: deps.sessionRepo,
        appConfig: deps.appConfig,
      })
    );
    this.backgroundRunner.register(
      createSqliteStorageMaintenanceTask({
        sessionRepo: deps.sessionRepo,
        sessionRuntime: deps.sessionRuntime,
        compactSessionMessages: deps.sessionServices.compactSessionMessages(),
      })
    );
    this.backgroundRunner.register(createCachePruneTask());
    deps.setBackgroundRunnerStateProvider(() =>
      this.backgroundRunner.getState()
    );
  }

  async prepareStartup(): Promise<void> {
    await prepareServerStartup({
      authRuntime: this.deps.authRuntime,
      sessionServices: this.deps.sessionServices,
      policy: {
        authBootstrapApiKey: this.deps.policy.authBootstrapApiKey,
        authApiKeyPrefix: this.deps.policy.authApiKeyPrefix,
      },
    });
  }

  startBackground(): void {
    if (this.backgroundStarted) {
      return;
    }
    this.backgroundStarted = true;
    this.backgroundRunner.start();
  }

  stopBackground(): void {
    if (!this.backgroundStarted) {
      return;
    }
    this.backgroundStarted = false;
    this.backgroundRunner.stop();
  }

  shutdown(signal: "SIGTERM" | "SIGINT"): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = (async () => {
      logger.info(`${signal} received, gracefully shutting down`);
      this.stopBackground();
      await executeServerShutdown({
        sessionRuntime: this.deps.sessionRuntime,
        sessionRepo: this.deps.sessionRepo,
        sessionServices: this.deps.sessionServices,
        policy: {
          sqliteRetentionHotDays: this.deps.policy.sqliteRetentionHotDays,
          backgroundTaskTimeoutMs: this.deps.policy.backgroundTaskTimeoutMs,
          sqliteRetentionCompactionBatchSize:
            this.deps.policy.sqliteRetentionCompactionBatchSize,
        },
      });
    })();

    return this.shutdownPromise;
  }
}

export function createServerLifecycle(
  deps: ServerLifecycleDependencies
): ServerLifecycle {
  return new DefaultServerLifecycle(deps);
}
