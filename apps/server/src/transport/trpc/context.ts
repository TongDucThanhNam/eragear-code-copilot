/**
 * tRPC Context
 *
 * Creates the tRPC context from explicit service dependencies.
 * This context is passed to all tRPC procedures and routers.
 *
 * @module transport/trpc/context
 */

import type {
  AgentServiceFactory,
  AiServiceFactory,
  AuthServiceFactory,
  ProjectServiceFactory,
  SessionServiceFactory,
  SettingsServiceFactory,
  ToolingServiceFactory,
} from "@/modules/service-factories";
import type { AppConfigService } from "@/modules/settings";

export interface RequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
}

type ConnectionParams = Record<string, unknown> | null;

const CONNECTION_PARAM_API_KEY_KEYS = ["apiKey", "api_key", "apikey"] as const;

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  key: string
): string | null {
  if (headers instanceof Headers) {
    const value = headers.get(key);
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }
  const value = headers[key];
  if (Array.isArray(value)) {
    const joined = value.join(",").trim();
    return joined.length > 0 ? joined : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function extractApiKeyFromConnectionParams(
  connectionParams?: ConnectionParams
): string | null {
  if (!connectionParams || typeof connectionParams !== "object") {
    return null;
  }
  for (const key of CONNECTION_PARAM_API_KEY_KEYS) {
    const value = connectionParams[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function withApiKeyHeader(req: RequestLike, apiKey: string): RequestLike {
  const hasAuthHeader =
    getHeader(req.headers, "x-api-key") !== null ||
    getHeader(req.headers, "x-api_key") !== null ||
    getHeader(req.headers, "authorization") !== null;
  if (hasAuthHeader) {
    return req;
  }

  if (req.headers instanceof Headers) {
    const nextHeaders = new Headers(req.headers);
    nextHeaders.set("x-api-key", apiKey);
    return { ...req, headers: nextHeaders };
  }

  return {
    ...req,
    headers: {
      ...req.headers,
      "x-api-key": apiKey,
    },
  };
}

export interface AuthContext {
  type: "session" | "apiKey";
  userId: string;
  user?: unknown;
  session?: unknown;
}

export interface TrpcContextDependencies {
  sessionServices: SessionServiceFactory;
  aiServices: AiServiceFactory;
  projectServices: ProjectServiceFactory;
  agentServices: AgentServiceFactory;
  toolingServices: ToolingServiceFactory;
  settingsServices: SettingsServiceFactory;
  authServices: AuthServiceFactory;
  appConfig: AppConfigService;
  resolveAuthContext: (req: RequestLike) => Promise<AuthContext | null>;
}

/**
 * Creates a tRPC context containing explicit service dependencies.
 *
 * @param deps - App-level service dependencies
 * @param opts - Optional request and connection parameters
 * @returns Context object with service factories
 *
 * @example
 * ```typescript
 * const context = createTrpcContext(deps);
 * const projects = context.projectServices.listProjects().execute();
 * ```
 */
export async function createTrpcContext(
  deps: TrpcContextDependencies,
  opts?: { req?: RequestLike; connectionParams?: ConnectionParams }
) {
  const apiKeyFromConnectionParams = extractApiKeyFromConnectionParams(
    opts?.connectionParams
  );
  const requestWithAuth =
    opts?.req && apiKeyFromConnectionParams
      ? withApiKeyHeader(opts.req, apiKeyFromConnectionParams)
      : opts?.req;

  const authContext = requestWithAuth
    ? await deps.resolveAuthContext(requestWithAuth)
    : null;

  return {
    sessionServices: deps.sessionServices,
    aiServices: deps.aiServices,
    projectServices: deps.projectServices,
    agentServices: deps.agentServices,
    toolingServices: deps.toolingServices,
    settingsServices: deps.settingsServices,
    authServices: deps.authServices,
    appConfig: deps.appConfig,
    auth: authContext,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
