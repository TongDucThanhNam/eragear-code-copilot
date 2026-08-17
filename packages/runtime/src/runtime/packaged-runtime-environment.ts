import path from "node:path";
import type { AgentCliAvailability } from "@eragear-code-copilot/shared";
import { resolveAgentCliAvailability } from "./agent-cli-diagnostics";

const DEFAULT_ALLOWED_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "BUN_ENV",
  "TERM",
  "SHELL",
  "ComSpec",
  "SystemRoot",
  "DEBUG",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

interface PackagedRuntimeEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  platform?: NodeJS.Platform;
  resolveCliAvailability?: () => Promise<AgentCliAvailability[]>;
}

interface CommandPolicy {
  command: string;
  allowAnyArgs: boolean;
  allowedArgs?: string[];
}

function defaultTerminalCommand(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string {
  if (platform !== "win32") {
    return "/bin/sh";
  }
  const configured = env.ComSpec ?? env.COMSPEC;
  if (configured?.trim()) {
    return path.resolve(configured);
  }
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "cmd.exe");
}

export async function configurePackagedRuntimeEnvironment(
  options: PackagedRuntimeEnvironmentOptions = {}
): Promise<NodeJS.ProcessEnv> {
  const env = options.env ?? process.env;
  const execPath = path.resolve(options.execPath ?? process.execPath);
  const platform = options.platform ?? process.platform;
  const getCliAvailability =
    options.resolveCliAvailability ?? resolveAgentCliAvailability;

  env.NODE_ENV ??= "production";
  env.BUN_ENV ??= "production";
  env.ALLOW_INSECURE_DEV_DEFAULTS ??= "false";
  env.CONFIG_STRICT_ALLOWLIST ??= "true";
  env.ALLOWED_ENV_KEYS ??= DEFAULT_ALLOWED_ENV_KEYS.join(",");

  if (!env.ALLOWED_AGENT_COMMAND_POLICIES?.trim()) {
    const availability = await getCliAvailability();
    const policies: CommandPolicy[] = [
      { command: execPath, allowAnyArgs: false, allowedArgs: [] },
      ...availability.flatMap((cli) =>
        cli.available && cli.executablePath
          ? [{ command: cli.executablePath, allowAnyArgs: true }]
          : []
      ),
    ];
    env.ALLOWED_AGENT_COMMAND_POLICIES = JSON.stringify(policies);
  }

  if (!env.ALLOWED_TERMINAL_COMMAND_POLICIES?.trim()) {
    env.ALLOWED_TERMINAL_COMMAND_POLICIES = JSON.stringify([
      {
        command: defaultTerminalCommand(env, platform),
        allowAnyArgs: true,
      },
    ] satisfies CommandPolicy[]);
  }

  return env;
}
