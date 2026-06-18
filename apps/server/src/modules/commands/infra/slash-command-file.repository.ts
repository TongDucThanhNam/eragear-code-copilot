import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type CustomSlashCommandRecord,
  CustomSlashCommandRecordSchema,
} from "../application/contracts/commands.contract";
import type {
  CustomSlashCommandRepositoryPort,
  CustomSlashCommandStoreSnapshot,
  MutableCustomSlashCommandStoreSnapshot,
} from "../application/ports/slash-command-registry.port";

const DOCUMENT_VERSION = 1;

const SlashCommandFileSchema = z.object({
  version: z.literal(DOCUMENT_VERSION),
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

  constructor(deps: { filePath: () => string }) {
    this.filePath = deps.filePath;
  }

  async read<T>(
    reader: (snapshot: CustomSlashCommandStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    return await reader(toStoreSnapshot(file));
  }

  async mutate<T>(
    mutator: (
      snapshot: MutableCustomSlashCommandStoreSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    const snapshot = toMutableStoreSnapshot(file);
    const result = await mutator(snapshot);
    await this.writeFile(fromMutableStoreSnapshot(snapshot));
    return result;
  }

  private async readFile(): Promise<SlashCommandFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return SlashCommandFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return { version: DOCUMENT_VERSION, commandsByUserId: {} };
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

function toStoreSnapshot(
  file: SlashCommandFile
): CustomSlashCommandStoreSnapshot {
  return {
    commandsByUserId: cloneCommandsByUserId(file.commandsByUserId),
  };
}

function toMutableStoreSnapshot(
  file: SlashCommandFile
): MutableCustomSlashCommandStoreSnapshot {
  return {
    commandsByUserId: cloneCommandsByUserId(file.commandsByUserId),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableCustomSlashCommandStoreSnapshot
): SlashCommandFile {
  return SlashCommandFileSchema.parse({
    version: DOCUMENT_VERSION,
    commandsByUserId: cloneCommandsByUserId(snapshot.commandsByUserId),
  });
}

function cloneCommandsByUserId(
  commandsByUserId: Readonly<
    Record<string, readonly CustomSlashCommandRecord[]>
  >
): Record<string, CustomSlashCommandRecord[]> {
  return Object.fromEntries(
    Object.entries(commandsByUserId).map(([userId, commands]) => [
      userId,
      commands.map(cloneCommand),
    ])
  );
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

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "ENOENT"
  );
}
