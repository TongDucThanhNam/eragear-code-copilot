import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  type AcpAuthRecord,
  AcpAuthRecordSchema,
  type AcpProviderAuthFile,
  type DeleteAcpAuthInput,
  type ListAcpAuthInput,
  type UpsertAcpAuthInput,
} from "../application/contracts/acp-auth.contract";
import type {
  AcpAuthRepositoryPort,
  AcpAuthSyncPatch,
} from "../application/ports/acp-auth-repository.port";

const DOCUMENT_VERSION = 1;
const FILE_MODE_PRIVATE = 0o600;
const MODULE = "acp-auth";

const AcpAuthDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    providers: z.array(AcpAuthRecordSchema),
  })
  .strict();

type AcpAuthDocument = z.infer<typeof AcpAuthDocumentSchema>;

export interface AcpAuthFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
  storageRootPath: string | (() => string | Promise<string>);
  nowMs?: () => number;
}

export class AcpAuthFileRepository implements AcpAuthRepositoryPort {
  private readonly filePathProvider: () => string | Promise<string>;
  private readonly storageRootPathProvider: () => string | Promise<string>;
  private readonly nowMs: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: AcpAuthFileRepositoryParams) {
    this.filePathProvider =
      typeof params.filePath === "string"
        ? () => params.filePath as string
        : params.filePath;
    this.storageRootPathProvider =
      typeof params.storageRootPath === "string"
        ? () => params.storageRootPath as string
        : params.storageRootPath;
    this.nowMs = params.nowMs ?? (() => Date.now());
  }

  async list(
    userId: string,
    input?: ListAcpAuthInput
  ): Promise<AcpAuthRecord[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return filterRecords(document.providers, { ...input, userId });
    });
  }

  async listAll(input?: ListAcpAuthInput): Promise<AcpAuthRecord[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return filterRecords(document.providers, input);
    });
  }

  async get(
    userId: string,
    providerId: string
  ): Promise<AcpAuthRecord | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return (
        document.providers.find(
          (record) =>
            record.userId === userId && record.providerId === providerId
        ) ?? null
      );
    });
  }

  async upsert(
    userId: string,
    input: UpsertAcpAuthInput & { authFilePath: string }
  ): Promise<AcpAuthRecord> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const now = this.nowMs();
      const existingIndex = document.providers.findIndex(
        (record) =>
          record.userId === userId && record.providerId === input.providerId
      );
      const previous =
        existingIndex >= 0 ? document.providers[existingIndex] : undefined;
      const record = AcpAuthRecordSchema.parse({
        userId,
        providerId: input.providerId,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        method: input.method,
        ...(input.credentialId ? { credentialId: input.credentialId } : {}),
        ...(input.envKey ? { envKey: input.envKey } : {}),
        authFilePath: normalizeAuthFilePath(input.authFilePath),
        enabled: input.enabled ?? previous?.enabled ?? true,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        syncStatus: "pending",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });

      if (existingIndex >= 0) {
        document.providers[existingIndex] = record;
      } else {
        document.providers.push(record);
      }
      await this.writeDocument(document);
      return record;
    });
  }

  async delete(
    userId: string,
    input: DeleteAcpAuthInput
  ): Promise<void> {
    await this.enqueue(async () => {
      const document = await this.readDocument();
      const before = document.providers.length;
      document.providers = document.providers.filter(
        (record) =>
          !(record.userId === userId && record.providerId === input.providerId)
      );
      if (document.providers.length === before) {
        throw new NotFoundError("ACP auth provider not found", {
          module: MODULE,
          op: "delete",
          details: { providerId: input.providerId },
        });
      }
      await this.writeDocument(document);
    });
  }

  async updateSyncState(
    userId: string,
    providerId: string,
    patch: AcpAuthSyncPatch
  ): Promise<AcpAuthRecord> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const index = document.providers.findIndex(
        (record) => record.userId === userId && record.providerId === providerId
      );
      const previous = index >= 0 ? document.providers[index] : undefined;
      if (!previous) {
        throw new NotFoundError("ACP auth provider not found", {
          module: MODULE,
          op: "sync",
          details: { providerId },
        });
      }
      const next = AcpAuthRecordSchema.parse({
        ...previous,
        syncStatus: patch.syncStatus,
        syncError: patch.syncError,
        lastSyncedAt: patch.lastSyncedAt ?? previous.lastSyncedAt,
        updatedAt: this.nowMs(),
      });
      document.providers[index] = next;
      await this.writeDocument(document);
      return next;
    });
  }

  async writeProviderAuthFile(
    record: AcpAuthRecord,
    payload: AcpProviderAuthFile
  ): Promise<void> {
    const target = await this.resolveAuthFilePath(record.authFilePath);
    await mkdir(path.dirname(target), { recursive: true });
    const tempPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: FILE_MODE_PRIVATE,
    });
    await chmod(tempPath, FILE_MODE_PRIVATE).catch(() => undefined);
    await rename(tempPath, target);
    await chmod(target, FILE_MODE_PRIVATE).catch(() => undefined);
  }

  async removeProviderAuthFile(record: AcpAuthRecord): Promise<void> {
    const target = await this.resolveAuthFilePath(record.authFilePath);
    await rm(target, { force: true }).catch(() => undefined);
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

  private async readDocument(): Promise<AcpAuthDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return AcpAuthDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, providers: [] };
      }
      throw error;
    }
  }

  private async writeDocument(document: AcpAuthDocument): Promise<void> {
    const filePath = await this.resolveFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  }

  private async resolveFilePath(): Promise<string> {
    return await this.filePathProvider();
  }

  private async resolveStorageRootPath(): Promise<string> {
    return path.resolve(await this.storageRootPathProvider());
  }

  private async resolveAuthFilePath(relativePath: string): Promise<string> {
    const normalized = normalizeAuthFilePath(relativePath);
    const root = await this.resolveStorageRootPath();
    const target = path.resolve(root, normalized);
    const relative = path.relative(root, target);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new ValidationError("ACP auth file path must stay in storage", {
        module: MODULE,
        op: "resolve-auth-file",
        details: { authFilePath: relativePath },
      });
    }
    return target;
  }
}

function filterRecords(
  records: AcpAuthRecord[],
  input?: ListAcpAuthInput & { userId?: string }
): AcpAuthRecord[] {
  return records
    .filter((record) => !input?.userId || record.userId === input.userId)
    .filter(
      (record) =>
        !input?.providerId || record.providerId === input.providerId.trim()
    )
    .filter((record) => input?.includeDisabled || record.enabled)
    .sort((left, right) => {
      const leftName = left.displayName ?? left.providerId;
      const rightName = right.displayName ?? right.providerId;
      return leftName.localeCompare(rightName);
    });
}

function normalizeAuthFilePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new ValidationError("Invalid ACP auth file path", {
      module: MODULE,
      op: "normalize-auth-file",
      details: { authFilePath: value },
    });
  }
  return normalized;
}
