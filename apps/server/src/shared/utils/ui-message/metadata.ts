import type { ProviderMetadata } from "@repo/shared";
import type { StoredContentBlock } from "@/shared/types/session.types";

export function mergeProviderMetadata(
  existing?: ProviderMetadata,
  incoming?: ProviderMetadata
): ProviderMetadata | undefined {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  const existingAcp =
    "acp" in existing && typeof existing.acp === "object" && existing.acp
      ? (existing.acp as Record<string, unknown>)
      : undefined;
  const incomingAcp =
    "acp" in incoming && typeof incoming.acp === "object" && incoming.acp
      ? (incoming.acp as Record<string, unknown>)
      : undefined;
  const mergedAcp =
    existingAcp || incomingAcp
      ? { ...(existingAcp ?? {}), ...(incomingAcp ?? {}) }
      : undefined;
  return mergedAcp
    ? { ...existing, ...incoming, acp: mergedAcp }
    : { ...existing, ...incoming };
}

export function buildProviderMetadata(params: {
  meta?: unknown;
  annotations?: unknown;
  resourceMeta?: unknown;
}): ProviderMetadata | undefined {
  const acp: Record<string, unknown> = {};
  if (params.meta !== undefined) {
    acp._meta = params.meta;
  }
  if (params.annotations !== undefined) {
    acp.annotations = params.annotations;
  }
  if (params.resourceMeta !== undefined) {
    acp.resourceMeta = params.resourceMeta;
  }
  if (Object.keys(acp).length === 0) {
    return undefined;
  }
  return { acp };
}

export function getBlockProviderMetadata(
  block: StoredContentBlock,
  resourceMeta?: unknown
): ProviderMetadata | undefined {
  return buildProviderMetadata({
    meta: getOptionalMeta(block),
    annotations: getOptionalAnnotations(block),
    resourceMeta,
  });
}

export function getResourceMeta(resource: unknown): unknown | undefined {
  return getOptionalMeta(resource);
}

export function getOptionalMeta(value: unknown): unknown | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return "_meta" in value ? (value as { _meta?: unknown })._meta : undefined;
}

export function getOptionalAnnotations(value: unknown): unknown | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return "annotations" in value
    ? (value as { annotations?: unknown }).annotations
    : undefined;
}

export function buildProviderMetadataFromMeta(
  meta?: unknown
): ProviderMetadata | undefined {
  return buildProviderMetadata({ meta });
}
