import {
  SUPERVISOR_RUN_LIMIT_CAPS,
  SupervisorOrchestratorService,
  SupervisorPlannerService,
  SupervisorRecoveryService,
  SupervisorRunEventsService,
  SupervisorSchedulerService,
  WorkerIntegrationService,
  WorkerResultService,
  WorkerSessionManagerService,
} from "#runtime/modules/supervisor-orchestration";
import {
  AiSdkSupervisorPlannerAdapter,
  ConfiguredAgentCatalogAdapter,
  GitSupervisorBaseSnapshotAdapter,
  GitWorkerWorkspaceAdapter,
  NotifyingSupervisorRunRepository,
  parseTrustedSupervisorVerificationCommands,
  TrustedCommandSupervisorVerifierAdapter,
} from "#runtime/modules/supervisor-orchestration/di";
import type {
  AgentUseCases,
  AiUseCases,
  SessionUseCases,
  SupervisorOrchestrationUseCases,
} from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type SupervisorOrchestrationDependencies = ServiceRegistrySlice<
  | "appLogger"
  | "eventBus"
  | "gitAdapter"
  | "supervisorPolicy"
  | "supervisorRunRepo"
>;

export function createSupervisorOrchestrationUseCases(
  deps: SupervisorOrchestrationDependencies,
  session: SessionUseCases,
  ai: AiUseCases,
  agents: AgentUseCases
): SupervisorOrchestrationUseCases {
  const runs = new NotifyingSupervisorRunRepository(
    deps.supervisorRunRepo,
    deps.eventBus,
    deps.appLogger
  );
  const plannerAdapter = new AiSdkSupervisorPlannerAdapter(
    deps.supervisorPolicy,
    deps.appLogger
  );
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
  const workerSessions = new WorkerSessionManagerService({
    runs,
    createSession: session.create,
    sendMessage: ai.sendMessage,
    stopSession: session.stop,
    resumeSession: session.resume,
    setModel: ai.setModel,
  });
  const workspaces = new GitWorkerWorkspaceAdapter();
  const integration = new WorkerIntegrationService(workspaces);
  const results = new WorkerResultService();
  const finalVerifier = new TrustedCommandSupervisorVerifierAdapter();
  const orchestrator = new SupervisorOrchestratorService({
    runs,
    planner,
    scheduler: new SupervisorSchedulerService(),
    workers: workerSessions,
    agents: new ConfiguredAgentCatalogAdapter(agents.list),
    baseSnapshot: new GitSupervisorBaseSnapshotAdapter(deps.gitAdapter),
    workspaces,
    integration,
    results,
    finalVerifier,
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
      maxRunDurationMs: readBoundedLimit(
        "SUPERVISOR_ORCHESTRATION_MAX_RUN_DURATION_MS",
        2 * 60 * 60 * 1000,
        SUPERVISOR_RUN_LIMIT_CAPS.maxRunDurationMs
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
  return {
    planner,
    workerSessions,
    orchestrator,
    recovery,
    events: new SupervisorRunEventsService(deps.eventBus),
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
