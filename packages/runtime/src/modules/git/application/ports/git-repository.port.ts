import type { GitChangedFile } from "../contracts/git.contract";

export interface GitRepositoryReadResult {
  isRepository: boolean;
  branch?: string;
  head?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changedFiles: GitChangedFile[];
  error?: string;
}

/**
 * Read-only Git integration port.
 *
 * Security invariant: adapters must scope all git commands to the provided
 * project root and return display-safe relative paths.
 */
export interface GitRepositoryPort {
  getRepositoryState(projectRoot: string): Promise<GitRepositoryReadResult>;
}

export type {
  GitChangedFile,
  GitRepositorySummary,
} from "../contracts/git.contract";
