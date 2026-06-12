import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { NotFoundError } from "@/shared/errors";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import type {
  CredentialListInput,
  CredentialListResult,
  CredentialRecord,
  DeleteCredentialInput,
  DeleteCredentialResult,
  ResolveCredentialSecretInput,
  UpsertCredentialInput,
} from "../application/contracts/credential.contract";
import type {
  CredentialStorePort,
  ResolvedCredentialSecret,
} from "../application/ports/credential-store.port";

const DOCUMENT_VERSION = 1;
const FILE_MODE_PRIVATE = 0o600;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_CONTEXT = "eragear-credential-store-v1";
const MODULE = "credential";

const EncryptedSecretSchema = z
  .object({
    algorithm: z.literal(ENCRYPTION_ALGORITHM),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  })
  .strict();

const CredentialDocumentEntrySchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string(),
    kind: z.enum(["api_key", "oauth_token", "bearer_token", "secret"]),
    providerId: z.string().optional(),
    projectId: z.string().optional(),
    agentId: z.string().optional(),
    secretPreview: z.string(),
    metadata: z.record(z.string(), z.string()).optional(),
    encryptedSecret: EncryptedSecretSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    secretUpdatedAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

const CredentialDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    entries: z.array(CredentialDocumentEntrySchema),
  })
  .strict();

type CredentialDocument = z.infer<typeof CredentialDocumentSchema>;
type CredentialDocumentEntry = z.infer<typeof CredentialDocumentEntrySchema>;

export interface EncryptedCredentialFileStoreParams {
  filePath: string | (() => string | Promise<string>);
  secretProvider: () => string;
  nowMs?: () => number;
}

export class EncryptedCredentialFileStore implements CredentialStorePort {
  private readonly filePathProvider: () => string | Promise<string>;
  private readonly secretProvider: () => string;
  private readonly nowMs: () => number;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: EncryptedCredentialFileStoreParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
    this.secretProvider = params.secretProvider;
    this.nowMs = params.nowMs ?? (() => Date.now());
  }

  async list(
    userId: string,
    input?: CredentialListInput
  ): Promise<CredentialListResult> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const credentials = document.entries
        .filter((entry) => entry.userId === userId)
        .filter((entry) => matchesListFilter(entry, input))
        .map(toCredentialRecord)
        .sort((left, right) => right.updatedAt - left.updatedAt);
      return { credentials, totalCount: credentials.length };
    });
  }

  async upsert(
    userId: string,
    input: UpsertCredentialInput
  ): Promise<CredentialRecord> {
    return await this.enqueue(async () => {
      const now = this.nowMs();
      const document = await this.readDocument();
      const existingIndex = input.id
        ? document.entries.findIndex(
            (entry) => entry.id === input.id && entry.userId === userId
          )
        : -1;
      if (input.id && existingIndex === -1) {
        throw new NotFoundError("Credential not found", {
          module: MODULE,
          op: "upsert",
          details: { credentialId: input.id },
        });
      }

      const previous =
        existingIndex >= 0 ? document.entries[existingIndex] : undefined;
      const entry: CredentialDocumentEntry = {
        id: previous?.id ?? createCredentialId(),
        userId,
        name: input.name.trim(),
        kind: input.kind,
        ...(input.providerId ? { providerId: input.providerId.trim() } : {}),
        ...(input.projectId ? { projectId: input.projectId.trim() } : {}),
        ...(input.agentId ? { agentId: input.agentId.trim() } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        secretPreview: previewSecret(input.secret),
        encryptedSecret: this.encrypt(input.secret),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        secretUpdatedAt: now,
        ...(previous?.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}),
      };

      if (existingIndex >= 0) {
        document.entries[existingIndex] = entry;
      } else {
        document.entries.push(entry);
      }
      await this.writeDocument(document);
      return toCredentialRecord(entry);
    });
  }

  async delete(
    userId: string,
    input: DeleteCredentialInput
  ): Promise<DeleteCredentialResult> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const before = document.entries.length;
      document.entries = document.entries.filter(
        (entry) => !(entry.id === input.id && entry.userId === userId)
      );
      if (document.entries.length === before) {
        throw new NotFoundError("Credential not found", {
          module: MODULE,
          op: "delete",
          details: { credentialId: input.id },
        });
      }
      await this.writeDocument(document);
      return { deleted: true };
    });
  }

  async resolveSecret(
    userId: string,
    input: ResolveCredentialSecretInput
  ): Promise<ResolvedCredentialSecret | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const index = document.entries.findIndex(
        (entry) =>
          entry.userId === userId &&
          (input.id
            ? entry.id === input.id
            : matchesResolveFilter(entry, input))
      );
      if (index === -1) {
        return null;
      }
      const entry = document.entries[index];
      if (!entry) {
        return null;
      }
      const usedEntry: CredentialDocumentEntry = {
        ...entry,
        lastUsedAt: this.nowMs(),
      };
      document.entries[index] = usedEntry;
      await this.writeDocument(document);
      return {
        credential: toCredentialRecord(usedEntry),
        secret: this.decrypt(usedEntry.encryptedSecret),
      };
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

  private async readDocument(): Promise<CredentialDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return CredentialDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, entries: [] };
      }
      throw error;
    }
  }

  private async writeDocument(document: CredentialDocument): Promise<void> {
    const filePath = await this.resolveFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, {
      mode: FILE_MODE_PRIVATE,
    });
    await chmod(tempPath, FILE_MODE_PRIVATE).catch(() => undefined);
    await rename(tempPath, filePath);
    await chmod(filePath, FILE_MODE_PRIVATE).catch(() => undefined);
  }

  private async resolveFilePath(): Promise<string> {
    return await this.filePathProvider();
  }

  private encrypt(secret: string): CredentialDocumentEntry["encryptedSecret"] {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.deriveKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return {
      algorithm: ENCRYPTION_ALGORITHM,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private decrypt(payload: CredentialDocumentEntry["encryptedSecret"]): string {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.deriveKey(),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }

  private deriveKey(): Buffer {
    return createHash("sha256")
      .update(this.secretProvider(), "utf8")
      .update(KEY_DERIVATION_CONTEXT, "utf8")
      .digest();
  }
}

function createCredentialId(): string {
  return `cred_${randomUUID()}`;
}

function previewSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `****${trimmed.slice(-4)}`;
}

function toCredentialRecord(entry: CredentialDocumentEntry): CredentialRecord {
  return {
    id: entry.id,
    userId: entry.userId,
    name: entry.name,
    kind: entry.kind,
    ...(entry.providerId ? { providerId: entry.providerId } : {}),
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    ...(entry.agentId ? { agentId: entry.agentId } : {}),
    secretPreview: entry.secretPreview,
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    secretUpdatedAt: entry.secretUpdatedAt,
    ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
  };
}

function matchesListFilter(
  entry: CredentialDocumentEntry,
  input?: CredentialListInput
): boolean {
  if (!input) {
    return true;
  }
  return (
    (!input.providerId || entry.providerId === input.providerId) &&
    (!input.projectId || entry.projectId === input.projectId) &&
    (!input.agentId || entry.agentId === input.agentId) &&
    (!input.kind || entry.kind === input.kind)
  );
}

function matchesResolveFilter(
  entry: CredentialDocumentEntry,
  input: ResolveCredentialSecretInput
): boolean {
  return (
    (!input.providerId || entry.providerId === input.providerId) &&
    (!input.kind || entry.kind === input.kind) &&
    (!input.name || entry.name === input.name)
  );
}
