import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { AgentSqliteRepository } from "@/modules/agent/di";
import { ProjectSqliteRepository } from "@/modules/project/di";
import { createSessionSqliteRepository } from "@/modules/session/di";
import {
  createDefaultAppConfigFromEnv,
  normalizeAppConfig,
} from "@/modules/settings/app-config.service";
import { SettingsSqliteRepository } from "@/modules/settings/di";
import type { AppConfig } from "@/shared/types/settings.types";
import {
  closeSqliteDb,
  getSqliteStorageStatsLocal,
  runSqliteRuntimeMaintenanceLocal,
} from "./sqlite-store";
import type {
  SqliteWorkerInitData,
  SqliteWorkerRequest,
  SqliteWorkerResponse,
} from "./sqlite-worker.protocol";
import { SQLITE_WORKER_KIND } from "./sqlite-worker.protocol";

function toErrorPayload(error: unknown): SqliteWorkerResponse["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function getMethod(
  target: Record<string, unknown>,
  method: string
): (...args: unknown[]) => unknown {
  const candidate = target[method];
  if (typeof candidate !== "function") {
    throw new Error(`Unknown SQLite worker method: ${method}`);
  }
  return candidate.bind(target) as (...args: unknown[]) => unknown;
}

const port = parentPort;

if (!isMainThread && port) {
  const init = workerData as SqliteWorkerInitData | undefined;
  if (init?.kind !== SQLITE_WORKER_KIND) {
    throw new Error("Invalid sqlite worker initialization data");
  }

  let runtimeAppConfig: AppConfig = createDefaultAppConfigFromEnv();
  const sessionRepo = createSessionSqliteRepository({
    policyProvider: () => ({
      sessionListPageMaxLimit: runtimeAppConfig.sessionListPageMaxLimit,
      sessionMessagesPageMaxLimit: runtimeAppConfig.sessionMessagesPageMaxLimit,
    }),
  });
  const projectRepo = new ProjectSqliteRepository();
  const agentRepo = new AgentSqliteRepository();
  const settingsRepo = new SettingsSqliteRepository();

  const handleStorageMethod = async (method: string, args: unknown[]) => {
    if (method === "runMaintenance") {
      return runSqliteRuntimeMaintenanceLocal();
    }
    if (method === "getStorageStats") {
      return getSqliteStorageStatsLocal();
    }
    if (method === "shutdown") {
      await closeSqliteDb();
      return null;
    }
    if (method === "setRuntimeConfig") {
      runtimeAppConfig = normalizeAppConfig(args[0], runtimeAppConfig);
      return runtimeAppConfig;
    }
    throw new Error(`Unknown SQLite storage method: ${method}`);
  };

  port.on("message", async (raw: unknown) => {
    const request = raw as SqliteWorkerRequest;
    if (request?.type !== "request" || typeof request.id !== "number") {
      return;
    }

    try {
      let result: unknown;
      if (request.service === "session") {
        result = await getMethod(
          sessionRepo as unknown as Record<string, unknown>,
          request.method
        )(...request.args);
      } else if (request.service === "project") {
        result = await getMethod(
          projectRepo as unknown as Record<string, unknown>,
          request.method
        )(...request.args);
      } else if (request.service === "agent") {
        result = await getMethod(
          agentRepo as unknown as Record<string, unknown>,
          request.method
        )(...request.args);
      } else if (request.service === "settings") {
        result = await getMethod(
          settingsRepo as unknown as Record<string, unknown>,
          request.method
        )(...request.args);
      } else if (request.service === "storage") {
        result = await handleStorageMethod(request.method, request.args);
      } else {
        throw new Error(`Unknown SQLite worker service: ${request.service}`);
      }

      const response: SqliteWorkerResponse = {
        type: "response",
        id: request.id,
        ok: true,
        result,
      };
      port.postMessage(response);
    } catch (error) {
      const response: SqliteWorkerResponse = {
        type: "response",
        id: request.id,
        ok: false,
        error: toErrorPayload(error),
      };
      port.postMessage(response);
    }
  });
}
