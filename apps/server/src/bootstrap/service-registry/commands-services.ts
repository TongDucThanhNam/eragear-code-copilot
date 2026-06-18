import { SlashCommandsService } from "@/modules/commands";
import {
  LocalAdeSlashCommandDiscoveryAdapter,
  type LocalAdeSlashCommandSource,
  SlashCommandFileRepository,
} from "@/modules/commands/di";
import type { CommandsUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type CommandsServiceDependencies = ServiceRegistrySlice<"clock">;

export function createCommandsUseCases(
  deps: CommandsServiceDependencies,
  localAde: LocalAdeSlashCommandSource
): CommandsUseCases {
  return {
    commands: new SlashCommandsService({
      discovery: new LocalAdeSlashCommandDiscoveryAdapter(localAde),
      customCommands: new SlashCommandFileRepository({
        filePath: () => getStorageFileSync("slash-commands.json"),
      }),
      nowMs: deps.clock.nowMs,
    }),
  };
}
