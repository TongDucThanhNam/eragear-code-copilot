import { createEventBusFileWatcherNotifier } from "#runtime/modules/file-watcher";
import type { FileWatcherUseCases } from "#runtime/modules/use-cases";
import { FsFileWatcherAdapter } from "#runtime/platform/file-watcher";
import type { ServiceRegistrySlice } from "./dependencies";

type FileWatcherDependencies = ServiceRegistrySlice<"eventBus" | "appLogger">;

export function createFileWatcherUseCases(
  deps: FileWatcherDependencies
): FileWatcherUseCases {
  return {
    fileWatcher: new FsFileWatcherAdapter({
      notifier: createEventBusFileWatcherNotifier(deps.eventBus),
      logger: deps.appLogger,
    }),
  };
}
