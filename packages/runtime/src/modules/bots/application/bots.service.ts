import { createHash, randomUUID } from "node:crypto";
import type {
  ScheduledWorkDecisionResult,
  ScheduledWorkPriorEvidence,
} from "#runtime/modules/supervisor";
import {
  isAppError,
  NotFoundError,
  ValidationError,
} from "#runtime/shared/errors";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { ChatSession } from "#runtime/shared/types/session.types";
import { redactSensitiveTextSample } from "#runtime/shared/utils/redaction.util";
import type {
  BotDefinition,
  BotOrchestrationResult,
  BotQuotaAutomationState,
  BotQuotaAutomationWindow,
  BotQuotaTriggerConfig,
  BotRun,
  BotRunTriggerContext,
  BotSystemStatus,
  BotTrigger,
  CompleteBotRunsForTurnInput,
  OrchestrateBotsInput,
  RecordBotQuotaSnapshotInput,
  StartBotRunInput,
  StopBotRunsForSessionInput,
  UpsertBotDefinitionInput,
} from "./contracts/bots.contract";
import type {
  BotQuotaAutomationStateSnapshot,
  BotRepositoryPort,
} from "./ports/bot-repository.port";
import { ProviderAdmissionService } from "./provider-admission.service";

const MODULE = "bots";
const DEFAULT_QUOTA_MIN_PERCENT_REMAINING = 1;
const DEFAULT_QUOTA_COOLDOWN_MS = 300_000;
const QUOTA_RECHECK_DELAY_MS = 60_000;
const QUOTA_IDLE_RECHECK_DELAY_MS = 5 * 60_000;
const STALE_QUOTA_WINDOW_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_QUOTA_DISPATCH_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

interface BotSessionCreator {
  execute(params: {
    userId: string;
    projectId?: string;
    agentId?: string;
  }): Promise<ChatSession>;
}

interface BotSessionResumer {
  execute(
    userId: string,
    chatId: string
  ): Promise<{
    chatId?: string;
    models?: ChatSession["models"] | null;
    alreadyRunning?: boolean;
  }>;
}

interface BotSessionStopper {
  execute(userId: string, chatId: string): Promise<unknown>;
}

interface BotModelSetter {
  execute(userId: string, chatId: string, modelId: string): Promise<unknown>;
}

interface BotMessageSender {
  execute(input: {
    userId: string;
    chatId: string;
    text: string;
    source: "automation" | "scheduled";
  }): Promise<{ turnId: string }>;
}

interface BotSessionStore {
  findById(
    chatId: string,
    userId: string
  ): Promise<
    | {
        id: string;
        userId: string;
        projectId?: string;
        agentId?: string;
        status: "running" | "stopped";
        models?: ChatSession["models"];
      }
    | undefined
  >;
}

interface BotSessionRuntime {
  get(chatId: string): ChatSession | undefined;
}

interface BotProjectStore {
  findById(
    projectId: string,
    userId: string
  ): Promise<{ id: string; path: string } | undefined>;
}

interface BotScheduledDecision {
  execute(input: {
    scheduleId: string;
    userId: string;
    projectId?: string;
    projectRoot: string;
    objective: string;
    workMode: "adaptive_session" | "supervisor_run";
    priorEvidence: ScheduledWorkPriorEvidence[];
  }): Promise<ScheduledWorkDecisionResult>;
}

interface BotSupervisorOrchestrator {
  createDraft?(input: {
    userId: string;
    projectId: string;
    projectRoot: string;
    intent: string;
    constraints?: string[];
    priority?: "urgent" | "high" | "normal" | "low";
    agentAllowlist?: string[];
    scheduleId?: string;
  }): Promise<{ runId: string; status: string }>;
  /** One-version compatibility for older injected test/automation adapters. */
  start?(input: {
    userId: string;
    projectId?: string;
    projectRoot: string;
    originalIntent: string;
    constraints?: string[];
    eligibleAgentIds?: string[];
    providerId?: string;
    scheduleId?: string;
    workerModelId?: string;
  }): Promise<{ runId: string; status: string }>;
  get(
    runId: string,
    userId: string
  ): Promise<{ runId: string; status: string } | null>;
  resume(
    runId: string,
    userId: string
  ): Promise<{ runId: string; status: string }>;
  schedule(
    runId: string,
    userId: string
  ): Promise<{ runId: string; status: string }>;
  cancel(
    runId: string,
    userId: string
  ): Promise<{ runId: string; status: string }>;
}

interface BotEntitlementChecker {
  checkFeature(
    userId: string,
    input: { featureId: "task_queue" }
  ): Promise<{ enabled: boolean; reason?: string }>;
}

interface QuotaWindowSnapshot {
  id: string;
  windowType?: string;
  label: string;
  percentRemaining?: number;
  remaining?: number;
  unlimited?: boolean;
  resetAt?: string;
}

interface ProviderQuotaSnapshot {
  providerId: string;
  displayName: string;
  status: "ready" | "not_configured" | "unavailable" | "error";
  aliases?: string[];
  checkedAt?: string;
  fetchedAt?: string;
  error?: { message: string };
  windows: QuotaWindowSnapshot[];
}

interface BotQuotaProvider {
  refresh(
    userId: string,
    input?: {
      providerId?: string;
      includeUnavailable?: boolean;
      force?: boolean;
    }
  ): Promise<{ providers: ProviderQuotaSnapshot[]; checkedAt: string }>;
}

interface StartBotOptions {
  dedupeKey?: string;
  triggerContext?: BotRunTriggerContext;
  autoExecute?: boolean;
}

export interface BotQuotaDispatchResult {
  users: number;
  dueWindows: number;
  refreshedProviders: number;
  dispatchedRuns: number;
  queuedRunsExecuted: number;
  skippedBots: number;
  failedProviders: number;
}

export interface BotUpdateSignal {
  botId: string;
  runId?: string;
  kind: "definition" | "run" | "deleted";
  status?: string;
  updatedAt: number;
}

interface BotsServiceDeps {
  repository: BotRepositoryPort;
  createSession?: BotSessionCreator;
  resumeSession?: BotSessionResumer;
  stopSession?: BotSessionStopper;
  setModel?: BotModelSetter;
  sendMessage?: BotMessageSender;
  sessionStore?: BotSessionStore;
  sessionRuntime?: BotSessionRuntime;
  projectStore?: BotProjectStore;
  scheduledDecision?: BotScheduledDecision;
  supervisorOrchestrator?: BotSupervisorOrchestrator;
  entitlement?: BotEntitlementChecker;
  eventBus?: EventBusPort;
  quotaProvider?: BotQuotaProvider;
  logger?: LoggerPort;
  now?: () => number;
  createId?: () => string;
}

export class BotsService {
  private readonly repository: BotRepositoryPort;
  private readonly createSession?: BotSessionCreator;
  private readonly resumeSession?: BotSessionResumer;
  private readonly stopSession?: BotSessionStopper;
  private readonly setModel?: BotModelSetter;
  private readonly sendMessage?: BotMessageSender;
  private readonly sessionStore?: BotSessionStore;
  private readonly sessionRuntime?: BotSessionRuntime;
  private readonly projectStore?: BotProjectStore;
  private readonly scheduledDecision?: BotScheduledDecision;
  private readonly supervisorOrchestrator?: BotSupervisorOrchestrator;
  private readonly entitlement?: BotEntitlementChecker;
  private readonly quotaProvider?: BotQuotaProvider;
  private readonly admission?: ProviderAdmissionService;
  private readonly eventBus?: EventBusPort;
  private readonly logger?: LoggerPort;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(deps: BotsServiceDeps) {
    this.repository = deps.repository;
    this.createSession = deps.createSession;
    this.resumeSession = deps.resumeSession;
    this.stopSession = deps.stopSession;
    this.setModel = deps.setModel;
    this.sendMessage = deps.sendMessage;
    this.sessionStore = deps.sessionStore;
    this.sessionRuntime = deps.sessionRuntime;
    this.projectStore = deps.projectStore;
    this.scheduledDecision = deps.scheduledDecision;
    this.supervisorOrchestrator = deps.supervisorOrchestrator;
    this.entitlement = deps.entitlement;
    this.quotaProvider = deps.quotaProvider;
    this.eventBus = deps.eventBus;
    this.logger = deps.logger;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
    this.admission = deps.quotaProvider
      ? new ProviderAdmissionService({
          repository: deps.repository,
          quota: deps.quotaProvider,
          entitlement: deps.entitlement,
          now: this.now,
          createId: this.createId,
        })
      : undefined;
  }

  async list(userId: string): Promise<BotSystemStatus> {
    const [bots, runs, providerLeases] = await Promise.all([
      this.repository.listBots(userId),
      this.repository.listRuns(userId),
      this.readQuotaAutomationState((snapshot) =>
        Object.values(snapshot.get().providerLeases)
          .filter((lease) => lease.userId === userId)
          .map((lease) => ({
            providerId: lease.providerId,
            botId: lease.botId,
            runId: lease.runId,
            acquiredAt: lease.acquiredAt,
            expiresAt: lease.expiresAt,
          }))
      ),
    ]);
    return {
      bots: bots.sort((left, right) => right.updatedAt - left.updatedAt),
      runs: runs.sort((left, right) => right.queuedAt - left.queuedAt),
      providerLeases,
    };
  }

  subscribe(input: {
    userId: string;
    botId?: string;
    listener: (update: BotUpdateSignal) => void;
  }): () => void {
    if (!this.eventBus) {
      return () => undefined;
    }
    return this.eventBus.subscribe((event) => {
      if (
        event.type !== "scheduled_task_updated" ||
        event.userId !== input.userId ||
        (input.botId && event.botId !== input.botId)
      ) {
        return;
      }
      input.listener({
        botId: event.botId,
        ...(event.runId ? { runId: event.runId } : {}),
        kind: event.kind,
        ...(event.status ? { status: event.status } : {}),
        updatedAt: event.updatedAt,
      });
    });
  }

  async upsert(
    userId: string,
    input: UpsertBotDefinitionInput
  ): Promise<BotDefinition> {
    const now = this.now();
    const existing = input.id
      ? await this.repository.getBot(userId, input.id)
      : null;
    if (input.id && !existing) {
      throw new NotFoundError("Bot definition not found", {
        module: MODULE,
        op: "upsert",
        details: { botId: input.id },
      });
    }
    const resolved = resolveBotUpsert(input, existing);
    assertValidBotUpsert(resolved);
    if (!existing || (!existing.enabled && resolved.enabled)) {
      await this.assertTaskQueueEntitled(userId);
    }
    return await this.repository.saveBot(
      buildBotDefinition({
        userId,
        input,
        existing,
        resolved,
        now,
        createId: this.createId,
      })
    );
  }

  async delete(userId: string, botId: string): Promise<void> {
    const existing = await this.repository.getBot(userId, botId);
    if (!existing) {
      throw new NotFoundError("Bot definition not found", {
        module: MODULE,
        op: "delete",
        details: { botId },
      });
    }
    const runs = (await this.repository.listRuns(userId)).filter(
      (run) => run.botId === botId
    );
    if (runs.some(isActiveRun)) {
      throw new ValidationError(
        "Stop active scheduled-task runs before deleting the task",
        {
          module: MODULE,
          op: "delete",
          details: { botId },
        }
      );
    }
    await Promise.all(
      runs.map((run) =>
        this.admission?.release({
          userId,
          runId: run.id,
          leaseId: run.admission?.leaseId,
        })
      )
    );
    await this.repository.deleteBot(userId, botId);
  }

  async setEnabled(
    userId: string,
    botId: string,
    enabled: boolean
  ): Promise<BotDefinition> {
    const existing = await this.repository.getBot(userId, botId);
    if (!existing) {
      throw new NotFoundError("Scheduled task not found", {
        module: MODULE,
        op: "setEnabled",
        details: { botId },
      });
    }
    if (enabled && !existing.enabled) {
      await this.assertTaskQueueEntitled(userId);
    }
    return await this.repository.saveBot({
      ...existing,
      enabled,
      updatedAt: this.now(),
    });
  }

  async startRun(userId: string, input: StartBotRunInput): Promise<BotRun> {
    const bot = await this.repository.getBot(userId, input.botId);
    if (!bot) {
      throw new NotFoundError("Bot definition not found", {
        module: MODULE,
        op: "startRun",
        details: { botId: input.botId },
      });
    }
    return await this.startBot(
      userId,
      bot,
      input.trigger ?? bot.trigger,
      input.context,
      { autoExecute: true }
    );
  }

  async runNowIfEligible(userId: string, botId: string): Promise<BotRun> {
    const bot = await this.repository.getBot(userId, botId);
    if (!bot) {
      throw new NotFoundError("Scheduled task not found", {
        module: MODULE,
        op: "runNowIfEligible",
        details: { botId },
      });
    }
    await this.assertTaskQueueEntitled(userId);
    const run = await this.startBot(
      userId,
      bot,
      "manual",
      { source: "run_now_if_eligible" },
      { autoExecute: false }
    );
    return await this.executeRun(userId, run.id);
  }

  async retryRun(userId: string, runId: string): Promise<BotRun> {
    const run = await this.repository.getRun(userId, runId);
    if (!run) {
      throw new NotFoundError("Scheduled task run not found", {
        module: MODULE,
        op: "retryRun",
        details: { runId },
      });
    }
    if (
      run.status !== "failed" &&
      run.status !== "stopped" &&
      run.status !== "quota_blocked"
    ) {
      throw new ValidationError(
        "Only blocked or terminal runs can be retried",
        {
          module: MODULE,
          op: "retryRun",
          details: { runId, status: run.status },
        }
      );
    }
    await this.assertTaskQueueEntitled(userId);
    const bot = await this.repository.getBot(userId, run.botId);
    if (!bot) {
      throw new NotFoundError("Scheduled task not found for retry", {
        module: MODULE,
        op: "retryRun",
        details: { runId, botId: run.botId },
      });
    }
    if (run.status === "quota_blocked") {
      await this.repository.saveRun({
        ...run,
        status: "stopped",
        stoppedAt: this.now(),
        nextAttemptAt: undefined,
      });
    }
    await this.admission?.release({
      userId,
      runId: run.id,
      leaseId: run.admission?.leaseId,
    });
    const retry = await this.startBot(
      userId,
      bot,
      "manual",
      {
        ...run.context,
        source: "retry",
        retryOfRunId: run.id,
      },
      { autoExecute: false }
    );
    return await this.executeRun(userId, retry.id);
  }

  async stopRun(userId: string, runId: string): Promise<BotRun> {
    const run = await this.repository.getRun(userId, runId);
    if (!run) {
      throw new NotFoundError("Bot run not found", {
        module: MODULE,
        op: "stopRun",
        details: { runId },
      });
    }
    if (!isActiveRun(run)) {
      return run;
    }
    if (run.supervisorRunId && this.supervisorOrchestrator) {
      await this.supervisorOrchestrator
        .cancel(run.supervisorRunId, userId)
        .catch(() => undefined);
    } else if (run.chatId && run.status === "running") {
      await this.stopSession
        ?.execute(userId, run.chatId)
        .catch(() => undefined);
    }
    const stopped = await this.repository.saveRun({
      ...run,
      status: "stopped",
      stoppedAt: this.now(),
      nextAttemptAt: undefined,
    });
    await this.admission?.release({
      userId,
      runId,
      leaseId: run.admission?.leaseId,
    });
    return stopped;
  }

  async orchestrate(
    userId: string,
    input: OrchestrateBotsInput
  ): Promise<BotOrchestrationResult> {
    const bots = (await this.repository.listBots(userId)).filter(
      (bot) => bot.enabled && bot.trigger === input.trigger
    );
    const startedRuns: BotRun[] = [];
    const skippedBotIds: string[] = [];
    for (const bot of bots) {
      try {
        startedRuns.push(
          await this.startBot(userId, bot, input.trigger, input.context, {
            autoExecute: true,
          })
        );
      } catch (error) {
        if (error instanceof ValidationError) {
          skippedBotIds.push(bot.id);
          continue;
        }
        throw error;
      }
    }
    return {
      trigger: input.trigger,
      startedRuns,
      skippedBotIds,
    };
  }

  async executeRun(userId: string, runId: string): Promise<BotRun> {
    const run = await this.repository.getRun(userId, runId);
    if (!run) {
      throw new NotFoundError("Bot run not found", {
        module: MODULE,
        op: "executeRun",
        details: { runId },
      });
    }
    if (run.status !== "queued" && run.status !== "quota_blocked") {
      return run;
    }
    if (run.nextAttemptAt !== undefined && run.nextAttemptAt > this.now()) {
      return run;
    }
    const bot = await this.repository.getBot(userId, run.botId);
    if (!bot) {
      return await this.failRun(
        run,
        "Bot definition not found for queued run."
      );
    }
    if (bot.execution.target === "queue_only") {
      return run;
    }
    if (isSubscriptionAwareSchedule(bot)) {
      return await this.executeScheduledRun(userId, bot, run);
    }
    return await this.executeLegacyRun(userId, bot, run);
  }

  private async executeLegacyRun(
    userId: string,
    bot: BotDefinition,
    run: BotRun
  ): Promise<BotRun> {
    if (!(this.createSession && this.sendMessage)) {
      return await this.failRun(run, "Bot executor is not configured.");
    }
    let current = await this.repository.saveRun({
      ...run,
      status: "running",
      startedAt: run.startedAt ?? this.now(),
      nextAttemptAt: undefined,
      error: undefined,
    });

    try {
      let chatId = bot.execution.chatId;
      let agentSessionId = current.agentSessionId;
      if (bot.execution.target === "new_session") {
        if (!bot.projectId) {
          return await this.failRun(
            current,
            "New-session bot execution requires a projectId."
          );
        }
        const session = await this.createSession.execute({
          userId,
          projectId: bot.projectId,
          ...(bot.agentId ? { agentId: bot.agentId } : {}),
        });
        chatId = session.id;
        agentSessionId = session.sessionId;
        current = await this.repository.saveRun({
          ...current,
          chatId,
          ...(agentSessionId ? { agentSessionId } : {}),
        });
      }

      if (!chatId) {
        return await this.failRun(
          current,
          "Existing-session bot execution requires a chatId."
        );
      }

      const submitted = await this.sendMessage.execute({
        userId,
        chatId,
        text: bot.prompt,
        source: "automation",
      });
      return await this.repository.saveRun({
        ...current,
        chatId,
        turnId: submitted.turnId,
        ...(agentSessionId ? { agentSessionId } : {}),
      });
    } catch (error) {
      if (bot.execution.target === "existing_session" && isPromptBusy(error)) {
        const retryAt = this.now() + getQuotaCooldownMs(bot);
        return await this.repository.saveRun({
          ...current,
          status: "queued",
          startedAt: null,
          nextAttemptAt: retryAt,
          error: getErrorMessage(error),
        });
      }
      return await this.failRun(current, getErrorMessage(error));
    }
  }

  private async executeScheduledRun(
    userId: string,
    bot: BotDefinition,
    run: BotRun
  ): Promise<BotRun> {
    if (!this.admission) {
      return await this.failRun(
        run,
        "Provider quota admission is not configured."
      );
    }
    const admission = await this.admission.admit({
      userId,
      bot,
      runId: run.id,
    });
    if (!admission.eligible) {
      return await this.repository.saveRun({
        ...run,
        status: "quota_blocked",
        admission: admission.admission,
        providerId: admission.admission.providerId ?? bot.providerId,
        startedAt: null,
        nextAttemptAt: admission.admission.nextCheckAt,
        failureReason: admission.admission.reason,
        error: admission.admission.reason,
        retryable: admission.admission.status !== "entitlement_required",
      });
    }

    let current = await this.repository.saveRun({
      ...run,
      status: "queued",
      admission: admission.admission,
      providerId: admission.admission.providerId,
      nextAttemptAt: undefined,
      failureReason: undefined,
      error: undefined,
      retryable: undefined,
    });

    let generated: ScheduledWorkDecisionResult;
    try {
      generated = await this.decideScheduledWork(userId, bot, current);
    } catch (error) {
      await this.admission.release({
        userId,
        runId: current.id,
        leaseId: current.admission?.leaseId,
      });
      const failureReason = `Supervisor decision unavailable: ${getErrorMessage(
        error
      )}`;
      return await this.repository.saveRun({
        ...current,
        status: "quota_blocked",
        startedAt: null,
        nextAttemptAt: this.now() + QUOTA_RECHECK_DELAY_MS,
        failureReason,
        error: failureReason,
        retryable: true,
      });
    }

    const decision = {
      action: generated.action,
      rationale: sanitizeScheduledEvidence(generated.rationale, 1200),
      evidenceSummary: sanitizeScheduledEvidence(
        generated.evidenceSummary,
        2400
      ),
      decidedAt: generated.decidedAt,
      ...(generated.retryable !== undefined
        ? { retryable: generated.retryable }
        : {}),
    } satisfies NonNullable<BotRun["decision"]>;
    current = await this.repository.saveRun({
      ...current,
      decision,
      ...(generated.prompt
        ? { promptHash: hashScheduledPrompt(generated.prompt) }
        : {}),
    });

    if (generated.action === "complete") {
      await this.admission.release({
        userId,
        runId: current.id,
        leaseId: current.admission?.leaseId,
      });
      await this.repository.saveBot({
        ...bot,
        enabled: false,
        updatedAt: this.now(),
      });
      return await this.repository.saveRun({
        ...current,
        status: "completed",
        completionState: "objective_completed",
        completedAt: this.now(),
      });
    }
    if (generated.action === "defer") {
      await this.admission.release({
        userId,
        runId: current.id,
        leaseId: current.admission?.leaseId,
      });
      const nextAttemptAt =
        this.now() + (generated.retryAfterMs ?? QUOTA_RECHECK_DELAY_MS);
      return await this.repository.saveRun({
        ...current,
        status: "quota_blocked",
        startedAt: null,
        nextAttemptAt,
        failureReason: decision.rationale,
        error: decision.rationale,
        retryable: true,
      });
    }
    if (generated.action === "failed" || !generated.prompt) {
      await this.admission.release({
        userId,
        runId: current.id,
        leaseId: current.admission?.leaseId,
      });
      const retryable = generated.retryable ?? false;
      return await this.repository.saveRun({
        ...current,
        status: retryable ? "quota_blocked" : "failed",
        completedAt: retryable ? null : this.now(),
        nextAttemptAt: retryable
          ? this.now() + (generated.retryAfterMs ?? QUOTA_RECHECK_DELAY_MS)
          : undefined,
        failureReason: decision.rationale,
        error: decision.rationale,
        retryable,
      });
    }

    return bot.workMode === "supervisor_run"
      ? await this.executeScheduledSupervisorRun(
          userId,
          bot,
          current,
          generated.prompt
        )
      : await this.executeScheduledAdaptiveRun(
          userId,
          bot,
          current,
          generated.prompt
        );
  }

  private async decideScheduledWork(
    userId: string,
    bot: BotDefinition,
    current: BotRun
  ): Promise<ScheduledWorkDecisionResult> {
    if (bot.promptStrategy === "fixed") {
      return {
        action: "dispatch",
        prompt: bot.prompt,
        rationale: "Using the migrated fixed prompt strategy.",
        evidenceSummary:
          "Fixed-prompt compatibility mode does not request a Supervisor project decision.",
        decidedAt: this.now(),
      };
    }
    if (!(this.scheduledDecision && this.projectStore && bot.projectId)) {
      throw new Error(
        "Scheduled Supervisor decision dependencies are not configured."
      );
    }
    const project = await this.projectStore.findById(bot.projectId, userId);
    if (!project) {
      throw new Error("Bound project is unavailable.");
    }
    const priorEvidence = (await this.repository.listRuns(userId))
      .filter(
        (candidate) => candidate.botId === bot.id && candidate.id !== current.id
      )
      .sort((left, right) => left.queuedAt - right.queuedAt)
      .map(toScheduledPriorEvidence);
    return await this.scheduledDecision.execute({
      scheduleId: bot.id,
      userId,
      projectId: bot.projectId,
      projectRoot: project.path,
      objective: bot.objective,
      workMode: bot.workMode,
      priorEvidence,
    });
  }

  private async executeScheduledAdaptiveRun(
    userId: string,
    bot: BotDefinition,
    run: BotRun,
    prompt: string
  ): Promise<BotRun> {
    if (!(this.createSession && this.sendMessage)) {
      return await this.failScheduledDispatch(
        run,
        "Adaptive-session executor is not configured."
      );
    }
    let current = run;
    let binding:
      | {
          chatId: string;
          agentSessionId?: string;
          models?: ChatSession["models"] | null;
          created: boolean;
        }
      | undefined;
    try {
      binding = await this.resolveAdaptiveBinding(userId, bot);
      await this.assertAndSelectScheduledModel({
        userId,
        bot,
        chatId: binding.chatId,
        models: binding.models,
      });
      current = await this.repository.saveRun({
        ...current,
        status: "running",
        chatId: binding.chatId,
        ...(binding.agentSessionId
          ? { agentSessionId: binding.agentSessionId }
          : {}),
        startedAt: current.startedAt ?? this.now(),
      });
      const submitted = await this.sendMessage.execute({
        userId,
        chatId: binding.chatId,
        text: prompt,
        source: "scheduled",
      });
      return await this.repository.saveRun({
        ...current,
        turnId: submitted.turnId,
      });
    } catch (error) {
      if (isPromptBusy(error)) {
        await this.admission?.release({
          userId,
          runId: current.id,
          leaseId: current.admission?.leaseId,
        });
        return await this.repository.saveRun({
          ...current,
          status: "quota_blocked",
          startedAt: null,
          nextAttemptAt: this.now() + getQuotaCooldownMs(bot),
          failureReason: getErrorMessage(error),
          error: getErrorMessage(error),
          retryable: true,
        });
      }
      if (binding?.created) {
        await this.stopSession
          ?.execute(userId, binding.chatId)
          .catch(() => undefined);
        await this.repository.saveBot({
          ...bot,
          execution: { target: "new_session" },
          updatedAt: this.now(),
        });
      }
      return await this.failScheduledDispatch(current, getErrorMessage(error));
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Scheduled Goal dispatch keeps provider telemetry, dedupe, and fail-closed bot state in one transition.
  private async executeScheduledSupervisorRun(
    userId: string,
    bot: BotDefinition,
    run: BotRun,
    prompt: string
  ): Promise<BotRun> {
    if (
      !(
        this.supervisorOrchestrator &&
        this.projectStore &&
        bot.projectId &&
        bot.agentId &&
        bot.providerId
      )
    ) {
      return await this.failScheduledDispatch(
        run,
        "Full Supervisor scheduled execution is not configured."
      );
    }
    try {
      const existingRun = await this.findNonTerminalSupervisorRun(userId, bot);
      let supervisorRun: { runId: string; status: string };
      if (existingRun) {
        supervisorRun =
          existingRun.status === "paused"
            ? await this.supervisorOrchestrator.resume(
                existingRun.runId,
                userId
              )
            : await this.supervisorOrchestrator.schedule(
                existingRun.runId,
                userId
              );
      } else {
        const project = await this.projectStore.findById(bot.projectId, userId);
        if (!project) {
          throw new Error("Bound project is unavailable.");
        }
        const constraints = [
          `Stable scheduled objective: ${bot.objective}`,
          "Preserve ACP permissions, sandbox checks, isolated worktrees, and integration gates.",
        ];
        if (this.supervisorOrchestrator.createDraft) {
          supervisorRun = await this.supervisorOrchestrator.createDraft({
            userId,
            projectId: bot.projectId,
            projectRoot: project.path,
            intent: prompt,
            constraints,
            priority: "normal",
            agentAllowlist: [bot.agentId],
            scheduleId: bot.id,
          });
        } else if (this.supervisorOrchestrator.start) {
          supervisorRun = await this.supervisorOrchestrator.start({
            userId,
            projectId: bot.projectId,
            projectRoot: project.path,
            originalIntent: prompt,
            constraints,
            eligibleAgentIds: [bot.agentId],
            providerId: bot.providerId,
            scheduleId: bot.id,
            ...(bot.modelId ? { workerModelId: bot.modelId } : {}),
          });
        } else {
          throw new Error("Supervisor Goal API is unavailable.");
        }
      }
      if (isTerminalSupervisorStatus(supervisorRun.status)) {
        await this.admission?.release({
          userId,
          runId: run.id,
          leaseId: run.admission?.leaseId,
        });
        return await this.repository.saveRun({
          ...run,
          supervisorRunId: supervisorRun.runId,
          status: supervisorRun.status === "completed" ? "completed" : "failed",
          completionState:
            supervisorRun.status === "completed" ? "work_completed" : "pending",
          completedAt: this.now(),
        });
      }
      const latest = (await this.repository.getRun(userId, run.id)) ?? run;
      if (
        latest.supervisorRunId === supervisorRun.runId &&
        latest.status === "quota_blocked"
      ) {
        return latest;
      }
      return await this.repository.saveRun({
        ...latest,
        status: "running",
        supervisorRunId: supervisorRun.runId,
        startedAt: latest.startedAt ?? this.now(),
      });
    } catch (error) {
      return await this.failScheduledDispatch(run, getErrorMessage(error));
    }
  }

  private async resolveAdaptiveBinding(
    userId: string,
    bot: BotDefinition
  ): Promise<{
    chatId: string;
    agentSessionId?: string;
    models?: ChatSession["models"] | null;
    created: boolean;
  }> {
    const chatId = bot.execution.chatId;
    if (chatId && this.sessionStore) {
      const stored = await this.sessionStore.findById(chatId, userId);
      if (stored && isCompatibleStoredBinding(stored, bot)) {
        const runtime = this.sessionRuntime?.get(chatId);
        if (runtime?.userId === userId) {
          return {
            chatId,
            created: false,
            ...(runtime.sessionId ? { agentSessionId: runtime.sessionId } : {}),
            models: runtime.models,
          };
        }
        if (this.resumeSession) {
          const resumed = await this.resumeSession.execute(userId, chatId);
          const resumedRuntime = this.sessionRuntime?.get(chatId);
          return {
            chatId: resumed.chatId ?? chatId,
            created: false,
            ...(resumedRuntime?.sessionId
              ? { agentSessionId: resumedRuntime.sessionId }
              : {}),
            models: resumedRuntime?.models ?? resumed.models,
          };
        }
      }
    }
    if (!bot.projectId) {
      throw new Error("Adaptive scheduled execution requires a projectId.");
    }
    const created = await this.createSession?.execute({
      userId,
      projectId: bot.projectId,
      ...(bot.agentId ? { agentId: bot.agentId } : {}),
    });
    if (!created) {
      throw new Error("Adaptive session creator is unavailable.");
    }
    await this.repository.saveBot({
      ...bot,
      execution: { target: "existing_session", chatId: created.id },
      updatedAt: this.now(),
    });
    return {
      chatId: created.id,
      created: true,
      ...(created.sessionId ? { agentSessionId: created.sessionId } : {}),
      models: created.models,
    };
  }

  private async assertAndSelectScheduledModel(input: {
    userId: string;
    bot: BotDefinition;
    chatId: string;
    models?: ChatSession["models"] | null;
  }): Promise<void> {
    if (input.bot.promptStrategy === "fixed" && !input.bot.modelId) {
      return;
    }
    const providerId = input.bot.providerId;
    if (!(providerId && input.models)) {
      throw new Error(
        "The ACP session model provider could not be proven compatible."
      );
    }
    const modelId = input.bot.modelId ?? input.models.currentModelId;
    const model = input.models.availableModels.find(
      (candidate) => candidate.modelId === modelId
    );
    if (!(model && modelMatchesProvider(model, providerId))) {
      throw new Error(
        `ACP model ${modelId} is not compatible with provider ${providerId}.`
      );
    }
    if (input.models.currentModelId !== modelId) {
      if (!this.setModel) {
        throw new Error("The configured ACP model cannot be selected.");
      }
      await this.setModel.execute(input.userId, input.chatId, modelId);
    }
  }

  private async findNonTerminalSupervisorRun(
    userId: string,
    bot: BotDefinition
  ): Promise<{ runId: string; status: string } | null> {
    if (!this.supervisorOrchestrator) {
      return null;
    }
    const candidates = (await this.repository.listRuns(userId))
      .filter(
        (candidate) =>
          candidate.botId === bot.id && Boolean(candidate.supervisorRunId)
      )
      .sort((left, right) => right.queuedAt - left.queuedAt);
    for (const candidate of candidates) {
      if (!candidate.supervisorRunId) {
        continue;
      }
      const run = await this.supervisorOrchestrator.get(
        candidate.supervisorRunId,
        userId
      );
      if (run && !isTerminalSupervisorStatus(run.status)) {
        return run;
      }
    }
    return null;
  }

  private async failScheduledDispatch(
    run: BotRun,
    error: string
  ): Promise<BotRun> {
    await this.admission?.release({
      userId: run.userId,
      runId: run.id,
      leaseId: run.admission?.leaseId,
    });
    return await this.repository.saveRun({
      ...run,
      status: "failed",
      completedAt: this.now(),
      nextAttemptAt: undefined,
      failureReason: error,
      error,
      retryable: false,
    });
  }

  async executeDueQueuedRuns(input: {
    userIds: string[];
    now?: string;
  }): Promise<number> {
    const nowMs = parseOptionalDateMs(input.now) ?? this.now();
    let executed = 0;
    for (const userId of uniqueTrimmed(input.userIds)) {
      const runs = await this.repository.listRuns(userId);
      for (const run of runs) {
        if (
          (run.status !== "queued" && run.status !== "quota_blocked") ||
          (run.nextAttemptAt !== undefined && run.nextAttemptAt > nowMs)
        ) {
          continue;
        }
        const bot = await this.repository.getBot(userId, run.botId);
        if (!bot || bot.execution.target === "queue_only") {
          continue;
        }
        await this.executeRun(userId, run.id);
        executed += 1;
      }
    }
    return executed;
  }

  async completeRunsForTurn(input: CompleteBotRunsForTurnInput): Promise<void> {
    const runs = await this.repository.listRuns(input.userId);
    const status = getCompletedRunStatus(input.stopReason);
    const completedRuns = runs.filter(
      (run) =>
        run.status === "running" &&
        run.chatId === input.chatId &&
        run.turnId === input.turnId
    );
    await Promise.all(
      completedRuns.map((run) =>
        this.repository.saveRun({
          ...run,
          status,
          completionState:
            status === "completed" ? "work_completed" : run.completionState,
          completedAt: this.now(),
          stoppedAt: status === "stopped" ? this.now() : run.stoppedAt,
          failureReason: status === "failed" ? input.stopReason : undefined,
          error: status === "failed" ? input.stopReason : undefined,
        })
      )
    );
    await Promise.all(
      completedRuns.map((run) =>
        this.admission?.release({
          userId: input.userId,
          runId: run.id,
          leaseId: run.admission?.leaseId,
        })
      )
    );
  }

  async stopRunsForSession(input: StopBotRunsForSessionInput): Promise<void> {
    const runs = await this.repository.listRuns(input.userId);
    const stoppedRuns = runs.filter(
      (run) => run.status === "running" && run.chatId === input.chatId
    );
    await Promise.all(
      stoppedRuns.map((run) =>
        this.repository.saveRun({
          ...run,
          status: "stopped",
          stoppedAt: this.now(),
          failureReason: input.stopReason,
          error: input.stopReason,
        })
      )
    );
    await Promise.all(
      stoppedRuns.map((run) =>
        this.admission?.release({
          userId: input.userId,
          runId: run.id,
          leaseId: run.admission?.leaseId,
        })
      )
    );
  }

  async completeRunsForSupervisorUpdate(input: {
    userId: string;
    runId: string;
    status: string;
  }): Promise<void> {
    if (!isTerminalSupervisorStatus(input.status)) {
      return;
    }
    const runs = (await this.repository.listRuns(input.userId)).filter(
      (run) =>
        (run.status === "running" || run.status === "quota_blocked") &&
        run.supervisorRunId === input.runId
    );
    await Promise.all(
      runs.map(async (run) => {
        const status = mapSupervisorTerminalStatus(input.status);
        await this.repository.saveRun({
          ...run,
          status,
          completionState:
            input.status === "completed"
              ? "work_completed"
              : run.completionState,
          completedAt: this.now(),
          stoppedAt: input.status === "cancelled" ? this.now() : run.stoppedAt,
          failureReason:
            input.status === "completed"
              ? undefined
              : `Supervisor run ended with ${input.status}.`,
        });
        await this.admission?.release({
          userId: input.userId,
          runId: run.id,
          leaseId: run.admission?.leaseId,
        });
      })
    );
  }

  async reconcileProviderLeases(input: { userIds: string[] }): Promise<number> {
    return (await this.admission?.reconcile(input)) ?? 0;
  }

  async admitSupervisorWorker(input: {
    userId: string;
    runId: string;
    scheduleId: string;
    providerId: string;
    taskId: string;
  }): Promise<{ eligible: boolean; reason?: string; nextCheckAt?: number }> {
    const bot = await this.repository.getBot(input.userId, input.scheduleId);
    if (
      !(bot && this.admission) ||
      bot.providerId?.toLowerCase() !== input.providerId.toLowerCase()
    ) {
      return {
        eligible: false,
        reason: "Scheduled provider binding is unavailable or mismatched.",
      };
    }
    const runs = (await this.repository.listRuns(input.userId))
      .filter(
        (run) =>
          run.botId === bot.id &&
          isActiveRun(run) &&
          (run.supervisorRunId === input.runId ||
            (!run.supervisorRunId && isActiveRun(run)))
      )
      .sort((left, right) => right.queuedAt - left.queuedAt);
    const scheduledRun = runs[0];
    if (!scheduledRun) {
      return {
        eligible: false,
        reason: "Scheduled run binding is unavailable.",
      };
    }
    const result = await this.admission.admit({
      userId: input.userId,
      bot,
      runId: scheduledRun.id,
    });
    await this.repository.saveRun({
      ...scheduledRun,
      supervisorRunId: input.runId,
      admission: result.admission,
      status: result.eligible ? "running" : "quota_blocked",
      startedAt: result.eligible
        ? (scheduledRun.startedAt ?? this.now())
        : scheduledRun.startedAt,
      nextAttemptAt: result.eligible ? undefined : result.admission.nextCheckAt,
      failureReason: result.eligible ? undefined : result.admission.reason,
    });
    return {
      eligible: result.eligible,
      ...(result.admission.reason ? { reason: result.admission.reason } : {}),
      ...(result.admission.nextCheckAt
        ? { nextCheckAt: result.admission.nextCheckAt }
        : {}),
    };
  }

  async recordQuotaSnapshot(input: RecordBotQuotaSnapshotInput): Promise<void> {
    if (input.status !== "ready") {
      return;
    }
    const nowMs = this.now();
    await this.repository.mutateQuotaAutomationState((snapshot) => {
      const state = snapshot.get();
      let changed = false;
      for (const window of input.windows) {
        if (!window.resetAt) {
          continue;
        }
        const resetMs = Date.parse(window.resetAt);
        if (!Number.isFinite(resetMs)) {
          continue;
        }
        const key = quotaWindowStateKey(
          input.userId,
          input.providerId,
          window.id,
          window.resetAt
        );
        const existing = state.windows[key];
        state.windows[key] = {
          userId: input.userId,
          providerId: input.providerId,
          providerDisplayName: input.providerDisplayName,
          windowId: window.id,
          windowLabel: window.label,
          resetAt: window.resetAt,
          percentRemaining: window.percentRemaining,
          remaining: window.remaining,
          observedAt: existing?.observedAt ?? nowMs,
          nextCheckAt: existing?.nextCheckAt ?? nowMs,
          lastCheckedAt: existing?.lastCheckedAt,
        };
        changed = true;
      }
      if (changed) {
        pruneQuotaAutomationState(state, nowMs);
        snapshot.set(state);
      }
    });
  }

  async dispatchDueQuotaResets(input: {
    userIds: string[];
    now?: string;
  }): Promise<BotQuotaDispatchResult> {
    const userIds = uniqueTrimmed(input.userIds);
    const nowMs = parseOptionalDateMs(input.now) ?? this.now();
    const result: BotQuotaDispatchResult = {
      users: userIds.length,
      dueWindows: 0,
      refreshedProviders: 0,
      dispatchedRuns: 0,
      queuedRunsExecuted: 0,
      skippedBots: 0,
      failedProviders: 0,
    };

    if (!this.quotaProvider) {
      result.queuedRunsExecuted = await this.executeDueQueuedRuns({
        userIds,
        now: input.now,
      });
      return result;
    }

    let state = await this.readQuotaAutomationState((snapshot) => {
      const current = snapshot.get();
      pruneQuotaAutomationState(current, nowMs);
      return current;
    });
    const dueWindows = Object.values(state.windows)
      .filter(
        (window) =>
          userIds.includes(window.userId) && window.nextCheckAt <= nowMs
      )
      .sort((left, right) => left.nextCheckAt - right.nextCheckAt);
    result.dueWindows = dueWindows.length;

    for (const dueWindow of dueWindows) {
      const bots = (await this.repository.listBots(dueWindow.userId)).filter(
        (bot) => bot.enabled && bot.trigger === "quota_refresh"
      );
      const candidateBots = bots.filter((bot) =>
        botMatchesQuotaWindow(bot, dueWindow)
      );
      if (candidateBots.length === 0) {
        await this.deferQuotaWindow(
          dueWindow,
          nowMs + QUOTA_IDLE_RECHECK_DELAY_MS
        );
        continue;
      }

      let freshProvider: ProviderQuotaSnapshot | undefined;
      try {
        const refreshed = await this.quotaProvider.refresh(dueWindow.userId, {
          providerId: dueWindow.providerId,
          includeUnavailable: true,
          force: true,
        });
        result.refreshedProviders += 1;
        freshProvider = refreshed.providers.find(
          (provider) => provider.providerId === dueWindow.providerId
        );
      } catch (error) {
        result.failedProviders += 1;
        this.logger?.warn("Quota bot provider refresh failed", {
          providerId: dueWindow.providerId,
          error: getErrorMessage(error),
        });
        await this.deferQuotaWindow(dueWindow, nowMs + QUOTA_RECHECK_DELAY_MS);
        continue;
      }

      const freshWindow = findMatchingFreshWindow(freshProvider, dueWindow);
      if (!freshProvider || freshProvider.status !== "ready" || !freshWindow) {
        await this.deferQuotaWindow(dueWindow, nowMs + QUOTA_RECHECK_DELAY_MS);
        continue;
      }

      for (const bot of candidateBots) {
        state = await this.readQuotaAutomationState((snapshot) =>
          snapshot.get()
        );
        const dedupeKey = quotaDispatchDedupeKey({
          userId: dueWindow.userId,
          botId: bot.id,
          providerId: dueWindow.providerId,
          windowId: dueWindow.windowId,
          resetAt: dueWindow.resetAt,
        });
        if (state.dispatched[dedupeKey]) {
          result.skippedBots += 1;
          continue;
        }
        const cooldownKey = quotaCooldownKey(
          dueWindow.userId,
          bot.id,
          dueWindow.providerId,
          dueWindow.windowId
        );
        const cooldown = state.cooldowns[cooldownKey];
        if (
          cooldown &&
          cooldown.lastDispatchedAt + getQuotaCooldownMs(bot) > nowMs
        ) {
          result.skippedBots += 1;
          continue;
        }
        if (
          !hasAvailableQuota(
            freshWindow,
            getQuotaMinPercent(bot),
            getQuotaConfig(bot).minRemaining
          )
        ) {
          result.skippedBots += 1;
          continue;
        }

        const run = await this.startBot(
          dueWindow.userId,
          bot,
          "quota_refresh",
          {
            providerId: dueWindow.providerId,
            windowId: dueWindow.windowId,
            resetAt: dueWindow.resetAt,
          },
          {
            autoExecute: false,
            dedupeKey,
            triggerContext: {
              providerId: dueWindow.providerId,
              providerDisplayName: dueWindow.providerDisplayName,
              windowId: dueWindow.windowId,
              windowLabel: dueWindow.windowLabel,
              resetAt: dueWindow.resetAt,
              percentRemaining: freshWindow.percentRemaining,
              remaining: freshWindow.remaining,
              source: "provider_quota_reset",
            },
          }
        );

        await this.repository.mutateQuotaAutomationState((snapshot) => {
          const state = snapshot.get();
          state.dispatched[dedupeKey] = {
            dedupeKey,
            userId: dueWindow.userId,
            botId: bot.id,
            providerId: dueWindow.providerId,
            windowId: dueWindow.windowId,
            resetAt: dueWindow.resetAt,
            dispatchedAt: nowMs,
            runIds: [run.id],
          };
          state.cooldowns[cooldownKey] = {
            userId: dueWindow.userId,
            botId: bot.id,
            providerId: dueWindow.providerId,
            windowId: dueWindow.windowId,
            lastDispatchedAt: nowMs,
          };
          snapshot.set(state);
        });

        if (bot.execution.target !== "queue_only") {
          await this.executeRun(dueWindow.userId, run.id);
        }
        result.dispatchedRuns += 1;
      }

      await this.deferQuotaWindow(
        dueWindow,
        nowMs + QUOTA_IDLE_RECHECK_DELAY_MS
      );
    }

    result.queuedRunsExecuted = await this.executeDueQueuedRuns({
      userIds,
      now: input.now,
    });
    return result;
  }

  private async startBot(
    userId: string,
    bot: BotDefinition,
    trigger: BotTrigger,
    context?: Record<string, string>,
    options: StartBotOptions = {}
  ): Promise<BotRun> {
    if (!bot.enabled) {
      throw new ValidationError("Bot is disabled", {
        module: MODULE,
        op: "startRun",
        details: { botId: bot.id },
      });
    }
    await this.assertTaskQueueEntitled(userId);
    const runs = await this.repository.listRuns(userId);
    if (
      options.dedupeKey &&
      runs.some((run) => run.dedupeKey === options.dedupeKey)
    ) {
      throw new ValidationError("Bot run already dispatched for this trigger", {
        module: MODULE,
        op: "startRun",
        details: { botId: bot.id, dedupeKey: options.dedupeKey },
      });
    }
    const activeRuns = runs.filter(
      (run) => run.botId === bot.id && isActiveRun(run)
    );
    if (activeRuns.length >= bot.maxConcurrency) {
      throw new ValidationError("Bot concurrency limit reached", {
        module: MODULE,
        op: "startRun",
        details: { botId: bot.id, maxConcurrency: bot.maxConcurrency },
      });
    }

    const now = this.now();
    const run: BotRun = {
      id: this.createId(),
      userId,
      botId: bot.id,
      trigger,
      status: "queued",
      completionState: "pending",
      context: context ?? {},
      ...(options.triggerContext
        ? { triggerContext: options.triggerContext }
        : {}),
      ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
      ...(bot.providerId ? { providerId: bot.providerId } : {}),
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      stoppedAt: null,
    };
    const saved = await this.repository.saveRun(run);
    if (
      options.autoExecute !== false &&
      bot.execution.target !== "queue_only" &&
      this.createSession &&
      this.sendMessage
    ) {
      queueMicrotask(() => {
        this.executeRun(userId, saved.id).catch((error) => {
          this.logger?.warn("Bot run execution failed", {
            botId: bot.id,
            runId: saved.id,
            error: getErrorMessage(error),
          });
        });
      });
    }
    return saved;
  }

  private async failRun(run: BotRun, error: string): Promise<BotRun> {
    return await this.repository.saveRun({
      ...run,
      status: "failed",
      completedAt: this.now(),
      nextAttemptAt: undefined,
      failureReason: error,
      error,
    });
  }

  private async assertTaskQueueEntitled(userId: string): Promise<void> {
    if (this.admission) {
      await this.admission.assertEntitled(userId);
      return;
    }
    if (!this.entitlement) {
      return;
    }
    const gate = await this.entitlement.checkFeature(userId, {
      featureId: "task_queue",
    });
    if (!gate.enabled) {
      throw new ValidationError(
        gate.reason ?? "The task_queue entitlement is required.",
        {
          module: MODULE,
          op: "assertTaskQueueEntitled",
        }
      );
    }
  }

  private async deferQuotaWindow(
    window: BotQuotaAutomationWindow,
    nextCheckAt: number
  ): Promise<void> {
    await this.repository.mutateQuotaAutomationState((snapshot) => {
      const state = snapshot.get();
      const key = quotaWindowStateKey(
        window.userId,
        window.providerId,
        window.windowId,
        window.resetAt
      );
      const current = state.windows[key];
      if (!current) {
        return;
      }
      state.windows[key] = {
        ...current,
        lastCheckedAt: this.now(),
        nextCheckAt,
      };
      snapshot.set(state);
    });
  }

  private async readQuotaAutomationState<T>(
    reader: (snapshot: BotQuotaAutomationStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.repository.readQuotaAutomationState(reader);
  }
}

interface ResolvedBotUpsert {
  agentId: string | undefined;
  projectId: string | undefined;
  modelId: string | undefined;
  triggerConfig: BotDefinition["triggerConfig"];
  promptStrategy: BotDefinition["promptStrategy"];
  prompt: string;
  objective: string;
  providerId: string | undefined;
  enabled: boolean;
  workMode: BotDefinition["workMode"];
  isNewSchedule: boolean;
}

function resolveBotUpsert(
  input: UpsertBotDefinitionInput,
  existing: BotDefinition | null
): ResolvedBotUpsert {
  const triggerConfig = input.triggerConfig ?? existing?.triggerConfig;
  const promptStrategy =
    input.promptStrategy ??
    existing?.promptStrategy ??
    (input.objective ? "supervisor_dynamic" : "fixed");
  const prompt = input.prompt?.trim() ?? existing?.prompt ?? "";
  return {
    agentId: input.agentId ?? existing?.agentId,
    projectId: input.projectId ?? existing?.projectId,
    modelId: input.modelId ?? existing?.modelId,
    triggerConfig,
    promptStrategy,
    prompt,
    objective: input.objective?.trim() || existing?.objective || prompt.trim(),
    providerId:
      input.providerId?.trim() ||
      existing?.providerId ||
      resolveSingleLegacyProviderId(triggerConfig),
    enabled: input.enabled ?? existing?.enabled ?? true,
    workMode: input.workMode ?? existing?.workMode ?? "adaptive_session",
    isNewSchedule: !existing && Boolean(input.objective || input.providerId),
  };
}

function assertValidBotUpsert(resolved: ResolvedBotUpsert): void {
  if (!resolved.objective) {
    throw new ValidationError("Scheduled task objective is required", {
      module: MODULE,
      op: "upsert",
    });
  }
  if (resolved.promptStrategy === "fixed" && !resolved.prompt) {
    throw new ValidationError("Fixed scheduled tasks require a prompt", {
      module: MODULE,
      op: "upsert",
    });
  }
  const requiresBinding =
    resolved.isNewSchedule || resolved.promptStrategy === "supervisor_dynamic";
  if (
    requiresBinding &&
    !(resolved.providerId && resolved.projectId && resolved.agentId)
  ) {
    throw new ValidationError(
      "Scheduled tasks require providerId, projectId, and agentId",
      {
        module: MODULE,
        op: "upsert",
      }
    );
  }
}

function buildBotDefinition(input: {
  userId: string;
  input: UpsertBotDefinitionInput;
  existing: BotDefinition | null;
  resolved: ResolvedBotUpsert;
  now: number;
  createId: () => string;
}): BotDefinition {
  const { existing, resolved } = input;
  return {
    id: existing?.id ?? input.createId(),
    userId: input.userId,
    name: input.input.name.trim(),
    description: input.input.description?.trim() ?? existing?.description ?? "",
    objective: resolved.objective,
    prompt: resolved.prompt,
    workMode: resolved.workMode,
    promptStrategy: resolved.promptStrategy,
    ...(resolved.providerId ? { providerId: resolved.providerId } : {}),
    enabled: resolved.enabled,
    trigger:
      input.input.trigger ??
      existing?.trigger ??
      (resolved.isNewSchedule ? "quota_refresh" : "manual"),
    ...(resolved.agentId ? { agentId: resolved.agentId } : {}),
    ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
    ...(resolved.modelId ? { modelId: resolved.modelId } : {}),
    maxConcurrency: input.input.maxConcurrency ?? existing?.maxConcurrency ?? 1,
    ...(resolved.triggerConfig
      ? { triggerConfig: resolved.triggerConfig }
      : {}),
    execution: input.input.execution ??
      existing?.execution ?? { target: "new_session" },
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function mapSupervisorTerminalStatus(
  status: string
): "completed" | "stopped" | "failed" {
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "stopped";
  }
  return "failed";
}

function isActiveRun(run: BotRun): boolean {
  return (
    run.status === "queued" ||
    run.status === "quota_blocked" ||
    run.status === "running"
  );
}

function isPromptBusy(error: unknown): boolean {
  return isAppError(error) && error.code === "PROMPT_BUSY";
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveTextSample(message).slice(0, 1200);
}

function sanitizeScheduledEvidence(value: string, maxLength: number): string {
  return redactSensitiveTextSample(value).slice(0, maxLength);
}

function getQuotaConfig(bot: BotDefinition): BotQuotaTriggerConfig {
  return (
    bot.triggerConfig?.quota ?? {
      providerIds: [],
      windowIds: [],
      minPercentRemaining: DEFAULT_QUOTA_MIN_PERCENT_REMAINING,
      cooldownMs: DEFAULT_QUOTA_COOLDOWN_MS,
    }
  );
}

function getQuotaMinPercent(bot: BotDefinition): number {
  return getQuotaConfig(bot).minPercentRemaining;
}

function getQuotaCooldownMs(bot: BotDefinition): number {
  return getQuotaConfig(bot).cooldownMs;
}

function botMatchesQuotaWindow(
  bot: BotDefinition,
  window: BotQuotaAutomationWindow
): boolean {
  const config = getQuotaConfig(bot);
  return (
    (bot.providerId
      ? bot.providerId.toLowerCase() === window.providerId.toLowerCase()
      : matchesOptionalList(config.providerIds, window.providerId)) &&
    matchesOptionalList(config.windowIds, window.windowId)
  );
}

function matchesOptionalList(values: readonly string[], candidate: string) {
  if (values.length === 0) {
    return true;
  }
  const normalized = candidate.trim().toLowerCase();
  return values.some((value) => value.trim().toLowerCase() === normalized);
}

function hasAvailableQuota(
  window: QuotaWindowSnapshot,
  minPercentRemaining: number,
  minRemaining?: number
): boolean {
  if (window.unlimited) {
    return true;
  }
  if (
    minRemaining !== undefined &&
    (window.remaining === undefined || window.remaining < minRemaining)
  ) {
    return false;
  }
  if (window.percentRemaining !== undefined) {
    return window.percentRemaining >= minPercentRemaining;
  }
  if (window.remaining !== undefined) {
    return window.remaining > 0;
  }
  return minPercentRemaining <= 0;
}

function isSubscriptionAwareSchedule(bot: BotDefinition): boolean {
  return (
    bot.promptStrategy === "supervisor_dynamic" ||
    Boolean(bot.providerId?.trim())
  );
}

function resolveSingleLegacyProviderId(
  triggerConfig: BotDefinition["triggerConfig"]
): string | undefined {
  const providerIds = triggerConfig?.quota?.providerIds ?? [];
  return providerIds.length === 1 ? providerIds[0]?.trim() : undefined;
}

function hashScheduledPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function toScheduledPriorEvidence(run: BotRun): ScheduledWorkPriorEvidence {
  return {
    runId: run.id,
    status: run.status,
    completionState: run.completionState,
    ...(run.decision
      ? {
          supervisorAction: run.decision.action,
          rationale: run.decision.rationale,
          evidenceSummary: run.decision.evidenceSummary,
        }
      : {}),
    ...(run.promptHash ? { promptHash: run.promptHash } : {}),
    ...(run.chatId ? { chatId: run.chatId } : {}),
    ...(run.turnId ? { turnId: run.turnId } : {}),
    ...(run.supervisorRunId ? { supervisorRunId: run.supervisorRunId } : {}),
    ...(run.failureReason ? { failureReason: run.failureReason } : {}),
  };
}

function isCompatibleStoredBinding(
  stored: {
    projectId?: string;
    agentId?: string;
  },
  bot: BotDefinition
): boolean {
  return (
    (!bot.projectId || stored.projectId === bot.projectId) &&
    (!bot.agentId || stored.agentId === bot.agentId)
  );
}

function modelMatchesProvider(
  model: NonNullable<ChatSession["models"]>["availableModels"][number],
  providerId: string
): boolean {
  const providerTokens = providerAliases(providerId);
  const declaredProviders = [model.provider, ...(model.providers ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  if (declaredProviders.length > 0) {
    return declaredProviders.some((provider) =>
      providerTokens.some((token) =>
        normalizeProviderToken(provider).includes(token)
      )
    );
  }
  const normalizedModelId = normalizeProviderToken(model.modelId);
  return providerTokens.some((token) => normalizedModelId.includes(token));
}

function providerAliases(providerId: string): string[] {
  const normalized = normalizeProviderToken(providerId)
    .replace(/codingplan/g, "")
    .replace(/plan/g, "");
  if (normalized.includes("zai") || normalized.includes("zhipu")) {
    return ["zai", "zhipu", "glm"];
  }
  if (normalized.includes("minimax")) {
    return ["minimax"];
  }
  return normalized ? [normalized] : [];
}

function normalizeProviderToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isTerminalSupervisorStatus(status: string): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function findMatchingFreshWindow(
  provider: ProviderQuotaSnapshot | undefined,
  dueWindow: BotQuotaAutomationWindow
): QuotaWindowSnapshot | undefined {
  if (!provider) {
    return undefined;
  }
  return provider.windows.find(
    (window) =>
      window.id === dueWindow.windowId ||
      window.windowType === dueWindow.windowId
  );
}

function getCompletedRunStatus(
  stopReason: string | undefined
): BotRun["status"] {
  const normalized = stopReason?.toLowerCase() ?? "";
  if (normalized.includes("cancel") || normalized.includes("stop")) {
    return "stopped";
  }
  if (normalized.includes("error") || normalized.includes("fail")) {
    return "failed";
  }
  return "completed";
}

function quotaWindowStateKey(
  userId: string,
  providerId: string,
  windowId: string,
  resetAt: string
): string {
  return [userId, providerId, windowId, resetAt].join("|");
}

function quotaDispatchDedupeKey(params: {
  userId: string;
  botId: string;
  providerId: string;
  windowId: string;
  resetAt: string;
}): string {
  return [
    params.userId,
    params.botId,
    params.providerId,
    params.windowId,
    params.resetAt,
  ].join("|");
}

function quotaCooldownKey(
  userId: string,
  botId: string,
  providerId: string,
  windowId: string
): string {
  return [userId, botId, providerId, windowId].join("|");
}

function parseOptionalDateMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pruneQuotaAutomationState(
  state: BotQuotaAutomationState,
  nowMs: number
): void {
  for (const [key, window] of Object.entries(state.windows)) {
    const resetMs = Date.parse(window.resetAt);
    if (
      Number.isFinite(resetMs) &&
      nowMs - resetMs > STALE_QUOTA_WINDOW_RETENTION_MS
    ) {
      delete state.windows[key];
    }
  }
  for (const [key, dispatch] of Object.entries(state.dispatched)) {
    if (nowMs - dispatch.dispatchedAt > STALE_QUOTA_DISPATCH_RETENTION_MS) {
      delete state.dispatched[key];
    }
  }
  for (const [key, lease] of Object.entries(state.providerLeases)) {
    if (lease.expiresAt <= nowMs) {
      delete state.providerLeases[key];
    }
  }
}
