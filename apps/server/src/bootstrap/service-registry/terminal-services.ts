import { ResolveActiveProjectService } from "@/modules/project";
import { TerminalService } from "@/modules/terminal";
import {
  ChildProcessTerminalRuntimeAdapter,
  TerminalSettingsFileRepository,
} from "@/modules/terminal/di";
import type { TerminalUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
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
