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
import { getNodeErrnoCode } from "#runtime/shared/utils/node-error.util";
import type {
  CredentialStorePort,
  StoredCredential,
} from "../application/ports/credential-store.port";

const DOCUMENT_VERSION = 1;
const FILE_MODE_PRIVATE = 0o600;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_CONTEXT = "eragear-credential-store-v1";

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
}

export class EncryptedCredentialFileStore implements CredentialStorePort {
  private readonly filePathProvider: () => string | Promise<string>;
  private readonly secretProvider: () => string;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: EncryptedCredentialFileStoreParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
    this.secretProvider = params.secretProvider;
  }

  async read<T>(
    reader: (credentials: readonly StoredCredential[]) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(
        document.entries.map((entry) => this.toStoredCredential(entry))
      );
    });
  }

  async mutate<T>(
    mutator: (credentials: StoredCredential[]) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const credentials = document.entries.map((entry) =>
        this.toStoredCredential(entry)
      );
      const result = await mutator(credentials);
      await this.writeDocument({
        version: DOCUMENT_VERSION,
        entries: credentials.map((credential) =>
          this.toDocumentEntry(credential)
        ),
      });
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

  private toStoredCredential(entry: CredentialDocumentEntry): StoredCredential {
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
      secret: this.decrypt(entry.encryptedSecret),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      secretUpdatedAt: entry.secretUpdatedAt,
      ...(entry.lastUsedAt !== undefined
        ? { lastUsedAt: entry.lastUsedAt }
        : {}),
    };
  }

  private toDocumentEntry(
    credential: StoredCredential
  ): CredentialDocumentEntry {
    return {
      id: credential.id,
      userId: credential.userId,
      name: credential.name,
      kind: credential.kind,
      ...(credential.providerId ? { providerId: credential.providerId } : {}),
      ...(credential.projectId ? { projectId: credential.projectId } : {}),
      ...(credential.agentId ? { agentId: credential.agentId } : {}),
      secretPreview: credential.secretPreview,
      ...(credential.metadata ? { metadata: credential.metadata } : {}),
      encryptedSecret: this.encrypt(credential.secret),
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      secretUpdatedAt: credential.secretUpdatedAt,
      ...(credential.lastUsedAt !== undefined
        ? { lastUsedAt: credential.lastUsedAt }
        : {}),
    };
  }
}
