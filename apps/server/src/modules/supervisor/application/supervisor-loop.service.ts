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
  SupervisorSemanticDecision,
  SupervisorSessionState,
} from "@/shared/types/supervisor.types";
import { mapSemanticToRuntime } from "@/shared/types/supervisor.types";
import { isBusyChatStatus } from "@/shared/utils/chat-events.util";
import { createId } from "@/shared/utils/id.util";
import type {
  SupervisorAutoResumeSignal,
  SupervisorDecisionPort,
  SupervisorTurnSnapshot,
} from "./ports/supervisor-decision.port";
import type {
  SupervisorAuditPort,
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
const USER_INSTRUCTION_PAGE_LIMIT = 200;
const MAX_USER_INSTRUCTION_CHARS = 2000;
const MAX_USER_INSTRUCTION_MESSAGES = 50;
const WAITING_CONFIRMATION_RE =
  /\b(waiting|wait)\b.{0,80}\b(confirmation|approval|permission|your input)\b/;
const NEEDS_CONFIRMATION_RE =
  /\b(needs?|requires?)\b.{0,80}\b(confirmation|approval)\b/;
const SHOULD_PROCEED_RE =
  /\b(should|shall|can)\s+i\b.{0,120}\b(proceed|continue|move on|start next|go ahead)\b/;
const USER_WANTS_PROCEED_RE =
  /\b(would you like|do you want)\b.{0,120}\b(proceed|continue|move on|next)\b/;
const OPTION_QUESTION_RE =
  /\b(would you like me to|do you want me to|would you like to|do you want to|which would you like|pick one|choose one)\s*:|(?:bạn|ban)\s+(?:chọn|chon|muốn|muon)|(?:chọn|chon)\s+(?:hướng|huong|option)|(?:lựa|lua)\s+(?:chọn|chon)\b|(?:phương|phuong)\s+(?:án|an)\s*:|\bpreference\b/i;
const OPTION_LETTER_RE = /\b([A-Z])[).]\s*(.+?)(?=\s+[A-Z][).]|$)/gi;
const LINE_SPLIT_RE = /\r?\n/;
const OPTION_BULLET_RE = /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/;
const TABLE_CELL_SEPARATOR_RE = /^[\s\-:|]+$/;
const PHASE_COMPLETE_RE =
  /\b(finished|completed|done with|wrapped up)\b.{0,80}\b(phase|step|stage|part|milestone)\b/;
const PHASE_NUMBER_COMPLETE_RE =
  /\bphase\s+\d+\b.{0,80}\b(finished|completed|done)\b/;
const UNSAFE_OPTION_RE =
  /\b(commit|push|deploy|release|publish|delete|remove|drop|credential|secret|token|api key)\b/i;
const RECOMMENDED_OPTION_RE = /\b(recommended|khuyến nghị|khuyen nghi)\b/i;
const PRODUCTIVE_OPTION_RE =
  /\b(improve|refine|polish|fix|continue|next|reports?|data-heavy|tables?|kpi|empty states?|other components?|more components?|component)\b/i;
const VERIFY_OPTION_RE = /\b(run|verify|test|lint|check|visual|preview|app)\b/i;
const OBSIDIAN_CONTEXT_RE =
  /\b(obsidian|vault|note|ba doc|business[- ]analyst)\b/i;
const LOCAL_CONTEXT_BLOCKED_RE =
  /\b(blocked|unable to find|cannot access|can't access|not available|missing|bị chặn|bi chan|không tìm thấy|khong tim thay|không truy cập|khong truy cap|không khả dụng|khong kha dung)\b/i;
const TOOL_ERROR_STATES = new Set(["output-error"]);
const TOOL_TYPE_PREFIX_RE = /^tool-/u;
const LOOP_DETECTION_MAX_IDENTICAL = 2; // Same decision 3 times in a row (counter >= 2)
const LOOP_DETECTION_PLAN_DELTA_IDENTICAL = 1; // Same decision + same plan 2 times (counter >= 1)
const DECISION_HISTORY_MAX_LENGTH = 5;
const FINGERPRINT_MAX_LENGTH = 256;

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
  private readonly auditPort: SupervisorAuditPort;
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
    auditPort: SupervisorAuditPort;
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
    this.auditPort = deps.auditPort;
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
      // R6 — Classifier pipeline (strict priority order: option/gate → memory → correct → done → LLM)
      let decision: SupervisorSemanticDecision | null = null;

      // R2 — Option/Gate classifier
      const optionDecision = createOptionQuestionDecision(snapshot);
      if (optionDecision) {
        decision = optionDecision;
        this.logger.info("Supervisor deterministic option decision selected", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          semanticAction: optionDecision.semanticAction,
          followUpPromptLength: optionDecision.followUpPrompt?.length ?? 0,
        });
      }

      // R3 — Memory recovery classifier
      if (!decision) {
        const memoryRecoveryDecision = createMemoryRecoveryDecision(snapshot);
        if (memoryRecoveryDecision) {
          decision = memoryRecoveryDecision;
          this.logger.info("Supervisor memory recovery decision selected", {
            chatId: event.chatId,
            turnId: event.turnId ?? null,
            semanticAction: memoryRecoveryDecision.semanticAction,
            followUpPromptLength:
              memoryRecoveryDecision.followUpPrompt?.length ?? 0,
            memoryResultCount: snapshot.memoryResults.length,
            hasProjectBlueprint: Boolean(snapshot.projectBlueprint),
          });
        }
      }

      // R4 — Correct classifier
      if (!decision) {
        const correctDecision = createCorrectDecision(snapshot);
        if (correctDecision) {
          decision = correctDecision;
          this.logger.info("Supervisor correct decision selected", {
            chatId: event.chatId,
            turnId: event.turnId ?? null,
            semanticAction: correctDecision.semanticAction,
          });
        }
      }

      // R5 — Done verification classifier
      if (!decision) {
        const doneVerificationDecision =
          createDoneVerificationDecision(snapshot);
        if (doneVerificationDecision) {
          decision = doneVerificationDecision;
          this.logger.info("Supervisor done verification decision selected", {
            chatId: event.chatId,
            turnId: event.turnId ?? null,
            semanticAction: doneVerificationDecision.semanticAction,
          });
        }
      }

      // LLM fallback
      if (!decision) {
        decision = await this.decisionPort.decideTurn(snapshot);
        this.logger.info("Supervisor LLM fallback decision selected", {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          semanticAction: decision.semanticAction,
        });
      }

      // T06 — Loop detection: check if same decision is repeated without artifact delta
      decision = this.detectLoop(
        snapshot.supervisor,
        decision,
        snapshot,
        event
      );

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
    // Collect all user messages via forward pagination for the instruction timeline
    const allMessages: StoredMessage[] = [];
    let cursor: number | undefined;
    while (true) {
      const page = await this.sessionRepo.getMessagesPage(
        event.chatId,
        event.userId,
        {
          cursor,
          direction: "forward",
          limit: USER_INSTRUCTION_PAGE_LIMIT,
          includeCompacted: true,
        }
      );
      allMessages.push(...page.messages);
      if (!page.hasMore || page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

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

    // Collect user messages in chronological order
    const userInstructionTimeline = allMessages
      .filter((message) => message.role === "user")
      .map((message) =>
        truncateStart(message.content ?? "", MAX_USER_INSTRUCTION_CHARS)
      )
      .slice(0, MAX_USER_INSTRUCTION_MESSAGES);

    const originalTaskGoal = userInstructionTimeline[0] ?? "";
    const latestUserInstruction = userInstructionTimeline.at(-1) ?? "";
    // taskGoal (current scope) is derived from the latest user instruction
    const taskGoal = latestUserInstruction || originalTaskGoal;

    const session = this.sessionRuntime.get(event.chatId);
    const projectRoot = session?.projectRoot ?? "";
    const toolContext = buildRecentToolContext(
      latestMessages,
      session?.toolCalls
    );
    const supervisor = normalizeSupervisorState(session?.supervisor);
    const [researchResults, memoryContext] = await Promise.all([
      this.runOptionalResearch({
        latestUserInstruction,
        latestAssistantTextPart,
      }),
      this.runOptionalMemory({
        chatId: event.chatId,
        projectRoot,
        latestUserInstruction,
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
      userInstructionCount: userInstructionTimeline.length,
    });
    return {
      chatId: event.chatId,
      projectRoot,
      stopReason: event.stopReason,
      taskGoal,
      latestAssistantTextPart,
      originalTaskGoal,
      latestUserInstruction,
      userInstructionTimeline,
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
    latestUserInstruction: string;
    latestAssistantTextPart: string;
  }) {
    if (this.policy.webSearchProvider === "none") {
      this.logger.info("Supervisor Exa search skipped: provider disabled");
      return [];
    }
    const haystack = `${input.latestUserInstruction}\n${input.latestAssistantTextPart}`;
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

  /**
   * T06 — Loop detection: detect repeated identical decisions without artifact delta.
   * If the same fingerprint appears consecutively too many times, override to ESCALATE.
   * If fingerprint repeats AND plan snapshot is unchanged, escalate sooner.
   */
  private detectLoop(
    supervisor: SupervisorSessionState,
    decision: SupervisorSemanticDecision,
    snapshot: SupervisorTurnSnapshot,
    event: SupervisorTurnCompleteEvent
  ): SupervisorSemanticDecision {
    const fingerprint = computeDecisionFingerprint(decision);
    const planSnapshot = computePlanSnapshot(snapshot.plan);
    const lastFingerprint = supervisor.lastDecisionFingerprint;
    const lastPlan = supervisor.lastPlanSnapshot;
    const consecutiveCount = supervisor.consecutiveIdenticalDecisions ?? 0;

    const isSameDecision = fingerprint === lastFingerprint;

    if (!isSameDecision) {
      // Different decision — reset counter (state update happens in applyDecision)
      return decision;
    }

    // Same decision as last turn
    const newCount = consecutiveCount + 1;

    // Check plan delta: if plan snapshot is unchanged AND decision is identical
    const planUnchanged =
      planSnapshot !== undefined &&
      lastPlan !== undefined &&
      planSnapshot === lastPlan;

    if (planUnchanged && newCount >= LOOP_DETECTION_PLAN_DELTA_IDENTICAL) {
      this.logger.warn(
        "Supervisor loop detected: same decision repeated with no plan delta",
        {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          fingerprint,
          consecutiveIdenticalDecisions: newCount,
          planUnchanged: true,
          originalSemanticAction: decision.semanticAction,
        }
      );
      return {
        semanticAction: "ESCALATE",
        runtimeAction: mapSemanticToRuntime("ESCALATE"),
        reason: `Loop detected: same decision (${decision.semanticAction}) repeated without artifact delta (plan unchanged). Original reason: ${decision.reason}`,
      };
    }

    if (newCount >= LOOP_DETECTION_MAX_IDENTICAL) {
      this.logger.warn(
        "Supervisor loop detected: same decision repeated consecutively",
        {
          chatId: event.chatId,
          turnId: event.turnId ?? null,
          fingerprint,
          consecutiveIdenticalDecisions: newCount,
          planUnchanged,
          originalSemanticAction: decision.semanticAction,
        }
      );
      return {
        semanticAction: "ESCALATE",
        runtimeAction: mapSemanticToRuntime("ESCALATE"),
        reason: `Loop detected: same decision (${decision.semanticAction}) repeated ${newCount + 1} times without progress. Original reason: ${decision.reason}`,
      };
    }

    // Same decision but not yet at threshold — allow through
    this.logger.info("Supervisor loop detection: same decision repeating", {
      chatId: event.chatId,
      turnId: event.turnId ?? null,
      fingerprint,
      consecutiveIdenticalDecisions: newCount,
      planUnchanged,
      semanticAction: decision.semanticAction,
    });
    return decision;
  }

  private async runOptionalMemory(input: {
    chatId: string;
    projectRoot: string;
    latestUserInstruction: string;
    latestAssistantTextPart: string;
  }): Promise<SupervisorMemoryContext> {
    if (this.policy.memoryProvider === "none") {
      this.logger.info("Supervisor memory lookup skipped: provider disabled", {
        chatId: input.chatId,
      });
      return { results: [] };
    }
    const haystack = `${input.latestUserInstruction}\n${input.latestAssistantTextPart}`;
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
    decision: SupervisorSemanticDecision,
    snapshot: SupervisorTurnSnapshot
  ): Promise<void> {
    this.logger.info("Supervisor decision applying", {
      chatId: event.chatId,
      turnId: event.turnId ?? null,
      semanticAction: decision.semanticAction,
      runtimeAction: decision.runtimeAction,
      followUpPromptLength: decision.followUpPrompt?.length ?? 0,
      latestAssistantTextPartLength: snapshot.latestAssistantTextPart.length,
      autoResumeSignal: snapshot.autoResumeSignal ?? null,
    });

    // R8 — SAVE_MEMORY side effect (non-blocking)
    if (decision.semanticAction === "SAVE_MEMORY") {
      try {
        await this.memoryPort.appendLog({
          chatId: event.chatId,
          projectRoot: snapshot.projectRoot,
          ...(event.turnId ? { turnId: event.turnId } : {}),
          action: "save_memory",
          reason: decision.reason,
          latestAssistantTextPart: snapshot.latestAssistantTextPart,
        });
      } catch (error) {
        this.logger.warn("Supervisor SAVE_MEMORY side-effect failed", {
          chatId: event.chatId,
          turnId: event.turnId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Build runtime decision for broadcast (R7 — only runtimeAction fields)
    const runtimeDecision: SupervisorDecisionSummary = {
      action: decision.runtimeAction,
      reason: decision.reason,
      ...(decision.followUpPrompt
        ? { followUpPrompt: decision.followUpPrompt }
        : {}),
    };

    // T06 — Track loop detection state: fingerprint, history, plan snapshot, counter
    const fingerprint = computeDecisionFingerprint(decision);
    const planSnapshot = computePlanSnapshot(snapshot.plan);
    const currentSupervisor = normalizeSupervisorState(
      this.sessionRuntime.get(event.chatId)?.supervisor
    );
    const lastFingerprint = currentSupervisor.lastDecisionFingerprint;
    const isSameDecision = fingerprint === lastFingerprint;
    const newConsecutiveCount = isSameDecision
      ? (currentSupervisor.consecutiveIdenticalDecisions ?? 0) + 1
      : 0;
    const history = currentSupervisor.decisionHistory ?? [];
    const updatedHistory = [fingerprint, ...history].slice(
      0,
      DECISION_HISTORY_MAX_LENGTH
    );

    await this.updateSupervisorState({
      chatId: event.chatId,
      userId: event.userId,
      patch: {
        lastDecision: runtimeDecision,
        reason: decision.reason,
        lastDecisionFingerprint: fingerprint,
        decisionHistory: updatedHistory,
        lastPlanSnapshot: planSnapshot ?? currentSupervisor.lastPlanSnapshot,
        consecutiveIdenticalDecisions: newConsecutiveCount,
      },
      broadcastDecision: runtimeDecision,
      turnId: event.turnId,
    });

    // R9 — appendSupervisorLog records semantic action
    await this.appendSupervisorLog(event, decision, snapshot);

    // R7 — Dispatch based on runtimeAction
    if (decision.runtimeAction === "done") {
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
    if (decision.runtimeAction === "needs_user") {
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
    if (decision.runtimeAction === "abort") {
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

    // "continue" dispatch
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
        action: decision.runtimeAction,
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
    decision: SupervisorSemanticDecision,
    snapshot: SupervisorTurnSnapshot
  ): Promise<void> {
    try {
      const state = normalizeSupervisorState(
        this.sessionRuntime.get(event.chatId)?.supervisor
      );
      // R9 — record semantic action for auditability via dedicated audit port
      await this.auditPort.appendEntry({
        chatId: event.chatId,
        projectRoot: snapshot.projectRoot,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        semanticAction: decision.semanticAction,
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
      this.logger.warn("Supervisor audit log failed", {
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
    "heroui",
    "hero ui",
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

/**
 * R2 — Option/Gate deterministic classifier.
 * Detects agent asking user to choose from options and auto-selects a safe option.
 */
export function createOptionQuestionDecision(
  snapshot: SupervisorTurnSnapshot
): SupervisorSemanticDecision | null {
  const options = extractAssistantChoiceOptions(
    snapshot.latestAssistantTextPart
  );
  const selected = selectAutopilotOption(options);
  if (selected) {
    return {
      semanticAction: "APPROVE_GATE",
      runtimeAction: mapSemanticToRuntime("APPROVE_GATE"),
      reason:
        "Agent asked the user to choose from listed options; autopilot selected a safe continuation option.",
      followUpPrompt: [
        `Select this option and continue: ${selected}`,
        "Keep the work scoped to the original request and existing repository conventions.",
        "Do not commit, push, deploy, or perform destructive actions unless the human explicitly requested them.",
      ].join("\n"),
    };
  }
  if (options.length > 0) {
    // All options exist but are all unsafe → ESCALATE
    return {
      semanticAction: "ESCALATE",
      runtimeAction: mapSemanticToRuntime("ESCALATE"),
      reason:
        "Agent offered options but all are unsafe; requiring human to choose.",
    };
  }
  return null;
}

/**
 * R3 — Memory recovery deterministic classifier.
 * Detects Obsidian/vault access blocker but with usable local memory context.
 */
export function createMemoryRecoveryDecision(
  snapshot: SupervisorTurnSnapshot
): SupervisorSemanticDecision | null {
  if (!snapshot.projectBlueprint && snapshot.memoryResults.length === 0) {
    return null;
  }
  const latestText = snapshot.latestAssistantTextPart;
  if (
    !(
      OBSIDIAN_CONTEXT_RE.test(latestText) &&
      LOCAL_CONTEXT_BLOCKED_RE.test(latestText)
    )
  ) {
    return null;
  }

  return {
    semanticAction: "CONTINUE",
    runtimeAction: mapSemanticToRuntime("CONTINUE"),
    reason:
      "Agent reported an Obsidian/vault access blocker, but supervisor local memory provided usable context.",
    followUpPrompt: [
      "Continue without waiting for the human.",
      "Use the Project blueprint and Relevant local memory included below as the required vault context for this phase.",
      "If the previous step selected a scope or option, keep that scope and proceed to the next safe route step.",
      "Do not retry Obsidian CLI unless it is strictly necessary; rely on the provided context and repository files.",
    ].join("\n"),
  };
}

/**
 * R4 — Correct deterministic classifier.
 * Detects when agent self-reports "done" but without verification artifacts.
 * Enhanced: followUpPrompt requests explicit objective evidence.
 */
export function createCorrectDecision(
  snapshot: SupervisorTurnSnapshot
): SupervisorSemanticDecision | null {
  const text = snapshot.latestAssistantTextPart;
  // Pattern: agent claims done but no verification artifacts (no run/verify/test/lint/check keywords)
  const doneMarker =
    /\b(done|finished|completed|all set|wrapper|wrapped up)\b/i.test(text);
  const hasVerification =
    /\b(run|verify|test|lint|check|preview|visual|pilot|demo)\b/i.test(text);
  if (!doneMarker || hasVerification) {
    return null;
  }
  return {
    semanticAction: "CORRECT",
    runtimeAction: mapSemanticToRuntime("CORRECT"),
    reason:
      "Agent self-reported done without verification artifacts; supervisor issued corrective continuation requesting objective evidence.",
    followUpPrompt: [
      "You indicated completion, but the supervisor could not verify output artifacts.",
      "Please provide objective evidence to confirm the task is genuinely complete:",
      "1. Which files were modified or created? List them.",
      "2. What tests were run and what were the results?",
      "3. Was there any build or compilation output? If so, summarize it.",
      "If any deliverables are missing, continue to the next logical step and ensure all agreed deliverables are ready.",
    ].join("\n"),
  };
}

/**
 * R5 — Done verification deterministic classifier.
 * Detects when agent self-reports "done" WITH verification artifacts.
 * Enhanced: requires plan state completion, no unresolved tool errors, and no last error.
 */
export function createDoneVerificationDecision(
  snapshot: SupervisorTurnSnapshot
): SupervisorSemanticDecision | null {
  const text = snapshot.latestAssistantTextPart;
  const doneMarker =
    /\b(done|finished|completed|all set|wrapper|wrapped up)\b/i.test(text);
  const hasVerification =
    /\b(run|verify|test|lint|check|preview|visual|pilot|demo)\b/i.test(text);
  if (!(doneMarker && hasVerification)) {
    return null;
  }

  // Plan state check: no entries with status "in_progress" or "pending"
  const pendingPlanEntries = snapshot.plan?.entries.filter((entry) => {
    const status = entry.status.toLowerCase();
    return status === "in_progress" || status === "pending";
  });
  if (pendingPlanEntries && pendingPlanEntries.length > 0) {
    return null;
  }

  // Tool error check: consecutive failures must be 0 or undefined (no tool data)
  if (
    snapshot.recentToolCallSummary &&
    snapshot.recentToolCallSummary.consecutiveFailures > 0
  ) {
    return null;
  }

  // Last error check: must be undefined or empty
  if (
    snapshot.lastErrorSummary &&
    snapshot.lastErrorSummary.trim().length > 0
  ) {
    return null;
  }

  return {
    semanticAction: "DONE",
    runtimeAction: mapSemanticToRuntime("DONE"),
    reason:
      "Agent self-reported completion with verification artifacts present, no pending plan entries, and no unresolved errors; supervisor confirmed done.",
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
  let formatDetected: "letter" | "bullet" | "table" | null = null;

  for (const line of lines) {
    // Check for A/B/C letter-option format (e.g., "A) Add login", "B. Add dashboard")
    if (formatDetected === null || formatDetected === "letter") {
      const letterMatches = [
        ...line.matchAll(new RegExp(OPTION_LETTER_RE.source, "gi")),
      ];
      if (letterMatches.length > 0) {
        formatDetected = "letter";
        collecting = true;
        for (const m of letterMatches) {
          if (m[2]) {
            options.push(normalizeOptionText(m[2]));
          }
        }
        continue;
      }
    }

    // Check for markdown table rows (e.g., "| 1 | Description |")
    if (
      (formatDetected === null || formatDetected === "table") &&
      line.includes("|")
    ) {
      const cells = line.split("|").filter((c) => c.trim().length > 0);
      // Skip separator rows (cells contain only -, :, |, space)
      const isSeparator = cells.every((c) =>
        TABLE_CELL_SEPARATOR_RE.test(c.trim())
      );
      if (isSeparator) {
        // Separator row — don't stop collecting but don't add to options
        continue;
      }
      // Data row: find the longest non-header cell as the "option text"
      // Typically column 2 in tables like "| 1 | Description |" or "| Action |"
      let bestCell = "";
      for (let i = 1; i < cells.length; i++) {
        const cell = cells[i]?.trim() ?? "";
        if (cell.length > bestCell.length) {
          bestCell = cell;
        }
      }
      if (bestCell.length > 0) {
        formatDetected = "table";
        collecting = true;
        options.push(normalizeOptionText(bestCell));
        continue;
      }
    }

    // Check for bullet/numbered format
    if (formatDetected === null || formatDetected === "bullet") {
      const match = OPTION_BULLET_RE.exec(line);
      if (match?.[1]) {
        formatDetected = "bullet";
        collecting = true;
        options.push(normalizeOptionText(match[1]));
        continue;
      }
    }

    // Stop collecting when we hit a non-empty non-table line after having started collecting
    if (collecting && line.trim().length > 0 && formatDetected !== "table") {
      break;
    }
    // For table format, separator rows don't stop collecting
    if (collecting && line.trim().length > 0 && formatDetected === "table") {
      const cells = line.split("|").filter((c) => c.trim().length > 0);
      const firstCell = cells[1]?.trim() ?? "";
      const isSeparator = TABLE_CELL_SEPARATOR_RE.test(firstCell);
      if (!isSeparator) {
        break;
      }
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

export function selectAutopilotOption(options: string[]): string | undefined {
  const safeOptions = options.filter(
    (option) => !UNSAFE_OPTION_RE.test(option)
  );
  if (safeOptions.length === 0) {
    return undefined;
  }
  // Scoring order (first match wins):
  // 1. RECOMMENDED — explicitly marked as recommended
  // 2. PRODUCTIVE — improves/refines/fixes/continues work
  // 3. VERIFY — runs/tests/checks/validates
  // 4. First safe option — fallback when no scoring match
  return (
    safeOptions.find((option) => RECOMMENDED_OPTION_RE.test(option)) ??
    safeOptions.find((option) => PRODUCTIVE_OPTION_RE.test(option)) ??
    safeOptions.find((option) => VERIFY_OPTION_RE.test(option)) ??
    safeOptions[0]
  );
}

// --- T06: Loop detection helpers ---

/**
 * Computes a deterministic fingerprint for a semantic decision.
 * Uses a simple string-based hash of the action, prompt, and reason.
 * No crypto dependency — just a stable concatenation with length cap.
 */
export function computeDecisionFingerprint(
  decision: Pick<
    SupervisorSemanticDecision,
    "semanticAction" | "followUpPrompt" | "reason"
  >
): string {
  const raw = `${decision.semanticAction}|${decision.followUpPrompt ?? ""}|${decision.reason ?? ""}`;
  // Simple deterministic hash: DJB2-style with string-based accumulator
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33 + raw.charCodeAt(i)) % 2_147_483_647;
  }
  // Include length of key segments for collision resistance
  return `${hash.toString(16)}:${raw.length}`;
}

/**
 * Computes a JSON snapshot of the plan for delta detection.
 * Returns undefined when no plan is present.
 */
export function computePlanSnapshot(
  plan: SupervisorTurnSnapshot["plan"]
): string | undefined {
  if (!plan?.entries?.length) {
    return undefined;
  }
  try {
    // Deterministic serialization: sort entries by content for stable comparison
    const serialized = plan.entries
      .map((entry) => `${entry.content}|${entry.status}|${entry.priority}`)
      .sort()
      .join(";");
    return serialized.slice(0, FINGERPRINT_MAX_LENGTH);
  } catch {
    return undefined;
  }
}
