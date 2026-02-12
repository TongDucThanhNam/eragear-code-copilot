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
  ensureUserDefaults?: (userId: string) => Promise<void>;
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
  opts?: { req?: RequestLike }
) {
  const authContext = opts?.req
    ? await deps.resolveAuthContext(opts.req)
    : null;
  if (authContext) {
    await deps.ensureUserDefaults?.(authContext.userId);
  }

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
