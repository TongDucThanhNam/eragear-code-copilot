import { randomUUID } from "node:crypto";
import {
  isAppError,
  NotFoundError,
  ValidationError,
} from "#runtime/shared/errors";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { ChatSession } from "#runtime/shared/types/session.types";
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

interface BotMessageSender {
  execute(input: {
    userId: string;
    chatId: string;
    text: string;
    source: "automation";
  }): Promise<{ turnId: string }>;
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

interface BotsServiceDeps {
  repository: BotRepositoryPort;
  createSession?: BotSessionCreator;
  sendMessage?: BotMessageSender;
  quotaProvider?: BotQuotaProvider;
  logger?: LoggerPort;
  now?: () => number;
  createId?: () => string;
}

export class BotsService {
  private readonly repository: BotRepositoryPort;
  private readonly createSession?: BotSessionCreator;
  private readonly sendMessage?: BotMessageSender;
  private readonly quotaProvider?: BotQuotaProvider;
  private readonly logger?: LoggerPort;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(deps: BotsServiceDeps) {
    this.repository = deps.repository;
    this.createSession = deps.createSession;
    this.sendMessage = deps.sendMessage;
    this.quotaProvider = deps.quotaProvider;
    this.logger = deps.logger;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
  }

  async list(userId: string): Promise<BotSystemStatus> {
    const [bots, runs] = await Promise.all([
      this.repository.listBots(userId),
      this.repository.listRuns(userId),
    ]);
    return {
      bots: bots.sort((left, right) => right.updatedAt - left.updatedAt),
      runs: runs.sort((left, right) => right.queuedAt - left.queuedAt),
    };
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

    const agentId = input.agentId ?? existing?.agentId;
    const projectId = input.projectId ?? existing?.projectId;
    const triggerConfig = input.triggerConfig ?? existing?.triggerConfig;
    const bot: BotDefinition = {
      id: existing?.id ?? this.createId(),
      userId,
      name: input.name.trim(),
      description: input.description?.trim() ?? existing?.description ?? "",
      prompt: input.prompt.trim(),
      enabled: input.enabled ?? existing?.enabled ?? true,
      trigger: input.trigger ?? existing?.trigger ?? "manual",
      ...(agentId ? { agentId } : {}),
      ...(projectId ? { projectId } : {}),
      maxConcurrency: input.maxConcurrency ?? existing?.maxConcurrency ?? 1,
      ...(triggerConfig ? { triggerConfig } : {}),
      execution: input.execution ??
        existing?.execution ?? { target: "new_session" },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return await this.repository.saveBot(bot);
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
    await this.repository.deleteBot(userId, botId);
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
    return await this.repository.saveRun({
      ...run,
      status: "stopped",
      stoppedAt: this.now(),
      nextAttemptAt: undefined,
    });
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
    if (run.status !== "queued") {
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
          run.status !== "queued" ||
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
    await Promise.all(
      runs
        .filter(
          (run) =>
            run.status === "running" &&
            run.chatId === input.chatId &&
            run.turnId === input.turnId
        )
        .map((run) =>
          this.repository.saveRun({
            ...run,
            status,
            completedAt: this.now(),
            stoppedAt: status === "stopped" ? this.now() : run.stoppedAt,
            error: status === "failed" ? input.stopReason : undefined,
          })
        )
    );
  }

  async stopRunsForSession(input: StopBotRunsForSessionInput): Promise<void> {
    const runs = await this.repository.listRuns(input.userId);
    await Promise.all(
      runs
        .filter(
          (run) => run.status === "running" && run.chatId === input.chatId
        )
        .map((run) =>
          this.repository.saveRun({
            ...run,
            status: "stopped",
            stoppedAt: this.now(),
            error: input.stopReason,
          })
        )
    );
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
          nextCheckAt: resetMs,
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
          userIds.includes(window.userId) &&
          Date.parse(window.resetAt) <= nowMs &&
          window.nextCheckAt <= nowMs
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
        if (!hasAvailableQuota(freshWindow, getQuotaMinPercent(bot))) {
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
      context: context ?? {},
      ...(options.triggerContext
        ? { triggerContext: options.triggerContext }
        : {}),
      ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
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
      error,
    });
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

function isActiveRun(run: BotRun): boolean {
  return run.status === "queued" || run.status === "running";
}

function isPromptBusy(error: unknown): boolean {
  return isAppError(error) && error.code === "PROMPT_BUSY";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    matchesOptionalList(config.providerIds, window.providerId) &&
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
  minPercentRemaining: number
): boolean {
  if (window.unlimited) {
    return true;
  }
  if (window.percentRemaining !== undefined) {
    return window.percentRemaining >= minPercentRemaining;
  }
  if (window.remaining !== undefined) {
    return window.remaining > 0;
  }
  return minPercentRemaining <= 0;
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
}
