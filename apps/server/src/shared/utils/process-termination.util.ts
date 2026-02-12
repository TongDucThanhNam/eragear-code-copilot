import type { ChildProcess } from "node:child_process";

const DEFAULT_TERM_TIMEOUT_MS = 3000;
const DEFAULT_KILL_TIMEOUT_MS = 1000;

export interface ProcessTerminationPolicy {
  termTimeoutMs?: number;
  killTimeoutMs?: number;
}

export interface ProcessTerminationResult {
  exited: boolean;
  signalSent: "none" | "SIGTERM" | "SIGKILL";
}

export function hasProcessExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

async function waitForProcessExit(
  proc: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (hasProcessExited(proc)) {
    return true;
  }
  if (!(timeoutMs > 0)) {
    return hasProcessExited(proc);
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    const cleanup = () => {
      proc.off("exit", handleExit);
      proc.off("error", handleError);
      if (timer !== null) {
        clearTimeout(timer);
      }
    };

    const settle = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleExit = () => settle(true);
    const handleError = () => settle(hasProcessExited(proc));
    const timer = setTimeout(() => settle(hasProcessExited(proc)), timeoutMs);
    timer.unref?.();

    proc.once("exit", handleExit);
    proc.once("error", handleError);
  });
}

function signalProcess(
  proc: ChildProcess,
  signal: "SIGTERM" | "SIGKILL"
): void {
  try {
    proc.kill(signal);
  } catch {
    // Ignore kill signaling failures and rely on observed exit state.
  }
}

export async function terminateProcessGracefully(
  proc: ChildProcess,
  policy: ProcessTerminationPolicy = {}
): Promise<ProcessTerminationResult> {
  if (hasProcessExited(proc)) {
    return { exited: true, signalSent: "none" };
  }

  const termTimeoutMs = Math.max(
    1,
    Math.trunc(policy.termTimeoutMs ?? DEFAULT_TERM_TIMEOUT_MS)
  );
  const killTimeoutMs = Math.max(
    1,
    Math.trunc(policy.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS)
  );

  signalProcess(proc, "SIGTERM");
  if (await waitForProcessExit(proc, termTimeoutMs)) {
    return { exited: true, signalSent: "SIGTERM" };
  }

  signalProcess(proc, "SIGKILL");
  const exited = await waitForProcessExit(proc, killTimeoutMs);
  return {
    exited,
    signalSent: "SIGKILL",
  };
}
