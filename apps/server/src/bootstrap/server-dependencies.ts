import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { createAuthContextResolverWithBootstrap } from "@/transport/auth/auth-context.bootstrap";
import type { HttpRouteDependencies } from "@/transport/http/routes/deps";
import type { TrpcContextDependencies } from "@/transport/trpc/context";
import type { AppDependencies } from "./composition";
import type { ServerRuntimePolicy } from "./server-runtime-policy";

const logger = createLogger("Server");

export function createHttpRouteDependencies(
  deps: AppDependencies,
  runtimePolicy: ServerRuntimePolicy,
  resolveAuthContext: HttpRouteDependencies["resolveAuthContext"]
): HttpRouteDependencies {
  return {
    sessionServices: deps.sessionServices,
    projectServices: deps.projectServices,
    agentServices: deps.agentServices,
    settingsServices: deps.settingsServices,
    appConfig: deps.appConfig,
    opsServices: deps.opsServices,
    eventBus: deps.eventBus,
    logStore: deps.logStore,
    logger: deps.appLogger,
    auth: deps.auth,
    authState: deps.authRuntime.authState,
    runtime: {
      isDev: runtimePolicy.isDev,
      defaultAdminUsername: runtimePolicy.defaultAdminUsername,
      httpMaxBodyBytes: runtimePolicy.httpMaxBodyBytes,
    },
    resolveAuthContext,
  };
}

export function createTrpcContextDependencies(
  deps: AppDependencies,
  resolveAuthContext: TrpcContextDependencies["resolveAuthContext"]
): TrpcContextDependencies {
  return {
    sessionServices: deps.sessionServices,
    aiServices: deps.aiServices,
    projectServices: deps.projectServices,
    agentServices: deps.agentServices,
    toolingServices: deps.toolingServices,
    settingsServices: deps.settingsServices,
    authServices: deps.authServices,
    appConfig: deps.appConfig,
    resolveAuthContext,
  };
}

export function createBootstrappedAuthResolver(deps: AppDependencies) {
  return createAuthContextResolverWithBootstrap(
    {
      resolveAuthContext: deps.resolveAuthContext,
      ensureUserDefaults: async (userId) => {
        await deps.agentServices.ensureAgentDefaults().execute(userId);
      },
      onEnsureUserDefaultsError: ({ userId, error }) => {
        logger.warn("Failed to ensure user defaults during auth bootstrap", {
          userId,
          error: error.message,
        });
      },
    },
    {
      ensureUserDefaultsTtlMs: ENV.authBootstrapEnsureDefaultsTtlMs,
      cacheMaxUsers: ENV.authBootstrapCacheMaxUsers,
      inFlightMaxUsers: ENV.authBootstrapInFlightMaxUsers,
    }
  );
}
