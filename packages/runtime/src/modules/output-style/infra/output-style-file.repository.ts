import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type OutputStyleSettings,
  OutputStyleSettingsSchema,
} from "../application/contracts/output-style.contract";
import type {
  MutableOutputStyleStoreSnapshot,
  OutputStyleRepositoryPort,
  OutputStyleStoreSnapshot,
} from "../application/ports/output-style-repository.port";

const OutputStyleFileSchema = z.object({
  version: z.literal(1),
  settingsByUserId: z.record(z.string(), OutputStyleSettingsSchema),
});

type OutputStyleFile = z.infer<typeof OutputStyleFileSchema>;

interface OutputStyleFileRepositoryDeps {
  filePath: () => string;
}

export class OutputStyleFileRepository implements OutputStyleRepositoryPort {
  private readonly filePath: () => string;

  constructor(deps: OutputStyleFileRepositoryDeps) {
    this.filePath = deps.filePath;
  }

  async read<T>(
    reader: (snapshot: OutputStyleStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    return await reader(toStoreSnapshot(file));
  }

  async mutate<T>(
    mutator: (snapshot: MutableOutputStyleStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    const snapshot = toMutableStoreSnapshot(file);
    const result = await mutator(snapshot);
    await this.writeFile(fromMutableStoreSnapshot(snapshot));
    return result;
  }

  private async readFile(): Promise<OutputStyleFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return OutputStyleFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        String((error as { code?: unknown }).code) === "ENOENT"
      ) {
        return { version: 1, settingsByUserId: {} };
      }
      throw error;
    }
  }

  private async writeFile(file: OutputStyleFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function toStoreSnapshot(file: OutputStyleFile): OutputStyleStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(file.settingsByUserId),
  };
}

function toMutableStoreSnapshot(
  file: OutputStyleFile
): MutableOutputStyleStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(file.settingsByUserId),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableOutputStyleStoreSnapshot
): OutputStyleFile {
  return OutputStyleFileSchema.parse({
    version: 1,
    settingsByUserId: cloneSettingsByUserId(snapshot.settingsByUserId),
  });
}

function cloneSettingsByUserId(
  settingsByUserId: Record<string, OutputStyleSettings>
): Record<string, OutputStyleSettings> {
  return Object.fromEntries(
    Object.entries(settingsByUserId).map(([userId, settings]) => [
      userId,
      OutputStyleSettingsSchema.parse(settings),
    ])
  );
}
