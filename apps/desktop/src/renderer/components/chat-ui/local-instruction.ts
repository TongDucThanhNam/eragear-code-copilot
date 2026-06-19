// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
export interface LocalSkillDescriptor {
  name: string;
  description?: string;
  prompt: string;
  sourcePath: string;
  enabled: boolean;
}

export interface LocalOutputStyleDescriptor {
  name: string;
  description?: string;
  prompt: string;
  sourcePath: string;
  enabled: boolean;
}

export function slugInstructionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[@/]+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function skillSlashCommandName(name: string): string {
  return `skill-${slugInstructionName(name)}`;
}

export function outputStyleSlashCommandName(name: string): string {
  return `style-${slugInstructionName(name)}`;
}

function stripSkillMentions(text: string, skillSlugs: Set<string>): string {
  return text
    .replace(/(^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/g, (match, prefix, name) => {
      return skillSlugs.has(name.toLowerCase()) ? prefix : match;
    })
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function buildSkillInvocationPrompt(params: {
  skills: LocalSkillDescriptor[];
  request: string;
}): string {
  const sections = params.skills.flatMap((skill) => [
    `Skill: ${skill.name}`,
    skill.description ? `Description: ${skill.description}` : "",
    `Source: ${skill.sourcePath}`,
    "Instructions:",
    skill.prompt,
    "",
  ]);

  return [
    `Use ${params.skills.length === 1 ? "this local skill" : "these local skills"} for the request.`,
    "",
    ...sections,
    "User request:",
    params.request.trim() ||
      "Apply the selected skill to the current project state.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function buildOutputStylePrompt(params: {
  style: LocalOutputStyleDescriptor;
  request: string;
}): string {
  return [
    `Respond using the "${params.style.name}" local output style.`,
    params.style.description
      ? `Style description: ${params.style.description}`
      : "",
    `Style source: ${params.style.sourcePath}`,
    "",
    "Style instructions:",
    params.style.prompt,
    "",
    "User request:",
    params.request.trim() || "Continue with this output style.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function resolveLocalInstructionCommand(params: {
  text: string;
  skills: LocalSkillDescriptor[];
  outputStyles: LocalOutputStyleDescriptor[];
}): { command: string; prompt: string } | null {
  const leadingCommand = params.text.match(
    /^\/([a-zA-Z0-9:_-]+)(?:\s+([\s\S]*))?$/
  );
  if (leadingCommand) {
    const commandName = leadingCommand[1].toLowerCase();
    const skill = params.skills.find(
      (item) => item.enabled && skillSlashCommandName(item.name) === commandName
    );
    if (skill) {
      return {
        command: commandName,
        prompt: buildSkillInvocationPrompt({
          skills: [skill],
          request: leadingCommand[2] ?? "",
        }),
      };
    }

    const style = params.outputStyles.find(
      (item) =>
        item.enabled && outputStyleSlashCommandName(item.name) === commandName
    );
    if (style) {
      return {
        command: commandName,
        prompt: buildOutputStylePrompt({
          style,
          request: leadingCommand[2] ?? "",
        }),
      };
    }
    return null;
  }

  const matchedSkills: LocalSkillDescriptor[] = [];
  const matchedSlugs = new Set<string>();
  const mentionPattern = /(^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(params.text))) {
    const slug = match[2].toLowerCase();
    if (matchedSlugs.has(slug)) {
      continue;
    }
    const skill = params.skills.find(
      (item) => item.enabled && slugInstructionName(item.name) === slug
    );
    if (skill) {
      matchedSkills.push(skill);
      matchedSlugs.add(slug);
    }
  }

  if (matchedSkills.length === 0) {
    return null;
  }

  return {
    command: [...matchedSlugs].map((slug) => `@${slug}`).join(","),
    prompt: buildSkillInvocationPrompt({
      skills: matchedSkills,
      request: stripSkillMentions(params.text, matchedSlugs),
    }),
  };
}
