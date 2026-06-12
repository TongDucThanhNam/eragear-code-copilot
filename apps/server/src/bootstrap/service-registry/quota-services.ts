import {
  ProviderQuotaService,
  type QuotaCredentialKind,
  type QuotaCredentialResolverPort,
} from "@/modules/quota";
import { createQuotaProviderAdapters } from "@/modules/quota/di";
import type {
  CredentialUseCases,
  ModelProviderUseCases,
  QuotaUseCases,
} from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createQuotaUseCases(
  deps: ServiceRegistryDependencies,
  credentialUseCases?: CredentialUseCases,
  modelProviderUseCases?: ModelProviderUseCases
): QuotaUseCases {
  return {
    provider: new ProviderQuotaService({
      agentRepo: deps.agentRepo,
      eventBus: deps.eventBus,
      clock: deps.clock,
      logger: deps.appLogger,
      adapters: createQuotaProviderAdapters(),
      credentialResolver: credentialUseCases
        ? createQuotaCredentialResolver(
            credentialUseCases,
            modelProviderUseCases
          )
        : undefined,
    }),
  };
}

function createQuotaCredentialResolver(
  credentialUseCases: CredentialUseCases,
  modelProviderUseCases?: ModelProviderUseCases
): QuotaCredentialResolverPort {
  return {
    resolveFirst: async (userId, input) => {
      const kinds = input.kinds ?? ["api_key", "bearer_token"];
      const providerIds = uniqueTrimmed(input.providerIds);
      const byProviderId = await resolveCredentialByProviderIds(
        credentialUseCases,
        userId,
        providerIds,
        kinds
      );
      if (byProviderId) {
        return byProviderId;
      }

      if (modelProviderUseCases) {
        const byModelProvider = await resolveCredentialByModelProvider(
          credentialUseCases,
          modelProviderUseCases,
          userId,
          [...providerIds, ...(input.names ?? [])],
          kinds
        );
        if (byModelProvider) {
          return byModelProvider;
        }
      }

      return await resolveCredentialByNames(
        credentialUseCases,
        userId,
        uniqueTrimmed(input.names ?? []),
        kinds
      );
    },
  };
}

async function resolveCredentialByProviderIds(
  credentialUseCases: CredentialUseCases,
  userId: string,
  providerIds: readonly string[],
  kinds: readonly QuotaCredentialKind[]
) {
  for (const providerId of providerIds) {
    for (const kind of kinds) {
      const resolved = await credentialUseCases.credential.resolveSecret(
        userId,
        { providerId, kind }
      );
      if (resolved) {
        return toQuotaCredentialSecret(resolved);
      }
    }
  }
  return null;
}

async function resolveCredentialByModelProvider(
  credentialUseCases: CredentialUseCases,
  modelProviderUseCases: ModelProviderUseCases,
  userId: string,
  needles: readonly string[],
  kinds: readonly QuotaCredentialKind[]
) {
  const providers = await modelProviderUseCases.modelProvider.list(userId, {
    includeDisabled: true,
  });
  for (const provider of providers.providers) {
    if (!(provider.credentialId && modelProviderMatches(provider, needles))) {
      continue;
    }
    const resolved = await credentialUseCases.credential.resolveSecret(userId, {
      id: provider.credentialId,
    });
    if (
      resolved &&
      kinds.includes(resolved.credential.kind as QuotaCredentialKind)
    ) {
      return toQuotaCredentialSecret(resolved);
    }
  }
  return null;
}

async function resolveCredentialByNames(
  credentialUseCases: CredentialUseCases,
  userId: string,
  names: readonly string[],
  kinds: readonly QuotaCredentialKind[]
) {
  for (const name of names) {
    for (const kind of kinds) {
      const resolved = await credentialUseCases.credential.resolveSecret(
        userId,
        { name, kind }
      );
      if (resolved) {
        return toQuotaCredentialSecret(resolved);
      }
    }
  }
  return null;
}

function toQuotaCredentialSecret(
  resolved: Awaited<
    ReturnType<CredentialUseCases["credential"]["resolveSecret"]>
  > & {}
) {
  return {
    credentialId: resolved.credential.id,
    name: resolved.credential.name,
    kind: resolved.credential.kind as QuotaCredentialKind,
    ...(resolved.credential.providerId
      ? { providerId: resolved.credential.providerId }
      : {}),
    secret: resolved.secret,
  };
}

function uniqueTrimmed(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function modelProviderMatches(
  provider: { id: string; name: string },
  needles: readonly string[]
): boolean {
  const normalizedNeedles = needles
    .map((needle) => normalizeProviderMatchValue(needle))
    .filter(Boolean);
  const values = [provider.id, provider.name].map(normalizeProviderMatchValue);
  return values.some((value) =>
    normalizedNeedles.some(
      (needle) => value === needle || value.includes(needle)
    )
  );
}

function normalizeProviderMatchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
