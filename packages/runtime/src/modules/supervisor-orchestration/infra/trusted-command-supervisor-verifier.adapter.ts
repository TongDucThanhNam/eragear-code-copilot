import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SupervisorFinalVerifierPort } from "../application/ports/supervisor-orchestrator.port";
import type { SupervisorVerificationEvidence } from "../domain/supervisor-run.schemas";

const execFileAsync = promisify(execFile);
const SHELL_OPERATOR_RE = /[;&|<>`\r\n]/u;
const WHITESPACE_RE = /\s/u;
const MAX_OUTPUT_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class TrustedCommandSupervisorVerifierAdapter
  implements SupervisorFinalVerifierPort
{
  private readonly timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async verify(input: { projectRoot: string; commands: string[] }) {
    const evidence: SupervisorVerificationEvidence[] = [];
    for (const command of input.commands) {
      const startedAt = new Date().toISOString();
      const [executable, ...args] = tokenizeTrustedCommand(command);
      if (!executable) {
        throw new Error("Trusted verification command has no executable");
      }
      try {
        const result = await execFileAsync(executable, args, {
          cwd: input.projectRoot,
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          timeout: this.timeoutMs,
          windowsHide: true,
        });
        evidence.push({
          command,
          exitCode: 0,
          outputSummary: boundOutput(`${result.stdout}\n${result.stderr}`),
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        const failure = error as {
          code?: string | number;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        evidence.push({
          command,
          exitCode: typeof failure.code === "number" ? failure.code : null,
          outputSummary: boundOutput(
            `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? "Command failed"}`
          ),
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      }
    }
    return evidence;
  }
}

export function parseTrustedSupervisorVerificationCommands(
  value: string | undefined
): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 64 ||
    parsed.some(
      (command) =>
        typeof command !== "string" ||
        command.trim().length === 0 ||
        command.length > 4096 ||
        SHELL_OPERATOR_RE.test(command)
    )
  ) {
    throw new Error(
      "SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS must be a JSON array of shell-free commands"
    );
  }
  return [...new Set(parsed.map((command) => command.trim()))];
}

function tokenizeTrustedCommand(command: string): string[] {
  if (SHELL_OPERATOR_RE.test(command)) {
    throw new Error("Trusted verification command contains a shell operator");
  }
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const character of command.trim()) {
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (WHITESPACE_RE.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote) {
    throw new Error("Trusted verification command has an unterminated quote");
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function boundOutput(output: string): string {
  const compact = output.trim();
  return compact.length <= MAX_OUTPUT_CHARS
    ? compact
    : `${compact.slice(0, MAX_OUTPUT_CHARS)}…`;
}
