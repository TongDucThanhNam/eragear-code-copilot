import type {
  AcpAuthRecord,
  AcpProviderAuthFile,
} from "../contracts/acp-auth.contract";

export interface AcpAuthStoreSnapshot {
  providers: readonly AcpAuthRecord[];
}

export interface MutableAcpAuthStoreSnapshot {
  providers: AcpAuthRecord[];
}

export interface AcpAuthRepositoryPort {
  read<T>(
    reader: (snapshot: AcpAuthStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableAcpAuthStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  writeProviderAuthFile(
    record: AcpAuthRecord,
    payload: AcpProviderAuthFile
  ): Promise<void>;
  removeProviderAuthFile(record: AcpAuthRecord): Promise<void>;
}
