import path from "node:path";

export type DesktopRuntimeRole = "daemon-service" | "desktop-service";

export interface DesktopRuntimeLaunchInput {
  bunExecutable?: string;
  role: DesktopRuntimeRole;
  runtimeExecutable?: string;
  runtimeRoot: string;
}

export interface DesktopRuntimeLaunch {
  args: string[];
  command: string;
  requiredFile: string;
}

export function resolveDesktopRuntimeLaunch(
  input: DesktopRuntimeLaunchInput
): DesktopRuntimeLaunch {
  const runtimeExecutable = input.runtimeExecutable?.trim();
  if (runtimeExecutable) {
    const executable = path.resolve(runtimeExecutable);
    return {
      command: executable,
      args: [input.role],
      requiredFile: executable,
    };
  }

  const sourceEntrypoint = path.join(
    path.resolve(input.runtimeRoot),
    "src",
    "runtime",
    `${input.role}.ts`
  );
  return {
    command: input.bunExecutable ?? "bun",
    args: [
      "run",
      path.relative(path.resolve(input.runtimeRoot), sourceEntrypoint),
    ],
    requiredFile: sourceEntrypoint,
  };
}
