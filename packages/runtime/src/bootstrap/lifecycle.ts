import type {
  AgentRuntimePort,
  SessionEventOutboxPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type {
  AppConfigService,
  LocalAdeService,
} from "#runtime/modules/settings";
import type {
  BotsUseCases,
  SessionUseCases,
  SupervisorOrchestrationUseCases,
  TaskAutoArchiveUseCases,
  UseCasePort,
} from "#runtime/modules/use-cases";
import {
  KNOWN_WORKFLOW_EFFECT_TYPES,
  type WorkflowJournalPort,
} from "#runtime/modules/workflow";
import { LOCAL_DESKTOP_USER_ID } from "#runtime/platform/auth/local-desktop-user";
import type { BackgroundRunnerState } from "#runtime/shared/types/background.types";
import type { AuthRuntime } from "../platform/auth/auth";
import {
  BackgroundRunner,
  createCachePruneTask,
  createPluginBatchScheduleDispatchTask,
  createProviderQuotaResetDispatchTask,
  createSessionEventOutboxDispatchTask,
  createSessionIdleCleanupTask,
  createSqliteStorageMaintenanceTask,
  createTaskAutoArchiveTask,
  createWorkflowReconcileDispatchTask,
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
  agentRuntime: AgentRuntimePort;
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
  sessionEventOutbox: SessionEventOutboxPort;
  workflowJournal: WorkflowJournalPort;
  sessionUseCases: SessionUseCases;
  supervisorOrchestration: Pick<
    SupervisorOrchestrationUseCases,
    "workflowRuntime" | "capacity"
  >;
  localAde: Pick<
    UseCasePort<LocalAdeService>,
    "dispatchDuePluginBatchSchedules"
  >;
  bots: Pick<
    BotsUseCases["bots"],
    "dispatchDueQuotaResets" | "reconcileProviderLeases"
  >;
  taskAutoArchive: TaskAutoArchiveUseCases["taskAutoArchive"];
  appConfig: AppConfigService;
  policy: ServerLifecyclePolicy;
  setBackgroundRunnerStateProvider: (
    provider: () => BackgroundRunnerState
  ) => void;
}

type WorkflowRestartJournal = Pick<
  WorkflowJournalPort,
  "markStaleStartedDispatchesUncertain" | "releasePendingEffectClaims"
>;

export async function reconcileWorkflowJournalAfterRestart(
  journal: WorkflowRestartJournal,
  nowMs: number
) {
  const releasedEffects = await journal.releasePendingEffectClaims({ nowMs });
  const uncertainEffects = await journal.markStaleStartedDispatchesUncertain({
    effectTypes: [...KNOWN_WORKFLOW_EFFECT_TYPES],
    nowMs,
    includeUnexpired: true,
    error: {
      kind: "runtime_restart",
      message:
        "The runtime restarted after this workflow effect started; reconcile external state and durable evidence before continuing.",
    },
  });
  return { releasedEffects, uncertainEffects };
}

class DefaultServerLifecycle implements ServerLifecycle {
  private readonly deps: ServerLifecycleDependencies;
  private readonly backgroundRunner = new BackgroundRunner();
  private backgroundStarted = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(deps: ServerLifecycleDependencies) {
    this.deps = deps;
    this.backgroundRunner.register(
      createWorkflowReconcileDispatchTask({
        runtime: deps.supervisorOrchestration.workflowRuntime,
      })
    );
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
        compactSessionMessages: {
          execute: (input) => deps.sessionUseCases.queries.compact(input),
        },
      })
    );
    this.backgroundRunner.register(
      createSessionEventOutboxDispatchTask({
        outbox: deps.sessionEventOutbox,
      })
    );
    this.backgroundRunner.register(
      createPluginBatchScheduleDispatchTask({
        dispatcher: deps.localAde,
        getUserIds: () => [
          LOCAL_DESKTOP_USER_ID,
          ...deps.sessionRuntime.getAll().map((session) => session.userId),
        ],
      })
    );
    this.backgroundRunner.register(
      createProviderQuotaResetDispatchTask({
        dispatcher: deps.bots,
        supervisorCapacity: deps.supervisorOrchestration.capacity,
        getUserIds: () => [
          LOCAL_DESKTOP_USER_ID,
          ...deps.sessionRuntime.getAll().map((session) => session.userId),
        ],
      })
    );
    this.backgroundRunner.register(
      createTaskAutoArchiveTask({
        runner: deps.taskAutoArchive,
        getUserIds: () => [
          LOCAL_DESKTOP_USER_ID,
          ...deps.sessionRuntime.getAll().map((session) => session.userId),
        ],
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
      sessionUseCases: this.deps.sessionUseCases,
      policy: {
        authBootstrapApiKey: this.deps.policy.authBootstrapApiKey,
        authApiKeyPrefix: this.deps.policy.authApiKeyPrefix,
      },
    });
    await this.deps.bots.reconcileProviderLeases({
      userIds: [
        LOCAL_DESKTOP_USER_ID,
        ...this.deps.sessionRuntime.getAll().map((session) => session.userId),
      ],
    });
    const { releasedEffects, uncertainEffects } =
      await reconcileWorkflowJournalAfterRestart(
        this.deps.workflowJournal,
        Date.now()
      );
    if (releasedEffects.length > 0) {
      logger.info("Released pending workflow effect claims after restart", {
        effectCount: releasedEffects.length,
      });
    }
    if (uncertainEffects.length > 0) {
      logger.warn("Workflow effects require post-restart reconciliation", {
        effectCount: uncertainEffects.length,
        effectIds: uncertainEffects
          .slice(0, 20)
          .map((effect) => effect.effectId),
      });
    }
    await this.deps.supervisorOrchestration.workflowRuntime.recoverStartup({
      releasedEffects,
      uncertainEffects,
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
      this.deps.agentRuntime.beginShutdown();
      this.stopBackground();
      await executeServerShutdown({
        sessionRuntime: this.deps.sessionRuntime,
        sessionRepo: this.deps.sessionRepo,
        sessionUseCases: this.deps.sessionUseCases,
        policy: {
          sqliteRetentionHotDays: this.deps.policy.sqliteRetentionHotDays,
          backgroundTaskTimeoutMs: this.deps.policy.backgroundTaskTimeoutMs,
          sqliteRetentionCompactionBatchSize:
            this.deps.policy.sqliteRetentionCompactionBatchSize,
        },
      });
      const processSummary =
        await this.deps.agentRuntime.terminateAllActiveProcesses();
      if (
        processSummary.terminated > 0 ||
        processSummary.failed > 0 ||
        processSummary.lingeringPids.length > 0
      ) {
        logger.info("Agent runtime process cleanup summary", processSummary);
      }
    })();

    return this.shutdownPromise;
  }
}

export function createServerLifecycle(
  deps: ServerLifecycleDependencies
): ServerLifecycle {
  return new DefaultServerLifecycle(deps);
}
