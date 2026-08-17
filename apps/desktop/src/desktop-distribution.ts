import path from "node:path";
import { pathToFileURL } from "node:url";

const WINDOWS_RUNTIME_EXECUTABLE = "eragear-runtime.exe";
const POSIX_RUNTIME_EXECUTABLE = "eragear-runtime";

export interface DesktopDistributionInput {
  appPath: string;
  developmentRendererUrl: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  repoRoot: string;
  resourcesPath: string;
  runtimeExecutableOverride?: string;
}

export interface DesktopDistribution {
  rendererUrl: string;
  runtimeRoot: string;
  runtimeExecutable?: string;
}

export function resolveDesktopDistribution(
  input: DesktopDistributionInput
): DesktopDistribution {
  if (!input.isPackaged) {
    return {
      rendererUrl: input.developmentRendererUrl,
      runtimeRoot: path.join(input.repoRoot, "packages", "runtime"),
    };
  }

  const runtimeRoot = path.join(input.resourcesPath, "runtime");
  const defaultRuntimeExecutable = path.join(
    runtimeRoot,
    input.platform === "win32"
      ? WINDOWS_RUNTIME_EXECUTABLE
      : POSIX_RUNTIME_EXECUTABLE
  );

  return {
    rendererUrl: pathToFileURL(
      path.join(input.appPath, "dist", "renderer", "index.html")
    ).toString(),
    runtimeRoot,
    runtimeExecutable: input.runtimeExecutableOverride?.trim()
      ? path.resolve(input.runtimeExecutableOverride)
      : defaultRuntimeExecutable,
  };
}
