/**
 * Parameters for creating a new session.
 */
export interface CreateSessionParams {
  /** Owning user identifier */
  userId: string;
  /** Optional project ID this session belongs to */
  projectId?: string;
  /** Optional file system path to the project root directory */
  projectRoot?: string;
  /** Optional agent ID selected by client; resolved server-side */
  agentId?: string;
  /** Trusted command override used by internal flows (e.g. resume), never client input */
  command?: string;
  /** Trusted args override used by internal flows (e.g. resume), never client input */
  args?: string[];
  /** Trusted env override used by internal flows (e.g. resume), never client input */
  env?: Record<string, string>;
  /** Optional predefined chat ID */
  chatId?: string;
  /** Session ID to load (for resuming existing sessions) */
  sessionIdToLoad?: string;
  /** Import replayed agent history into local DB when loading an external session */
  importExternalHistoryOnLoad?: boolean;
}
