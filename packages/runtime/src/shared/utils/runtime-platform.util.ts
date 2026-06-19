import path from "node:path";

const runtimePlatform: NodeJS.Platform = process.platform;

export function getRuntimePlatform(): NodeJS.Platform {
  return runtimePlatform;
}

export function isWindows(): boolean {
  return runtimePlatform === "win32";
}

export function isPosix(): boolean {
  return !isWindows();
}

export function normalizeExecutablePathForPlatform(value: string): string {
  const normalized = path.normalize(value.trim());
  if (isWindows()) {
    return normalized.toLowerCase();
  }
  return normalized;
}
