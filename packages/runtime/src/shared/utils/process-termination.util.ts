import { type ChildProcess, spawn } from "node:child_process";
import { getNodeErrnoCode } from "./node-error.util";
import { isPosix, isWindows } from "./runtime-platform.util";

const DEFAULT_TERM_TIMEOUT_MS = 3000;
const DEFAULT_KILL_TIMEOUT_MS = 1000;

export interface ProcessTerminationPolicy {
  termTimeoutMs?: number;
  killTimeoutMs?: number;
  processGroupId?: number;
  forceWindowsTreeTermination?: boolean;
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
  signal: "SIGTERM" | "SIGKILL",
  processGroupId?: number
): void {
  if (!isPosix()) {
    signalWindowsProcessTree(proc, signal);
    return;
  }
  if (
    typeof processGroupId === "number" &&
    Number.isInteger(processGroupId) &&
    processGroupId > 0
  ) {
    try {
      process.kill(-processGroupId, signal);
      return;
    } catch {
      // Fallback to single-process signaling below.
    }
  }
  try {
    proc.kill(signal);
  } catch {
    // Ignore kill signaling failures and rely on observed exit state.
  }
}

function signalWindowsProcessTree(
  proc: ChildProcess,
  signal: "SIGTERM" | "SIGKILL"
): void {
  const pid = typeof proc.pid === "number" && proc.pid > 0 ? proc.pid : null;
  if (pid !== null) {
    const args = ["/PID", String(pid), "/T"];
    if (signal === "SIGKILL") {
      args.push("/F");
    }

    try {
      const killer = spawn("taskkill", args, {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      killer.once("error", () => {
        try {
          proc.kill(signal);
        } catch {
          // Ignore kill signaling failures and rely on observed exit state.
        }
      });
      return;
    } catch {
      // Fallback below when taskkill invocation cannot start.
    }
  }

  try {
    proc.kill(signal);
  } catch {
    // Ignore kill signaling failures and rely on observed exit state.
  }
}

export function hasProcessGroupAlive(processGroupId: number): boolean {
  if (!(isPosix() && Number.isInteger(processGroupId)) || processGroupId <= 0) {
    return false;
  }
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    const code = getNodeErrnoCode(error);
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number
): Promise<boolean> {
  if (!hasProcessGroupAlive(processGroupId)) {
    return true;
  }
  if (!(timeoutMs > 0)) {
    return !hasProcessGroupAlive(processGroupId);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 25);
      timer.unref?.();
    });
    if (!hasProcessGroupAlive(processGroupId)) {
      return true;
    }
  }
  return !hasProcessGroupAlive(processGroupId);
}

export async function terminateProcessGracefully(
  proc: ChildProcess,
  policy: ProcessTerminationPolicy = {}
): Promise<ProcessTerminationResult> {
  const processGroupId = policy.processGroupId;
  const hasProcessGroup =
    isPosix() &&
    typeof processGroupId === "number" &&
    Number.isInteger(processGroupId) &&
    processGroupId > 0;
  const processGroupAlive =
    hasProcessGroup && hasProcessGroupAlive(processGroupId);

  const forceWindowsTreeTermination =
    isWindows() && policy.forceWindowsTreeTermination === true;

  if (
    hasProcessExited(proc) &&
    !processGroupAlive &&
    !forceWindowsTreeTermination
  ) {
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

  signalProcess(proc, "SIGTERM", processGroupId);
  const termExited = hasProcessGroup
    ? await waitForProcessGroupExit(processGroupId, termTimeoutMs)
    : await waitForProcessExit(proc, termTimeoutMs);
  if (termExited) {
    return { exited: true, signalSent: "SIGTERM" };
  }

  signalProcess(proc, "SIGKILL", processGroupId);
  const exited = hasProcessGroup
    ? await waitForProcessGroupExit(processGroupId, killTimeoutMs)
    : await waitForProcessExit(proc, killTimeoutMs);
  return {
    exited,
    signalSent: "SIGKILL",
  };
}
