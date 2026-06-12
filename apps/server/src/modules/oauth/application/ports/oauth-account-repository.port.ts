import type {
  OAuthLinkedAccount,
  OAuthProviderId,
} from "../contracts/oauth.contract";

export interface OAuthAccountRepositoryPort {
  listLinkedAccounts(
    userId: string,
    providerIds: OAuthProviderId[]
  ): Promise<OAuthLinkedAccount[]>;
}
