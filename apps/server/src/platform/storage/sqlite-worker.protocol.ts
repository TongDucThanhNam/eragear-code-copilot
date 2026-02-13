export const SQLITE_WORKER_KIND = "sqlite_storage_worker";

export type SqliteWorkerService =
  | "session"
  | "project"
  | "agent"
  | "settings"
  | "storage";

export interface SqliteWorkerRequest {
  type: "request";
  id: number;
  service: SqliteWorkerService;
  method: string;
  args: unknown[];
}

export interface SqliteWorkerResponse {
  type: "response";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface SqliteWorkerReadyMessage {
  type: "ready";
}

export type SqliteWorkerMessage =
  | SqliteWorkerReadyMessage
  | SqliteWorkerResponse;

export interface SqliteWorkerInitData {
  kind: typeof SQLITE_WORKER_KIND;
  allowedRoots: string[];
}
