import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "#runtime/shared/utils/node-error.util";
import {
  type ModelProviderRecord,
  ModelProviderRecordSchema,
} from "../application/contracts/model-provider.contract";
import type {
  ModelProviderRepositoryPort,
  ModelProviderStoreSnapshot,
  MutableModelProviderStoreSnapshot,
} from "../application/ports/model-provider-repository.port";

const DOCUMENT_VERSION = 1;

const ModelProviderDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    seededUserIds: z.array(z.string()).default([]),
    providers: z.array(ModelProviderRecordSchema),
  })
  .strict();

type ModelProviderDocument = z.infer<typeof ModelProviderDocumentSchema>;

export interface ModelProviderFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class ModelProviderFileRepository
  implements ModelProviderRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: ModelProviderFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async read<T>(
    reader: (snapshot: ModelProviderStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(toStoreSnapshot(document));
    });
  }

  async mutate<T>(
    mutator: (snapshot: MutableModelProviderStoreSnapshot) => T | Promise<T>
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

  private async readDocument(): Promise<ModelProviderDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return ModelProviderDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, seededUserIds: [], providers: [] };
      }
      throw error;
    }
  }

  private async writeDocument(document: ModelProviderDocument): Promise<void> {
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
  document: ModelProviderDocument
): ModelProviderStoreSnapshot {
  return {
    seededUserIds: [...document.seededUserIds],
    providers: document.providers.map(cloneProvider),
  };
}

function toMutableStoreSnapshot(
  document: ModelProviderDocument
): MutableModelProviderStoreSnapshot {
  return {
    seededUserIds: [...document.seededUserIds],
    providers: document.providers.map(cloneProvider),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableModelProviderStoreSnapshot
): ModelProviderDocument {
  return ModelProviderDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    seededUserIds: [...snapshot.seededUserIds],
    providers: snapshot.providers.map((provider) =>
      ModelProviderRecordSchema.parse(provider)
    ),
  });
}

function cloneProvider(provider: ModelProviderRecord): ModelProviderRecord {
  return ModelProviderRecordSchema.parse(provider);
}
