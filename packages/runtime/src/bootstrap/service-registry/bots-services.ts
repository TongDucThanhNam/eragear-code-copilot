import { BotsService } from "#runtime/modules/bots";
import {
  BotFileRepository,
  NotifyingBotRepository,
} from "#runtime/modules/bots/di";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type {
  AiUseCases,
  BotsUseCases,
  CodingPlanSubscriptionUseCases,
  QuotaUseCases,
  SessionUseCases,
  SupervisorOrchestrationUseCases,
  SupervisorUseCases,
} from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";

export function createBotsUseCases(params: {
  session: SessionUseCases;
  ai: AiUseCases;
  quota: QuotaUseCases;
  supervisor: SupervisorUseCases;
  supervisorOrchestration: SupervisorOrchestrationUseCases;
  codingPlanSubscription: CodingPlanSubscriptionUseCases;
  sessionStore: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  projectStore: ProjectRepositoryPort;
  eventBus: EventBusPort;
  logger: LoggerPort;
}): BotsUseCases {
  const repository = new NotifyingBotRepository(
    new BotFileRepository({
      filePath: () => getStorageFileSync("bots.json"),
    }),
    params.eventBus,
    params.logger
  );

  const bots = new BotsService({
    repository,
    createSession: params.session.create,
    resumeSession: params.session.resume,
    stopSession: params.session.stop,
    setModel: params.ai.setModel,
    sendMessage: params.ai.sendMessage,
    sessionStore: params.sessionStore,
    sessionRuntime: params.sessionRuntime,
    projectStore: params.projectStore,
    scheduledDecision: params.supervisor.scheduledWork,
    supervisorOrchestrator: params.supervisorOrchestration.orchestrator,
    entitlement: params.codingPlanSubscription.codingPlanSubscription,
    eventBus: params.eventBus,
    quotaProvider: params.quota.provider,
    logger: params.logger,
  });
  params.supervisorOrchestration.orchestrator.setDispatchAdmission({
    admit: (input) => bots.admitSupervisorWorker(input),
  });
  return { bots };
}
