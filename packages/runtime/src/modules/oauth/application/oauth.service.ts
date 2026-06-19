import type {
  OAuthActiveProviderResult,
  OAuthProviderDescriptor,
  OAuthProviderId,
  OAuthProvidersResult,
  OAuthRestoreCachedSessionResult,
} from "./contracts/oauth.contract";
import type { OAuthAccountRepositoryPort } from "./ports/oauth-account-repository.port";

interface OAuthServiceDeps {
  accountRepository: OAuthAccountRepositoryPort;
  providers: OAuthProviderDescriptor[];
  now?: () => number;
}

export class OAuthService {
  private readonly accountRepository: OAuthAccountRepositoryPort;
  private readonly providers: OAuthProviderDescriptor[];
  private readonly now: () => number;

  constructor(deps: OAuthServiceDeps) {
    this.accountRepository = deps.accountRepository;
    this.providers = deps.providers;
    this.now = deps.now ?? Date.now;
  }

  async getProviders(userId: string): Promise<OAuthProvidersResult> {
    const activeProviders = await this.listActiveProviders(userId);
    return {
      providers: this.providers,
      activeProviders,
      configuredCount: this.providers.filter((provider) => provider.configured)
        .length,
      linkedCount: activeProviders.length,
    };
  }

  async getActiveProvider(userId: string): Promise<OAuthActiveProviderResult> {
    const activeProviders = await this.listActiveProviders(userId);
    return {
      activeProviders,
      linkedCount: activeProviders.length,
    };
  }

  async restoreCachedSession(
    userId: string
  ): Promise<OAuthRestoreCachedSessionResult> {
    const activeProviders = await this.listActiveProviders(userId);
    return {
      restored: activeProviders.length > 0,
      activeProviders,
      restoredAt: this.now(),
    };
  }

  private listActiveProviders(userId: string) {
    return this.accountRepository.listLinkedAccounts(
      userId,
      this.providers.map((provider) => provider.id as OAuthProviderId)
    );
  }
}
