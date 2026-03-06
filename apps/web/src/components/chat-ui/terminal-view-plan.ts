import type { TerminalOutputSnapshot } from "@/store/chat-stream-store";

export type TerminalWritePlan =
  | { type: "noop" }
  | { type: "append"; chunks: readonly string[] }
  | { type: "reset"; chunks: readonly string[] };

function flattenTerminalSnapshotChunks(
  terminalSnapshots: readonly TerminalOutputSnapshot[]
): string[] {
  const chunks: string[] = [];
  for (const terminal of terminalSnapshots) {
    if (terminal.chunks.length > 0) {
      chunks.push(...terminal.chunks);
    }
  }
  return chunks;
}

function readTerminalSnapshotDeltaChunks(
  terminal: TerminalOutputSnapshot,
  absoluteStartOffset: number
): string[] {
  if (absoluteStartOffset <= terminal.startOffset) {
    return [...terminal.chunks];
  }

  let remainingSkip = absoluteStartOffset - terminal.startOffset;
  const chunks: string[] = [];
  for (const chunk of terminal.chunks) {
    if (remainingSkip >= chunk.length) {
      remainingSkip -= chunk.length;
      continue;
    }
    if (remainingSkip > 0) {
      chunks.push(chunk.slice(remainingSkip));
      remainingSkip = 0;
      continue;
    }
    chunks.push(chunk);
  }
  return chunks;
}

export function getTerminalWritePlan(
  previousTerminals: readonly TerminalOutputSnapshot[],
  nextTerminals: readonly TerminalOutputSnapshot[]
): TerminalWritePlan {
  if (previousTerminals.length !== nextTerminals.length) {
    return {
      type: "reset",
      chunks: flattenTerminalSnapshotChunks(nextTerminals),
    };
  }

  let firstChangedIndex = -1;
  let hasAdditionalChanges = false;
  for (let index = 0; index < nextTerminals.length; index += 1) {
    const previousTerminal = previousTerminals[index];
    const nextTerminal = nextTerminals[index];
    if (!previousTerminal || previousTerminal.terminalId !== nextTerminal?.terminalId) {
      return {
        type: "reset",
        chunks: flattenTerminalSnapshotChunks(nextTerminals),
      };
    }
    const isChanged =
      previousTerminal.touchedSeq !== nextTerminal.touchedSeq ||
      previousTerminal.totalChars !== nextTerminal.totalChars ||
      previousTerminal.startOffset !== nextTerminal.startOffset;
    if (!isChanged) {
      continue;
    }
    if (firstChangedIndex === -1) {
      firstChangedIndex = index;
      continue;
    }
    hasAdditionalChanges = true;
  }

  if (firstChangedIndex === -1) {
    return { type: "noop" };
  }
  if (hasAdditionalChanges || firstChangedIndex !== nextTerminals.length - 1) {
    return {
      type: "reset",
      chunks: flattenTerminalSnapshotChunks(nextTerminals),
    };
  }

  const previousTerminal = previousTerminals[firstChangedIndex];
  const nextTerminal = nextTerminals[firstChangedIndex];
  if (
    !previousTerminal ||
    !nextTerminal ||
    nextTerminal.startOffset !== previousTerminal.startOffset ||
    nextTerminal.totalChars < previousTerminal.totalChars
  ) {
    return {
      type: "reset",
      chunks: flattenTerminalSnapshotChunks(nextTerminals),
    };
  }

  const deltaChunks = readTerminalSnapshotDeltaChunks(
    nextTerminal,
    previousTerminal.startOffset + previousTerminal.totalChars
  );
  if (deltaChunks.length === 0) {
    return {
      type: "reset",
      chunks: flattenTerminalSnapshotChunks(nextTerminals),
    };
  }
  return {
    type: "append",
    chunks: deltaChunks,
  };
}
