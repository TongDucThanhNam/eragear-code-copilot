import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type {
  CustomSlashCommandRecord,
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
  private readonly nowMs: () => number;

  constructor(deps: {
    discovery: SlashCommandDiscoveryPort;
    customCommands: CustomSlashCommandRepositoryPort;
    nowMs?: () => number;
  }) {
    this.discovery = deps.discovery;
    this.customCommands = deps.customCommands;
    this.nowMs = deps.nowMs ?? (() => Date.now());
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
    await this.customCommands.mutate((snapshot) => {
      const commands = getUserCommands(snapshot.commandsByUserId, userId);
      const command = this.createCommandRecord(userId, input, name);
      snapshot.commandsByUserId[userId] = [command, ...commands];
      return command;
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
    const commandId = input.id;
    const name = normalizeSlashCommandName(input.name);
    await this.assertNameAvailable(userId, name, commandId);
    await this.customCommands.mutate((snapshot) => {
      const commands = getUserCommands(snapshot.commandsByUserId, userId);
      const index = commands.findIndex((command) => command.id === commandId);
      if (index < 0) {
        throw commandNotFound(commandId);
      }
      const existing = commands[index];
      if (!existing) {
        throw commandNotFound(commandId);
      }
      const next: CustomSlashCommandRecord = {
        ...existing,
        name,
        description: input.description,
        prompt: input.prompt,
        argumentHint: input.argumentHint,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: this.nowMs(),
      };
      commands[index] = next;
      snapshot.commandsByUserId[userId] = commands;
      return next;
    });
    return await this.list(userId);
  }

  async setEnabled(
    userId: string,
    input: ToggleSlashCommandInput
  ): Promise<SlashCommandsListResult> {
    if (input.id.startsWith("command.custom.")) {
      await this.customCommands.mutate((snapshot) => {
        const commands = getUserCommands(snapshot.commandsByUserId, userId);
        const index = commands.findIndex((command) => command.id === input.id);
        if (index < 0) {
          throw commandNotFound(input.id);
        }
        const existing = commands[index];
        if (!existing) {
          throw commandNotFound(input.id);
        }
        const next: CustomSlashCommandRecord = {
          ...existing,
          enabled: input.enabled,
          updatedAt: this.nowMs(),
        };
        commands[index] = next;
        snapshot.commandsByUserId[userId] = commands;
        return next;
      });
      return await this.list(userId);
    }
    const discovered = await this.discovery.setDiscoveredCommandEnabled(
      userId,
      input
    );
    const custom = await this.listCustomCommands(userId);
    return toResult([...discovered, ...custom]);
  }

  async delete(
    userId: string,
    input: DeleteSlashCommandInput
  ): Promise<SlashCommandsListResult> {
    await this.customCommands.mutate((snapshot) => {
      const commands = getUserCommands(snapshot.commandsByUserId, userId);
      const next = commands.filter((command) => command.id !== input.id);
      if (next.length === commands.length) {
        throw commandNotFound(input.id);
      }
      snapshot.commandsByUserId[userId] = next;
    });
    return await this.list(userId);
  }

  private async listAll(
    userId: string,
    input?: SlashCommandsProjectInput
  ): Promise<SlashCommandDescriptor[]> {
    const [discovered, custom] = await Promise.all([
      this.discovery.listDiscoveredCommands(userId, input),
      this.listCustomCommands(userId),
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

  private async listCustomCommands(
    userId: string
  ): Promise<CustomSlashCommandRecord[]> {
    return await this.customCommands.read((snapshot) =>
      getUserCommands(snapshot.commandsByUserId, userId)
    );
  }

  private createCommandRecord(
    userId: string,
    input: UpsertSlashCommandInput,
    name: string
  ): CustomSlashCommandRecord {
    const id = input.id ?? `command.custom.${randomUUID()}`;
    const now = this.nowMs();
    return {
      id,
      userId,
      name,
      ...(input.description ? { description: input.description } : {}),
      prompt: input.prompt,
      sourcePath: `eragear://commands/${id}`,
      enabled: input.enabled ?? true,
      ...(input.argumentHint ? { argumentHint: input.argumentHint } : {}),
      scope: "user",
      storage: "custom",
      tags: ["user", "custom"],
      diagnostics: [],
      createdAt: now,
      updatedAt: now,
    };
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

function getUserCommands(
  commandsByUserId: Readonly<
    Record<string, readonly CustomSlashCommandRecord[]>
  >,
  userId: string
): CustomSlashCommandRecord[] {
  return [...(commandsByUserId[userId] ?? [])].map(cloneCommand);
}

function cloneCommand(
  command: CustomSlashCommandRecord
): CustomSlashCommandRecord {
  return {
    ...command,
    tags: [...command.tags],
    diagnostics: [...command.diagnostics],
  };
}

function commandNotFound(commandId: string): NotFoundError {
  return new NotFoundError("Slash command not found", {
    module: "commands",
    op: OP,
    details: { commandId },
  });
}
