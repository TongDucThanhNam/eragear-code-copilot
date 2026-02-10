import type { Settings } from "@/shared/types/settings.types";
import type {
  ApiKeyCreateResponse,
  DashboardData,
  TabKey,
} from "./dashboard-data";
import type { DashboardErrors } from "./dashboard-types";

export interface DashboardViewState {
  settings: Settings;
  dashboardData: DashboardData;
  activeTab: TabKey;
  errors?: DashboardErrors;
  success?: boolean;
  notice?: string;
  isLoading?: boolean;
  requiresRestart?: string[];
  createdApiKey?: ApiKeyCreateResponse;
}

export interface DashboardViewActions {
  navigation: {
    onTabChange: (tab: TabKey) => void;
  };
  sessions: {
    onRefreshSessions: () => void;
    onStopSession: (chatId: string) => Promise<void>;
    onDeleteSession: (chatId: string) => Promise<void>;
  };
  projects: {
    onCreateProject: (input: {
      name: string;
      path: string;
      description?: string;
    }) => Promise<void>;
  };
  agents: {
    onCreateAgent: (input: {
      name: string;
      type: string;
      command: string;
      argsInput?: string;
    }) => Promise<void>;
    onUpdateAgent: (input: {
      id: string;
      name: string;
      type: string;
      command: string;
      argsInput?: string;
    }) => Promise<void>;
    onDeleteAgent: (agentId: string) => Promise<void>;
  };
  auth: {
    onCreateApiKey: (input: {
      name?: string;
      prefix?: string;
      expiresInDays?: number;
    }) => Promise<void>;
    onDeleteApiKey: (keyId: string) => Promise<void>;
    onActivateDeviceSession: (token: string) => Promise<void>;
    onRevokeDeviceSession: (token: string) => Promise<void>;
  };
  settings: {
    onSaveSettings: (formData: FormData) => Promise<void>;
  };
}
