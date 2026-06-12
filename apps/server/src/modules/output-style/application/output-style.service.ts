import type {
  OutputStylePreset,
  OutputStylePresetId,
  OutputStylePromptPrefix,
  OutputStyleSettingsResult,
  UpdateOutputStyleSettingsInput,
} from "./contracts/output-style.contract";
import type { OutputStyleRepositoryPort } from "./ports/output-style-repository.port";

const DEFAULT_OUTPUT_STYLE_PRESET: OutputStylePreset = {
  id: "default",
  name: "Default",
  description: "Use the agent default response style.",
  instructions: "",
};

const DEFAULT_PRESETS: OutputStylePreset[] = [
  DEFAULT_OUTPUT_STYLE_PRESET,
  {
    id: "concise",
    name: "Concise",
    description: "Short direct answers with minimal framing.",
    instructions:
      "Keep the response concise and direct. Prefer short paragraphs and only include details that change the user's next action.",
  },
  {
    id: "explanatory",
    name: "Explanatory",
    description: "More context and reasoning for implementation decisions.",
    instructions:
      "Explain the reasoning behind key decisions, include relevant tradeoffs, and keep the answer structured for learning.",
  },
  {
    id: "review",
    name: "Review",
    description: "Code-review style with risks and findings first.",
    instructions:
      "Use a code-review style. Lead with findings, risks, regressions, and missing tests before summaries or implementation notes.",
  },
];

export class OutputStyleService {
  private readonly repository: OutputStyleRepositoryPort;

  constructor(repository: OutputStyleRepositoryPort) {
    this.repository = repository;
  }

  async getSettings(userId: string): Promise<OutputStyleSettingsResult> {
    return {
      settings: await this.repository.getSettings(userId),
      presets: DEFAULT_PRESETS,
    };
  }

  async updateSettings(
    userId: string,
    input: UpdateOutputStyleSettingsInput
  ): Promise<OutputStyleSettingsResult> {
    return {
      settings: await this.repository.updateSettings(userId, input),
      presets: DEFAULT_PRESETS,
    };
  }

  async resolvePromptPrefix(userId: string): Promise<OutputStylePromptPrefix> {
    const settings = await this.repository.getSettings(userId);
    const preset = findPreset(settings.activePresetId);
    if (!(settings.enabled && preset.instructions.trim())) {
      return {
        applied: false,
        presetId: settings.activePresetId,
        text: "",
      };
    }
    return {
      applied: true,
      presetId: preset.id,
      text: [
        `Response style: ${preset.name}`,
        "Style instructions:",
        preset.instructions,
      ].join("\n"),
    };
  }
}

function findPreset(id: OutputStylePresetId): OutputStylePreset {
  return (
    DEFAULT_PRESETS.find((preset) => preset.id === id) ??
    DEFAULT_OUTPUT_STYLE_PRESET
  );
}
