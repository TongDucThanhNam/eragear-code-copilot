import { describe, expect, test } from "bun:test";
import type {
  OAuthLinkedAccount,
  OAuthProviderDescriptor,
  OAuthProviderId,
} from "./contracts/oauth.contract";
import { OAuthService } from "./oauth.service";
import type { OAuthAccountRepositoryPort } from "./ports/oauth-account-repository.port";

const PROVIDERS: OAuthProviderDescriptor[] = [
  {
    id: "github",
    name: "GitHub",
    configured: true,
    missingEnv: [],
    signInPath: "/api/auth/sign-in/social",
    linkPath: "/api/auth/link-social",
    callbackPath: "/api/auth/callback/github",
    defaultScopes: ["read:user", "user:email"],
  },
  {
    id: "google",
    name: "Google",
    configured: false,
    missingEnv: [
      "AUTH_OAUTH_GOOGLE_CLIENT_ID",
      "AUTH_OAUTH_GOOGLE_CLIENT_SECRET",
    ],
    signInPath: "/api/auth/sign-in/social",
    linkPath: "/api/auth/link-social",
    callbackPath: "/api/auth/callback/google",
    defaultScopes: ["email", "profile", "openid"],
  },
];

class OAuthAccountRepositoryStub implements OAuthAccountRepositoryPort {
  providerIds: OAuthProviderId[] = [];
  accounts: OAuthLinkedAccount[] = [
    {
      id: "account-1",
      providerId: "github",
      accountId: "gh-1",
      linkedAt: 1,
      updatedAt: 2,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: "read:user,user:email",
      scopes: ["read:user", "user:email"],
      hasAccessToken: true,
      hasRefreshToken: false,
    },
  ];

  listLinkedAccounts(
    _userId: string,
    providerIds: OAuthProviderId[]
  ): Promise<OAuthLinkedAccount[]> {
    this.providerIds = providerIds;
    return Promise.resolve(this.accounts);
  }
}

describe("OAuthService", () => {
  test("returns provider metadata with linked account status", async () => {
    const repository = new OAuthAccountRepositoryStub();
    const service = new OAuthService({
      accountRepository: repository,
      providers: PROVIDERS,
      now: () => 10,
    });

    const result = await service.getProviders("user-1");
    const restored = await service.restoreCachedSession("user-1");

    expect(repository.providerIds).toEqual(["github", "google"]);
    expect(result.configuredCount).toBe(1);
    expect(result.linkedCount).toBe(1);
    expect(result.activeProviders[0]?.hasAccessToken).toBe(true);
    expect(restored).toEqual({
      restored: true,
      activeProviders: repository.accounts,
      restoredAt: 10,
    });
  });
});
