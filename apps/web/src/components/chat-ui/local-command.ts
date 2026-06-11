export interface LocalSlashCommandDescriptor {
  name: string;
  description?: string;
  prompt: string;
  sourcePath: string;
  enabled: boolean;
  argumentHint?: string;
}

const ARGUMENT_PLACEHOLDERS = [
  "$ARGUMENTS",
  "{{arguments}}",
  "{{ args }}",
  "{{args}}",
];

export function visibleSlashCommandName(value: string): string {
  return value.trim().replace(/^\//, "");
}

function replaceArgumentPlaceholders(prompt: string, args: string): {
  prompt: string;
  replaced: boolean;
} {
  let replaced = false;
  let next = prompt;
  for (const placeholder of ARGUMENT_PLACEHOLDERS) {
    if (next.includes(placeholder)) {
      next = next.split(placeholder).join(args);
      replaced = true;
    }
  }
  return { prompt: next, replaced };
}

export function buildLocalCommandPrompt(params: {
  name: string;
  description?: string;
  prompt: string;
  sourcePath: string;
  args: string;
}): string {
  const basePrompt =
    params.prompt.trim() ||
    params.description?.trim() ||
    `Run local slash command ${params.name}.`;
  const args = params.args.trim();
  const replaced = replaceArgumentPlaceholders(basePrompt, args);

  return [
    `Run the local slash command "${params.name}".`,
    params.description ? `Command description: ${params.description}` : "",
    `Command source: ${params.sourcePath}`,
    "",
    "Command instructions:",
    replaced.prompt,
    !replaced.replaced && args ? "" : "",
    !replaced.replaced && args ? "User arguments:" : "",
    !replaced.replaced && args ? args : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function resolveLocalCommand(params: {
  text: string;
  commands: LocalSlashCommandDescriptor[];
}): { command: string; prompt: string } | null {
  const leadingCommand = params.text.match(/^\/([a-zA-Z0-9:_-]+)(?:\s+([\s\S]*))?$/);
  if (!leadingCommand) {
    return null;
  }
  const commandName = leadingCommand[1].toLowerCase();
  const command = params.commands.find(
    (item) =>
      item.enabled &&
      visibleSlashCommandName(item.name).toLowerCase() === commandName
  );
  if (!command) {
    return null;
  }
  return {
    command: commandName,
    prompt: buildLocalCommandPrompt({
      name: command.name.startsWith("/") ? command.name : `/${command.name}`,
      description: command.description,
      prompt: command.prompt,
      sourcePath: command.sourcePath,
      args: leadingCommand[2] ?? "",
    }),
  };
}
