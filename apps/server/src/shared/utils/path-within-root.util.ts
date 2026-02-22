import { realpath } from "node:fs/promises";
import path from "node:path";
import { isNodeErrno } from "@/shared/utils/node-error.util";
import { fileUriToPath } from "@/shared/utils/path.util";

const MAX_CANONICAL_ANCESTOR_ASCENT = 256;

function isPathOutsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return isNodeErrno(error, "ENOENT") || isNodeErrno(error, "ENOTDIR");
}

async function canonicalizeTargetPath(resolvedPath: string): Promise<string> {
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  const pathSuffix: string[] = [];
  let cursor = resolvedPath;
  let ascents = 0;
  while (true) {
    try {
      const canonicalAncestor = await realpath(cursor);
      return path.resolve(canonicalAncestor, ...pathSuffix);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw error;
      }
      pathSuffix.unshift(path.basename(cursor));
      cursor = parent;
      ascents += 1;
      if (ascents > MAX_CANONICAL_ANCESTOR_ASCENT) {
        throw new Error("Path resolution exceeded maximum ancestor depth");
      }
    }
  }
}

export async function resolvePathWithinRoot(params: {
  rootPath: string;
  inputPath: string;
}): Promise<{ canonicalRootPath: string; canonicalTargetPath: string }> {
  const rawPath = fileUriToPath(params.inputPath);
  const configuredRoot = path.resolve(params.rootPath);
  let canonicalRootPath = configuredRoot;
  try {
    canonicalRootPath = await realpath(configuredRoot);
  } catch {
    throw new Error(`Invalid project root: ${configuredRoot}`);
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(canonicalRootPath, rawPath);
  const canonicalTargetPath = await canonicalizeTargetPath(resolvedPath);

  if (isPathOutsideRoot(canonicalRootPath, canonicalTargetPath)) {
    throw new Error(
      `Access denied (outside project root): ${canonicalTargetPath} (root: ${canonicalRootPath})`
    );
  }

  return {
    canonicalRootPath,
    canonicalTargetPath,
  };
}

export function toPortableRelativePath(params: {
  canonicalRootPath: string;
  canonicalTargetPath: string;
}): string {
  const relativePath = path.relative(
    params.canonicalRootPath,
    params.canonicalTargetPath
  );
  return relativePath.split(path.sep).join("/");
}
