import type { ChildProcess } from "node:child_process";
import type { TerminalPtyProcess } from "../terminal/pty-process";
import type { TerminalState } from "../types/session.types";
import {
  hasProcessExited,
  terminateProcessGracefully,
} from "./process-termination.util";

const PTY_TERMINATION_TIMEOUT_MS = 4000;

function isChildProcess(
  process: TerminalState["process"]
): process is ChildProcess {
  return (
    typeof (process as ChildProcess).once === "function" &&
    typeof (process as ChildProcess).off === "function"
  );
}

export function pauseTerminalProcessOutput(term: TerminalState): void {
  if (term.processKind === "pty") {
    (term.process as TerminalPtyProcess).pause?.();
    return;
  }
  if (isChildProcess(term.process)) {
    term.process.stdout?.pause();
    term.process.stderr?.pause();
  }
}

export function resumeTerminalProcessOutput(term: TerminalState): void {
  if (term.processKind === "pty") {
    (term.process as TerminalPtyProcess).resume?.();
    return;
  }
  if (isChildProcess(term.process)) {
    term.process.stdout?.resume();
    term.process.stderr?.resume();
  }
}

export function hasTerminalProcessExited(term: TerminalState): boolean {
  if (term.lifecycleState === "exited" || term.exitStatus) {
    return true;
  }
  if (!isChildProcess(term.process)) {
    return false;
  }
  return hasProcessExited(term.process);
}

async function waitForTerminalExitWithTimeout(
  term: TerminalState,
  timeoutMs: number
): Promise<void> {
  await Promise.race([
    term.exitPromise.then(() => undefined),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
}

export async function terminateTerminalStateProcess(
  term: TerminalState
): Promise<void> {
  if (term.terminationPromise) {
    await term.terminationPromise;
    return;
  }

  if (term.killTimer) {
    clearTimeout(term.killTimer);
    term.killTimer = undefined;
  }

  if (hasTerminalProcessExited(term)) {
    return;
  }
  term.lifecycleState = "terminating";

  const terminationPromise =
    term.processKind === "pty" || !isChildProcess(term.process)
      ? (async () => {
          try {
            term.process.kill();
          } catch {
            // Ignore kill signaling failures and rely on observed exit state.
          }
          await waitForTerminalExitWithTimeout(
            term,
            PTY_TERMINATION_TIMEOUT_MS
          );
        })()
      : terminateProcessGracefully(term.process, {
          processGroupId: term.processGroupId,
          forceWindowsTreeTermination: true,
        }).then(() => undefined);

  term.terminationPromise = terminationPromise;

  try {
    await terminationPromise;
  } finally {
    if (term.terminationPromise === terminationPromise) {
      term.terminationPromise = undefined;
    }
  }
}
