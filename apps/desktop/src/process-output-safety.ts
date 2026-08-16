import type { EventEmitter } from "node:events";

export interface ProcessOutputStream
  extends Pick<EventEmitter, "on" | "listenerCount"> {
  destroyed?: boolean;
  writable?: boolean;
}

const guardedStreams = new WeakSet<ProcessOutputStream>();
const unavailableStreams = new WeakSet<ProcessOutputStream>();

/**
 * Electron is a GUI process and must outlive the terminal that launched it.
 * Node emits EPIPE/stream errors when an inherited stdout or stderr disappears;
 * consuming that event prevents diagnostic output from crashing the main process.
 */
export function installProcessOutputErrorGuards(
  streams: readonly ProcessOutputStream[] = [process.stdout, process.stderr]
): void {
  for (const stream of streams) {
    if (guardedStreams.has(stream)) {
      continue;
    }
    guardedStreams.add(stream);
    stream.on("error", () => {
      unavailableStreams.add(stream);
    });
  }
}

export function isProcessOutputAvailable(stream: ProcessOutputStream): boolean {
  return !(
    unavailableStreams.has(stream) ||
    stream.destroyed === true ||
    stream.writable === false
  );
}

export function writeProcessOutputSafely(
  stream: ProcessOutputStream,
  write: () => void
): void {
  if (!isProcessOutputAvailable(stream)) {
    return;
  }
  try {
    write();
  } catch {
    unavailableStreams.add(stream);
  }
}
