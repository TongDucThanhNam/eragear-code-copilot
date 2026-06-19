import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type {
  AcpAuthListResult,
  AcpAuthMethod,
  AcpAuthRecord,
  AcpAuthSyncResult,
  AcpAuthSyncStatus,
  DeleteAcpAuthInput,
  ListAcpAuthInput,
  SyncAcpAuthInput,
  UpsertAcpAuthInput,
} from "./contracts/acp-auth.contract";
import { AcpAuthRecordSchema } from "./contracts/acp-auth.contract";
import type { AcpAuthRepositoryPort } from "./ports/acp-auth-repository.port";
import type { CredentialSecretResolverPort } from "./ports/credential-secret-resolver.port";

const MODULE = "acp-auth";
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const WINDOWS_PATH_SEPARATOR_PATTERN = /\\/g;
const LEADING_SLASH_PATTERN = /^\/+/;
const CREDENTIAL_METHODS = new Set<AcpAuthMethod>([
  "api_key",
  "bearer_token",
  "oauth_token",
]);

interface AcpAuthSyncPatch {
  syncStatus: AcpAuthSyncStatus;
  lastSyncedAt?: number;
  syncError?: string;
}

export class AcpAuthService {
  private readonly repository: AcpAuthRepositoryPort;
  private readonly credentialResolver: CredentialSecretResolverPort;
  private readonly nowMs: () => number;

  constructor(params: {
    repository: AcpAuthRepositoryPort;
    credentialResolver: CredentialSecretResolverPort;
    nowMs?: () => number;
  }) {
    this.repository = params.repository;
    this.credentialResolver = params.credentialResolver;
    this.nowMs = params.nowMs ?? (() => Date.now());
  }

  async list(
    userId: string,
    input?: ListAcpAuthInput
  ): Promise<AcpAuthListResult> {
    const providers = await this.repository.read((snapshot) =>
      filterRecords(snapshot.providers, { ...input, userId })
    );
    return { providers, totalCount: providers.length };
  }

  async upsert(
    userId: string,
    input: UpsertAcpAuthInput
  ): Promise<AcpAuthRecord> {
    const normalized = normalizeUpsertInput(input);
    return await this.repository.mutate((snapshot) => {
      const now = this.nowMs();
      const authFilePath = normalizeAuthFilePath(
        normalized.authFilePath ?? defaultAuthFilePath(normalized.providerId)
      );
      const existingIndex = snapshot.providers.findIndex(
        (record) =>
          record.userId === userId &&
          record.providerId === normalized.providerId
      );
      const previous =
        existingIndex >= 0 ? snapshot.providers[existingIndex] : undefined;
      const record = AcpAuthRecordSchema.parse({
        userId,
        providerId: normalized.providerId,
        ...(normalized.displayName
          ? { displayName: normalized.displayName }
          : {}),
        method: normalized.method,
        ...(normalized.credentialId
          ? { credentialId: normalized.credentialId }
          : {}),
        ...(normalized.envKey ? { envKey: normalized.envKey } : {}),
        authFilePath,
        enabled: normalized.enabled ?? previous?.enabled ?? true,
        ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
        syncStatus: "pending",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });

      if (existingIndex >= 0) {
        snapshot.providers[existingIndex] = record;
      } else {
        snapshot.providers.push(record);
      }
      return record;
    });
  }

  async delete(
    userId: string,
    input: DeleteAcpAuthInput
  ): Promise<{
    deleted: true;
  }> {
    const existing = await this.repository.mutate((snapshot) => {
      const index = snapshot.providers.findIndex(
        (record) =>
          record.userId === userId && record.providerId === input.providerId
      );
      const record = index >= 0 ? snapshot.providers[index] : undefined;
      if (!record) {
        throw new NotFoundError("ACP auth provider not found", {
          module: MODULE,
          op: "delete",
          details: { providerId: input.providerId },
        });
      }
      snapshot.providers.splice(index, 1);
      return record;
    });
    await this.repository.removeProviderAuthFile(existing);
    return { deleted: true };
  }

  async sync(
    userId: string,
    input?: SyncAcpAuthInput
  ): Promise<AcpAuthSyncResult> {
    const providers = await this.repository.read((snapshot) =>
      filterRecords(snapshot.providers, {
        userId,
        providerId: input?.providerId,
        includeDisabled: true,
      })
    );
    return await this.syncRecords(providers);
  }

  async syncStartup(): Promise<AcpAuthSyncResult> {
    const providers = await this.repository.read((snapshot) =>
      filterRecords(snapshot.providers, { includeDisabled: true })
    );
    return await this.syncRecords(providers);
  }

  private async syncRecords(
    records: AcpAuthRecord[]
  ): Promise<AcpAuthSyncResult> {
    const syncedAt = this.nowMs();
    const providers: AcpAuthRecord[] = [];
    let errorCount = 0;

    for (const record of records) {
      const synced = await this.syncRecord(record, syncedAt);
      if (synced.syncStatus === "error") {
        errorCount += 1;
      }
      providers.push(synced);
    }

    return {
      providers,
      totalCount: providers.length,
      syncedAt,
      errorCount,
    };
  }

  private async syncRecord(
    record: AcpAuthRecord,
    syncedAt: number
  ): Promise<AcpAuthRecord> {
    if (!record.enabled) {
      await this.repository.removeProviderAuthFile(record);
      return await this.updateSyncState(record.userId, record.providerId, {
        syncStatus: "disabled",
        syncError: undefined,
      });
    }

    if (record.method === "external_cli") {
      await this.repository.removeProviderAuthFile(record);
      return await this.updateSyncState(record.userId, record.providerId, {
        syncStatus: "synced",
        lastSyncedAt: syncedAt,
        syncError: undefined,
      });
    }

    if (!record.credentialId) {
      await this.repository.removeProviderAuthFile(record);
      return await this.updateSyncState(record.userId, record.providerId, {
        syncStatus: "missing_credential",
        syncError: "Credential is required for provider auth sync.",
      });
    }

    const resolved = await this.credentialResolver.resolveSecret(
      record.userId,
      {
        id: record.credentialId,
      }
    );
    if (!resolved) {
      await this.repository.removeProviderAuthFile(record);
      return await this.updateSyncState(record.userId, record.providerId, {
        syncStatus: "missing_credential",
        syncError: "Credential was not found or is not accessible.",
      });
    }

    try {
      const env = record.envKey
        ? { [record.envKey]: resolved.secret }
        : undefined;
      await this.repository.writeProviderAuthFile(record, {
        version: 1,
        providerId: record.providerId,
        method: record.method,
        credentialId: resolved.credential.id,
        updatedAt: new Date(syncedAt).toISOString(),
        auth: {
          type: record.method,
          secret: resolved.secret,
        },
        env,
        ...(record.metadata ? { metadata: record.metadata } : {}),
      });
      return await this.updateSyncState(record.userId, record.providerId, {
        syncStatus: "synced",
        lastSyncedAt: syncedAt,
        syncError: undefined,
      });
    } catch (error) {
      return await this.updateSyncState(record.userId, record.providerId, {
        syncStatus: "error",
        syncError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateSyncState(
    userId: string,
    providerId: string,
    patch: AcpAuthSyncPatch
  ): Promise<AcpAuthRecord> {
    return await this.repository.mutate((snapshot) => {
      const index = snapshot.providers.findIndex(
        (record) => record.userId === userId && record.providerId === providerId
      );
      const previous = index >= 0 ? snapshot.providers[index] : undefined;
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
      snapshot.providers[index] = next;
      return next;
    });
  }
}

function filterRecords(
  records: readonly AcpAuthRecord[],
  input?: ListAcpAuthInput & { userId?: string }
): AcpAuthRecord[] {
  return [...records]
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

function normalizeUpsertInput(input: UpsertAcpAuthInput): UpsertAcpAuthInput {
  const providerId = input.providerId.trim();
  if (!providerId) {
    throw new ValidationError("Provider id is required", {
      module: MODULE,
      op: "upsert",
    });
  }

  const displayName = input.displayName?.trim();
  const credentialId = input.credentialId?.trim();
  const envKey = input.envKey?.trim().toUpperCase();
  const authFilePath = input.authFilePath?.trim();

  if (envKey && !ENV_KEY_PATTERN.test(envKey)) {
    throw new ValidationError("Env key must be an uppercase environment name", {
      module: MODULE,
      op: "upsert",
      details: { envKey },
    });
  }

  if (CREDENTIAL_METHODS.has(input.method) && !credentialId) {
    throw new ValidationError("Credential is required for this auth method", {
      module: MODULE,
      op: "upsert",
      details: { method: input.method },
    });
  }

  return {
    providerId,
    ...(displayName ? { displayName } : {}),
    method: input.method,
    ...(credentialId ? { credentialId } : {}),
    ...(envKey ? { envKey } : {}),
    ...(authFilePath ? { authFilePath } : {}),
    enabled: input.enabled ?? true,
    ...(input.metadata ? { metadata: normalizeMetadata(input.metadata) } : {}),
  };
}

function normalizeMetadata(
  input: Record<string, string>
): Record<string, string> | undefined {
  const normalized = Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0)
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function defaultAuthFilePath(providerId: string): string {
  return `acp-auth/${providerPathSegment(providerId)}/auth.json`;
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

function providerPathSegment(providerId: string): string {
  const normalized = providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "provider";
}
