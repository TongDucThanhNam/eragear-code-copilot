export interface OutputStylePromptResult {
  applied: boolean;
  text: string;
  presetId?: string;
}

export interface OutputStylePromptPort {
  resolvePromptPrefix(userId: string): Promise<OutputStylePromptResult>;
}
