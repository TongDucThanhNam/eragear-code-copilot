import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type OutputStyleSettings,
  OutputStyleSettingsSchema,
  type UpdateOutputStyleSettingsInput,
} from "../application/contracts/output-style.contract";
import type { OutputStyleRepositoryPort } from "../application/ports/output-style-repository.port";

const OutputStyleFileSchema = z.object({
  version: z.literal(1),
  settingsByUserId: z.record(z.string(), OutputStyleSettingsSchema),
});

type OutputStyleFile = z.infer<typeof OutputStyleFileSchema>;

interface OutputStyleFileRepositoryDeps {
  filePath: () => string;
  now?: () => number;
}

export class OutputStyleFileRepository implements OutputStyleRepositoryPort {
  private readonly filePath: () => string;
  private readonly now: () => number;

  constructor(deps: OutputStyleFileRepositoryDeps) {
    this.filePath = deps.filePath;
    this.now = deps.now ?? Date.now;
  }

  async getSettings(userId: string): Promise<OutputStyleSettings> {
    const file = await this.readFile();
    return file.settingsByUserId[userId] ?? this.createDefaultSettings();
  }

  async updateSettings(
    userId: string,
    input: UpdateOutputStyleSettingsInput
  ): Promise<OutputStyleSettings> {
    const file = await this.readFile();
    const current =
      file.settingsByUserId[userId] ?? this.createDefaultSettings();
    const next: OutputStyleSettings = {
      ...current,
      ...input,
      updatedAt: this.now(),
    };
    file.settingsByUserId[userId] = next;
    await this.writeFile(file);
    return next;
  }

  private createDefaultSettings(): OutputStyleSettings {
    return {
      enabled: false,
      activePresetId: "default",
      updatedAt: this.now(),
    };
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
