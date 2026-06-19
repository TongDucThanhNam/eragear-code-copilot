import type { OAuthProviderDescriptor } from "#runtime/modules/oauth";

export const AUTH_OAUTH_PROVIDER_IDS = ["github", "google", "discord"] as const;

export type AuthOAuthProviderId = (typeof AUTH_OAUTH_PROVIDER_IDS)[number];

export interface AuthOAuthProviderCredentials {
  clientId: string;
  clientSecret: string;
  scope?: string[];
}

export type AuthOAuthProviderCredentialsMap = Partial<
  Record<AuthOAuthProviderId, AuthOAuthProviderCredentials>
>;

interface AuthOAuthProviderDefinition {
  id: AuthOAuthProviderId;
  name: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  defaultScopes: string[];
}

export const AUTH_OAUTH_PROVIDER_DEFINITIONS: readonly AuthOAuthProviderDefinition[] =
  [
    {
      id: "github",
      name: "GitHub",
      clientIdEnv: "AUTH_OAUTH_GITHUB_CLIENT_ID",
      clientSecretEnv: "AUTH_OAUTH_GITHUB_CLIENT_SECRET",
      defaultScopes: ["read:user", "user:email"],
    },
    {
      id: "google",
      name: "Google",
      clientIdEnv: "AUTH_OAUTH_GOOGLE_CLIENT_ID",
      clientSecretEnv: "AUTH_OAUTH_GOOGLE_CLIENT_SECRET",
      defaultScopes: ["email", "profile", "openid"],
    },
    {
      id: "discord",
      name: "Discord",
      clientIdEnv: "AUTH_OAUTH_DISCORD_CLIENT_ID",
      clientSecretEnv: "AUTH_OAUTH_DISCORD_CLIENT_SECRET",
      defaultScopes: ["identify", "email"],
    },
  ] as const;

export interface AuthOAuthProviderEnvInput {
  githubClientId?: string;
  githubClientIdAlias?: string;
  githubClientSecret?: string;
  githubClientSecretAlias?: string;
  githubScopes?: string[];
  googleClientId?: string;
  googleClientIdAlias?: string;
  googleClientSecret?: string;
  googleClientSecretAlias?: string;
  googleScopes?: string[];
  discordClientId?: string;
  discordClientIdAlias?: string;
  discordClientSecret?: string;
  discordClientSecretAlias?: string;
  discordScopes?: string[];
}

export function resolveAuthOAuthProvidersFromEnv(
  input: AuthOAuthProviderEnvInput
): AuthOAuthProviderCredentialsMap {
  return {
    ...resolveProviderCredentials("github", {
      clientId: firstNonEmpty([
        input.githubClientId,
        input.githubClientIdAlias,
      ]),
      clientSecret: firstNonEmpty([
        input.githubClientSecret,
        input.githubClientSecretAlias,
      ]),
      scope: input.githubScopes,
    }),
    ...resolveProviderCredentials("google", {
      clientId: firstNonEmpty([
        input.googleClientId,
        input.googleClientIdAlias,
      ]),
      clientSecret: firstNonEmpty([
        input.googleClientSecret,
        input.googleClientSecretAlias,
      ]),
      scope: input.googleScopes,
    }),
    ...resolveProviderCredentials("discord", {
      clientId: firstNonEmpty([
        input.discordClientId,
        input.discordClientIdAlias,
      ]),
      clientSecret: firstNonEmpty([
        input.discordClientSecret,
        input.discordClientSecretAlias,
      ]),
      scope: input.discordScopes,
    }),
  };
}

export function createAuthOAuthProviderDescriptors(
  credentials: AuthOAuthProviderCredentialsMap
): OAuthProviderDescriptor[] {
  return AUTH_OAUTH_PROVIDER_DEFINITIONS.map((definition) => {
    const configured = Boolean(credentials[definition.id]);
    return {
      id: definition.id,
      name: definition.name,
      configured,
      missingEnv: configured
        ? []
        : [definition.clientIdEnv, definition.clientSecretEnv],
      signInPath: "/api/auth/sign-in/social",
      linkPath: "/api/auth/link-social",
      callbackPath: `/api/auth/callback/${definition.id}`,
      defaultScopes: definition.defaultScopes,
    };
  });
}

export function createBetterAuthSocialProviders(
  credentials: AuthOAuthProviderCredentialsMap
) {
  const socialProviders: Record<string, AuthOAuthProviderCredentials> = {};
  for (const providerId of AUTH_OAUTH_PROVIDER_IDS) {
    const providerCredentials = credentials[providerId];
    if (!providerCredentials) {
      continue;
    }
    socialProviders[providerId] = providerCredentials;
  }
  return socialProviders;
}

function resolveProviderCredentials(
  providerId: AuthOAuthProviderId,
  input: {
    clientId?: string;
    clientSecret?: string;
    scope?: string[];
  }
): AuthOAuthProviderCredentialsMap {
  const clientId = input.clientId?.trim();
  const clientSecret = input.clientSecret?.trim();
  if (!(clientId && clientSecret)) {
    return {};
  }
  return {
    [providerId]: {
      clientId,
      clientSecret,
      ...(input.scope && input.scope.length > 0 ? { scope: input.scope } : {}),
    },
  };
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && value.trim().length > 0)?.trim();
}
