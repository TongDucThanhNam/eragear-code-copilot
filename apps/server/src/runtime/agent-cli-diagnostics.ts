import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentCliAvailability, AgentCliId } from "@repo/shared";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 2_000;

interface AgentCliDefinition {
  id: AgentCliId;
  displayName: string;
  command: string;
  installHint: string;
}

const AGENT_CLIS: AgentCliDefinition[] = [
  {
    id: "codex",
    displayName: "Codex",
    command: "codex",
    installHint:
      "Install and authenticate the Codex CLI, then ensure `codex` is on PATH.",
  },
  {
    id: "claude",
    displayName: "Claude Code",
    command: "claude",
    installHint:
      "Install and authenticate Claude Code, then ensure `claude` is on PATH.",
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    command: "gemini",
    installHint:
      "Install and authenticate Gemini CLI, then ensure `gemini` is on PATH.",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    command: "opencode",
    installHint:
      "Install and authenticate OpenCode, then ensure `opencode` is on PATH.",
  },
];

function resolveExecutable(command: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function firstOutputLine(stdout: string, stderr: string): string | undefined {
  const line = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line;
}

async function readCliVersion(executablePath: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync(executablePath, ["--version"], {
      timeout: VERSION_TIMEOUT_MS,
      windowsHide: true,
    });
    return firstOutputLine(result.stdout, result.stderr);
  } catch {
    return undefined;
  }
}

export async function resolveAgentCliAvailability(): Promise<
  AgentCliAvailability[]
> {
  const results: AgentCliAvailability[] = [];

  for (const definition of AGENT_CLIS) {
    const executablePath = resolveExecutable(definition.command);
    if (!executablePath) {
      results.push({
        id: definition.id,
        displayName: definition.displayName,
        command: definition.command,
        available: false,
        message: `${definition.displayName} CLI was not found on PATH.`,
        installHint: definition.installHint,
      });
      continue;
    }

    const version = await readCliVersion(executablePath);
    results.push({
      id: definition.id,
      displayName: definition.displayName,
      command: definition.command,
      available: true,
      executablePath,
      ...(version ? { version } : {}),
      message: version
        ? `${definition.displayName} CLI detected: ${version}`
        : `${definition.displayName} CLI detected; version command did not return a value.`,
      installHint: definition.installHint,
    });
  }

  return results;
}
