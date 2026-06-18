import type { OutputStyleSettings } from "../contracts/output-style.contract";

export interface OutputStyleStoreSnapshot {
  settingsByUserId: Readonly<Record<string, OutputStyleSettings>>;
}

export interface MutableOutputStyleStoreSnapshot {
  settingsByUserId: Record<string, OutputStyleSettings>;
}

export interface OutputStyleRepositoryPort {
  read<T>(
    reader: (snapshot: OutputStyleStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableOutputStyleStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}
