import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { NotFoundError } from "@/shared/errors";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  type DeleteModelProviderInput,
  type DeleteModelProviderResult,
  type GetModelProviderInput,
  type ListModelProvidersInput,
  type ModelProviderListResult,
  type ModelProviderRecord,
  ModelProviderRecordSchema,
  type ModelProviderSeed,
  type UpsertModelProviderInput,
} from "../application/contracts/model-provider.contract";
import type { ModelProviderRepositoryPort } from "../application/ports/model-provider-repository.port";

const DOCUMENT_VERSION = 1;
const MODULE = "model-provider";

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
  nowMs?: () => number;
}

export class ModelProviderFileRepository
  implements ModelProviderRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private readonly nowMs: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: ModelProviderFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
    this.nowMs = params.nowMs ?? (() => Date.now());
  }

  async list(
    userId: string,
    input?: ListModelProvidersInput
  ): Promise<ModelProviderListResult> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return listFromDocument(document, userId, input);
    });
  }

  async get(
    userId: string,
    input: GetModelProviderInput
  ): Promise<ModelProviderRecord | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return (
        document.providers.find(
          (provider) => provider.userId === userId && provider.id === input.id
        ) ?? null
      );
    });
  }

  async upsert(
    userId: string,
    input: UpsertModelProviderInput
  ): Promise<ModelProviderRecord> {
    return await this.enqueue(async () => {
      const now = this.nowMs();
      const document = await this.readDocument();
      const existingIndex = input.id
        ? document.providers.findIndex(
            (provider) => provider.userId === userId && provider.id === input.id
          )
        : -1;
      const previous =
        existingIndex >= 0 ? document.providers[existingIndex] : undefined;
      const provider = ModelProviderRecordSchema.parse({
        id: previous?.id ?? input.id ?? createProviderId(),
        userId,
        name: input.name,
        endpoints: input.endpoints,
        ...(input.credentialId ? { credentialId: input.credentialId } : {}),
        ...(input.apiKeyUrl ? { apiKeyUrl: input.apiKeyUrl } : {}),
        models: input.models,
        modelSupportedFormats: input.modelSupportedFormats ?? {},
        providerMappings: input.providerMappings ?? {},
        source: previous?.source ?? "custom",
        enabled: input.enabled ?? previous?.enabled ?? true,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });

      if (existingIndex >= 0) {
        document.providers[existingIndex] = provider;
      } else {
        document.providers.push(provider);
      }
      await this.writeDocument(document);
      return provider;
    });
  }

  async delete(
    userId: string,
    input: DeleteModelProviderInput
  ): Promise<DeleteModelProviderResult> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const before = document.providers.length;
      document.providers = document.providers.filter(
        (provider) => !(provider.userId === userId && provider.id === input.id)
      );
      if (document.providers.length === before) {
        throw new NotFoundError("Model provider not found", {
          module: MODULE,
          op: "delete",
          details: { providerId: input.id },
        });
      }
      await this.writeDocument(document);
      return { deleted: true };
    });
  }

  async ensureDefaults(
    userId: string,
    defaults: ModelProviderSeed[]
  ): Promise<void> {
    await this.enqueue(async () => {
      const document = await this.readDocument();
      if (document.seededUserIds.includes(userId)) {
        return;
      }
      addMissingDefaults(document, userId, defaults, this.nowMs());
      document.seededUserIds.push(userId);
      await this.writeDocument(document);
    });
  }

  async restoreDefaults(
    userId: string,
    defaults: ModelProviderSeed[]
  ): Promise<ModelProviderListResult> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      addMissingDefaults(document, userId, defaults, this.nowMs());
      if (!document.seededUserIds.includes(userId)) {
        document.seededUserIds.push(userId);
      }
      await this.writeDocument(document);
      return listFromDocument(document, userId, { includeDisabled: true });
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

function addMissingDefaults(
  document: ModelProviderDocument,
  userId: string,
  defaults: ModelProviderSeed[],
  now: number
): void {
  const existingIds = new Set(
    document.providers
      .filter((provider) => provider.userId === userId)
      .map((provider) => provider.id)
  );
  for (const seed of defaults) {
    if (existingIds.has(seed.id)) {
      continue;
    }
    document.providers.push(
      ModelProviderRecordSchema.parse({
        ...seed,
        userId,
        createdAt: now,
        updatedAt: now,
      })
    );
    existingIds.add(seed.id);
  }
}

function listFromDocument(
  document: ModelProviderDocument,
  userId: string,
  input?: ListModelProvidersInput
): ModelProviderListResult {
  const providers = document.providers
    .filter((provider) => provider.userId === userId)
    .filter((provider) => input?.includeDisabled || provider.enabled)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    providers,
    totalCount: providers.length,
  };
}

function createProviderId(): string {
  return `provider_${randomUUID()}`;
}
