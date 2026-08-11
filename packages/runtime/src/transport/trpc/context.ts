/**
 * tRPC Context
 *
 * Creates the tRPC context from explicit service dependencies.
 * This context is passed to all tRPC procedures and routers.
 *
 * @module transport/trpc/context
 */

import type { AppConfigService } from "#runtime/modules/settings";
import type { AppUseCases } from "#runtime/modules/use-cases";
import { LOCAL_DESKTOP_USER_ID } from "#runtime/shared/constants/local-desktop-user.constants";
import {
  type ConnectionParams,
  createTrpcAuthRequest,
  type RequestLike,
} from "./context-auth-request";

export type { ConnectionParams, RequestLike } from "./context-auth-request";

export interface AuthContext {
  type: "session" | "apiKey" | "local";
  userId: string;
  user?: unknown;
  session?: unknown;
}

export interface TrpcContextDependencies {
  useCases: AppUseCases;
  appConfig: AppConfigService;
  resolveAuthContext: (req: RequestLike) => Promise<AuthContext | null>;
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
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
 * const projects = context.useCases.project.list.execute();
 * ```
 */
export async function createTrpcContext(
  deps: TrpcContextDependencies,
  opts?: { req?: RequestLike; connectionParams?: ConnectionParams }
) {
  const requestWithAuth = createTrpcAuthRequest(
    opts?.req,
    opts?.connectionParams
  );

  const resolvedAuthContext = requestWithAuth
    ? await deps.resolveAuthContext(requestWithAuth)
    : null;
  const authContext =
    process.env.ERAGEAR_RUNTIME_TRANSPORT === "user-daemon" &&
    resolvedAuthContext?.type === "apiKey" &&
    isLoopbackAddress(requestWithAuth?.remoteAddress)
      ? {
          type: "local" as const,
          userId: LOCAL_DESKTOP_USER_ID,
          user: {
            id: LOCAL_DESKTOP_USER_ID,
            username: "local",
            name: "Local Desktop",
          },
        }
      : resolvedAuthContext;

  return {
    useCases: deps.useCases,
    appConfig: deps.appConfig,
    auth: authContext,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
