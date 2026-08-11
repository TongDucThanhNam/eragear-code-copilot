import {
  AcpCapacityCoordinator,
  AcpManagerSessionCoordinator,
  createClientSafeSupervisorRunUpdate,
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
  TelegramLongPollingCoordinator,
  TelegramManagerBridgeService,
  WorkerIntegrationService,
  WorkerResultService,
  WorkerSessionManagerService,
} from "#runtime/modules/supervisor-orchestration";
import {
  AcpManagerOnlySupervisorPlannerAdapter,
  ConfiguredAgentCatalogAdapter,
  CredentialTelegramManagerSecretStoreAdapter,
  GitScopedFinalCommitAdapter,
  GitSupervisorBaseSnapshotAdapter,
  GitWorkerWorkspaceAdapter,
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
>;

export function createSupervisorOrchestrationUseCases(
  deps: SupervisorOrchestrationDependencies,
  session: SessionUseCases,
  ai: AiUseCases,
  agents: AgentUseCases,
  credential: CredentialUseCases,
  tooling: ToolingUseCases
): SupervisorOrchestrationUseCases {
  const runs = new NotifyingSupervisorRunRepository(
    deps.supervisorRunRepo,
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
      stop: (userId, chatId) => session.stop.execute(userId, chatId),
      resumeExact: (userId, chatId) =>
        session.resume.execute(userId, chatId, { mode: "exact_only" }),
    },
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
    sendMessage: ai.sendMessage,
    stopSession: session.stop,
    resumeSession: session.resume,
    results: resultReader,
    capacity,
    readiness: profiles,
  });
  const workerSessions = new WorkerSessionManagerService({
    runs,
    createSession: session.create,
    sendMessage: ai.sendMessage,
    stopSession: session.stop,
    resumeSession: session.resume,
    setModel: ai.setModel,
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
    configuredLimits: {
      maxConcurrency: readBoundedLimit(
        "SUPERVISOR_ORCHESTRATION_MAX_CONCURRENCY",
        2,
        SUPERVISOR_RUN_LIMIT_CAPS.maxConcurrency
      ),
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
  const recovery = new SupervisorRecoveryService(
    runs,
    {
      async inspect(input) {
        try {
          const state = await session.queries.state(input.userId, input.chatId);
          return {
            status: state.status,
            resumable:
              state.status === "stopped" && state.loadSessionSupported === true,
          };
        } catch {
          return { status: "missing", resumable: false };
        }
      },
    },
    workerSessions,
    workspaces,
    orchestrator
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
