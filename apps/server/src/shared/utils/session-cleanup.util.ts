/**
 * Session Cleanup Utilities
 *
 * Provides helpers for terminating session-related processes safely.
 */

import type { ChildProcess } from "node:child_process";
import type { ChatSession, TerminalState } from "../types/session.types";
import { terminateProcessGracefully } from "./process-termination.util";

function hasProcessExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * Terminates all terminal processes for a session.
 * Clears any active terminal timeout timers.
 */
export async function terminateSessionTerminals(
  session: ChatSession
): Promise<void> {
  const terminalStates = Array.from(
    session.terminals.values()
  ) as TerminalState[];

  await Promise.allSettled(
    terminalStates.map(async (termState) => {
      if (termState.killTimer) {
        clearTimeout(termState.killTimer);
        termState.killTimer = undefined;
      }
      if (!termState.process || hasProcessExited(termState.process)) {
        return;
      }
      await terminateProcessGracefully(termState.process);
    })
  );

  session.terminals.clear();
}
