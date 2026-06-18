import type { TerminalSettings } from "../contracts/terminal.contract";

export interface TerminalSettingsRepositoryPort {
  read<T>(
    reader: (snapshot: TerminalSettingsStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableTerminalSettingsStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}

export interface TerminalSettingsStoreSnapshot {
  settingsByUserId: Readonly<Record<string, TerminalSettings>>;
}

export interface MutableTerminalSettingsStoreSnapshot {
  settingsByUserId: Record<string, TerminalSettings>;
}
