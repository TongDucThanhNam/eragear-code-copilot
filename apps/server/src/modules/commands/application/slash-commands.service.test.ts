import { describe, expect, test } from "bun:test";
import type { SlashCommandDescriptor } from "./contracts/commands.contract";
import type {
  CustomSlashCommandRepositoryPort,
  CustomSlashCommandStoreSnapshot,
  MutableCustomSlashCommandStoreSnapshot,
  SlashCommandDiscoveryPort,
} from "./ports/slash-command-registry.port";
import { SlashCommandsService } from "./slash-commands.service";

class CustomRepoStub implements CustomSlashCommandRepositoryPort {
  snapshot: MutableCustomSlashCommandStoreSnapshot = {
    commandsByUserId: {},
  };

  async read<T>(
    reader: (snapshot: CustomSlashCommandStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader(this.snapshot);
  }

  async mutate<T>(
    mutator: (
      snapshot: MutableCustomSlashCommandStoreSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.snapshot);
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
      nowMs: () => 100,
    });

    const result = await service.create("user-1", {
      id: "command.custom.review",
      name: "Review Code",
      prompt: "Review $ARGUMENTS",
    });

    expect(result.customCount).toBe(1);
    expect(result.discoveredCount).toBe(1);
    expect(result.commands[0]).toMatchObject({
      name: "/review-code",
      storage: "custom",
      enabled: true,
      sourcePath: "eragear://commands/command.custom.review",
      tags: ["user", "custom"],
      createdAt: 100,
      updatedAt: 100,
    });
    expect(customCommands.snapshot.commandsByUserId["user-1"]?.[0]?.name).toBe(
      "/review-code"
    );
  });

  test("rejects duplicate names across custom and discovered commands", async () => {
    const service = new SlashCommandsService({
      discovery: new DiscoveryStub(),
      customCommands: new CustomRepoStub(),
      nowMs: () => 100,
    });

    await expect(
      service.create("user-1", {
        name: "/fix",
        prompt: "Duplicate",
      })
    ).rejects.toThrow("already exists");
  });

  test("updates toggles and deletes custom commands through the service", async () => {
    const customCommands = new CustomRepoStub();
    customCommands.snapshot.commandsByUserId["user-1"] = [
      {
        id: "command.custom.review",
        userId: "user-1",
        name: "/review",
        prompt: "Review",
        sourcePath: "eragear://commands/command.custom.review",
        enabled: true,
        scope: "user",
        storage: "custom",
        tags: ["user", "custom"],
        diagnostics: [],
        createdAt: 100,
        updatedAt: 100,
      },
    ];
    const service = new SlashCommandsService({
      discovery: new DiscoveryStub(),
      customCommands,
      nowMs: () => 200,
    });

    const updated = await service.update("user-1", {
      id: "command.custom.review",
      name: "Review Deeply",
      prompt: "Review deeply",
      enabled: false,
    });

    expect(updated.commands[0]).toMatchObject({
      id: "command.custom.review",
      name: "/review-deeply",
      prompt: "Review deeply",
      enabled: false,
      createdAt: 100,
      updatedAt: 200,
    });

    const enabled = await service.setEnabled("user-1", {
      id: "command.custom.review",
      enabled: true,
    });

    expect(enabled.commands[0]).toMatchObject({
      id: "command.custom.review",
      enabled: true,
      updatedAt: 200,
    });

    const deleted = await service.delete("user-1", {
      id: "command.custom.review",
    });

    expect(deleted.customCount).toBe(0);
    expect(customCommands.snapshot.commandsByUserId["user-1"]).toEqual([]);
  });
});
