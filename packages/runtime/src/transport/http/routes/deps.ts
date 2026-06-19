import type { AppConfigService } from "#runtime/modules/settings";
import type { AppUseCases } from "#runtime/modules/use-cases";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LogStorePort } from "#runtime/shared/ports/log-store.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";

interface AuthSessionResult {
  user: {
    id: string;
    username?: string | null;
    email?: string | null;
    name?: string | null;
  };
  session?: unknown;
}

interface AuthContextResult {
  userId: string;
}

export interface AuthServicePort {
  api: {
    listApiKeys(input: { headers: Headers }): Promise<unknown>;
    createApiKey(input: {
      body: {
        name?: string;
        prefix?: string;
        expiresIn?: number;
        userId: string;
      };
    }): Promise<unknown>;
    deleteApiKey(input: {
      body: { keyId: string };
      headers: Headers;
    }): Promise<unknown>;
    listDeviceSessions(input: { headers: Headers }): Promise<unknown>;
    revokeDeviceSession(input: {
      body: { sessionToken: string };
      headers: Headers;
    }): Promise<unknown>;
    setActiveSession(input: {
      body: { sessionToken: string };
      headers: Headers;
    }): Promise<unknown>;
    getSession(input: { headers: Headers }): Promise<AuthSessionResult | null>;
  };
}

export interface HttpRouteDependencies {
  useCases: AppUseCases;
  appConfig: AppConfigService;
  eventBus: EventBusPort;
  logStore: LogStorePort;
  logger: LoggerPort;
  auth: AuthServicePort;
  authState: {
    adminUsername: string | null;
  };
  runtime: {
    isDev: boolean;
    defaultAdminUsername: string;
    httpMaxBodyBytes: number;
  };
  resolveAuthContext(input: {
    headers: Headers | Record<string, string | string[] | undefined>;
    url?: string;
    remoteAddress?: string;
  }): Promise<AuthContextResult | null>;
}
