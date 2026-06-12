import type {
  OutputStyleSettings,
  UpdateOutputStyleSettingsInput,
} from "../contracts/output-style.contract";

export interface OutputStyleRepositoryPort {
  getSettings(userId: string): Promise<OutputStyleSettings>;
  updateSettings(
    userId: string,
    input: UpdateOutputStyleSettingsInput
  ): Promise<OutputStyleSettings>;
}
