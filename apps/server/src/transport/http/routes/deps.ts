import type {
  AgentServiceFactory,
  OpsServiceFactory,
  ProjectServiceFactory,
  SessionServiceFactory,
  SettingsServiceFactory,
} from "@/modules/service-factories";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";

interface AuthSessionResult {
  user: {
    id: string;
  };
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
  sessionServices: SessionServiceFactory;
  projectServices: ProjectServiceFactory;
  agentServices: AgentServiceFactory;
  settingsServices: SettingsServiceFactory;
  opsServices: OpsServiceFactory;
  eventBus: EventBusPort;
  logStore: LogStorePort;
  logger: LoggerPort;
  auth: AuthServicePort;
}
