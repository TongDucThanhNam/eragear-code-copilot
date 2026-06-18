import type { EventBusPort } from "@/shared/ports/event-bus.port";

export interface SettingsChangedNotification {
  changedKeys: string[];
  requiresRestart: string[];
}

export interface SettingsChangeNotifier {
  publishSettingsChanged(input: SettingsChangedNotification): Promise<void>;
}

export function createEventBusSettingsChangeNotifier(
  eventBus: EventBusPort
): SettingsChangeNotifier {
  return {
    async publishSettingsChanged(input) {
      await eventBus.publish({
        type: "settings_updated",
        changedKeys: input.changedKeys,
        requiresRestart: input.requiresRestart,
      });
      await eventBus.publish({
        type: "dashboard_refresh",
        reason: "settings_updated",
      });
    },
  };
}

export const noopSettingsChangeNotifier: SettingsChangeNotifier = {
  publishSettingsChanged: () => Promise.resolve(),
};
