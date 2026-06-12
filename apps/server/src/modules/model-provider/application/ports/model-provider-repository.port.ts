import type {
  DeleteModelProviderInput,
  DeleteModelProviderResult,
  GetModelProviderInput,
  ListModelProvidersInput,
  ModelProviderListResult,
  ModelProviderRecord,
  ModelProviderSeed,
  UpsertModelProviderInput,
} from "../contracts/model-provider.contract";

export interface ModelProviderRepositoryPort {
  list(
    userId: string,
    input?: ListModelProvidersInput
  ): Promise<ModelProviderListResult>;
  get(
    userId: string,
    input: GetModelProviderInput
  ): Promise<ModelProviderRecord | null>;
  upsert(
    userId: string,
    input: UpsertModelProviderInput
  ): Promise<ModelProviderRecord>;
  delete(
    userId: string,
    input: DeleteModelProviderInput
  ): Promise<DeleteModelProviderResult>;
  ensureDefaults(userId: string, defaults: ModelProviderSeed[]): Promise<void>;
  restoreDefaults(
    userId: string,
    defaults: ModelProviderSeed[]
  ): Promise<ModelProviderListResult>;
}
