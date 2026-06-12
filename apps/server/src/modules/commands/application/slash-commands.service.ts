import { randomUUID } from "node:crypto";
import { ValidationError } from "@/shared/errors";
import type {
  DeleteSlashCommandInput,
  SlashCommandDescriptor,
  SlashCommandsListResult,
  SlashCommandsProjectInput,
  ToggleSlashCommandInput,
  UpsertSlashCommandInput,
} from "./contracts/commands.contract";
import type {
  CustomSlashCommandRepositoryPort,
  SlashCommandDiscoveryPort,
} from "./ports/slash-command-registry.port";

const OP = "commands.registry";
const COMMAND_NAME_PATTERN = /^[a-z0-9:_-]+$/;
const LEADING_SLASH_PATTERN = /^\//;

export class SlashCommandsService {
  private readonly discovery: SlashCommandDiscoveryPort;
  private readonly customCommands: CustomSlashCommandRepositoryPort;

  constructor(deps: {
    discovery: SlashCommandDiscoveryPort;
    customCommands: CustomSlashCommandRepositoryPort;
  }) {
    this.discovery = deps.discovery;
    this.customCommands = deps.customCommands;
  }

  async list(
    userId: string,
    input?: SlashCommandsProjectInput
  ): Promise<SlashCommandsListResult> {
    return toResult(await this.listAll(userId, input));
  }

  async create(
    userId: string,
    input: UpsertSlashCommandInput
  ): Promise<SlashCommandsListResult> {
    const name = normalizeSlashCommandName(input.name);
    await this.assertNameAvailable(userId, name);
    await this.customCommands.createCustomCommand(userId, {
      ...input,
      name,
      id: input.id ?? `command.custom.${randomUUID()}`,
      enabled: input.enabled ?? true,
    });
    return await this.list(userId);
  }

  async update(
    userId: string,
    input: UpsertSlashCommandInput
  ): Promise<SlashCommandsListResult> {
    if (!input.id) {
      throw new ValidationError("Command id is required", {
        module: "commands",
        op: `${OP}.update`,
      });
    }
    const name = normalizeSlashCommandName(input.name);
    await this.assertNameAvailable(userId, name, input.id);
    await this.customCommands.updateCustomCommand(userId, {
      ...input,
      id: input.id,
      name,
    });
    return await this.list(userId);
  }

  async setEnabled(
    userId: string,
    input: ToggleSlashCommandInput
  ): Promise<SlashCommandsListResult> {
    if (input.id.startsWith("command.custom.")) {
      await this.customCommands.setCustomCommandEnabled(userId, input);
      return await this.list(userId);
    }
    const discovered = await this.discovery.setDiscoveredCommandEnabled(
      userId,
      input
    );
    const custom = await this.customCommands.listCustomCommands(userId);
    return toResult([...discovered, ...custom]);
  }

  async delete(
    userId: string,
    input: DeleteSlashCommandInput
  ): Promise<SlashCommandsListResult> {
    await this.customCommands.deleteCustomCommand(userId, input);
    return await this.list(userId);
  }

  private async listAll(
    userId: string,
    input?: SlashCommandsProjectInput
  ): Promise<SlashCommandDescriptor[]> {
    const [discovered, custom] = await Promise.all([
      this.discovery.listDiscoveredCommands(userId, input),
      this.customCommands.listCustomCommands(userId),
    ]);
    return [...custom, ...discovered].sort(compareCommands);
  }

  private async assertNameAvailable(
    userId: string,
    name: string,
    excludeId?: string
  ): Promise<void> {
    const normalized = visibleCommandName(name);
    const all = await this.listAll(userId);
    const duplicate = all.find(
      (command) =>
        command.id !== excludeId &&
        visibleCommandName(command.name) === normalized
    );
    if (duplicate) {
      throw new ValidationError(
        "A slash command with this name already exists",
        {
          module: "commands",
          op: OP,
          details: { name },
        }
      );
    }
  }
}

export function normalizeSlashCommandName(value: string): string {
  const normalized = visibleCommandName(value)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!(normalized && COMMAND_NAME_PATTERN.test(normalized))) {
    throw new ValidationError("Slash command name is invalid", {
      module: "commands",
      op: OP,
      details: { value },
    });
  }
  return `/${normalized}`;
}

function visibleCommandName(value: string): string {
  return value.trim().replace(LEADING_SLASH_PATTERN, "").toLowerCase();
}

function compareCommands(
  left: SlashCommandDescriptor,
  right: SlashCommandDescriptor
): number {
  if (left.storage !== right.storage) {
    return left.storage === "custom" ? -1 : 1;
  }
  return visibleCommandName(left.name).localeCompare(
    visibleCommandName(right.name)
  );
}

function toResult(commands: SlashCommandDescriptor[]): SlashCommandsListResult {
  return {
    commands,
    enabledCount: commands.filter((command) => command.enabled).length,
    customCount: commands.filter((command) => command.storage === "custom")
      .length,
    discoveredCount: commands.filter(
      (command) => command.storage === "filesystem-discovery"
    ).length,
    totalCount: commands.length,
  };
}
