/**
 * Code Context Service
 *
 * Provides code context utilities for sessions, including project context,
 * git diffs, and file content retrieval.
 *
 * @module modules/tooling/application/code-context.service
 */

import type { SessionRuntimePort } from "@/modules/session";
import { NotFoundError } from "@/shared/errors";
import type { GitPort } from "./ports/git.port";

const MODULE = "tooling";
const OP_PROJECT_CONTEXT = "tooling.code-context.project-context";
const OP_GIT_DIFF = "tooling.code-context.git-diff";
const OP_FILE_CONTENT = "tooling.code-context.file-content";

/**
 * CodeContextService
 *
 * Service for retrieving code context information within a session.
 * Provides project scanning, git operations, and file content access.
 *
 * @example
 * ```typescript
 * const service = new CodeContextService(gitAdapter, sessionRuntime);
 * const context = await service.getProjectContext("chat-123");
 * const diff = await service.getGitDiff("chat-123");
 * const file = await service.getFileContent("chat-123", "src/index.ts");
 * ```
 */
export class CodeContextService {
  /** Git adapter for version control operations */
  private readonly git: GitPort;
  /** Runtime store for accessing active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a CodeContextService with required dependencies
   */
  constructor(git: GitPort, sessionRuntime: SessionRuntimePort) {
    this.git = git;
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Retrieves the project context for a session
   *
   * @param chatId - The chat session identifier
   * @returns The project context from git operations
   * @throws Error if session is not found
   */
  async getProjectContext(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new NotFoundError("Chat not found", {
        module: MODULE,
        op: OP_PROJECT_CONTEXT,
        details: { chatId },
      });
    }
    const scanRoot = session.cwd || session.projectRoot;
    return await this.git.getProjectContext(scanRoot);
  }

  /**
   * Retrieves the git diff for a session's project
   *
   * @param chatId - The chat session identifier
   * @returns The git diff output
   * @throws Error if session is not found
   */
  async getGitDiff(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new NotFoundError("Chat not found", {
        module: MODULE,
        op: OP_GIT_DIFF,
        details: { chatId },
      });
    }
    return await this.git.getDiff(session.projectRoot);
  }

  /**
   * Retrieves the content of a file within the session's project root
   *
   * @param chatId - The chat session identifier
   * @param path - The file path relative to the project root
   * @returns Object containing the file content
   * @throws Error if session is not found
   */
  async getFileContent(chatId: string, path: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new NotFoundError("Chat not found", {
        module: MODULE,
        op: OP_FILE_CONTENT,
        details: { chatId, path },
      });
    }
    const content = await this.git.readFileWithinRoot(
      session.projectRoot,
      path
    );
    return { content };
  }
}
