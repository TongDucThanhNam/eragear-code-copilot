import { OAuthService } from "#runtime/modules/oauth";
import { BetterAuthOAuthAccountRepository } from "#runtime/modules/oauth/di";
import type { OAuthUseCases } from "#runtime/modules/use-cases";
import type { AuthRuntime } from "#runtime/platform/auth/auth";

export function createOAuthUseCases(authRuntime: AuthRuntime): OAuthUseCases {
  return {
    oauth: new OAuthService({
      accountRepository: new BetterAuthOAuthAccountRepository(
        authRuntime.authDb
      ),
      providers: authRuntime.oauthProviderDescriptors,
    }),
  };
}
