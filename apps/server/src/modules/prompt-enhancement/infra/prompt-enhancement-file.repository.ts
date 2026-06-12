import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  type PromptEnhancementSettings,
  PromptEnhancementSettingsSchema,
  type UpdatePromptEnhancementSettingsInput,
} from "../application/contracts/prompt-enhancement.contract";
import type { PromptEnhancementRepositoryPort } from "../application/ports/prompt-enhancement-repository.port";
import { DEFAULT_PROMPT_ENHANCEMENT_SETTINGS } from "../application/prompt-enhancement.service";

const DOCUMENT_VERSION = 1;

const PromptEnhancementDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    settingsByUserId: z.record(z.string(), PromptEnhancementSettingsSchema),
  })
  .strict();

type PromptEnhancementDocument = z.infer<
  typeof PromptEnhancementDocumentSchema
>;

export interface PromptEnhancementFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class PromptEnhancementFileRepository
  implements PromptEnhancementRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: PromptEnhancementFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async getSettings(userId: string): Promise<PromptEnhancementSettings> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return document.settingsByUserId[userId] ?? defaultSettings();
    });
  }

  async updateSettings(
    userId: string,
    input: UpdatePromptEnhancementSettingsInput
  ): Promise<PromptEnhancementSettings> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const next = PromptEnhancementSettingsSchema.parse({
        ...defaultSettings(),
        ...(document.settingsByUserId[userId] ?? {}),
        ...input,
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

  private async readDocument(): Promise<PromptEnhancementDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return PromptEnhancementDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, settingsByUserId: {} };
      }
      throw error;
    }
  }

  private async writeDocument(
    document: PromptEnhancementDocument
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

function defaultSettings(): PromptEnhancementSettings {
  return { ...DEFAULT_PROMPT_ENHANCEMENT_SETTINGS };
}
