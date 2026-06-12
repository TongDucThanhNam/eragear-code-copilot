import type {
  PromptEnhancementMode,
  PromptEnhancementRequest,
  PromptEnhancementResult,
  PromptEnhancementSettings,
  PromptEnhancementSettingsResult,
  UpdatePromptEnhancementSettingsInput,
} from "./contracts/prompt-enhancement.contract";
import type { PromptEnhancementRepositoryPort } from "./ports/prompt-enhancement-repository.port";

export const DEFAULT_PROMPT_ENHANCEMENT_SETTINGS: PromptEnhancementSettings = {
  enabled: false,
  includeProjectContext: true,
  includeDate: true,
  instructionMode: "execution",
  customInstruction: "",
};

const INSTRUCTION_PRESETS: Record<PromptEnhancementMode, string[]> = {
  execution: [
    "Preserve the user's intent and do not silently narrow the task.",
    "Use the repository's existing architecture and conventions.",
    "Prefer concrete implementation steps and verify changes when possible.",
    "Ask for clarification only when progress is blocked by missing information.",
  ],
  planning: [
    "Turn the request into a concrete plan with assumptions and risks.",
    "Call out dependencies, verification steps, and likely integration points.",
    "Keep implementation out of scope unless the user explicitly asks to execute.",
  ],
  concise: [
    "Keep the answer direct and avoid unnecessary background.",
    "Prioritize the next actionable step and mention only material risks.",
  ],
};

export class PromptEnhancementService {
  private readonly repository: PromptEnhancementRepositoryPort;
  private readonly nowMs: () => number;

  constructor(
    repository: PromptEnhancementRepositoryPort,
    options?: { nowMs?: () => number }
  ) {
    this.repository = repository;
    this.nowMs = options?.nowMs ?? (() => Date.now());
  }

  async getSettings(userId: string): Promise<PromptEnhancementSettingsResult> {
    return { settings: await this.repository.getSettings(userId) };
  }

  async updateSettings(
    userId: string,
    input: UpdatePromptEnhancementSettingsInput
  ): Promise<PromptEnhancementSettingsResult> {
    return {
      settings: await this.repository.updateSettings(
        userId,
        normalizeUpdate(input)
      ),
    };
  }

  async enhance(
    input: PromptEnhancementRequest
  ): Promise<PromptEnhancementResult> {
    const settings = await this.repository.getSettings(input.userId);
    if (
      !settings.enabled ||
      input.source === "supervisor" ||
      input.text.trim().length === 0
    ) {
      return {
        text: input.text,
        applied: false,
        settings,
        sections: [],
      };
    }

    const sections = buildEnhancementSections(input, settings, this.nowMs());
    return {
      text: `${sections.join("\n")}\n\nOriginal user request:\n${input.text.trim()}`,
      applied: true,
      settings,
      sections,
    };
  }
}

function normalizeUpdate(
  input: UpdatePromptEnhancementSettingsInput
): UpdatePromptEnhancementSettingsInput {
  return {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.includeProjectContext !== undefined
      ? { includeProjectContext: input.includeProjectContext }
      : {}),
    ...(input.includeDate !== undefined
      ? { includeDate: input.includeDate }
      : {}),
    ...(input.instructionMode
      ? { instructionMode: input.instructionMode }
      : {}),
    ...(input.customInstruction !== undefined
      ? { customInstruction: input.customInstruction.trim() }
      : {}),
  };
}

function buildEnhancementSections(
  input: PromptEnhancementRequest,
  settings: PromptEnhancementSettings,
  nowMs: number
): string[] {
  const sections = ["[Eragear Prompt Enhancement]"];
  const context: string[] = [];
  if (settings.includeDate) {
    context.push(`- Date: ${new Date(nowMs).toISOString().slice(0, 10)}`);
  }
  if (settings.includeProjectContext) {
    if (input.projectRoot) {
      context.push(`- Project root: ${input.projectRoot}`);
    }
    if (input.projectId) {
      context.push(`- Project id: ${input.projectId}`);
    }
  }
  if (context.length > 0) {
    sections.push("Context:");
    sections.push(...context);
  }

  sections.push("Instruction enrichment:");
  sections.push(
    ...INSTRUCTION_PRESETS[settings.instructionMode].map(
      (instruction) => `- ${instruction}`
    )
  );
  if (settings.customInstruction.trim()) {
    sections.push("- Custom instruction:");
    sections.push(settings.customInstruction.trim());
  }
  return sections;
}
