import { describe, expect, test } from "bun:test";
import type {
  CustomSlashCommandRecord,
  SlashCommandDescriptor,
} from "./contracts/commands.contract";
import type {
  CustomSlashCommandRepositoryPort,
  SlashCommandDiscoveryPort,
} from "./ports/slash-command-registry.port";
import { SlashCommandsService } from "./slash-commands.service";

class CustomRepoStub implements CustomSlashCommandRepositoryPort {
  commands: CustomSlashCommandRecord[] = [];

  listCustomCommands(): Promise<CustomSlashCommandRecord[]> {
    return Promise.resolve(this.commands);
  }

  createCustomCommand(
    userId: string,
    input: Parameters<
      CustomSlashCommandRepositoryPort["createCustomCommand"]
    >[1]
  ): Promise<CustomSlashCommandRecord> {
    const command: CustomSlashCommandRecord = {
      id: input.id ?? "command.custom.test",
      userId,
      name: input.name,
      prompt: input.prompt,
      sourcePath: `eragear://commands/${input.id}`,
      enabled: input.enabled ?? true,
      scope: "user",
      storage: "custom",
      tags: ["custom"],
      diagnostics: [],
      createdAt: 100,
      updatedAt: 100,
    };
    this.commands.unshift(command);
    return Promise.resolve(command);
  }

  updateCustomCommand(
    _userId: string,
    input: Parameters<
      CustomSlashCommandRepositoryPort["updateCustomCommand"]
    >[1]
  ): Promise<CustomSlashCommandRecord> {
    const current = this.commands.find((command) => command.id === input.id);
    if (!current) {
      throw new Error("not found");
    }
    Object.assign(current, input);
    return Promise.resolve(current);
  }

  setCustomCommandEnabled(
    _userId: string,
    input: Parameters<
      CustomSlashCommandRepositoryPort["setCustomCommandEnabled"]
    >[1]
  ): Promise<CustomSlashCommandRecord> {
    const current = this.commands.find((command) => command.id === input.id);
    if (!current) {
      throw new Error("not found");
    }
    current.enabled = input.enabled;
    return Promise.resolve(current);
  }

  deleteCustomCommand(): Promise<void> {
    return Promise.resolve();
  }
}

class DiscoveryStub implements SlashCommandDiscoveryPort {
  commands: SlashCommandDescriptor[] = [
    {
      id: "command.project.fix",
      name: "/fix",
      description: "Fix issues",
      prompt: "Fix issues",
      sourcePath: "/repo/.eragear/commands/fix.md",
      enabled: true,
      scope: "project",
      storage: "filesystem-discovery",
      tags: ["project"],
      diagnostics: [],
    },
  ];

  listDiscoveredCommands(): Promise<SlashCommandDescriptor[]> {
    return Promise.resolve(this.commands);
  }

  setDiscoveredCommandEnabled(): Promise<SlashCommandDescriptor[]> {
    return Promise.resolve(this.commands);
  }
}

describe("SlashCommandsService", () => {
  test("creates normalized custom commands and lists registry commands", async () => {
    const customCommands = new CustomRepoStub();
    const service = new SlashCommandsService({
      discovery: new DiscoveryStub(),
      customCommands,
    });

    const result = await service.create("user-1", {
      name: "Review Code",
      prompt: "Review $ARGUMENTS",
    });

    expect(result.customCount).toBe(1);
    expect(result.discoveredCount).toBe(1);
    expect(result.commands[0]).toMatchObject({
      name: "/review-code",
      storage: "custom",
      enabled: true,
    });
  });

  test("rejects duplicate names across custom and discovered commands", async () => {
    const service = new SlashCommandsService({
      discovery: new DiscoveryStub(),
      customCommands: new CustomRepoStub(),
    });

    await expect(
      service.create("user-1", {
        name: "/fix",
        prompt: "Duplicate",
      })
    ).rejects.toThrow("already exists");
  });
});
