import { OAuthService } from "@/modules/oauth";
import { BetterAuthOAuthAccountRepository } from "@/modules/oauth/di";
import type { OAuthUseCases } from "@/modules/use-cases";
import type { AuthRuntime } from "@/platform/auth/auth";

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
