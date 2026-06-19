import { realpath } from "node:fs/promises";
import path from "node:path";
import { isNodeErrno } from "#runtime/shared/utils/node-error.util";
import { fileUriToPath } from "#runtime/shared/utils/path.util";

const MAX_CANONICAL_ANCESTOR_ASCENT = 256;
const WINDOWS_DRIVE_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_DRIVE_RELATIVE_ROOT_RE = /^[a-zA-Z]:$/;

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

function isAbsoluteInputPath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    WINDOWS_DRIVE_ABSOLUTE_PATH_RE.test(value) ||
    value.startsWith("\\\\")
  );
}

function normalizeCanonicalAncestorPath(value: string): string {
  return WINDOWS_DRIVE_RELATIVE_ROOT_RE.test(value) ? `${value}\\` : value;
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
      const canonicalAncestor = normalizeCanonicalAncestorPath(
        await realpath(cursor)
      );
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

  const resolvedPath = isAbsoluteInputPath(rawPath)
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
