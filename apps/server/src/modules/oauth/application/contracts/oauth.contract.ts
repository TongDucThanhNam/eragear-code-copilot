import { z } from "zod";

export const OAuthProviderIdSchema = z.enum(["github", "google", "discord"]);
export type OAuthProviderId = z.infer<typeof OAuthProviderIdSchema>;

export const OAuthProviderDescriptorSchema = z.object({
  id: OAuthProviderIdSchema,
  name: z.string(),
  configured: z.boolean(),
  missingEnv: z.array(z.string()),
  signInPath: z.string(),
  linkPath: z.string(),
  callbackPath: z.string(),
  defaultScopes: z.array(z.string()),
});
export type OAuthProviderDescriptor = z.infer<
  typeof OAuthProviderDescriptorSchema
>;

export const OAuthLinkedAccountSchema = z.object({
  id: z.string(),
  providerId: OAuthProviderIdSchema,
  accountId: z.string(),
  linkedAt: z.number(),
  updatedAt: z.number(),
  accessTokenExpiresAt: z.number().nullable(),
  refreshTokenExpiresAt: z.number().nullable(),
  scope: z.string().nullable(),
  scopes: z.array(z.string()),
  hasAccessToken: z.boolean(),
  hasRefreshToken: z.boolean(),
});
export type OAuthLinkedAccount = z.infer<typeof OAuthLinkedAccountSchema>;

export const OAuthProvidersResultSchema = z.object({
  providers: z.array(OAuthProviderDescriptorSchema),
  activeProviders: z.array(OAuthLinkedAccountSchema),
  configuredCount: z.number(),
  linkedCount: z.number(),
});
export type OAuthProvidersResult = z.infer<typeof OAuthProvidersResultSchema>;

export const OAuthActiveProviderResultSchema = z.object({
  activeProviders: z.array(OAuthLinkedAccountSchema),
  linkedCount: z.number(),
});
export type OAuthActiveProviderResult = z.infer<
  typeof OAuthActiveProviderResultSchema
>;

export const OAuthRestoreCachedSessionResultSchema = z.object({
  restored: z.boolean(),
  activeProviders: z.array(OAuthLinkedAccountSchema),
  restoredAt: z.number(),
});
export type OAuthRestoreCachedSessionResult = z.infer<
  typeof OAuthRestoreCachedSessionResultSchema
>;
