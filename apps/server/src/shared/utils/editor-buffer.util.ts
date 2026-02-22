import { ENV } from "@/config/environment";
import type { ChatSession } from "@/shared/types/session.types";

function isExpiredBuffer(updatedAt: number, now: number, ttlMs: number): boolean {
  if (!Number.isFinite(updatedAt)) {
    return true;
  }
  return now - updatedAt > ttlMs;
}

/**
 * Evict stale and overflow editor buffers for one session.
 * Buffers are pruned by TTL first, then by oldest `updatedAt`.
 */
export function pruneEditorTextBuffers(
  session: Pick<ChatSession, "editorTextBuffers">,
  now = Date.now()
): void {
  const buffers = session.editorTextBuffers;
  if (!buffers || buffers.size === 0) {
    return;
  }

  const ttlMs = Math.max(1, ENV.editorBufferTtlMs);
  for (const [filePath, buffer] of buffers) {
    if (isExpiredBuffer(buffer.updatedAt, now, ttlMs)) {
      buffers.delete(filePath);
    }
  }

  const maxFiles = Math.max(1, ENV.editorBufferMaxFilesPerSession);
  if (buffers.size <= maxFiles) {
    return;
  }

  const candidates = [...buffers.entries()].sort((left, right) => {
    const updatedAtDiff = left[1].updatedAt - right[1].updatedAt;
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }
    return left[0].localeCompare(right[0]);
  });
  const overflow = buffers.size - maxFiles;
  for (let index = 0; index < overflow; index += 1) {
    const candidate = candidates[index];
    if (candidate?.[0]) {
      buffers.delete(candidate[0]);
    }
  }
}
