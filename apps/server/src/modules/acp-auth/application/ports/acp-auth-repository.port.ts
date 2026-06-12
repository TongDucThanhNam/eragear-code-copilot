import type {
  AcpAuthRecord,
  AcpAuthSyncStatus,
  AcpProviderAuthFile,
  DeleteAcpAuthInput,
  ListAcpAuthInput,
  UpsertAcpAuthInput,
} from "../contracts/acp-auth.contract";

export interface AcpAuthSyncPatch {
  syncStatus: AcpAuthSyncStatus;
  lastSyncedAt?: number;
  syncError?: string;
}

export interface AcpAuthRepositoryPort {
  list(userId: string, input?: ListAcpAuthInput): Promise<AcpAuthRecord[]>;
  listAll(input?: ListAcpAuthInput): Promise<AcpAuthRecord[]>;
  get(userId: string, providerId: string): Promise<AcpAuthRecord | null>;
  upsert(
    userId: string,
    input: UpsertAcpAuthInput & { authFilePath: string }
  ): Promise<AcpAuthRecord>;
  delete(userId: string, input: DeleteAcpAuthInput): Promise<void>;
  updateSyncState(
    userId: string,
    providerId: string,
    patch: AcpAuthSyncPatch
  ): Promise<AcpAuthRecord>;
  writeProviderAuthFile(
    record: AcpAuthRecord,
    payload: AcpProviderAuthFile
  ): Promise<void>;
  removeProviderAuthFile(record: AcpAuthRecord): Promise<void>;
}
