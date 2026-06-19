import { initializeBotAutomationEvents } from "#runtime/modules/bots/init/bot-automation-events.init";
import { initializeFileWatcherEvents } from "#runtime/modules/file-watcher/init/file-watcher-events.init";
import { initializeGitEvents } from "#runtime/modules/git/init/git-events.init";
import { initializeProjectEvents } from "#runtime/modules/project/init/project-events.init";
import type { SessionRuntimePort } from "#runtime/modules/session";
import { initializeSubagentEvents } from "#runtime/modules/session/init/subagent-events.init";
import { initializeSettingsEvents } from "#runtime/modules/settings/init/settings-events.init";
import { initializeSupervisorEvents } from "#runtime/modules/supervisor/init/supervisor-events.init";
import { initializeUsageStatsEvents } from "#runtime/modules/usage-stats/init/usage-stats-events.init";
import type { AppUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";

export interface ModuleEventSubscriptionsOwner {
  dispose(): void;
}

export function initializeModuleEventSubscriptions(params: {
  eventBus: EventBusPort;
  useCases: AppUseCases;
  sessionRuntime: SessionRuntimePort;
  logger: LoggerPort;
}): ModuleEventSubscriptionsOwner {
  const { eventBus, logger, sessionRuntime, useCases } = params;
  const unsubscribeCallbacks = [
    initializeSettingsEvents({
      eventBus,
      settingsUseCases: useCases.settings,
    }),
    initializeProjectEvents({
      eventBus,
      sessionUseCases: useCases.session,
    }),
    initializeGitEvents({
      eventBus,
      gitUseCases: useCases.git,
      logger,
    }),
    initializeSubagentEvents({
      eventBus,
      sessionUseCases: useCases.session,
      logger,
    }),
    initializeFileWatcherEvents({
      eventBus,
      fileWatcherUseCases: useCases.fileWatcher,
      sessionRuntime,
      logger,
    }),
    initializeUsageStatsEvents({
      eventBus,
      usageStatsUseCases: useCases.usageStats,
      logger,
    }),
    initializeBotAutomationEvents({
      eventBus,
      botsUseCases: useCases.bots,
      logger,
    }),
    initializeSupervisorEvents({
      eventBus,
      supervisorUseCases: useCases.supervisor,
      logger,
    }),
  ];

  return {
    dispose() {
      for (const unsubscribe of unsubscribeCallbacks.splice(0)) {
        unsubscribe();
      }
    },
  };
}
