import { FileWatcherService } from "@/modules/file-watcher";
import type { FileWatcherUseCases } from "@/modules/use-cases";
import { FsFileWatcherAdapter } from "@/platform/file-watcher";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createFileWatcherUseCases(
  deps: ServiceRegistryDependencies
): FileWatcherUseCases {
  return {
    fileWatcher: new FileWatcherService(
      new FsFileWatcherAdapter({
        eventBus: deps.eventBus,
        logger: deps.appLogger,
      })
    ),
  };
}
