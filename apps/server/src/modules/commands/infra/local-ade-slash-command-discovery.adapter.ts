import type {
  SlashCommandDescriptor,
  SlashCommandsProjectInput,
  ToggleSlashCommandInput,
} from "../application/contracts/commands.contract";
import type { SlashCommandDiscoveryPort } from "../application/ports/slash-command-registry.port";

interface LocalAdeCommand {
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
}

interface LocalAdeCommandSnapshot {
  commands: LocalAdeCommand[];
}

export interface LocalAdeSlashCommandSource {
  snapshot(userId: string): Promise<LocalAdeCommandSnapshot>;
  updateCapabilityState(
    userId: string,
    input: { capabilityId: string; enabled: boolean }
  ): Promise<LocalAdeCommandSnapshot>;
}

export class LocalAdeSlashCommandDiscoveryAdapter
  implements SlashCommandDiscoveryPort
{
  private readonly localAde: LocalAdeSlashCommandSource;

  constructor(localAde: LocalAdeSlashCommandSource) {
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

function toSlashCommandDescriptor(
  command: LocalAdeCommand
): SlashCommandDescriptor {
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
