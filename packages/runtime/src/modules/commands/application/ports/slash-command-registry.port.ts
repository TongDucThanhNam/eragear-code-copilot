import type {
  CustomSlashCommandRecord,
  SlashCommandDescriptor,
  SlashCommandsProjectInput,
  ToggleSlashCommandInput,
} from "../contracts/commands.contract";

export interface SlashCommandDiscoveryPort {
  listDiscoveredCommands(
    userId: string,
    input?: SlashCommandsProjectInput
  ): Promise<SlashCommandDescriptor[]>;
  setDiscoveredCommandEnabled(
    userId: string,
    input: ToggleSlashCommandInput
  ): Promise<SlashCommandDescriptor[]>;
}

export interface CustomSlashCommandRepositoryPort {
  read<T>(
    reader: (snapshot: CustomSlashCommandStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (
      snapshot: MutableCustomSlashCommandStoreSnapshot
    ) => T | Promise<T>
  ): Promise<T>;
}

export interface CustomSlashCommandStoreSnapshot {
  commandsByUserId: Readonly<
    Record<string, readonly CustomSlashCommandRecord[]>
  >;
}

export interface MutableCustomSlashCommandStoreSnapshot {
  commandsByUserId: Record<string, CustomSlashCommandRecord[]>;
}
