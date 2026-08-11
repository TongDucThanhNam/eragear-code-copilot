import { describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "#runtime/modules/session/application/ports/session-runtime.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { PendingPermissionRequest } from "#runtime/shared/types/session.types";
import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorWorkerAttempt,
} from "../domain/supervisor-run.schemas";
import {
  evaluateSupervisorWorkerPermission,
  SupervisorWorkerPermissionService,
} from "./supervisor-worker-permission.service";

const root = "C:/owned/worktree";

function fixture(
  overrides: {
    toolName?: string;
    input?: unknown;
    sessionProjectRoot?: string;
  } = {}
) {
  const attempt = {
    attemptId: "attempt-1",
    chatId: "chat-1",
    agentId: "agent-1",
    status: "running",
    workspace: { projectRoot: root },
  } as SupervisorWorkerAttempt;
  const task = {
    taskId: "task-1",
    status: "running",
    executionMode: "write",
    filesAllowed: ["result.txt"],
    verificationCommands: ["bun test"],
    attempts: [attempt],
  } as SupervisorTaskRecord;
  const run = {
    runId: "run-1",
    userId: "user-1",
    status: "running",
    plan: {
      approvedAt: "2026-08-11T00:00:00.000Z",
      envelope: { verificationCommands: ["bun test"] },
    },
    tasks: [task],
  } as SupervisorRunState;
  const pending = {
    resolve: () => undefined,
    options: [],
    toolName: overrides.toolName ?? "execute",
    input: overrides.input ?? { command: "bun test", cwd: root },
  } as PendingPermissionRequest;
  return {
    run,
    task,
    attempt,
    pending,
    sessionProjectRoot: overrides.sessionProjectRoot ?? root,
  };
}

describe("evaluateSupervisorWorkerPermission", () => {
  test("allows scoped edits only in the bound isolated worktree", () => {
    expect(
      evaluateSupervisorWorkerPermission(fixture({ toolName: "edit" }))
    ).toEqual({ action: "allow", reason: "isolated_scoped_edit" });
    expect(
      evaluateSupervisorWorkerPermission(
        fixture({ toolName: "edit", sessionProjectRoot: "C:/user/repo" })
      )
    ).toEqual({ action: "reject", reason: "isolated_root_mismatch" });
  });

  test("allows exact verification and bounded read-only commands", () => {
    expect(evaluateSupervisorWorkerPermission(fixture())).toEqual({
      action: "allow",
      reason: "approved_verification_command",
    });
    expect(
      evaluateSupervisorWorkerPermission(
        fixture({
          input: {
            command:
              '"C:/Program Files/PowerShell/7/pwsh.exe" -NoProfile -Command "bun test"',
            cwd: root,
          },
        })
      )
    ).toEqual({ action: "allow", reason: "approved_verification_command" });
    expect(
      evaluateSupervisorWorkerPermission(
        fixture({
          input: {
            command:
              'pwsh -NoLogo -NonInteractive -Command "git status --short"',
            cwd: root,
          },
        })
      )
    ).toEqual({ action: "allow", reason: "isolated_read_only_command" });
  });

  test("rejects compound, destructive, and out-of-root commands", () => {
    for (const input of [
      { command: "bun test; git commit -am bad", cwd: root },
      { command: "git commit -am bad", cwd: root },
      { command: "Get-Content ../secret.txt", cwd: root },
      { command: "bun test", cwd: "C:/user/repo" },
    ]) {
      expect(
        evaluateSupervisorWorkerPermission(fixture({ input })).action
      ).toBe("reject");
    }
  });
});

describe("SupervisorWorkerPermissionService", () => {
  test("handles bound worker permissions and leaves normal chats untouched", async () => {
    const bound = fixture();
    const decisions: string[] = [];
    const sessions = {
      get(chatId: string) {
        if (chatId !== "chat-1") {
          return undefined;
        }
        return {
          userId: "user-1",
          projectRoot: root,
          pendingPermissions: new Map([["request-1", bound.pending]]),
        };
      },
    } as unknown as SessionRuntimePort;
    const service = new SupervisorWorkerPermissionService({
      runs: {
        listNonTerminal: () => Promise.resolve([bound.run]),
      } as never,
      sessions,
      respond: {
        execute(input) {
          decisions.push(input.decision);
          return Promise.resolve();
        },
      },
      logger: { info: () => undefined } as unknown as LoggerPort,
    });

    expect(
      await service.handlePermissionRequest({
        chatId: "chat-1",
        requestId: "request-1",
      })
    ).toBe(true);
    expect(decisions).toEqual(["allow_once"]);
    expect(
      await service.handlePermissionRequest({
        chatId: "normal-chat",
        requestId: "request-2",
      })
    ).toBe(false);
  });
});
