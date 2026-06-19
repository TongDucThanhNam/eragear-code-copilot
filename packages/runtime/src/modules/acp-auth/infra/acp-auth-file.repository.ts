import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ValidationError } from "#runtime/shared/errors";
import { getNodeErrnoCode } from "#runtime/shared/utils/node-error.util";
import {
  type AcpAuthRecord,
  AcpAuthRecordSchema,
  type AcpProviderAuthFile,
} from "../application/contracts/acp-auth.contract";
import type {
  AcpAuthRepositoryPort,
  AcpAuthStoreSnapshot,
  MutableAcpAuthStoreSnapshot,
} from "../application/ports/acp-auth-repository.port";

const DOCUMENT_VERSION = 1;
const FILE_MODE_PRIVATE = 0o600;
const MODULE = "acp-auth";
const WINDOWS_PATH_SEPARATOR_PATTERN = /\\/g;
const LEADING_SLASH_PATTERN = /^\/+/;

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
}

export class AcpAuthFileRepository implements AcpAuthRepositoryPort {
  private readonly filePathProvider: () => string | Promise<string>;
  private readonly storageRootPathProvider: () => string | Promise<string>;
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
  }

  async read<T>(
    reader: (snapshot: AcpAuthStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(toStoreSnapshot(document));
    });
  }

  async mutate<T>(
    mutator: (snapshot: MutableAcpAuthStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const snapshot = toMutableStoreSnapshot(document);
      const result = await mutator(snapshot);
      await this.writeDocument(fromMutableStoreSnapshot(snapshot));
      return result;
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

function toStoreSnapshot(document: AcpAuthDocument): AcpAuthStoreSnapshot {
  return {
    providers: document.providers.map(cloneRecord),
  };
}

function toMutableStoreSnapshot(
  document: AcpAuthDocument
): MutableAcpAuthStoreSnapshot {
  return {
    providers: document.providers.map(cloneRecord),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableAcpAuthStoreSnapshot
): AcpAuthDocument {
  return AcpAuthDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    providers: snapshot.providers.map(cloneRecord),
  });
}

function cloneRecord(record: AcpAuthRecord): AcpAuthRecord {
  return AcpAuthRecordSchema.parse(record);
}

function normalizeAuthFilePath(value: string): string {
  const normalized = value
    .replace(WINDOWS_PATH_SEPARATOR_PATTERN, "/")
    .replace(LEADING_SLASH_PATTERN, "")
    .trim();
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
