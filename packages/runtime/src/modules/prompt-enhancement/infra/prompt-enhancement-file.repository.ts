import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "#runtime/shared/utils/node-error.util";
import {
  type PromptEnhancementSettings,
  PromptEnhancementSettingsSchema,
} from "../application/contracts/prompt-enhancement.contract";
import type {
  MutablePromptEnhancementStoreSnapshot,
  PromptEnhancementRepositoryPort,
  PromptEnhancementStoreSnapshot,
} from "../application/ports/prompt-enhancement-repository.port";

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

  async read<T>(
    reader: (snapshot: PromptEnhancementStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(toStoreSnapshot(document));
    });
  }

  async mutate<T>(
    mutator: (snapshot: MutablePromptEnhancementStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const snapshot = toMutableStoreSnapshot(document);
      const result = await mutator(snapshot);
      await this.writeDocument(fromMutableStoreSnapshot(snapshot));
      return result;
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

function toStoreSnapshot(
  document: PromptEnhancementDocument
): PromptEnhancementStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(document.settingsByUserId),
  };
}

function toMutableStoreSnapshot(
  document: PromptEnhancementDocument
): MutablePromptEnhancementStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(document.settingsByUserId),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutablePromptEnhancementStoreSnapshot
): PromptEnhancementDocument {
  return PromptEnhancementDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    settingsByUserId: cloneSettingsByUserId(snapshot.settingsByUserId),
  });
}

function cloneSettingsByUserId(
  settingsByUserId: Record<string, PromptEnhancementSettings>
): Record<string, PromptEnhancementSettings> {
  return Object.fromEntries(
    Object.entries(settingsByUserId).map(([userId, settings]) => [
      userId,
      PromptEnhancementSettingsSchema.parse(settings),
    ])
  );
}
