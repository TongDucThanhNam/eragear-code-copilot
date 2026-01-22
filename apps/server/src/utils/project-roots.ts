import path from "node:path";

export function ensureProjectRootsConfigured(allowedRoots: string[]) {
  if (!allowedRoots || allowedRoots.length === 0) {
    throw new Error(
      "Project roots must be configured in /config settings before use."
    );
  }
}

export function resolveProjectPath(
  projectPath: string,
  allowedRoots: string[]
): string {
  ensureProjectRootsConfigured(allowedRoots);
  const resolvedProject = path.resolve(projectPath);

  const isAllowed = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    if (resolvedProject === resolvedRoot) {
      return true;
    }
    const normalizedRoot = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : `${resolvedRoot}${path.sep}`;
    return resolvedProject.startsWith(normalizedRoot);
  });

  if (!isAllowed) {
    throw new Error(
      `Project root ${resolvedProject} is not allowed. Add it in /config settings.`
    );
  }

  return resolvedProject;
}
