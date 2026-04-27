import type * as acp from "@agentclientprotocol/sdk";
import type { SendMessageService } from "@/modules/ai";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { StoredMessage } from "@/modules/session/domain/stored-session.types";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  SupervisorDecisionSummary,
  SupervisorSessionState,
} from "@/shared/types/supervisor.types";
import { isBusyChatStatus } from "@/shared/utils/chat-events.util";
import { createId } from "@/shared/utils/id.util";
import type {
  SupervisorAutoResumeSignal,
  SupervisorDecisionPort,
  SupervisorTurnSnapshot,
} from "./ports/supervisor-decision.port";
import type {
  SupervisorMemoryContext,
  SupervisorMemoryPort,
} from "./ports/supervisor-memory.port";
import type { SupervisorResearchPort } from "./ports/supervisor-research.port";
import type { SupervisorPolicy } from "./supervisor-policy";
import { buildSupervisorFollowUpPrompt } from "./supervisor-prompt.builder";
import { normalizeSupervisorState } from "./supervisor-state.util";

const LATEST_ASSISTANT_LOOKBACK_LIMIT = 8;
const LATEST_ASSISTANT_CONTENT_FALLBACK_MAX_CHARS = 4000;
const RECENT_TOOL_CALL_SUMMARY_LIMIT = 6;
const LAST_ERROR_SUMMARY_MAX_CHARS = 1200;
const SUPERVISOR_RESEARCH_QUERY_MAX_CHARS = 400;
const SUPERVISOR_MEMORY_QUERY_MAX_CHARS = 400;
const WAITING_CONFIRMATION_RE =
  /\b(waiting|wait)\b.{0,80}\b(confirmation|approval|permission|your input)\b/;
const NEEDS_CONFIRMATION_RE =
  /\b(needs?|requires?)\b.{0,80}\b(confirmation|approval)\b/;
const SHOULD_PROCEED_RE =
  /\b(should|shall|can)\s+i\b.{0,120}\b(proceed|continue|move on|start next|go ahead)\b/;
const USER_WANTS_PROCEED_RE =
  /\b(would you like|do you want)\b.{0,120}\b(proceed|continue|move on|next)\b/;
const OPTION_QUESTION_RE =
  /\b(would you like me to|do you want me to|would you like to|do you want to)\s*:/i;
const LINE_SPLIT_RE = /\r?\n/;
const OPTION_BULLET_RE = /^\s*[-*]\s+(.+?)\s*$/;
const PHASE_COMPLETE_RE =
  /\b(finished|completed|done with|wrapped up)\b.{0,80}\b(phase|step|stage|part|milestone)\b/;
const PHASE_NUMBER_COMPLETE_RE =
  /\bphase\s+\d+\b.{0,80}\b(finished|completed|done)\b/;
const UNSAFE_OPTION_RE =
  /\b(commit|push|deploy|release|publish|delete|remove|drop|credential|secret|token|api key)\b/i;
const PRODUCTIVE_OPTION_RE =
  /\b(improve|refine|polish|fix|continue|next|other components?|more components?|component)\b/i;
const VERIFY_OPTION_RE = /\b(run|verify|test|lint|check|visual|preview|app)\b/i;
const TOOL_ERROR_STATES = new Set(["output-error"]);
const TOOL_TYPE_PREFIX_RE = /^tool-/u;

export interface SupervisorTurnCompleteEvent {
  chatId: string;
  userId: string;
  turnId?: string;
  stopReason: string;
  source: "client" | "supervisor";
}

interface SupervisorJob {
  turnId?: string;
  promise: Promise<void>;
}

export class SupervisorLoopService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sendMessage: SendMessageService;
  private readonly decisionPort: SupervisorDecisionPort;
  private readonly researchPort: SupervisorResearchPort;
  private readonly memoryPort: SupervisorMemoryPort;
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly jobs = new Map<string, SupervisorJob>();
  private readonly scheduledTurns = new Set<string>();

  constructor(deps: {
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
    sendMessage: SendMessageService;
    decisionPort: SupervisorDecisionPort;
    researchPort: SupervisorResearchPort;
    memoryPort: SupervisorMemoryPort;
    policy: SupervisorPolicy;
    logger: LoggerPort;
    clock: ClockPort;
  }) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.sendMessage = deps.sendMessage;
    this.decisionPort = deps.decisionPort;
    this.researchPort = deps.researchPort;
    this.memoryPort = deps.memoryPort;
    this.policy = deps.policy;
    this.logger = deps.logger;
    this.clock = deps.clock;
  }

  scheduleReview(event: SupervisorTurnCompleteEvent): void {
    this.logger.info("Supervisor review schedule requested", {
      chatId: event.chatId,
      turnId: event.turnId ?? null,
      stopReason: event.stopReason,
      source: event.source,
    });
    const turnKey = event.turnId ? `${event.chatId}:${event.turnId}` : "";
    if (turnKey && this.scheduledTurns.has(turnKey)) {
      this.logger.info("Supervisor review schedule skipped: duplicate turn", {
        chatId: event.chatId,
        turnId: event.turnId,
      });
      return;
    }
    const existing = this.jobs.get(event.chatId);
    if (existing) {
      this.logger.info(
        "Supervisor review schedule skipped: job already active",
        {
          chatId: event.chatId,
          requestedTurnId: event.turnId ?? null,
          activeTurnId: existing.turnId ?? null,
        }
      );
      return;
    }

    if (turnKey) {
      this.scheduledTurns.add(turnKey);
    }
    const promise = this.runReview(event).finally(() => {
      const current = this.jobs.get(event.chatId);
      if (current?.promise === promise) {
        this.jobs.delete(event.chatId);
      }
      if (turnKey) {
        this.scheduledTurns.delete(turnKey);
      }
    });
    this.jobs.set(event.chatId, { turnId: event.turnId, promise });
    promise.catch((error) => {
      this.logger.warn("Supervisor review job failed", {
        chatId: event.chatId,
        turnId: event.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async runReview(event: SupervisorTurnCompleteEvent): Promise<void> {
    this.logger.info("Supervisor review starting", {
      chatId: event.chatId,
      turnId: event.turnId ?? null,
      stopReason: event.stopReason,
      source: event.source,
    });
    const ready = await this.prepareReview(event);
    if (!ready) {
      this.logger.info("Supervisor review not ready", {
        chatId: event.chatId,
        turnId: event.turnId ?? null,
      });
      return;
    }

    await this.updateSupervisorState({
      chatId: event.chatId,
      userId: event.userId,
      patch: {
        status: "reviewing",
        reason: "Reviewing completed ACP turn",
        lastTurnId: event.turnId,
      },
    });

    try {
      const snapshot = await this.buildSnapshot(event);
      const optionDecision = createOptionQuestionDecision(
        snapshot.latestAssistantTextPart
      );
      if (optionDecision) {
        this.logger.info("Supervisor deterministic option decision selected", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          action: optionDecision.action,
          followUpPromptLength: optionDecision.followUpPrompt?.length ?? 0,
        });
      }
      const decision =
        optionDecision ?? (await this.decisionPort.decideTurn(snapshot));
      await this.applyDecision(event, decision, snapshot);
    } catch (error) {
      this.logger.warn("Supervisor review failed", {
        chatId: event.chatId,
        turnId: event.turnId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.updateSupervisorState({
        chatId: event.chatId,
        userId: event.userId,
        patch: {
          status: "error",
          reason:
            error instanceof Error ? error.message : "Supervisor review failed",
        },
      });
    }
  }

  private async prepareReview(
    event: SupervisorTurnCompleteEvent
  ): Promise<boolean> {
    let shouldRun = false;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Guard clauses stay local so each skip reason logs exact supervisor state.
    await this.sessionRuntime.runExclusive(event.chatId, async () => {
      const session = this.sessionRuntime.get(event.chatId);
      if (!session || session.userId !== event.userId) {
        this.logger.info(
          "Supervisor review skipped: session missing or user mismatch",
          {
            chatId: event.chatId,
            turnId: event.turnId ?? null,
            hasSession: Boolean(session),
          }
        );
        return;
      }

      const supervisor = normalizeSupervisorState(session.supervisor);
      if (supervisor.mode !== "full_autopilot") {
        this.logger.info("Supervisor review skipped: mode is not autopilot", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          mode: supervisor.mode,
        });
        return;
      }
      if (!this.policy.enabled) {
        this.logger.info("Supervisor review skipped: disabled by policy", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
        });
        session.supervisor = {
          ...supervisor,
          status: "disabled",
          reason: "Supervisor disabled by configuration",
          updatedAt: this.clock.nowMs(),
        };
        await this.persistAndBroadcastState(event.chatId, event.userId);
        return;
      }
      if (this.policy.model.trim().length === 0) {
        this.logger.warn("Supervisor review skipped: model is not configured", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
        });
        session.supervisor = {
          ...supervisor,
          status: "error",
          reason: "SUPERVISOR_MODEL is required",
          updatedAt: this.clock.nowMs(),
        };
        await this.persistAndBroadcastState(event.chatId, event.userId);
        return;
      }
      if (
        session.activeTurnId ||
        session.activePromptTask ||
        session.pendingPermissions.size > 0 ||
        isBusyChatStatus(session.chatStatus)
      ) {
        this.logger.info("Supervisor review skipped: session is busy", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          activeTurnId: session.activeTurnId ?? null,
          activePromptTurnId: session.activePromptTask?.turnId ?? null,
          pendingPermissionCount: session.pendingPermissions.size,
          chatStatus: session.chatStatus,
        });
        return;
      }
      if (event.stopReason === "cancelled") {
        this.logger.info("Supervisor review aborted: prompt was cancelled", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
        });
        session.supervisor = {
          ...supervisor,
          status: "aborted",
          reason: "Prompt turn was cancelled",
          updatedAt: this.clock.nowMs(),
        };
        await this.persistAndBroadcastState(event.chatId, event.userId);
        return;
      }

      const now = this.clock.nowMs();
      const resetRun =
        event.source !== "supervisor" ||
        !supervisor.runStartedAt ||
        supervisor.status === "done" ||
        supervisor.status === "aborted" ||
        supervisor.status === "needs_user" ||
        supervisor.status === "error";
      const runStartedAt = resetRun ? now : (supervisor.runStartedAt ?? now);
      const continuationCount = resetRun
        ? 0
        : (supervisor.continuationCount ?? 0);
      if (now - runStartedAt > this.policy.maxRuntimeMs) {
        this.logger.warn("Supervisor review aborted: max runtime exceeded", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          runStartedAt,
          maxRuntimeMs: this.policy.maxRuntimeMs,
        });
        session.supervisor = {
          ...supervisor,
          status: "aborted",
          reason: "Supervisor max runtime exceeded",
          runStartedAt,
          continuationCount,
          updatedAt: now,
        };
        await this.persistAndBroadcastState(event.chatId, event.userId);
        return;
      }

      session.supervisor = {
        ...supervisor,
        status: "queued",
        reason: "Queued supervisor review",
        runId: resetRun ? createId("sup") : supervisor.runId,
        runStartedAt,
        continuationCount,
        lastTurnId: event.turnId,
        updatedAt: now,
      };
      await this.persistAndBroadcastState(event.chatId, event.userId);
      this.logger.info("Supervisor review queued", {
        chatId: event.chatId,
        turnId: event.turnId ?? null,
        runId: session.supervisor.runId ?? null,
        continuationCount,
      });
      shouldRun = true;
    });
    return shouldRun;
  }

  private async buildSnapshot(
    event: SupervisorTurnCompleteEvent
  ): Promise<SupervisorTurnSnapshot> {
    const firstPage = await this.sessionRepo.getMessagesPage(
      event.chatId,
      event.userId,
      {
        direction: "forward",
        limit: 1,
        includeCompacted: true,
      }
    );
    const latestPage = await this.sessionRepo.getMessagesPage(
      event.chatId,
      event.userId,
      {
        direction: "backward",
        limit: LATEST_ASSISTANT_LOOKBACK_LIMIT,
        includeCompacted: true,
      }
    );
    const latestMessages = latestPage.messages;
    const latestAssistantTextPart = getLatestAssistantTextPart(latestMessages);
    const autoResumeSignal = detectAutoResumeSignal(latestAssistantTextPart);
    const taskGoal =
      firstPage.messages.find((message) => message.role === "user")?.content ??
      latestMessages.find((message) => message.role === "user")?.content ??
      "";
    const session = this.sessionRuntime.get(event.chatId);
    const projectRoot = session?.projectRoot ?? "";
    const toolContext = buildRecentToolContext(
      latestMessages,
      session?.toolCalls
    );
    const supervisor = normalizeSupervisorState(session?.supervisor);
    const [researchResults, memoryContext] = await Promise.all([
      this.runOptionalResearch({
        taskGoal,
        latestAssistantTextPart,
      }),
      this.runOptionalMemory({
        chatId: event.chatId,
        projectRoot,
        taskGoal,
        latestAssistantTextPart,
      }),
    ]);
    this.logger.info("Supervisor snapshot built", {
      chatId: event.chatId,
      latestAssistantTextPartLength: latestAssistantTextPart.length,
      autoResumeSignal: autoResumeSignal ?? null,
      recentToolCount: toolContext.summary?.lastNToolNames.length ?? 0,
      consecutiveToolFailures: toolContext.summary?.consecutiveFailures ?? 0,
      hasLastErrorSummary: Boolean(toolContext.lastErrorSummary),
      memoryResultCount: memoryContext.results.length,
      hasProjectBlueprint: Boolean(memoryContext.projectBlueprint),
      researchResultCount: researchResults.length,
    });
    return {
      chatId: event.chatId,
      projectRoot,
      stopReason: event.stopReason,
      taskGoal,
      latestAssistantTextPart,
      ...(autoResumeSignal ? { autoResumeSignal } : {}),
      ...(toolContext.summary
        ? { recentToolCallSummary: toolContext.summary }
        : {}),
      ...(toolContext.lastErrorSummary
        ? { lastErrorSummary: toolContext.lastErrorSummary }
        : {}),
      ...(memoryContext.projectBlueprint
        ? { projectBlueprint: memoryContext.projectBlueprint }
        : {}),
      memoryResults: memoryContext.results,
      ...(session?.plan ? { plan: session.plan } : {}),
      supervisor,
      researchResults,
    };
  }

  private async runOptionalResearch(input: {
    taskGoal: string;
    latestAssistantTextPart: string;
  }) {
    if (this.policy.webSearchProvider === "none") {
      this.logger.info("Supervisor Exa search skipped: provider disabled");
      return [];
    }
    const haystack = `${input.taskGoal}\n${input.latestAssistantTextPart}`;
    if (!shouldResearch(haystack)) {
      this.logger.info("Supervisor Exa search skipped: no search signal", {
        haystackLength: haystack.length,
      });
      return [];
    }
    const query = haystack
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SUPERVISOR_RESEARCH_QUERY_MAX_CHARS);
    return await this.researchPort.search(query);
  }

  private async runOptionalMemory(input: {
    chatId: string;
    projectRoot: string;
    taskGoal: string;
    latestAssistantTextPart: string;
  }): Promise<SupervisorMemoryContext> {
    if (this.policy.memoryProvider === "none") {
      this.logger.info("Supervisor memory lookup skipped: provider disabled", {
        chatId: input.chatId,
      });
      return { results: [] };
    }
    const haystack = `${input.taskGoal}\n${input.latestAssistantTextPart}`;
    const query = haystack
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SUPERVISOR_MEMORY_QUERY_MAX_CHARS);
    return await this.memoryPort.lookup({
      query,
      chatId: input.chatId,
      projectRoot: input.projectRoot,
    });
  }

  private async applyDecision(
    event: SupervisorTurnCompleteEvent,
    decision: SupervisorDecisionSummary,
    snapshot: SupervisorTurnSnapshot
  ): Promise<void> {
    this.logger.info("Supervisor decision applying", {
      chatId: event.chatId,
      turnId: event.turnId ?? null,
      action: decision.action,
      followUpPromptLength: decision.followUpPrompt?.length ?? 0,
      latestAssistantTextPartLength: snapshot.latestAssistantTextPart.length,
      autoResumeSignal: snapshot.autoResumeSignal ?? null,
    });
    await this.updateSupervisorState({
      chatId: event.chatId,
      userId: event.userId,
      patch: {
        lastDecision: decision,
        reason: decision.reason,
      },
      broadcastDecision: decision,
      turnId: event.turnId,
    });
    await this.appendSupervisorLog(event, decision, snapshot);

    if (decision.action === "done") {
      await this.updateSupervisorState({
        chatId: event.chatId,
        userId: event.userId,
        patch: {
          status: "done",
          reason: decision.reason,
        },
      });
      return;
    }
    if (decision.action === "needs_user") {
      await this.updateSupervisorState({
        chatId: event.chatId,
        userId: event.userId,
        patch: {
          status: "needs_user",
          reason: decision.reason,
        },
      });
      return;
    }
    if (decision.action === "abort") {
      await this.updateSupervisorState({
        chatId: event.chatId,
        userId: event.userId,
        patch: {
          status: "aborted",
          reason: decision.reason,
        },
      });
      return;
    }

    const followUpPrompt = decision.followUpPrompt?.trim();
    if (!followUpPrompt) {
      await this.updateSupervisorState({
        chatId: event.chatId,
        userId: event.userId,
        patch: {
          status: "aborted",
          reason: "Supervisor continue decision did not include a prompt",
        },
      });
      return;
    }

    const state = normalizeSupervisorState(
      this.sessionRuntime.get(event.chatId)?.supervisor
    );
    const nextContinuationCount = (state.continuationCount ?? 0) + 1;
    if (nextContinuationCount > this.policy.maxRepeatedPrompts) {
      await this.updateSupervisorState({
        chatId: event.chatId,
        userId: event.userId,
        patch: {
          status: "aborted",
          reason: "Supervisor repeated prompt limit exceeded",
          continuationCount: nextContinuationCount,
        },
      });
      return;
    }

    await this.updateSupervisorState({
      chatId: event.chatId,
      userId: event.userId,
      patch: {
        status: "continuing",
        reason: decision.reason,
        continuationCount: nextContinuationCount,
      },
    });

    const guardedFollowUpPrompt = buildSupervisorFollowUpPrompt({
      followUpPrompt,
      ...(snapshot.projectBlueprint
        ? { projectBlueprint: snapshot.projectBlueprint }
        : {}),
      memoryResults: snapshot.memoryResults,
    });

    await this.sendMessage.execute({
      userId: event.userId,
      chatId: event.chatId,
      text: guardedFollowUpPrompt,
      source: "supervisor",
      textAnnotations: {
        source: "supervisor",
        reason: decision.reason,
        action: decision.action,
        continuationCount: nextContinuationCount,
      },
    });
    this.logger.info("Supervisor follow-up prompt sent", {
      chatId: event.chatId,
      previousTurnId: event.turnId ?? null,
      continuationCount: nextContinuationCount,
      followUpPromptLength: guardedFollowUpPrompt.length,
    });
  }

  private async appendSupervisorLog(
    event: SupervisorTurnCompleteEvent,
    decision: SupervisorDecisionSummary,
    snapshot: SupervisorTurnSnapshot
  ): Promise<void> {
    try {
      const state = normalizeSupervisorState(
        this.sessionRuntime.get(event.chatId)?.supervisor
      );
      await this.memoryPort.appendLog({
        chatId: event.chatId,
        projectRoot: snapshot.projectRoot,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        action: decision.action,
        reason: decision.reason,
        ...(snapshot.autoResumeSignal
          ? { autoResumeSignal: snapshot.autoResumeSignal }
          : {}),
        ...(typeof state.continuationCount === "number"
          ? { continuationCount: state.continuationCount }
          : {}),
        latestAssistantTextPart: snapshot.latestAssistantTextPart,
      });
    } catch (error) {
      this.logger.warn("Supervisor memory log failed", {
        chatId: event.chatId,
        turnId: event.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateSupervisorState(params: {
    chatId: string;
    userId: string;
    patch: Partial<SupervisorSessionState>;
    broadcastDecision?: SupervisorDecisionSummary;
    turnId?: string;
  }): Promise<void> {
    await this.sessionRuntime.runExclusive(params.chatId, async () => {
      const session = this.sessionRuntime.get(params.chatId);
      if (!session || session.userId !== params.userId) {
        return;
      }
      const current = normalizeSupervisorState(session.supervisor);
      session.supervisor = {
        ...current,
        ...params.patch,
        mode: current.mode,
        updatedAt: this.clock.nowMs(),
      };
      await this.persistAndBroadcastState(params.chatId, params.userId);
      if (params.broadcastDecision) {
        await this.sessionRuntime.broadcast(params.chatId, {
          type: "supervisor_decision",
          decision: params.broadcastDecision,
          supervisor: session.supervisor,
          turnId: params.turnId,
        });
      }
    });
  }

  private async persistAndBroadcastState(
    chatId: string,
    userId: string
  ): Promise<void> {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.supervisor) {
      return;
    }
    await this.sessionRepo.updateMetadata(chatId, userId, {
      supervisor: session.supervisor,
    });
    await this.sessionRuntime.broadcast(chatId, {
      type: "supervisor_status",
      supervisor: session.supervisor,
    });
  }
}

function shouldResearch(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "latest",
    "current",
    "today",
    "recent",
    "search",
    "web",
    "documentation",
    "docs",
    "release",
    "version",
  ].some((needle) => normalized.includes(needle));
}

interface ToolObservation {
  id: string;
  name: string;
  failed: boolean;
  errorSummary?: string;
}

export function buildRecentToolContext(
  messages: StoredMessage[],
  runtimeToolCalls?: Map<string, acp.ToolCall>
): {
  summary?: SupervisorTurnSnapshot["recentToolCallSummary"];
  lastErrorSummary?: string;
} {
  const observations = new Map<string, ToolObservation>();
  for (const message of messages) {
    collectStoredMessageToolObservations(message, observations);
  }
  if (runtimeToolCalls) {
    for (const toolCall of runtimeToolCalls.values()) {
      const observation = createRuntimeToolObservation(toolCall);
      if (observation) {
        observations.set(observation.id, observation);
      }
    }
  }

  const recent = [...observations.values()].slice(
    -RECENT_TOOL_CALL_SUMMARY_LIMIT
  );
  if (recent.length === 0) {
    return {};
  }
  const lastErrorSummary = findLastErrorSummary(recent);

  return {
    summary: {
      lastNToolNames: recent.map((tool) => tool.name),
      consecutiveFailures: countConsecutiveFailures(recent),
    },
    ...(lastErrorSummary ? { lastErrorSummary } : {}),
  };
}

function collectStoredMessageToolObservations(
  message: StoredMessage,
  observations: Map<string, ToolObservation>
): void {
  for (const toolCall of message.toolCalls ?? []) {
    const name = normalizeToolName(toolCall.name);
    observations.set(`${message.id}:tool-call:${observations.size}`, {
      id: `${message.id}:tool-call:${observations.size}`,
      name,
      failed: false,
    });
  }
  for (const part of message.parts ?? []) {
    if (!isToolLikePart(part)) {
      continue;
    }
    const id =
      part.toolCallId || `${message.id}:tool-part:${observations.size}`;
    const name = normalizeToolName(
      part.title ?? part.type.replace(TOOL_TYPE_PREFIX_RE, "")
    );
    const errorSummary =
      typeof part.errorText === "string"
        ? truncateStart(part.errorText, LAST_ERROR_SUMMARY_MAX_CHARS)
        : undefined;
    observations.set(id, {
      id,
      name,
      failed: TOOL_ERROR_STATES.has(part.state ?? ""),
      ...(errorSummary ? { errorSummary } : {}),
    });
  }
}

function createRuntimeToolObservation(
  toolCall: acp.ToolCall
): ToolObservation | null {
  if (!toolCall.toolCallId) {
    return null;
  }
  const errorSummary =
    toolCall.status === "failed"
      ? truncateStart(
          stringifyCompact(toolCall.rawOutput),
          LAST_ERROR_SUMMARY_MAX_CHARS
        )
      : "";
  return {
    id: toolCall.toolCallId,
    name: normalizeToolName(toolCall.kind ?? toolCall.title ?? "tool"),
    failed: toolCall.status === "failed",
    ...(errorSummary ? { errorSummary } : {}),
  };
}

function isToolLikePart(part: unknown): part is {
  type: `tool-${string}`;
  toolCallId?: string;
  title?: string;
  state?: string;
  errorText?: string;
} {
  if (!part || typeof part !== "object") {
    return false;
  }
  const record = part as Record<string, unknown>;
  return typeof record.type === "string" && record.type.startsWith("tool-");
}

function countConsecutiveFailures(observations: ToolObservation[]): number {
  let count = 0;
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (!observations[index]?.failed) {
      break;
    }
    count += 1;
  }
  return count;
}

function findLastErrorSummary(
  observations: ToolObservation[]
): string | undefined {
  return observations
    .slice()
    .reverse()
    .find((tool) => tool.failed && tool.errorSummary)?.errorSummary;
}

function normalizeToolName(value: string): string {
  return value.replace(/\s+/g, " ").trim() || "tool";
}

function stringifyCompact(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateStart(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated]`;
}

export function getLatestAssistantTextPart(messages: StoredMessage[]): string {
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!latestAssistant) {
    return "";
  }
  if (latestAssistant.parts) {
    for (let index = latestAssistant.parts.length - 1; index >= 0; index -= 1) {
      const part = latestAssistant.parts[index];
      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  return tailText(
    latestAssistant.content ?? "",
    LATEST_ASSISTANT_CONTENT_FALLBACK_MAX_CHARS
  );
}

export function detectAutoResumeSignal(
  text: string
): SupervisorAutoResumeSignal | undefined {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (extractAssistantChoiceOptions(text).length > 0) {
    return "option_selection_needed";
  }
  if (
    WAITING_CONFIRMATION_RE.test(normalized) ||
    NEEDS_CONFIRMATION_RE.test(normalized)
  ) {
    return "confirmation_needed";
  }
  if (
    SHOULD_PROCEED_RE.test(normalized) ||
    USER_WANTS_PROCEED_RE.test(normalized)
  ) {
    return "confirmation_needed";
  }
  if (
    PHASE_COMPLETE_RE.test(normalized) ||
    PHASE_NUMBER_COMPLETE_RE.test(normalized)
  ) {
    return "phase_complete";
  }
  return undefined;
}

export function createOptionQuestionDecision(
  text: string
): SupervisorDecisionSummary | null {
  const options = extractAssistantChoiceOptions(text);
  const selected = selectAutopilotOption(options);
  if (!selected) {
    return null;
  }
  return {
    action: "continue",
    reason:
      "Agent asked the user to choose from listed options; autopilot selected a safe continuation option.",
    followUpPrompt: [
      `Select this option and continue: ${selected}`,
      "Keep the work scoped to the original request and existing repository conventions.",
      "Do not commit, push, deploy, or perform destructive actions unless the human explicitly requested them.",
    ].join("\n"),
  };
}

export function extractAssistantChoiceOptions(text: string): string[] {
  const anchor = findLastOptionQuestionAnchor(text);
  if (anchor < 0) {
    return [];
  }

  const lines = text.slice(anchor).split(LINE_SPLIT_RE);
  const options: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const match = OPTION_BULLET_RE.exec(line);
    if (match?.[1]) {
      collecting = true;
      options.push(normalizeOptionText(match[1]));
      continue;
    }
    if (collecting && line.trim().length > 0) {
      break;
    }
  }

  return options.filter(Boolean).slice(0, 8);
}

function findLastOptionQuestionAnchor(text: string): number {
  const matches = [...text.matchAll(new RegExp(OPTION_QUESTION_RE, "gi"))];
  return matches.at(-1)?.index ?? -1;
}

function normalizeOptionText(option: string): string {
  return option.replace(/\s+/g, " ").trim();
}

function tailText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(value.length - maxChars);
}

function selectAutopilotOption(options: string[]): string | undefined {
  const safeOptions = options.filter(
    (option) => !UNSAFE_OPTION_RE.test(option)
  );
  if (safeOptions.length === 0) {
    return undefined;
  }
  return (
    safeOptions.find((option) => PRODUCTIVE_OPTION_RE.test(option)) ??
    safeOptions.find((option) => VERIFY_OPTION_RE.test(option)) ??
    safeOptions[0]
  );
}
