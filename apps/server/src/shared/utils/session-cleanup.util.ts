/**
 * Session Cleanup Utilities
 *
 * Provides helpers for terminating session-related processes safely.
 */

import type { ChatSession, TerminalState } from "../types/session.types";

/**
 * Terminates all terminal processes for a session.
 * Clears any active terminal timeout timers.
 */
export function terminateSessionTerminals(session: ChatSession) {
  for (const terminal of session.terminals.values()) {
    const termState = terminal as TerminalState;
    if (termState.killTimer) {
      clearTimeout(termState.killTimer);
      termState.killTimer = undefined;
    }
    if (termState.process && !termState.process.killed) {
      termState.process.kill("SIGTERM");
    }
  }
  session.terminals.clear();
}
