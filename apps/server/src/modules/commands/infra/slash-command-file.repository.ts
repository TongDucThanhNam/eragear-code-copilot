import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { NotFoundError } from "@/shared/errors";
import {
  type CustomSlashCommandRecord,
  CustomSlashCommandRecordSchema,
  type DeleteSlashCommandInput,
  type ToggleSlashCommandInput,
  type UpsertSlashCommandInput,
} from "../application/contracts/commands.contract";
import type { CustomSlashCommandRepositoryPort } from "../application/ports/slash-command-registry.port";

const SlashCommandFileSchema = z.object({
  version: z.literal(1),
  commandsByUserId: z.record(
    z.string(),
    z.array(CustomSlashCommandRecordSchema)
  ),
});

type SlashCommandFile = z.infer<typeof SlashCommandFileSchema>;

export class SlashCommandFileRepository
  implements CustomSlashCommandRepositoryPort
{
  private readonly filePath: () => string;
  private readonly nowMs: () => number;

  constructor(deps: { filePath: () => string; nowMs?: () => number }) {
    this.filePath = deps.filePath;
    this.nowMs = deps.nowMs ?? (() => Date.now());
  }

  async listCustomCommands(
    userId: string
  ): Promise<CustomSlashCommandRecord[]> {
    const file = await this.readFile();
    return [...(file.commandsByUserId[userId] ?? [])];
  }

  async createCustomCommand(
    userId: string,
    input: UpsertSlashCommandInput & { id: string; name: string }
  ): Promise<CustomSlashCommandRecord> {
    const file = await this.readFile();
    const commands = file.commandsByUserId[userId] ?? [];
    const now = this.nowMs();
    const command: CustomSlashCommandRecord = {
      id: input.id,
      userId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      prompt: input.prompt,
      sourcePath: `eragear://commands/${input.id}`,
      enabled: input.enabled ?? true,
      ...(input.argumentHint ? { argumentHint: input.argumentHint } : {}),
      scope: "user",
      storage: "custom",
      tags: ["user", "custom"],
      diagnostics: [],
      createdAt: now,
      updatedAt: now,
    };
    file.commandsByUserId[userId] = [command, ...commands];
    await this.writeFile(file);
    return command;
  }

  async updateCustomCommand(
    userId: string,
    input: UpsertSlashCommandInput & { id: string }
  ): Promise<CustomSlashCommandRecord> {
    const file = await this.readFile();
    const commands = file.commandsByUserId[userId] ?? [];
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
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      argumentHint: input.argumentHint,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: this.nowMs(),
    };
    commands[index] = next;
    file.commandsByUserId[userId] = commands;
    await this.writeFile(file);
    return next;
  }

  async setCustomCommandEnabled(
    userId: string,
    input: ToggleSlashCommandInput
  ): Promise<CustomSlashCommandRecord> {
    const file = await this.readFile();
    const commands = file.commandsByUserId[userId] ?? [];
    const command = commands.find((item) => item.id === input.id);
    if (!command) {
      throw commandNotFound(input.id);
    }
    command.enabled = input.enabled;
    command.updatedAt = this.nowMs();
    await this.writeFile(file);
    return command;
  }

  async deleteCustomCommand(
    userId: string,
    input: DeleteSlashCommandInput
  ): Promise<void> {
    const file = await this.readFile();
    const commands = file.commandsByUserId[userId] ?? [];
    const next = commands.filter((command) => command.id !== input.id);
    if (next.length === commands.length) {
      throw commandNotFound(input.id);
    }
    file.commandsByUserId[userId] = next;
    await this.writeFile(file);
  }

  private async readFile(): Promise<SlashCommandFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return SlashCommandFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return { version: 1, commandsByUserId: {} };
      }
      throw error;
    }
  }

  private async writeFile(file: SlashCommandFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function commandNotFound(commandId: string): NotFoundError {
  return new NotFoundError("Slash command not found", {
    module: "commands",
    op: "commands.registry",
    details: { commandId },
  });
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "ENOENT"
  );
}
