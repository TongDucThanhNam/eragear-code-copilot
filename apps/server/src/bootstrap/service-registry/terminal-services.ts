import { TerminalService } from "@/modules/terminal";
import {
  ChildProcessTerminalRuntimeAdapter,
  TerminalSettingsFileRepository,
} from "@/modules/terminal/di";
import type { TerminalUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createTerminalUseCases(
  deps: ServiceRegistryDependencies
): TerminalUseCases {
  return {
    terminal: new TerminalService({
      runtime: new ChildProcessTerminalRuntimeAdapter(),
      settingsRepo: new TerminalSettingsFileRepository({
        filePath: () => getStorageFileSync("terminal-settings.json"),
      }),
      projectRepo: deps.projectRepo,
    }),
  };
}
