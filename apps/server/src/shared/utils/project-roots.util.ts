/**
 * Project Roots Utility
 *
 * Utilities for validating and resolving paths within allowed project roots.
 * Provides security boundaries to ensure projects only access configured directories.
 *
 * @module shared/utils/project-roots.util
 */

import { homedir } from "node:os";
import path from "node:path";

/**
 * Ensures that project roots have been configured
 *
 * @param allowedRoots - List of allowed project root directories
 * @throws Error if no roots are configured
 */
export function ensureProjectRootsConfigured(allowedRoots: string[]) {
  if (!allowedRoots || allowedRoots.length === 0) {
    throw new Error(
      "Project roots must be configured in /config settings before use."
    );
  }
}

/**
 * Checks if a path is within one of the allowed project roots
 *
 * Handles edge cases where one root might be a prefix of another
 * (e.g., `/source_code_backup` should not match `/source_code`).
 *
 * @param targetPath - The path to check
 * @param allowedRoots - List of allowed project root directories
 * @returns True if the path is within an allowed root
 *
 * @example
 * ```typescript
 * const allowed = ['/projects', '/work'];
 * isPathWithinRoots('/projects/my-app', allowed); // true
 * isPathWithinRoots('/projects_backup/other', allowed); // false
 * ```
 */
export function isPathWithinRoots(
  targetPath: string,
  allowedRoots: string[]
): boolean {
  if (!allowedRoots || allowedRoots.length === 0) {
    return false;
  }

  const resolvedTarget = path.resolve(targetPath);

  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    // Exact match
    if (resolvedTarget === resolvedRoot) {
      return true;
    }
    // Subdirectory: ensure trailing separator to avoid false positives
    // e.g., /source_code/ won't match /source_code_backup
    const normalizedRoot = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : `${resolvedRoot}${path.sep}`;
    return resolvedTarget.startsWith(normalizedRoot);
  });
}

/**
 * Resolves a project path and validates it against allowed roots
 *
 * @param projectPath - The project path to resolve
 * @param allowedRoots - List of allowed project root directories
 * @returns The resolved absolute path
 * @throws Error if the path is not within allowed roots
 *
 * @example
 * ```typescript
 * const allowed = ['/projects'];
 * const resolved = resolveProjectPath('./my-app', allowed);
 * // Returns: '/projects/my-app' (absolute path)
 * ```
 */
export function resolveProjectPath(
  projectPath: string,
  allowedRoots: string[]
): string {
  ensureProjectRootsConfigured(allowedRoots);

  if (!isPathWithinRoots(projectPath, allowedRoots)) {
    const resolvedProject = path.resolve(projectPath);
    throw new Error(
      `Project root ${resolvedProject} is not allowed. Add it in /config settings.`
    );
  }

  return path.resolve(projectPath);
}

interface ProjectRootBoundaryOptions {
  homeDir?: string;
}

/**
 * Normalizes project roots and enforces that every root stays under the host home directory.
 */
export function normalizeProjectRootsForSettings(
  roots: string[],
  options?: ProjectRootBoundaryOptions
): string[] {
  const normalizedHomeDir = path.resolve(options?.homeDir ?? homedir());
  if (normalizedHomeDir === path.parse(normalizedHomeDir).root) {
    throw new Error(
      "[Settings] Home directory must be a non-root path to define project root boundaries."
    );
  }

  const normalizedRoots = roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .map((root) => path.resolve(root));

  if (normalizedRoots.length === 0) {
    throw new Error("At least one project root is required");
  }

  const uniqueRoots = [...new Set(normalizedRoots)];
  for (const root of uniqueRoots) {
    const parsed = path.parse(root);
    if (root === parsed.root) {
      throw new Error(
        `Invalid project root "${root}". Filesystem root is not allowed.`
      );
    }
    if (!isPathWithinRoots(root, [normalizedHomeDir])) {
      throw new Error(
        `Project root "${root}" must be inside the home directory "${normalizedHomeDir}".`
      );
    }
  }

  return uniqueRoots;
}
