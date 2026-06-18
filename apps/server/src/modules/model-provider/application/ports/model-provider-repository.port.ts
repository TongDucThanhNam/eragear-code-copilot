import type { ModelProviderRecord } from "../contracts/model-provider.contract";

export interface ModelProviderStoreSnapshot {
  seededUserIds: readonly string[];
  providers: readonly ModelProviderRecord[];
}

export interface MutableModelProviderStoreSnapshot {
  seededUserIds: string[];
  providers: ModelProviderRecord[];
}

export interface ModelProviderRepositoryPort {
  read<T>(
    reader: (snapshot: ModelProviderStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableModelProviderStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}
