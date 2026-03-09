/**
 * Session Cleanup Utilities
 *
 * Provides helpers for terminating session-related processes safely.
 */

import type { ChatSession, TerminalState } from "../types/session.types";
import {
  hasProcessExited,
  terminateProcessGracefully,
} from "./process-termination.util";

async function terminateTerminalStates(
  terminalStates: TerminalState[]
): Promise<void> {
  await Promise.allSettled(
    terminalStates.map(async (termState) => {
      if (termState.killTimer) {
        clearTimeout(termState.killTimer);
        termState.killTimer = undefined;
      }
      if (termState.terminationPromise) {
        await termState.terminationPromise;
        return;
      }
      if (!termState.process || hasProcessExited(termState.process)) {
        return;
      }
      await terminateProcessGracefully(termState.process, {
        processGroupId: termState.processGroupId,
        forceWindowsTreeTermination: true,
      });
    })
  );
}

/**
 * Terminates all terminal processes for a session.
 * Clears any active terminal timeout timers.
 */
export async function terminateSessionTerminals(
  session: ChatSession
): Promise<void> {
  for (const [, pending] of session.pendingPermissions) {
    try {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } catch {
      // Ignore permission resolution failures during teardown.
    }
  }
  session.pendingPermissions.clear();

  const terminalStates = Array.from(
    session.terminals.values()
  ) as TerminalState[];
  await terminateTerminalStates(terminalStates);

  session.terminals.clear();
}

export async function terminateSessionTerminalsByTurnId(
  session: ChatSession,
  turnId: string
): Promise<void> {
  const terminalEntries = (
    Array.from(session.terminals.entries()) as [string, TerminalState][]
  ).filter((entry): entry is [string, TerminalState] => {
    const [, termState] = entry;
    return termState.turnId === turnId;
  });
  if (terminalEntries.length === 0) {
    return;
  }

  await terminateTerminalStates(
    terminalEntries.map(([, terminalState]) => terminalState)
  );
}
