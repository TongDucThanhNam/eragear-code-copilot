// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
export interface SubagentCommandDescriptor {
  name: string;
  description?: string;
  prompt: string;
  sourcePath: string;
  enabled: boolean;
}

export function slugCommandName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function subagentSlashCommandName(name: string): string {
  return `agent-${slugCommandName(name)}`;
}

export function buildSubagentDelegationPrompt(params: {
  name: string;
  description?: string;
  prompt: string;
  request: string;
  sourcePath: string;
}): string {
  return [
    `Delegate this task to the "${params.name}" subagent profile.`,
    params.description ? `Subagent description: ${params.description}` : "",
    `Subagent source: ${params.sourcePath}`,
    "",
    "Subagent instructions:",
    params.prompt,
    "",
    "User request:",
    params.request.trim() ||
      "Review the current project state and report findings.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function resolveSubagentCommand(params: {
  text: string;
  subagents: SubagentCommandDescriptor[];
}): {
  command: string;
  prompt: string;
  subagent: {
    name: string;
    description?: string;
    sourcePath: string;
  };
} | null {
  const leadingCommand = params.text.match(
    /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/
  );
  if (!leadingCommand) {
    return null;
  }
  const commandName = leadingCommand[1];
  const subagent = params.subagents.find(
    (item) =>
      item.enabled && subagentSlashCommandName(item.name) === commandName
  );
  if (!subagent) {
    return null;
  }
  return {
    command: commandName,
    prompt: buildSubagentDelegationPrompt({
      name: subagent.name,
      description: subagent.description,
      prompt: subagent.prompt,
      request: leadingCommand[2] ?? "",
      sourcePath: subagent.sourcePath,
    }),
    subagent: {
      name: subagent.name,
      ...(subagent.description ? { description: subagent.description } : {}),
      sourcePath: subagent.sourcePath,
    },
  };
}
