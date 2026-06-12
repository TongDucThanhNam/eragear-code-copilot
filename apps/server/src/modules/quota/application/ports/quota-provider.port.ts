import type { AgentConfig } from "@/shared/types/agent.types";
import type {
  QuotaProviderSource,
  QuotaWindow,
} from "../contracts/quota.contract";
import type { QuotaCredentialResolverPort } from "./quota-credential-resolver.port";

export interface QuotaProviderContext {
  userId: string;
  agents: AgentConfig[];
  now: Date;
  credentialResolver?: QuotaCredentialResolverPort;
}

export type QuotaAuthSource = "env" | "local_auth" | "credential";

export interface QuotaAuthOk {
  ok: true;
  token: string;
  source: QuotaAuthSource;
  accountId?: string;
  endpointVariant?: string;
}

export interface QuotaAuthMissing {
  ok: false;
  reason: string;
}

export type QuotaAuthResult = QuotaAuthOk | QuotaAuthMissing;

export interface QuotaProviderFetchResult {
  displayName?: string;
  windows: QuotaWindow[];
  fetchedAt?: string;
}

/**
 * Remote/local quota adapter.
 *
 * Security invariant: implementations must not return raw provider payloads,
 * tokens, API keys, or secret-bearing diagnostics through this interface.
 */
export interface QuotaProviderAdapter {
  id: string;
  aliases: string[];
  displayName: string;
  source: QuotaProviderSource;
  detect(ctx: QuotaProviderContext): boolean;
  resolveAuth(ctx: QuotaProviderContext): Promise<QuotaAuthResult>;
  fetchQuota(
    auth: QuotaAuthOk,
    ctx: QuotaProviderContext
  ): Promise<QuotaProviderFetchResult>;
}
