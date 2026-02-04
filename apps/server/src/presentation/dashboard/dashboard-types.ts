import type { Settings } from "@/shared/types/settings.types";
import type {
  ApiKeyCreateResponse,
  DashboardData,
  TabKey,
} from "./dashboard-data";

export interface DashboardErrors {
  projectRoots?: string;
  general?: string;
}

export interface DashboardBootstrap {
  settings: Settings;
  dashboardData: DashboardData;
  activeTab: TabKey;
  errors?: DashboardErrors;
  success?: boolean;
  notice?: string;
  requiresRestart?: string[];
  createdApiKey?: ApiKeyCreateResponse;
}
