import {
  type SlashCommandDescriptor,
  type SlashCommandDiscoveryPort,
  type SlashCommandsProjectInput,
  SlashCommandsService,
  type ToggleSlashCommandInput,
} from "@/modules/commands";
import { SlashCommandFileRepository } from "@/modules/commands/di";
import type { LocalAdeService } from "@/modules/settings";
import type { CommandsUseCases, UseCasePort } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { ServiceRegistryDependencies } from "./dependencies";

class LocalAdeSlashCommandDiscoveryAdapter
  implements SlashCommandDiscoveryPort
{
  private readonly localAde: UseCasePort<LocalAdeService>;

  constructor(localAde: UseCasePort<LocalAdeService>) {
    this.localAde = localAde;
  }

  async listDiscoveredCommands(
    userId: string,
    _input?: SlashCommandsProjectInput
  ): Promise<SlashCommandDescriptor[]> {
    const snapshot = await this.localAde.snapshot(userId);
    return snapshot.commands.map(toSlashCommandDescriptor);
  }

  async setDiscoveredCommandEnabled(
    userId: string,
    input: ToggleSlashCommandInput
  ): Promise<SlashCommandDescriptor[]> {
    const snapshot = await this.localAde.updateCapabilityState(userId, {
      capabilityId: input.id,
      enabled: input.enabled,
    });
    return snapshot.commands.map(toSlashCommandDescriptor);
  }
}

function toSlashCommandDescriptor(command: {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  sourcePath: string;
  enabled: boolean;
  argumentHint?: string;
  scope: string;
  tags?: string[];
  diagnostics?: string[];
}): SlashCommandDescriptor {
  return {
    id: command.id,
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    prompt: command.prompt,
    sourcePath: command.sourcePath,
    enabled: command.enabled,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    scope: command.scope,
    storage: "filesystem-discovery",
    tags: command.tags ?? [],
    diagnostics: command.diagnostics ?? [],
  };
}

export function createCommandsUseCases(
  deps: ServiceRegistryDependencies,
  localAde: UseCasePort<LocalAdeService>
): CommandsUseCases {
  return {
    commands: new SlashCommandsService({
      discovery: new LocalAdeSlashCommandDiscoveryAdapter(localAde),
      customCommands: new SlashCommandFileRepository({
        filePath: () => getStorageFileSync("slash-commands.json"),
        nowMs: deps.clock.nowMs,
      }),
    }),
  };
}
