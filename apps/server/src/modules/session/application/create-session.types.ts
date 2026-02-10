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
  /** Command to spawn the agent process (defaults to "opencode") */
  command?: string;
  /** Arguments to pass to the agent command */
  args?: string[];
  /** Environment variables for the agent process */
  env?: Record<string, string>;
  /** Optional predefined chat ID */
  chatId?: string;
  /** Session ID to load (for resuming existing sessions) */
  sessionIdToLoad?: string;
}
