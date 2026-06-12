export const AUTO_PROJECT_MEMORY_CONTEXT_BYTES = 12_000;
export const AUTO_PROJECT_MEMORY_CONTEXT_CHUNKS = 4;

export interface AutoProjectMemoryContextInput {
  text: string;
  hasFiles: boolean;
  mentionCount: number;
  enabledMemorySources: number;
  commandResolved: boolean;
}

export function shouldAutoAttachProjectMemoryContext(
  input: AutoProjectMemoryContextInput
): boolean {
  const text = input.text.trim();
  if (input.enabledMemorySources <= 0 || input.commandResolved) {
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

export function shouldUseProjectMemoryContextResult(input: {
  status: "ready" | "no-enabled-sources";
  sourceCount: number;
}): boolean {
  return input.status === "ready" && input.sourceCount > 0;
}

export function composeProjectContextPrompt(params: {
  userRequest: string;
  memoryPrompt?: string | null;
  indexPrompt?: string | null;
}): string {
  const contextSections = [
    params.memoryPrompt
      ? ["Project Memory Context:", params.memoryPrompt.trim()].join("\n")
      : "",
    params.indexPrompt
      ? ["Project Index Context:", params.indexPrompt.trim()].join("\n")
      : "",
  ].filter((section) => section.length > 0);

  if (contextSections.length === 0) {
    return params.userRequest;
  }

  return [
    "Use the attached local project context for this request.",
    "",
    ...contextSections.flatMap((section) => [section, ""]),
    "Final user request:",
    params.userRequest.trim(),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
