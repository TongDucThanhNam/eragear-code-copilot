export function composeProjectContextPrompt(params: {
  userRequest: string;
  indexPrompt?: string | null;
}): string {
  const contextSections = [
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
