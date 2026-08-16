import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  asRecord,
  decodeJwtPayload,
  getEnvValue,
  readString,
} from "./quota-adapter-utils";

const AUTH_CACHE_MS = 5000;

interface LocalAuthDocument {
  json: unknown;
}

interface AuthCache {
  expiresAt: number;
  documents: LocalAuthDocument[];
}

let authCache: AuthCache | null = null;

export interface LocalAuthToken {
  token: string;
  accountId?: string;
}

export async function findApiKeyInLocalAuth(
  providerKeys: readonly string[]
): Promise<LocalAuthToken | null> {
  const documents = await readLocalAuthDocuments();
  for (const document of documents) {
    const entry = findProviderEntry(document.json, providerKeys);
    const token = readTokenFromEntry(entry, [
      "apiKey",
      "api_key",
      "key",
      "token",
    ]);
    if (token) {
      return { token };
    }
  }
  return null;
}

export async function findOAuthTokenInLocalAuth(
  providerKeys: readonly string[]
): Promise<LocalAuthToken | null> {
  const documents = await readLocalAuthDocuments();
  for (const document of documents) {
    const topLevelToken = readOAuthTokenFromEntry(document.json);
    if (topLevelToken) {
      return topLevelToken;
    }

    const entry = findProviderEntry(document.json, providerKeys);
    const token = readOAuthTokenFromEntry(entry);
    if (token) {
      return token;
    }
  }
  return null;
}

export function readOAuthTokenFromEntry(value: unknown): LocalAuthToken | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const type = readString(record, ["type"])?.toLowerCase();
  if (type && type !== "oauth") {
    return null;
  }

  const token = readTokenFromEntry(record, [
    "access",
    "accessToken",
    "access_token",
  ]);
  if (!token) {
    return null;
  }
  return {
    token,
    accountId: readAccountId(record, token),
  };
}

function readTokenFromEntry(
  value: unknown,
  keys: readonly string[]
): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const direct = readString(record, keys);
  if (direct) {
    return direct;
  }

  const nested = asRecord(record.tokens);
  if (nested) {
    return readString(nested, keys) ?? null;
  }

  return null;
}

function readAccountId(record: Record<string, unknown>, token: string) {
  const direct = readString(record, [
    "accountId",
    "account_id",
    "account",
    "chatgptAccountId",
    "chatgpt_account_id",
  ]);
  if (direct) {
    return direct;
  }

  const nestedTokens = asRecord(record.tokens);
  if (nestedTokens) {
    const nestedDirect = readString(nestedTokens, [
      "accountId",
      "account_id",
      "account",
      "chatgptAccountId",
      "chatgpt_account_id",
    ]);
    if (nestedDirect) {
      return nestedDirect;
    }
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return undefined;
  }
  const payloadDirect = readString(payload, [
    "accountId",
    "account_id",
    "chatgptAccountId",
    "chatgpt_account_id",
  ]);
  if (payloadDirect) {
    return payloadDirect;
  }

  const openAiAuth = asRecord(payload["https://api.openai.com/auth"]);
  return openAiAuth
    ? readString(openAiAuth, ["accountId", "account_id", "account"])
    : undefined;
}

function findProviderEntry(
  json: unknown,
  providerKeys: readonly string[]
): unknown {
  const root = asRecord(json);
  if (!root) {
    return undefined;
  }

  const containers = [
    root,
    asRecord(root.auth),
    asRecord(root.providers),
    asRecord(root.credentials),
  ].filter((container): container is Record<string, unknown> =>
    Boolean(container)
  );

  for (const container of containers) {
    const entry = getCaseInsensitive(container, providerKeys);
    if (entry !== undefined) {
      return entry;
    }
  }

  return undefined;
}

function getCaseInsensitive(
  record: Record<string, unknown>,
  keys: readonly string[]
): unknown {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (normalizedKeys.has(key.toLowerCase())) {
      return value;
    }
  }
  return undefined;
}

async function readLocalAuthDocuments(): Promise<LocalAuthDocument[]> {
  const now = Date.now();
  if (authCache && authCache.expiresAt > now) {
    return authCache.documents;
  }

  const documents: LocalAuthDocument[] = [];
  for (const authPath of getCandidateAuthPaths()) {
    try {
      const raw = await readFile(authPath, "utf8");
      documents.push({ json: JSON.parse(raw) });
    } catch {
      // Missing or malformed local auth is treated as unconfigured.
    }
  }

  authCache = {
    expiresAt: now + AUTH_CACHE_MS,
    documents,
  };
  return documents;
}

function getCandidateAuthPaths(): string[] {
  const paths = new Set<string>();
  for (const key of ["OPENCODE_AUTH_PATH", "CODEX_AUTH_PATH"]) {
    const value = getEnvValue(key);
    if (value) {
      paths.add(value);
    }
  }

  const home = os.homedir();
  if (home) {
    paths.add(path.join(home, ".config", "opencode", "auth.json"));
    paths.add(path.join(home, ".local", "share", "opencode", "auth.json"));
    paths.add(path.join(home, ".config", "codex", "auth.json"));
    paths.add(path.join(home, ".codex", "auth.json"));
    paths.add(
      path.join(home, "Library", "Application Support", "opencode", "auth.json")
    );
  }

  const appData = getEnvValue("APPDATA");
  if (appData) {
    paths.add(path.join(appData, "opencode", "auth.json"));
    paths.add(path.join(appData, "Codex", "auth.json"));
  }

  return [...paths];
}
