import { randomUUID } from "node:crypto";
import { NotFoundError } from "#runtime/shared/errors";
import type {
  CredentialListInput,
  CredentialListResult,
  CredentialRecord,
  DeleteCredentialInput,
  DeleteCredentialResult,
  ResolveCredentialSecretInput,
  UpsertCredentialInput,
} from "./contracts/credential.contract";
import type {
  CredentialStorePort,
  ResolvedCredentialSecret,
  StoredCredential,
} from "./ports/credential-store.port";

const MODULE = "credential";

export interface CredentialServiceParams {
  createId?: () => string;
  nowMs?: () => number;
}

export class CredentialService {
  private readonly store: CredentialStorePort;
  private readonly createId: () => string;
  private readonly nowMs: () => number;

  constructor(
    store: CredentialStorePort,
    params: CredentialServiceParams = {}
  ) {
    this.store = store;
    this.createId = params.createId ?? (() => `cred_${randomUUID()}`);
    this.nowMs = params.nowMs ?? (() => Date.now());
  }

  async list(
    userId: string,
    input?: CredentialListInput
  ): Promise<CredentialListResult> {
    return await this.store.read((credentials) => {
      const records = credentials
        .filter((credential) => credential.userId === userId)
        .filter((credential) => matchesListFilter(credential, input))
        .map(toCredentialRecord)
        .sort((left, right) => right.updatedAt - left.updatedAt);
      return { credentials: records, totalCount: records.length };
    });
  }

  async upsert(
    userId: string,
    input: UpsertCredentialInput
  ): Promise<CredentialRecord> {
    return await this.store.mutate((credentials) => {
      const now = this.nowMs();
      const existingIndex = input.id
        ? credentials.findIndex(
            (credential) =>
              credential.id === input.id && credential.userId === userId
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
        existingIndex >= 0 ? credentials[existingIndex] : undefined;
      const credential: StoredCredential = {
        id: previous?.id ?? this.createId(),
        userId,
        name: input.name.trim(),
        kind: input.kind,
        ...optionalTrimmed("providerId", input.providerId),
        ...optionalTrimmed("projectId", input.projectId),
        ...optionalTrimmed("agentId", input.agentId),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        secretPreview: previewSecret(input.secret),
        secret: input.secret,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        secretUpdatedAt: now,
        ...(previous?.lastUsedAt !== undefined
          ? { lastUsedAt: previous.lastUsedAt }
          : {}),
      };

      if (existingIndex >= 0) {
        credentials[existingIndex] = credential;
      } else {
        credentials.push(credential);
      }
      return toCredentialRecord(credential);
    });
  }

  async delete(
    userId: string,
    input: DeleteCredentialInput
  ): Promise<DeleteCredentialResult> {
    return await this.store.mutate((credentials) => {
      const index = credentials.findIndex(
        (credential) =>
          credential.id === input.id && credential.userId === userId
      );
      if (index === -1) {
        throw new NotFoundError("Credential not found", {
          module: MODULE,
          op: "delete",
          details: { credentialId: input.id },
        });
      }

      credentials.splice(index, 1);
      return { deleted: true };
    });
  }

  async resolveSecret(
    userId: string,
    input: ResolveCredentialSecretInput
  ): Promise<ResolvedCredentialSecret | null> {
    return await this.store.mutate((credentials) => {
      const index = credentials.findIndex(
        (credential) =>
          credential.userId === userId &&
          (input.id
            ? credential.id === input.id
            : matchesResolveFilter(credential, input))
      );
      if (index === -1) {
        return null;
      }

      const credential = credentials[index];
      if (!credential) {
        return null;
      }

      const usedCredential: StoredCredential = {
        ...credential,
        lastUsedAt: this.nowMs(),
      };
      credentials[index] = usedCredential;
      return {
        credential: toCredentialRecord(usedCredential),
        secret: usedCredential.secret,
      };
    });
  }
}

function previewSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `****${trimmed.slice(-4)}`;
}

function toCredentialRecord(credential: StoredCredential): CredentialRecord {
  const { secret: _secret, ...record } = credential;
  return record;
}

function matchesListFilter(
  credential: StoredCredential,
  input?: CredentialListInput
): boolean {
  if (!input) {
    return true;
  }
  return (
    (!input.providerId || credential.providerId === input.providerId) &&
    (!input.projectId || credential.projectId === input.projectId) &&
    (!input.agentId || credential.agentId === input.agentId) &&
    (!input.kind || credential.kind === input.kind)
  );
}

function matchesResolveFilter(
  credential: StoredCredential,
  input: ResolveCredentialSecretInput
): boolean {
  return (
    (!input.providerId || credential.providerId === input.providerId) &&
    (!input.kind || credential.kind === input.kind) &&
    (!input.name || credential.name === input.name)
  );
}

function optionalTrimmed<Key extends "providerId" | "projectId" | "agentId">(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Record<Key, string>) : {};
}
