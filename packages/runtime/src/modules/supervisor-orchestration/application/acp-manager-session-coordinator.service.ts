import { createId } from "#runtime/shared/utils/id.util";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import {
  SupervisorRunRevisionConflictError,
  transitionSupervisorRun,
} from "../domain/supervisor-run.transitions";
import { buildAcpManagerPrompt } from "./acp-manager-prompt.builder";
import {
  type AcpManagerTurn,
  AcpManagerTurnSchema,
} from "./contracts/acp-manager-turn.contract";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  type AcpSessionConfigOption,
  resolvePreferredSessionEffort,
} from "./preferred-session-effort";
import {
  type AcpSessionModes,
  resolveSafeSessionModeId,
} from "./safe-session-mode";

const MAX_CAS_ATTEMPTS = 8;
const MAX_MANAGER_RESULT_CHARS = 64_000;
const JSON_CODE_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

export interface AcpManagerSessionCreatePort {
  execute(input: {
    userId: string;
    projectId?: string;
    projectRoot?: string;
    agentId?: string;
    chatId?: string;
  }): Promise<{
    id: string;
    sessionId?: string;
    modes?: AcpSessionModes;
    configOptions?: AcpSessionConfigOption[];
  }>;
}

export interface AcpManagerMessageSendPort {
  execute(input: {
    userId: string;
    chatId: string;
    text: string;
    source: "orchestrator";
  }): Promise<{ turnId: string }>;
}

export interface AcpManagerSessionStopPort {
  execute(userId: string, chatId: string): Promise<unknown>;
}

export interface AcpManagerSessionResumePort {
  execute(
    userId: string,
    chatId: string,
    options: { mode: "exact_only" }
  ): Promise<unknown>;
}

export interface AcpManagerModeSetPort {
  execute(userId: string, chatId: string, modeId: string): Promise<unknown>;
}

export interface AcpManagerModelSetPort {
  execute(
    userId: string,
    chatId: string,
    modelId: string
  ): Promise<{ configOptions?: AcpSessionConfigOption[] }>;
}

export interface AcpManagerConfigOptionSetPort {
  execute(
    userId: string,
    chatId: string,
    configId: string,
    value: string
  ): Promise<unknown>;
}

export interface AcpManagerResultReaderPort {
  latestAssistantText(input: {
    userId: string;
    chatId: string;
  }): Promise<string | null>;
}

export interface AcpManagerCapacityPort {
  suspendManager(input: {
    runId: string;
    userId: string;
    failure: { error?: unknown };
  }): Promise<{ suspended: boolean; run: SupervisorRunState }>;
}

export interface AcpManagerReadinessPort {
  recordExactResumeSuccess(input: {
    userId: string;
    agentId: string;
    projectId?: string;
  }): Promise<unknown>;
}

export interface AcpManagerSessionCoordinatorDeps {
  runs: SupervisorRunRepositoryPort;
  createSession: AcpManagerSessionCreatePort;
  sendMessage: AcpManagerMessageSendPort;
  stopSession: AcpManagerSessionStopPort;
  resumeSession: AcpManagerSessionResumePort;
  setModel?: AcpManagerModelSetPort;
  setMode?: AcpManagerModeSetPort;
  setConfigOption?: AcpManagerConfigOptionSetPort;
  preferredModelId?: string;
  preferredEffort?: string;
  trustedVerificationCommands?: string[];
  results: AcpManagerResultReaderPort;
  capacity?: AcpManagerCapacityPort;
  readiness?: AcpManagerReadinessPort;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface AcpManagerCompletedTurn {
  runId: string;
  userId: string;
  turnId: string;
  turn: AcpManagerTurn;
}

export interface AcpManagerStoppedTurn {
  runId: string;
  userId: string;
  turnId: string;
}

export class AcpManagerSessionCoordinator {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly createSession: AcpManagerSessionCreatePort;
  private readonly sendMessage: AcpManagerMessageSendPort;
  private readonly stopSession: AcpManagerSessionStopPort;
  private readonly resumeSession: AcpManagerSessionResumePort;
  private readonly setModel?: AcpManagerModelSetPort;
  private readonly setMode?: AcpManagerModeSetPort;
  private readonly setConfigOption?: AcpManagerConfigOptionSetPort;
  private readonly preferredModelId?: string;
  private readonly preferredEffort?: string;
  private readonly trustedVerificationCommands: string[];
  private readonly results: AcpManagerResultReaderPort;
  private readonly capacity?: AcpManagerCapacityPort;
  private readonly readiness?: AcpManagerReadinessPort;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(deps: AcpManagerSessionCoordinatorDeps) {
    this.runs = deps.runs;
    this.createSession = deps.createSession;
    this.sendMessage = deps.sendMessage;
    this.stopSession = deps.stopSession;
    this.resumeSession = deps.resumeSession;
    this.setModel = deps.setModel;
    this.setMode = deps.setMode;
    this.setConfigOption = deps.setConfigOption;
    this.preferredModelId = deps.preferredModelId;
    this.preferredEffort = deps.preferredEffort;
    this.trustedVerificationCommands = [
      ...(deps.trustedVerificationCommands ?? []),
    ];
    this.results = deps.results;
    this.capacity = deps.capacity;
    this.readiness = deps.readiness;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
  }

  async dispatch(input: {
    runId: string;
    userId: string;
    managerAgentId: string;
    turnKind: "plan" | "replan";
    requestedChanges?: string;
    projectIndexSummary?: string;
    scopeResolutionSummary?: string;
  }): Promise<SupervisorRunState> {
    let run = await this.reserveSession(input);
    const manager = requireManager(run);
    try {
      if (!manager.agentSessionId) {
        const created = await this.createSession.execute({
          userId: run.userId,
          ...(run.projectId ? { projectId: run.projectId } : {}),
          projectRoot: run.projectRoot,
          agentId: manager.agentId,
          chatId: manager.chatId,
        });
        if (created.id !== manager.chatId) {
          throw new Error("ACP manager returned a different chat id");
        }
        if (!created.sessionId) {
          throw new Error(
            "ACP manager did not establish an exact-resumable session id"
          );
        }
        const managerModeId = resolveSafeSessionModeId(
          "read_only",
          created.modes,
          "manager"
        );
        if (managerModeId) {
          if (!this.setMode) {
            throw new Error("ACP manager mode selection is unavailable");
          }
          await this.setMode.execute(run.userId, manager.chatId, managerModeId);
        }
        const modelConfigOptions = await this.applyPreferredModel(
          run.userId,
          manager.chatId
        );
        await this.applyPreferredEffort({
          userId: run.userId,
          chatId: manager.chatId,
          configOptions: modelConfigOptions ?? created.configOptions,
        });
        run = await this.updateRun(run.runId, run.userId, (draft) => {
          const draftManager = requireManager(draft);
          draftManager.agentSessionId = created.sessionId;
          draftManager.status = "running";
        });
      } else if (manager.status === "stopped") {
        const resumed = (await this.resumeSession.execute(
          run.userId,
          manager.chatId,
          {
            mode: "exact_only",
          }
        )) as { configOptions?: AcpSessionConfigOption[] };
        const modelConfigOptions = await this.applyPreferredModel(
          run.userId,
          manager.chatId
        );
        await this.applyPreferredEffort({
          userId: run.userId,
          chatId: manager.chatId,
          configOptions: modelConfigOptions ?? resumed.configOptions,
        });
        await this.readiness
          ?.recordExactResumeSuccess({
            userId: run.userId,
            agentId: manager.agentId,
            ...(run.projectId ? { projectId: run.projectId } : {}),
          })
          .catch(() => undefined);
        run = await this.updateRun(run.runId, run.userId, (draft) => {
          requireManager(draft).status = "running";
        });
      }

      const prompt = buildAcpManagerPrompt({
        run,
        turnKind: input.turnKind,
        trustedVerificationCommands: this.trustedVerificationCommands,
        ...(input.requestedChanges
          ? { requestedChanges: input.requestedChanges }
          : {}),
        ...(input.projectIndexSummary
          ? { projectIndexSummary: input.projectIndexSummary }
          : {}),
        ...(input.scopeResolutionSummary
          ? { scopeResolutionSummary: input.scopeResolutionSummary }
          : {}),
      });
      const submitted = await this.sendMessage.execute({
        userId: run.userId,
        chatId: requireManager(run).chatId,
        text: prompt,
        source: "orchestrator",
      });
      return await this.updateRun(run.runId, run.userId, (draft) => {
        const draftManager = requireManager(draft);
        draftManager.status = "running";
        Reflect.deleteProperty(draftManager, "pendingTurnKind");
        draftManager.activeTurn = {
          turnId: submitted.turnId,
          kind: input.turnKind,
          startedAt: this.now(),
        };
      });
    } catch (error) {
      const handled = await this.capacity?.suspendManager({
        runId: run.runId,
        userId: run.userId,
        failure: { error },
      });
      if (handled?.suspended) {
        return handled.run;
      }
      await this.updateRun(run.runId, run.userId, (draft) => {
        draft.status = "needs_user";
        const draftManager = requireManager(draft);
        draftManager.status = "failed";
        if (
          !draft.decisions.some(
            (decision) =>
              decision.status === "open" &&
              decision.kind === "classifier_uncertain"
          )
        ) {
          draft.decisions.push({
            decisionId: this.idFactory("decision"),
            kind: "classifier_uncertain",
            status: "open",
            prompt:
              error instanceof Error
                ? error.message
                : "ACP manager turn failed without a classified recovery path",
            createdAt: this.now(),
          });
        }
      });
      throw error;
    }
  }

  private async applyPreferredEffort(input: {
    userId: string;
    chatId: string;
    configOptions?: AcpSessionConfigOption[];
  }): Promise<void> {
    const selection = resolvePreferredSessionEffort(
      input.configOptions,
      this.preferredEffort
    );
    if (!selection) {
      return;
    }
    if (!this.setConfigOption) {
      throw new Error("ACP manager effort selection is unavailable");
    }
    await this.setConfigOption.execute(
      input.userId,
      input.chatId,
      selection.configId,
      selection.value
    );
  }

  private async applyPreferredModel(
    userId: string,
    chatId: string
  ): Promise<AcpSessionConfigOption[] | undefined> {
    if (!this.preferredModelId) {
      return undefined;
    }
    if (!this.setModel) {
      throw new Error("ACP manager model selection is unavailable");
    }
    const result = await this.setModel.execute(
      userId,
      chatId,
      this.preferredModelId
    );
    return result.configOptions;
  }

  async resumePending(input: {
    runId: string;
    userId: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const manager = requireManager(run);
    if (!manager.pendingTurnKind) {
      return run;
    }
    return await this.dispatch({
      runId: run.runId,
      userId: run.userId,
      managerAgentId: manager.agentId,
      turnKind: manager.pendingTurnKind,
    });
  }

  async stop(input: {
    runId: string;
    userId: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    if (!run.managerSession) {
      return run;
    }
    const hasAgentSession = Boolean(run.managerSession.agentSessionId);
    const stopped = await this.updateRun(run.runId, run.userId, (draft) => {
      const manager = requireManager(draft);
      manager.status = "stopped";
      Reflect.deleteProperty(manager, "activeTurn");
      Reflect.deleteProperty(manager, "pendingTurnKind");
    });
    if (hasAgentSession) {
      await this.stopSession.execute(
        stopped.userId,
        requireManager(stopped).chatId
      );
    }
    return stopped;
  }

  async claimCompletedTurn(input: {
    userId: string;
    chatId: string;
    turnId: string;
  }): Promise<AcpManagerCompletedTurn | null> {
    const runs = await this.runs.listNonTerminal();
    const run = runs.find(
      (candidate) =>
        candidate.userId === input.userId &&
        candidate.managerSession?.chatId === input.chatId &&
        candidate.managerSession.activeTurn?.turnId === input.turnId
    );
    if (!run) {
      return null;
    }
    const eventId = `manager-turn:${input.chatId}:${input.turnId}`;
    if (run.processedEventIds.includes(eventId)) {
      return null;
    }
    const text = await this.results.latestAssistantText({
      userId: input.userId,
      chatId: input.chatId,
    });
    let turn: AcpManagerTurn;
    try {
      if (!text) {
        throw new Error("ACP manager completion has no assistant result");
      }
      turn = extractAcpManagerTurn(text);
      if (turn.runId && turn.runId !== run.runId) {
        throw new Error("ACP manager result run id does not match its binding");
      }
    } catch (error) {
      await this.failCompletedTurn({
        run,
        eventId,
        turnId: input.turnId,
        error,
      });
      throw error;
    }
    const saved = await this.updateRun(run.runId, run.userId, (draft) => {
      const manager = requireManager(draft);
      manager.lastCompletedTurnId = input.turnId;
      Reflect.deleteProperty(manager, "activeTurn");
      manager.status = "stopped";
      draft.processedEventIds.push(eventId);
    });
    await this.stopSession
      .execute(saved.userId, requireManager(saved).chatId)
      .catch(() => undefined);
    return {
      runId: saved.runId,
      userId: saved.userId,
      turnId: input.turnId,
      turn,
    };
  }

  async recoverCompletedTurn(input: {
    runId: string;
    userId: string;
  }): Promise<AcpManagerCompletedTurn | null> {
    const run = await this.requireRun(input.runId, input.userId);
    const manager = run.managerSession;
    const turnId = manager?.activeTurn?.turnId;
    if (!(manager && turnId)) {
      return null;
    }
    return await this.claimCompletedTurn({
      userId: input.userId,
      chatId: manager.chatId,
      turnId,
    });
  }

  async claimStoppedTurn(input: {
    userId: string;
    chatId: string;
    reason?: string;
  }): Promise<AcpManagerStoppedTurn | null> {
    const runs = await this.runs.listNonTerminal();
    const run = runs.find(
      (candidate) =>
        candidate.userId === input.userId &&
        candidate.managerSession?.chatId === input.chatId &&
        candidate.managerSession.status === "running" &&
        Boolean(candidate.managerSession.activeTurn)
    );
    const turnId = run?.managerSession?.activeTurn?.turnId;
    if (!(run && turnId)) {
      return null;
    }
    const eventId = `manager-stopped:${input.chatId}:${turnId}`;
    let claimed = false;
    const saved = await this.updateRun(run.runId, run.userId, (draft) => {
      claimed = false;
      const manager = draft.managerSession;
      if (
        !manager ||
        manager.chatId !== input.chatId ||
        manager.status !== "running" ||
        manager.activeTurn?.turnId !== turnId ||
        draft.processedEventIds.includes(eventId)
      ) {
        return;
      }
      claimed = true;
      draft.status = "needs_user";
      manager.status = "failed";
      manager.lastCompletedTurnId = turnId;
      Reflect.deleteProperty(manager, "activeTurn");
      Reflect.deleteProperty(manager, "pendingTurnKind");
      draft.processedEventIds.push(eventId);
      draft.decisions.push({
        decisionId: this.idFactory("decision"),
        kind: "classifier_uncertain",
        status: "open",
        prompt:
          input.reason ??
          "ACP manager session stopped before completing its active turn",
        createdAt: this.now(),
      });
    });
    return claimed
      ? { runId: saved.runId, userId: saved.userId, turnId }
      : null;
  }

  private async failCompletedTurn(input: {
    run: SupervisorRunState;
    eventId: string;
    turnId: string;
    error: unknown;
  }): Promise<void> {
    const message =
      input.error instanceof Error
        ? input.error.message
        : "ACP manager returned an unclassified invalid result";
    const saved = await this.updateRun(
      input.run.runId,
      input.run.userId,
      (draft) => {
        draft.status = "needs_user";
        const manager = requireManager(draft);
        manager.lastCompletedTurnId = input.turnId;
        manager.status = "stopped";
        Reflect.deleteProperty(manager, "activeTurn");
        Reflect.deleteProperty(manager, "pendingTurnKind");
        draft.processedEventIds.push(input.eventId);
        if (
          !draft.decisions.some(
            (decision) =>
              decision.status === "open" &&
              decision.kind === "classifier_uncertain"
          )
        ) {
          draft.decisions.push({
            decisionId: this.idFactory("decision"),
            kind: "classifier_uncertain",
            status: "open",
            prompt: message,
            createdAt: this.now(),
          });
        }
      }
    );
    await this.stopSession
      .execute(saved.userId, requireManager(saved).chatId)
      .catch(() => undefined);
  }

  private async reserveSession(input: {
    runId: string;
    userId: string;
    managerAgentId: string;
    turnKind: "plan" | "replan";
  }): Promise<SupervisorRunState> {
    return await this.updateRun(input.runId, input.userId, (draft) => {
      if (draft.managerSession) {
        if (draft.managerSession.agentId !== input.managerAgentId) {
          throw new Error(
            "Sticky ACP manager cannot be rerouted after session reservation"
          );
        }
        if (draft.managerSession.activeTurn) {
          throw new Error("ACP manager already has an active turn");
        }
        draft.managerSession.pendingTurnKind = input.turnKind;
        return;
      }
      draft.managerSession = {
        agentId: input.managerAgentId,
        chatId: this.idFactory("manager-chat"),
        status: "creating",
        exactResumeRequired: true,
        pendingTurnKind: input.turnKind,
      };
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "manager_session_bound",
        actor: "orchestrator",
        summary: `Bound sticky ACP manager ${input.managerAgentId}`,
        createdAt: this.now(),
      });
    });
  }

  private async updateRun(
    runId: string,
    userId: string,
    mutate: (draft: SupervisorRunState) => void
  ): Promise<SupervisorRunState> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const run = await this.requireRun(runId, userId);
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate,
      });
      try {
        return await this.runs.save(next, run.revision);
      } catch (error) {
        if (!(error instanceof SupervisorRunRevisionConflictError)) {
          throw error;
        }
      }
    }
    throw new Error(
      "Could not update ACP manager state after revision conflicts"
    );
  }

  private async requireRun(runId: string, userId: string) {
    const run = await this.runs.get(runId, userId);
    if (!run) {
      throw new Error(`Supervisor run not found: ${runId}`);
    }
    return run;
  }
}

export function extractAcpManagerTurn(text: string): AcpManagerTurn {
  const bounded = text.slice(-MAX_MANAGER_RESULT_CHARS).trim();
  const fenced = bounded.match(JSON_CODE_FENCE_PATTERN)?.[1]?.trim();
  let cause: unknown;
  for (const candidate of fenced
    ? [fenced]
    : collectManagerJsonCandidates(bounded)) {
    try {
      return AcpManagerTurnSchema.parse(JSON.parse(candidate));
    } catch (error) {
      cause = error;
    }
  }
  throw new Error("ACP manager returned invalid structured output", { cause });
}

function collectManagerJsonCandidates(text: string): string[] {
  const candidates = [text];
  let index = text.lastIndexOf("{");
  while (index >= 0) {
    const candidate = text.slice(index).trim();
    if (candidate !== text) {
      candidates.push(candidate);
    }
    if (index === 0) {
      break;
    }
    index = text.lastIndexOf("{", index - 1);
  }
  return candidates;
}

function requireManager(run: SupervisorRunState) {
  if (!run.managerSession) {
    throw new Error(`Supervisor run ${run.runId} has no ACP manager session`);
  }
  return run.managerSession;
}
