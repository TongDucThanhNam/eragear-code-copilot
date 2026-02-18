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

  session.terminals.clear();
}
