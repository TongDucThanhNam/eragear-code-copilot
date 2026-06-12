import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  type TerminalSettings,
  TerminalSettingsSchema,
  type UpdateTerminalSettingsInput,
} from "../application/contracts/terminal.contract";
import type { TerminalSettingsRepositoryPort } from "../application/ports/terminal-settings-repository.port";
import { DEFAULT_TERMINAL_SETTINGS } from "../application/terminal.service";

const DOCUMENT_VERSION = 1;

const TerminalSettingsDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    settingsByUserId: z.record(z.string(), TerminalSettingsSchema),
  })
  .strict();

type TerminalSettingsDocument = z.infer<typeof TerminalSettingsDocumentSchema>;

export interface TerminalSettingsFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class TerminalSettingsFileRepository
  implements TerminalSettingsRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: TerminalSettingsFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async getSettings(userId: string): Promise<TerminalSettings> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return document.settingsByUserId[userId] ?? defaultSettings();
    });
  }

  async updateSettings(
    userId: string,
    input?: UpdateTerminalSettingsInput
  ): Promise<TerminalSettings> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const next = TerminalSettingsSchema.parse({
        ...defaultSettings(),
        ...(document.settingsByUserId[userId] ?? {}),
        ...(input ?? {}),
      });
      document.settingsByUserId[userId] = next;
      await this.writeDocument(document);
      return next;
    });
  }

  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async readDocument(): Promise<TerminalSettingsDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return TerminalSettingsDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, settingsByUserId: {} };
      }
      throw error;
    }
  }

  private async writeDocument(
    document: TerminalSettingsDocument
  ): Promise<void> {
    const filePath = await this.resolveFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`);
    await rename(tempPath, filePath);
  }

  private async resolveFilePath(): Promise<string> {
    return await this.filePathProvider();
  }
}

function defaultSettings(): TerminalSettings {
  return { ...DEFAULT_TERMINAL_SETTINGS };
}
