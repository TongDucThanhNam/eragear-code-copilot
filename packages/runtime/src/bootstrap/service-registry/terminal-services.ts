import { ResolveActiveProjectService } from "#runtime/modules/project";
import { TerminalService } from "#runtime/modules/terminal";
import {
  ChildProcessTerminalRuntimeAdapter,
  TerminalSettingsFileRepository,
} from "#runtime/modules/terminal/di";
import type { TerminalUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type TerminalServiceDependencies = ServiceRegistrySlice<"projectRepo">;

export function createTerminalUseCases(
  deps: TerminalServiceDependencies
): TerminalUseCases {
  const activeProjectResolver = new ResolveActiveProjectService(
    deps.projectRepo
  );

  return {
    terminal: new TerminalService({
      runtime: new ChildProcessTerminalRuntimeAdapter(),
      settingsRepo: new TerminalSettingsFileRepository({
        filePath: () => getStorageFileSync("terminal-settings.json"),
      }),
      projectRepo: deps.projectRepo,
      activeProjectResolver,
    }),
  };
}
