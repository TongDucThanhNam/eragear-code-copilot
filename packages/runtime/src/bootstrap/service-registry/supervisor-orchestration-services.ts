import { CryptoHasher } from "bun";
import {
  AcpCapacityCoordinator,
  AcpManagerSessionCoordinator,
  createClientSafeSupervisorRunUpdate,
  resolveRunVerificationCommands,
  SUPERVISOR_RUN_LIMIT_CAPS,
  SupervisorAgentCapacityCoordinator,
  SupervisorAgentProfileService,
  SupervisorFinalCommitService,
  SupervisorGlobalSchedulerService,
  SupervisorManagerInboxService,
  SupervisorOrchestratorService,
  SupervisorPlannerService,
  SupervisorPowerLeaseCoordinator,
  SupervisorRecoveryService,
  SupervisorRunEventsService,
  SupervisorSchedulerService,
  SupervisorWorkerPermissionService,
  SupervisorWorkflowRunBoundary,
  SupervisorWorkflowRuntimeService,
  TelegramLongPollingCoordinator,
  TelegramManagerBridgeService,
  WorkerIntegrationService,
  WorkerResultService,
  WorkerSessionManagerService,
} from "#runtime/modules/supervisor-orchestration";
import {
  AcpManagerOnlySupervisorPlannerAdapter,
  AiSupervisorEffectPromptDispatchAdapter,
  ConfiguredAgentCatalogAdapter,
  CredentialTelegramManagerSecretStoreAdapter,
  GitScopedFinalCommitAdapter,
  GitSupervisorBaseSnapshotAdapter,
  GitWorkerWorkspaceAdapter,
  JournaledSupervisorRunRepository,
  NotifyingSupervisorRunRepository,
  parseTrustedSupervisorVerificationCommands,
  SessionRepositoryAcpManagerResultReaderAdapter,
  SystemSupervisorPowerLeaseAdapter,
  TelegramBotApiAdapter,
  TrustedCommandSupervisorVerifierAdapter,
} from "#runtime/modules/supervisor-orchestration/di";
import type {
  AgentUseCases,
  AiUseCases,
  CredentialUseCases,
  QuotaUseCases,
  SessionUseCases,
  SupervisorOrchestrationUseCases,
  ToolingUseCases,
} from "#runtime/modules/use-cases";
import { LOCAL_DESKTOP_USER_ID } from "#runtime/shared/constants/local-desktop-user.constants";
import type { ServiceRegistrySlice } from "./dependencies";

type SupervisorOrchestrationDependencies = ServiceRegistrySlice<
  | "appLogger"
  | "agentRepo"
  | "eventBus"
  | "gitAdapter"
  | "sessionRepo"
  | "sessionRuntime"
  | "supervisorRunRepo"
  | "workflowJournal"
>;

export function createSupervisorOrchestrationUseCases(
  deps: SupervisorOrchestrationDependencies,
  session: SessionUseCases,
  ai: AiUseCases,
  agents: AgentUseCases,
  credential: CredentialUseCases,
  tooling: ToolingUseCases,
  quota: QuotaUseCases
): SupervisorOrchestrationUseCases {
  const runs = new NotifyingSupervisorRunRepository(
    new JournaledSupervisorRunRepository(
      deps.supervisorRunRepo,
      deps.workflowJournal
    ),
    deps.eventBus,
    deps.appLogger
  );
  const plannerAdapter = new AcpManagerOnlySupervisorPlannerAdapter();
  const trustedVerificationCommands =
    parseTrustedSupervisorVerificationCommands(
      process.env.SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS
    );
  const planner = new SupervisorPlannerService(plannerAdapter, {
    trustedVerificationCommandsByRole: {
      research: trustedVerificationCommands,
      implementation: trustedVerificationCommands,
      test: trustedVerificationCommands,
      review: trustedVerificationCommands,
      integration: trustedVerificationCommands,
    },
    defaultAgentIdByRole: {},
  });
  const capacity = new AcpCapacityCoordinator({
    runs,
    eventBus: deps.eventBus,
    sessions: {
      resumeExact: (userId, chatId) =>
        session.resume.execute(userId, chatId, { mode: "exact_only" }),
      getModelId: (chatId) =>
        deps.sessionRuntime.get(chatId)?.models?.currentModelId,
    },
    quota: quota.provider,
  });
  const resultReader = new SessionRepositoryAcpManagerResultReaderAdapter(
    deps.sessionRepo
  );
  const profiles = new SupervisorAgentProfileService({
    agents: {
      listSupervisorProfiles(userId, projectId) {
        const list = deps.agentRepo.listSupervisorProfiles;
        if (!list) {
          throw new Error("Supervisor agent profile storage is unavailable");
        }
        return list.call(deps.agentRepo, userId, projectId);
      },
      saveSupervisorProfile(userId, profile) {
        const save = deps.agentRepo.saveSupervisorProfile;
        if (!save) {
          throw new Error("Supervisor agent profile storage is unavailable");
        }
        return save.call(deps.agentRepo, userId, profile);
      },
    },
    createSession: session.create,
    stopSession: session.stop,
    resumeSession: session.resume,
  });
  const manager = new AcpManagerSessionCoordinator({
    runs,
    createSession: session.create,
    effectPromptDispatch: new AiSupervisorEffectPromptDispatchAdapter(
      ai.sendMessage
    ),
    stopSession: session.stop,
    resumeSession: session.resume,
    setModel: ai.setModel,
    setMode: ai.setMode,
    setConfigOption: ai.setConfigOption,
    preferredModelId: "openai/gpt-5.6-sol",
    preferredEffort: "max",
    trustedVerificationCommands,
    results: resultReader,
    capacity,
    readiness: profiles,
  });
  const workerSessions = new WorkerSessionManagerService({
    runs,
    createSession: session.create,
    effectPromptDispatch: new AiSupervisorEffectPromptDispatchAdapter(
      ai.sendMessage
    ),
    stopSession: session.stop,
    resumeSession: session.resume,
    setModel: ai.setModel,
    setMode: ai.setMode,
    setConfigOption: ai.setConfigOption,
    preferredEffort: readSupervisorModelEffort() ?? "max",
    capacity,
  });
  const workerPermissions = new SupervisorWorkerPermissionService({
    runs,
    sessions: deps.sessionRuntime,
    respond: tooling.respondPermission,
    logger: deps.appLogger,
  });
  const agentCapacity = new SupervisorAgentCapacityCoordinator({
    runs,
    profiles,
  });
  const workspaces = new GitWorkerWorkspaceAdapter();
  const integration = new WorkerIntegrationService(workspaces);
  const results = new WorkerResultService();
  const finalVerifier = new TrustedCommandSupervisorVerifierAdapter();
  const finalCommit = new SupervisorFinalCommitService(
    new GitScopedFinalCommitAdapter()
  );
  const workflowRunBoundary = new SupervisorWorkflowRunBoundary();
  const orchestrator = new SupervisorOrchestratorService({
    runs,
    planner,
    manager,
    agentCapacity,
    scheduler: new SupervisorSchedulerService(),
    workers: workerSessions,
    agents: new ConfiguredAgentCatalogAdapter(agents.list, profiles),
    baseSnapshot: new GitSupervisorBaseSnapshotAdapter(deps.gitAdapter),
    workspaces,
    integration,
    results,
    finalVerifier,
    finalCommit,
    workflowRunBoundary,
    configuredLimits: {
      maxConcurrency: 1,
      maxTasks: readBoundedLimit(
        "SUPERVISOR_ORCHESTRATION_MAX_TASKS",
        12,
        SUPERVISOR_RUN_LIMIT_CAPS.maxTasks
      ),
      maxAttemptsPerTask: readBoundedLimit(
        "SUPERVISOR_ORCHESTRATION_MAX_ATTEMPTS_PER_TASK",
        2,
        SUPERVISOR_RUN_LIMIT_CAPS.maxAttemptsPerTask
      ),
      maxPlannerReplans: readBoundedLimit(
        "SUPERVISOR_ORCHESTRATION_MAX_PLANNER_REPLANS",
        2,
        SUPERVISOR_RUN_LIMIT_CAPS.maxPlannerReplans,
        0
      ),
    },
  });
  const workflowRuntime = new SupervisorWorkflowRuntimeService({
    runs,
    journal: deps.workflowJournal,
    unitOfWork: deps.workflowJournal,
    runBoundary: workflowRunBoundary,
    trustedVerificationCommands,
    effects: {
      async requestPlan(context) {
        if (!context.preparedPrompt) {
          throw new Error("Request-plan effect is missing its frozen prompt");
        }
        await orchestrator.executeWorkflowPlanEffect({
          runId: context.run.runId,
          userId: context.userId,
          preparedPrompt: context.preparedPrompt,
        });
        return { kind: "plan_requested" };
      },
      async requestCapacity(context) {
        const taskId = requireIntentString(context.intent, "workItemId");
        const task = requireWorkflowTask(context.run, taskId);
        if (!task.preferredAgentId) {
          throw new Error(`Task ${taskId} has no selected agent`);
        }
        const observation = await agentCapacity.admit({
          userId: context.userId,
          ...(context.run.projectId
            ? { projectId: context.run.projectId }
            : {}),
          agentId: task.preferredAgentId,
          overnight: Boolean(context.run.legacyAutomation?.scheduleId),
        });
        return {
          kind: "capacity_observed",
          taskId,
          available: observation.eligible,
          agentIdentityId: task.preferredAgentId,
          ...(observation.eligible
            ? {}
            : {
                retryAt: new Date(
                  Date.parse(context.run.updatedAt) + 60_000
                ).toISOString(),
              }),
        };
      },
      async startTurn(context) {
        if (!context.preparedPrompt) {
          throw new Error("Start-turn effect is missing its frozen prompt");
        }
        const taskId = requireIntentString(context.intent, "workItemId");
        const updated = await orchestrator.executeWorkflowStartTurnEffect({
          runId: context.run.runId,
          userId: context.userId,
          taskId,
          preparedPrompt: context.preparedPrompt,
        });
        const attempt = requireWorkflowTask(updated, taskId).attempts.at(-1);
        if (!attempt) {
          throw new Error(
            `Worker dispatch did not persist an attempt: ${taskId}`
          );
        }
        return { kind: "turn_started", taskId, attemptId: attempt.attemptId };
      },
      async resumeSession(context) {
        if (!context.preparedPrompt) {
          throw new Error("Resume-session effect is missing its frozen prompt");
        }
        const taskId = requireIntentString(context.intent, "workItemId");
        const attemptId = requireIntentString(context.intent, "attemptId");
        const attempt = requireWorkflowAttempt(context.run, taskId, attemptId);
        const resumeInput = {
          runId: context.run.runId,
          userId: context.userId,
          taskId,
          attemptId,
          preparedPrompt: context.preparedPrompt,
        };
        if (attempt.status === "waiting_capacity") {
          await workerSessions.resumePendingCapacity(resumeInput);
        } else {
          await workerSessions.resume(resumeInput);
        }
        const resumedRun = await runs.get(context.run.runId, context.userId);
        const resumedAttempt = resumedRun
          ? requireWorkflowAttempt(resumedRun, taskId, attemptId)
          : undefined;
        if (resumedAttempt?.status !== "running" || !resumedAttempt.turnId) {
          throw new Error(
            `Worker ${attemptId} did not persist submitted turn evidence during resume`
          );
        }
        return { kind: "session_resumed", taskId, attemptId };
      },
      async resumeManagerSession(context) {
        if (!context.preparedPrompt) {
          throw new Error("Manager-resume effect is missing its frozen prompt");
        }
        const waitId = requireIntentString(context.intent, "waitId");
        const managerSession = context.run.managerSession;
        if (!managerSession) {
          throw new Error("Manager session is unavailable for exact resume");
        }
        await session.resume.execute(context.userId, managerSession.chatId, {
          mode: "exact_only",
        });
        await manager.resumePending({
          runId: context.run.runId,
          userId: context.userId,
          preparedPrompt: context.preparedPrompt,
        });
        const resumedRun = await runs.get(context.run.runId, context.userId);
        const resumedManager = resumedRun?.managerSession;
        if (
          resumedManager?.status !== "running" ||
          !resumedManager.activeTurn?.turnId ||
          resumedRun?.capacityWaits.some((wait) => wait.owner === "manager")
        ) {
          throw new Error(
            "Manager resume did not persist submitted turn evidence"
          );
        }
        return { kind: "manager_session_resumed", waitId };
      },
      async inspectUncertainTurn(context) {
        const taskId = requireIntentString(context.intent, "workItemId");
        const attemptId = requireIntentString(context.intent, "attemptId");
        const attempt = requireWorkflowAttempt(context.run, taskId, attemptId);
        try {
          const state = await session.queries.state(
            context.userId,
            attempt.chatId
          );
          const promptActive =
            state.status === "running" &&
            (state.chatStatus === "submitted" ||
              state.chatStatus === "streaming" ||
              state.chatStatus === "awaiting_permission" ||
              state.chatStatus === "cancelling");
          if (promptActive) {
            return {
              kind: "uncertain_turn_inspected",
              taskId,
              attemptId,
              disposition: "running",
            };
          }
          if (state.loadSessionSupported === true) {
            return {
              kind: "uncertain_turn_inspected",
              taskId,
              attemptId,
              disposition: "waiting_capacity",
              retryAt: new Date().toISOString(),
            };
          }
        } catch {
          // Missing session state is projected to an explicit user decision.
        }
        return {
          kind: "uncertain_turn_inspected",
          taskId,
          attemptId,
          disposition: "needs_user",
          decisionId: `${context.effect.effectId}-uncertain-decision`,
        };
      },
      async runVerification(context) {
        const scope = requireIntentString(context.intent, "scope");
        const taskId = optionalIntentString(context.intent, "workItemId");
        const commands =
          scope === "run"
            ? resolveRunVerificationCommands(
                context.run,
                trustedVerificationCommands
              )
            : requireWorkflowTask(context.run, taskId as string)
                .verificationCommands;
        const evidence =
          commands.length > 0
            ? await finalVerifier.verify({
                projectRoot: context.run.projectRoot,
                commands,
              })
            : [];
        const passed =
          commands.length > 0 &&
          commands.every((command) =>
            evidence.some(
              (item) => item.command === command && item.exitCode === 0
            )
          );
        const evidenceRefs = evidence.map((item) =>
          createEvidenceRef(context.run.runId, taskId ?? "run", item)
        );
        return {
          kind: "verification_completed",
          scope: scope === "run" ? "run" : "work_item",
          ...(taskId ? { taskId } : {}),
          passed,
          evidenceRefs,
          evidence,
          ...(passed
            ? {}
            : {
                decisionId: `${context.effect.effectId}-verification-decision`,
                reason:
                  commands.length === 0
                    ? "No trusted machine verification is configured; explicit user acceptance is required."
                    : "Trusted verification failed; review its persisted evidence before continuing.",
              }),
        };
      },
      requestDecision(context) {
        return Promise.resolve({
          kind: "decision_requested",
          decisionId: requireIntentString(context.intent, "decisionId"),
          ...(optionalIntentString(context.intent, "workItemId")
            ? {
                taskId: optionalIntentString(context.intent, "workItemId"),
              }
            : {}),
        });
      },
      async integrateWorkspace(context) {
        const taskId = requireIntentString(context.intent, "workItemId");
        const task = requireWorkflowTask(context.run, taskId);
        const attemptId = requireIntentString(context.intent, "attemptId");
        const attempt = requireWorkflowAttempt(context.run, taskId, attemptId);
        if (!(attempt.workspace && attempt.result)) {
          throw new Error(`Integration evidence is incomplete: ${attemptId}`);
        }
        await workerSessions.release({
          runId: context.run.runId,
          userId: context.userId,
          taskId,
          attemptId,
        });
        const patch = attempt.result.patch
          ? {
              workspace: attempt.workspace,
              artifact: attempt.result.patch,
              files: attempt.result.files,
            }
          : await workspaces.collect(attempt.workspace);
        const result = attempt.result.patch
          ? attempt.result
          : {
              ...attempt.result,
              files: patch.files,
              patch: patch.artifact,
            };
        const gate = await integration.integrate({
          run: context.run,
          task,
          workspace: attempt.workspace,
          patch,
          result,
          approvedGateKinds: context.run.gates
            .filter(
              (candidate) =>
                candidate.taskId === taskId &&
                candidate.attemptId === attemptId &&
                candidate.status === "approved"
            )
            .map((candidate) => candidate.kind),
        });
        const deliveryFingerprints =
          gate.decision === "allow" && task.executionMode === "write"
            ? await workspaces.fingerprint({
                projectRoot: context.run.projectRoot,
                relativePaths: result.files.touched,
              })
            : {};
        return {
          kind: "integration_completed",
          taskId,
          passed: gate.decision === "allow",
          files: result.files,
          ...(result.patch ? { patch: result.patch } : {}),
          deliveryFingerprints,
          ...(gate.decision === "allow"
            ? {}
            : {
                decisionId: `${context.effect.effectId}-integration-decision`,
                reason: gate.reasons.join(", "),
              }),
        };
      },
      async stopAgentSession(context) {
        const sessionId = requireIntentString(context.intent, "sessionId");
        if (
          optionalIntentString(context.intent, "purpose") ===
          "capacity_suspension"
        ) {
          await session.stop.execute(context.userId, sessionId);
          return { kind: "agent_session_stopped", sessionId };
        }
        if (context.run.managerSession?.chatId === sessionId) {
          await manager.stop({
            runId: context.run.runId,
            userId: context.userId,
          });
        } else {
          const binding = findWorkflowAttemptByChatId(context.run, sessionId);
          if (binding) {
            await workerSessions.stop({
              runId: context.run.runId,
              userId: context.userId,
              taskId: binding.taskId,
              attemptId: binding.attemptId,
            });
          }
        }
        return { kind: "agent_session_stopped", sessionId };
      },
      async disposeWorkspace(context) {
        const workspaceId = requireIntentString(context.intent, "workspaceId");
        const workspace = findWorkflowWorkspace(context.run, workspaceId);
        if (workspace) {
          await workspaces.dispose(workspace);
        }
        return { kind: "workspace_disposed", workspaceId };
      },
      async createFinalCommit(context) {
        const committed = await finalCommit.commit(context.run);
        return {
          kind: "final_commit_created",
          commitSha: committed.commitSha,
          safetyRef: committed.safetyRef,
        };
      },
    },
    onRunCommitted: async (run) => {
      await deps.eventBus
        .publish({
          type: "supervisor_run_updated",
          userId: run.userId,
          ...(run.projectId ? { projectId: run.projectId } : {}),
          update: createClientSafeSupervisorRunUpdate(run),
        })
        .catch((error) => {
          deps.appLogger.warn("Workflow run update publish failed", {
            runId: run.runId,
            revision: run.revision,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
  });
  orchestrator.setWorkflowPump((runId, userId) =>
    workflowRuntime.pumpRun({ runId, userId })
  );
  const recovery = new SupervisorRecoveryService(
    runs,
    {
      async inspect(input) {
        try {
          const state = await session.queries.state(input.userId, input.chatId);
          return {
            status: state.status,
            resumable: state.loadSessionSupported === true,
            promptActive:
              state.status === "running" &&
              (state.chatStatus === "submitted" ||
                state.chatStatus === "streaming" ||
                state.chatStatus === "awaiting_permission" ||
                state.chatStatus === "cancelling"),
          };
        } catch {
          return { status: "missing", resumable: false, promptActive: false };
        }
      },
    },
    workerSessions,
    workspaces,
    orchestrator,
    manager
  );
  const globalScheduler = new SupervisorGlobalSchedulerService({
    runs,
    orchestrator,
  });
  orchestrator.setGlobalScheduler(() => globalScheduler.tick());
  const events = new SupervisorRunEventsService(deps.eventBus);
  const inbox = new SupervisorManagerInboxService(orchestrator, events);
  const power = new SupervisorPowerLeaseCoordinator(
    runs,
    deps.eventBus,
    new SystemSupervisorPowerLeaseAdapter()
  );
  power.start();
  const telegram = new TelegramManagerBridgeService(
    new CredentialTelegramManagerSecretStoreAdapter(credential.credential),
    {
      async list(input) {
        return (
          await orchestrator.list({
            userId: input.userId,
            includeTerminal: input.includeTerminal,
          })
        ).map((run) => createClientSafeSupervisorRunUpdate(run));
      },
      async approvePlan(input) {
        await orchestrator.approvePlan(input);
      },
      async requestPlanChanges(input) {
        await orchestrator.requestPlanChanges(input);
      },
      async pause(runId, userId) {
        await orchestrator.pause(runId, userId);
      },
      async resume(runId, userId) {
        await orchestrator.resume(runId, userId);
      },
      async cancel(runId, userId) {
        await orchestrator.cancel(runId, userId);
      },
    },
    {
      list: (input) => inbox.list(input),
      async answer(input) {
        await orchestrator.answerDecision(input);
      },
    },
    new TelegramBotApiAdapter()
  );
  const telegramPolling = new TelegramLongPollingCoordinator(
    telegram,
    deps.eventBus,
    () => [LOCAL_DESKTOP_USER_ID]
  );
  telegramPolling.start();
  return {
    planner,
    manager,
    capacity,
    resultReader,
    profiles,
    globalScheduler,
    inbox,
    power,
    telegram,
    telegramPolling,
    workerSessions,
    orchestrator,
    recovery,
    workflowRuntime,
    workerPermissions,
    events,
    integration,
  };
}

function readBoundedLimit(
  key: string,
  fallback: number,
  maximum: number,
  minimum = 1
): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!(Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum)) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function readSupervisorModelEffort(): string | undefined {
  const key = "SUPERVISOR_ORCHESTRATION_MODEL_EFFORT";
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  if (!["none", "low", "medium", "high", "xhigh", "max"].includes(value)) {
    throw new Error(
      `${key} must be one of none, low, medium, high, xhigh, or max`
    );
  }
  return value;
}

function requireIntentString(
  intent: Record<string, unknown>,
  key: string
): string {
  const value = intent[key];
  if (typeof value !== "string") {
    throw new Error(`Workflow effect intent requires ${key}`);
  }
  return value;
}

function optionalIntentString(
  intent: Record<string, unknown>,
  key: string
): string | undefined {
  const value = intent[key];
  return typeof value === "string" ? value : undefined;
}

function requireWorkflowTask(
  run: Parameters<typeof createClientSafeSupervisorRunUpdate>[0],
  taskId: string
) {
  const task = run.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new Error(`Supervisor task not found: ${taskId}`);
  }
  return task;
}

function requireWorkflowAttempt(
  run: Parameters<typeof createClientSafeSupervisorRunUpdate>[0],
  taskId: string,
  attemptId: string
) {
  const attempt = requireWorkflowTask(run, taskId).attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (!attempt) {
    throw new Error(`Supervisor attempt not found: ${attemptId}`);
  }
  return attempt;
}

function findWorkflowAttemptByChatId(
  run: Parameters<typeof createClientSafeSupervisorRunUpdate>[0],
  chatId: string
) {
  for (const task of run.tasks) {
    const attempt = task.attempts.find(
      (candidate) => candidate.chatId === chatId
    );
    if (attempt) {
      return { taskId: task.taskId, attemptId: attempt.attemptId };
    }
  }
  return undefined;
}

function findWorkflowWorkspace(
  run: Parameters<typeof createClientSafeSupervisorRunUpdate>[0],
  workspaceId: string
) {
  for (const task of run.tasks) {
    const workspace = task.attempts.find(
      (attempt) => attempt.workspace?.workspaceId === workspaceId
    )?.workspace;
    if (workspace) {
      return workspace;
    }
  }
  return undefined;
}

function createEvidenceRef(
  runId: string,
  scopeId: string,
  evidence: {
    command: string;
    exitCode: number | null;
    outputSummary: string;
    startedAt: string;
    finishedAt: string;
  }
): string {
  const digest = CryptoHasher.hash(
    "sha256",
    JSON.stringify({ runId, scopeId, evidence }),
    "hex"
  );
  return `verification-evidence-${digest}`;
}
