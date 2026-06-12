import type {
  OAuthLinkedAccount,
  OAuthProviderId,
} from "../application/contracts/oauth.contract";
import type { OAuthAccountRepositoryPort } from "../application/ports/oauth-account-repository.port";

interface AuthDbReader {
  prepare(query: string): {
    all(...args: unknown[]): unknown[];
  };
}

interface AccountRow {
  id?: unknown;
  accountId?: unknown;
  providerId?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  accessTokenExpiresAt?: unknown;
  refreshTokenExpiresAt?: unknown;
  scope?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const SCOPE_SEPARATOR_RE = /[,\s]+/;

export class BetterAuthOAuthAccountRepository
  implements OAuthAccountRepositoryPort
{
  private readonly authDb: AuthDbReader;

  constructor(authDb: AuthDbReader) {
    this.authDb = authDb;
  }

  listLinkedAccounts(
    userId: string,
    providerIds: OAuthProviderId[]
  ): Promise<OAuthLinkedAccount[]> {
    if (providerIds.length === 0) {
      return Promise.resolve([]);
    }

    const placeholders = providerIds.map(() => "?").join(", ");
    const rows = this.authDb
      .prepare(
        `SELECT id, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, createdAt, updatedAt
         FROM "account"
         WHERE userId = ? AND providerId IN (${placeholders})
         ORDER BY updatedAt DESC`
      )
      .all(userId, ...providerIds) as AccountRow[];

    return Promise.resolve(
      rows
        .map(mapAccountRow)
        .filter((row): row is OAuthLinkedAccount => row !== null)
    );
  }
}

function mapAccountRow(row: AccountRow): OAuthLinkedAccount | null {
  const id = toStringValue(row.id);
  const accountId = toStringValue(row.accountId);
  const providerId = toProviderId(row.providerId);
  const linkedAt = toTimestamp(row.createdAt);
  const updatedAt = toTimestamp(row.updatedAt);

  if (
    !(id && accountId && providerId && linkedAt !== null && updatedAt !== null)
  ) {
    return null;
  }

  const scope = toStringValue(row.scope);
  return {
    id,
    providerId,
    accountId,
    linkedAt,
    updatedAt,
    accessTokenExpiresAt: toTimestamp(row.accessTokenExpiresAt),
    refreshTokenExpiresAt: toTimestamp(row.refreshTokenExpiresAt),
    scope,
    scopes: scope ? splitScope(scope) : [],
    hasAccessToken: Boolean(toStringValue(row.accessToken)),
    hasRefreshToken: Boolean(toStringValue(row.refreshToken)),
  };
}

function toProviderId(value: unknown): OAuthProviderId | null {
  if (value === "github" || value === "google" || value === "discord") {
    return value;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    const asDate = Date.parse(value);
    return Number.isFinite(asDate) ? asDate : null;
  }
  return null;
}

function splitScope(scope: string): string[] {
  return scope
    .split(SCOPE_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}
