/**
 * Git/code-context read port used by tooling use-cases.
 *
 * Security invariant: all file reads must remain inside the provided project
 * root, and adapters should return sanitized paths suitable for UI display.
 */
export interface GitPort {
  /** Get project context (rules, tabs, files) */
  getProjectContext(scanRoot: string): Promise<{
    projectRules: { path: string; location: string }[];
    activeTabs: { path: string }[];
    files: string[];
  }>;
  /** Get git diff for a project */
  getDiff(projectRoot: string): Promise<string>;
  /** Read a file within the project root */
  readFileWithinRoot(
    projectRoot: string,
    relativePath: string
  ): Promise<string>;
}
