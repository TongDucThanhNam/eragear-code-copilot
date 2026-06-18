import { initializeBotAutomationEvents } from "@/modules/bots/init/bot-automation-events.init";
import { initializeFileWatcherEvents } from "@/modules/file-watcher/init/file-watcher-events.init";
import { initializeGitEvents } from "@/modules/git/init/git-events.init";
import { initializeProjectEvents } from "@/modules/project/init/project-events.init";
import type { SessionRuntimePort } from "@/modules/session";
import { initializeSubagentEvents } from "@/modules/session/init/subagent-events.init";
import { initializeSettingsEvents } from "@/modules/settings/init/settings-events.init";
import { initializeSupervisorEvents } from "@/modules/supervisor/init/supervisor-events.init";
import { initializeUsageStatsEvents } from "@/modules/usage-stats/init/usage-stats-events.init";
import type { AppUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

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
