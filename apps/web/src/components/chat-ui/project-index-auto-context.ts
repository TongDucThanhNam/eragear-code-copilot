export const AUTO_PROJECT_INDEX_CONTEXT_LIMIT = 8;

export interface AutoProjectIndexContextInput {
  text: string;
  hasFiles: boolean;
  mentionCount: number;
  projectIndexReady: boolean;
  commandResolved: boolean;
}

export function shouldAutoAttachProjectIndexContext(
  input: AutoProjectIndexContextInput
): boolean {
  const text = input.text.trim();
  if (!input.projectIndexReady || input.commandResolved) {
    return false;
  }
  if (input.hasFiles || input.mentionCount > 0) {
    return false;
  }
  if (text.length < 12) {
    return false;
  }
  if (text.startsWith("/") || text.startsWith("@")) {
    return false;
  }
  return true;
}

export function shouldUseAutoProjectIndexSearchResult(input: {
  status: "ready" | "not-indexed" | "no-results";
  resultCount: number;
}): boolean {
  return input.status === "ready" && input.resultCount > 0;
}
