import type {
  TerminalSettings,
  UpdateTerminalSettingsInput,
} from "../contracts/terminal.contract";

export interface TerminalSettingsRepositoryPort {
  getSettings(userId: string): Promise<TerminalSettings>;
  updateSettings(
    userId: string,
    input?: UpdateTerminalSettingsInput
  ): Promise<TerminalSettings>;
}
