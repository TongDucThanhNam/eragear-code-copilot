import type { SessionRuntimePort } from "#runtime/modules/session/application/ports/session-runtime.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { PendingPermissionRequest } from "#runtime/shared/types/session.types";
import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorWorkerAttempt,
} from "../domain/supervisor-run.schemas";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";

const UNSAFE_COMMAND_SYNTAX = /(?:[;&|><`]|\$\(|\r|\n)/;
const OUTSIDE_ROOT_SYNTAX =
  /(?:^|[\s"'])(?:\.\.[\\/]|~[\\/]|[a-z]:[\\/]|\\\\|\/)/i;
const SENSITIVE_COMMAND_TEXT =
  /(?:credential|password|secret|api[_ -]?key|\.env(?:\.|\b)|\.pem\b|\.key\b)/i;
const COMMAND_WORD_SEPARATOR = /\s+/;
const PATH_SEPARATOR = /[\\/]+/g;
const TRAILING_SLASH = /\/$/;
const POWERSHELL_WRAPPER =
  /^(?:"[^"]*[\\/](?:pwsh|powershell)(?:\.exe)?"|(?:pwsh|powershell)(?:\.exe)?)\s+(?:(?:-nologo|-noprofile|-noninteractive)\s+)*(?:-command|-c)\s+([\s\S]+)$/i;
const OUTER_DOUBLE_QUOTES = /^"([\s\S]*)"$/;
const OUTER_SINGLE_QUOTES = /^'([\s\S]*)'$/;
const READ_ONLY_COMMANDS = new Set([
  "dir",
  "get-childitem",
  "get-content",
  "git",
  "ls",
  "rg",
  "select-string",
  "test-path",
  "type",
]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "diff",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

export interface WorkerPermissionResponsePort {
  execute(input: {
    userId: string;
    chatId: string;
    requestId: string;
    decision: string;
  }): Promise<unknown>;
}

export interface SupervisorWorkerPermissionDecision {
  action: "allow" | "reject";
  reason: string;
}

interface BoundWorkerPermission {
  run: SupervisorRunState;
  task: SupervisorTaskRecord;
  attempt: SupervisorWorkerAttempt;
}

interface SupervisorWorkerPermissionDeps {
  runs: SupervisorRunRepositoryPort;
  sessions: SessionRuntimePort;
  respond: WorkerPermissionResponsePort;
  logger: LoggerPort;
}

/** Resolves ACP approvals only inside an approved worker's isolated worktree. */
export class SupervisorWorkerPermissionService {
  private readonly deps: SupervisorWorkerPermissionDeps;

  constructor(deps: SupervisorWorkerPermissionDeps) {
    this.deps = deps;
  }

  async handlePermissionRequest(input: {
    chatId: string;
    requestId: string;
  }): Promise<boolean> {
    const session = this.deps.sessions.get(input.chatId);
    const pending = session?.pendingPermissions.get(input.requestId);
    if (!(session && pending)) {
      return false;
    }

    const binding = await this.findBinding({
      userId: session.userId,
      chatId: input.chatId,
      turnId: pending.turnId,
    });
    if (!binding) {
      return false;
    }

    const decision = evaluateSupervisorWorkerPermission({
      ...binding,
      pending,
      sessionProjectRoot: session.projectRoot,
    });
    await this.deps.respond.execute({
      userId: session.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      decision: decision.action === "allow" ? "allow_once" : "reject",
    });
    this.deps.logger.info("Supervisor worker permission resolved", {
      chatId: input.chatId,
      requestId: input.requestId,
      runId: binding.run.runId,
      taskId: binding.task.taskId,
      action: decision.action,
      reason: decision.reason,
    });
    return true;
  }

  private async findBinding(input: {
    userId: string;
    chatId: string;
    turnId?: string;
  }): Promise<BoundWorkerPermission | null> {
    for (const run of await this.deps.runs.listNonTerminal()) {
      if (run.userId !== input.userId) {
        continue;
      }
      for (const task of run.tasks) {
        const attempt = task.attempts.find(
          (candidate) =>
            candidate.chatId === input.chatId &&
            (!input.turnId || candidate.turnId === input.turnId)
        );
        if (attempt) {
          return { run, task, attempt };
        }
      }
    }
    return null;
  }
}

export function evaluateSupervisorWorkerPermission(input: {
  run: SupervisorRunState;
  task: SupervisorTaskRecord;
  attempt: SupervisorWorkerAttempt;
  pending: PendingPermissionRequest;
  sessionProjectRoot: string;
}): SupervisorWorkerPermissionDecision {
  const { run, task, attempt, pending } = input;
  if (
    run.status !== "running" ||
    !run.plan?.approvedAt ||
    task.status !== "running" ||
    attempt.status !== "running"
  ) {
    return { action: "reject", reason: "worker_not_running" };
  }

  const isolatedRoot =
    attempt.workspace?.projectRoot ?? attempt.isolatedProjectRoot;
  if (
    !isolatedRoot ||
    normalizePath(isolatedRoot) !== normalizePath(input.sessionProjectRoot)
  ) {
    return { action: "reject", reason: "isolated_root_mismatch" };
  }

  const toolName = pending.toolName?.trim().toLowerCase();
  if (toolName === "edit") {
    if (task.executionMode !== "write" || task.filesAllowed.length === 0) {
      return { action: "reject", reason: "edit_not_authorized" };
    }
    // The agent sandbox confines the edit to isolatedRoot. Integration later
    // rejects every changed path outside task.filesAllowed before user-tree IO.
    return { action: "allow", reason: "isolated_scoped_edit" };
  }

  if (toolName !== "execute") {
    return { action: "reject", reason: "unsupported_permission_kind" };
  }

  const command = readStringField(pending.input, "command")?.trim();
  const cwd = readStringField(pending.input, "cwd")?.trim();
  if (!command || (cwd && normalizePath(cwd) !== normalizePath(isolatedRoot))) {
    return { action: "reject", reason: "command_context_mismatch" };
  }

  const approvedCommands = new Set([
    ...task.verificationCommands,
    ...(run.plan?.envelope.verificationCommands ?? []),
  ]);
  const policyCommand = unwrapKnownShell(command);
  const normalizedCommand = normalizeCommand(policyCommand);
  if (
    [...approvedCommands].some(
      (approved) => normalizeCommand(approved) === normalizedCommand
    )
  ) {
    return { action: "allow", reason: "approved_verification_command" };
  }

  return isSafeReadOnlyCommand(policyCommand)
    ? { action: "allow", reason: "isolated_read_only_command" }
    : { action: "reject", reason: "command_outside_approved_envelope" };
}

function isSafeReadOnlyCommand(command: string): boolean {
  if (
    UNSAFE_COMMAND_SYNTAX.test(command) ||
    OUTSIDE_ROOT_SYNTAX.test(command) ||
    SENSITIVE_COMMAND_TEXT.test(command)
  ) {
    return false;
  }
  const words = command.trim().split(COMMAND_WORD_SEPARATOR);
  const executable = words[0]?.toLowerCase();
  if (!(executable && READ_ONLY_COMMANDS.has(executable))) {
    return false;
  }
  if (executable !== "git") {
    return true;
  }
  const subcommand = words[1]?.toLowerCase();
  return Boolean(subcommand && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand));
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function unwrapKnownShell(value: string): string {
  const trimmed = value.trim();
  const match = POWERSHELL_WRAPPER.exec(trimmed);
  if (!match?.[1]) {
    return trimmed;
  }
  const inner = match[1].trim();
  return (
    OUTER_DOUBLE_QUOTES.exec(inner)?.[1] ??
    OUTER_SINGLE_QUOTES.exec(inner)?.[1] ??
    inner
  );
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(PATH_SEPARATOR, "/")
    .replace(TRAILING_SLASH, "")
    .toLowerCase();
}
