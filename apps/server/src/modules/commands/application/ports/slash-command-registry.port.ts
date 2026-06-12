import type {
  CustomSlashCommandRecord,
  DeleteSlashCommandInput,
  SlashCommandDescriptor,
  SlashCommandsProjectInput,
  ToggleSlashCommandInput,
  UpsertSlashCommandInput,
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
  listCustomCommands(userId: string): Promise<CustomSlashCommandRecord[]>;
  createCustomCommand(
    userId: string,
    input: UpsertSlashCommandInput & { name: string }
  ): Promise<CustomSlashCommandRecord>;
  updateCustomCommand(
    userId: string,
    input: UpsertSlashCommandInput & { id: string }
  ): Promise<CustomSlashCommandRecord>;
  setCustomCommandEnabled(
    userId: string,
    input: ToggleSlashCommandInput
  ): Promise<CustomSlashCommandRecord>;
  deleteCustomCommand(
    userId: string,
    input: DeleteSlashCommandInput
  ): Promise<void>;
}
