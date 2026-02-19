import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ENV } from "@/config/environment";
import type { AgentRuntimePort } from "@/modules/session";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import type { CommandPolicy } from "@/shared/utils/allowlist.util";
import { ManageBootAllowlistsService } from "./manage-boot-allowlists.service";

const BOOT_CONFIG_PATH_ENV_KEY = "ERAGEAR_BOOT_CONFIG_PATH";

function clonePolicies(source: CommandPolicy[]): CommandPolicy[] {
  return source.map((policy) => ({
    command: policy.command,
    allowAnyArgs: policy.allowAnyArgs,
    allowedArgs: policy.allowedArgs ? [...policy.allowedArgs] : undefined,
    allowedArgPatterns: policy.allowedArgPatterns
      ? [...policy.allowedArgPatterns]
      : undefined,
  }));
}

function createAgentRuntimeStub() {
  const updates: Array<{
    allowedAgentCommandPolicies: CommandPolicy[];
    allowedEnvKeys: string[];
  }> = [];

  const runtime: AgentRuntimePort = {
    spawn: () => {
      throw new Error("not implemented in test");
    },
    createAcpConnection: () => {
      throw new Error("not implemented in test");
    },
    beginShutdown: () => undefined,
    terminateAllActiveProcesses: () =>
      Promise.resolve({ terminated: 0, failed: 0, lingeringPids: [] }),
    updateInvocationPolicy: (policy) => {
      updates.push({
        allowedAgentCommandPolicies: clonePolicies(
          policy.allowedAgentCommandPolicies
        ),
        allowedEnvKeys: [...policy.allowedEnvKeys],
      });
    },
  };

  return { runtime, updates };
}

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

async function createBootConfigFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "eragear-boot-allowlists-"));
  const filePath = path.join(dir, "settings.json");
  await writeFile(
    filePath,
    JSON.stringify(
      {
        boot: {
          mode: "compiled",
          WS_PORT: 3010,
          WS_HOST: "0.0.0.0",
          AUTH_SECRET: "compiled_boot_secret_rotate_before_deploy_4f4c7c0d2d0a",
          ALLOWED_AGENT_COMMAND_POLICIES: [
            { command: "/usr/bin/git", allowAnyArgs: true },
          ],
          ALLOWED_TERMINAL_COMMAND_POLICIES: [
            { command: "/bin/sh", allowAnyArgs: true },
          ],
          ALLOWED_ENV_KEYS: ["PATH", "HOME"],
        },
      },
      null,
      2
    ),
    "utf8"
  );
  return filePath;
}

describe("ManageBootAllowlistsService", () => {
  test("loads boot allowlists from configured settings file", async () => {
    const filePath = await createBootConfigFile();
    const previousBootPath = process.env[BOOT_CONFIG_PATH_ENV_KEY];
    process.env[BOOT_CONFIG_PATH_ENV_KEY] = filePath;

    try {
      const events: DomainEvent[] = [];
      const { runtime } = createAgentRuntimeStub();
      const service = new ManageBootAllowlistsService(
        createEventBusStub(events),
        runtime
      );

      const snapshot = await service.get();
      expect(snapshot.mode).toBe("compiled");
      expect(snapshot.sourcePath).toBe(filePath);
      expect(snapshot.allowedAgentCommandPolicies).toEqual([
        {
          command: "/usr/bin/git",
          allowAnyArgs: true,
          allowedArgs: [],
          allowedArgPatterns: [],
        },
      ]);
      expect(snapshot.allowedTerminalCommandPolicies).toEqual([
        {
          command: "/bin/sh",
          allowAnyArgs: true,
          allowedArgs: [],
          allowedArgPatterns: [],
        },
      ]);
      expect(snapshot.allowedEnvKeys).toEqual(["PATH", "HOME"]);
      expect(snapshot.warnings).toEqual([]);
      expect(events).toEqual([]);
    } finally {
      if (previousBootPath === undefined) {
        delete process.env[BOOT_CONFIG_PATH_ENV_KEY];
      } else {
        process.env[BOOT_CONFIG_PATH_ENV_KEY] = previousBootPath;
      }
    }
  });

  test("updates boot allowlists, applies runtime policy, and emits events", async () => {
    const filePath = await createBootConfigFile();
    const previousBootPath = process.env[BOOT_CONFIG_PATH_ENV_KEY];
    process.env[BOOT_CONFIG_PATH_ENV_KEY] = filePath;
    const originalAgentPolicies = clonePolicies(
      ENV.allowedAgentCommandPolicies
    );
    const originalTerminalPolicies = clonePolicies(
      ENV.allowedTerminalCommandPolicies
    );
    const originalAllowedAgentCommands = [...ENV.allowedAgentCommands];
    const originalAllowedTerminalCommands = [...ENV.allowedTerminalCommands];
    const originalAllowedEnvKeys = [...ENV.allowedEnvKeys];

    try {
      const events: DomainEvent[] = [];
      const { runtime, updates } = createAgentRuntimeStub();
      const service = new ManageBootAllowlistsService(
        createEventBusStub(events),
        runtime
      );

      const snapshot = await service.update({
        allowedAgentCommandPolicies: [
          {
            command: "/home/terasumi/.bun/bin/claude-code-acp",
            allowAnyArgs: true,
          },
        ],
        allowedTerminalCommandPolicies: [
          {
            command: "/bin/bash",
            allowAnyArgs: true,
          },
        ],
        allowedEnvKeys: ["PATH", "HOME", "API_KEY"],
      });

      expect(snapshot.allowedAgentCommandPolicies[0]?.command).toBe(
        "/home/terasumi/.bun/bin/claude-code-acp"
      );
      expect(snapshot.allowedTerminalCommandPolicies[0]?.command).toBe(
        "/bin/bash"
      );
      expect(snapshot.allowedEnvKeys).toEqual(["PATH", "HOME", "API_KEY"]);

      const fileContent = await readFile(filePath, "utf8");
      const parsed = JSON.parse(fileContent) as {
        boot?: Record<string, unknown>;
      };
      expect(parsed.boot?.ALLOWED_AGENT_COMMAND_POLICIES).toEqual([
        {
          command: "/home/terasumi/.bun/bin/claude-code-acp",
          allowAnyArgs: true,
          allowedArgs: [],
          allowedArgPatterns: [],
        },
      ]);
      expect(parsed.boot?.ALLOWED_TERMINAL_COMMAND_POLICIES).toEqual([
        {
          command: "/bin/bash",
          allowAnyArgs: true,
          allowedArgs: [],
          allowedArgPatterns: [],
        },
      ]);
      expect(parsed.boot?.ALLOWED_ENV_KEYS).toEqual([
        "PATH",
        "HOME",
        "API_KEY",
      ]);

      expect(updates).toHaveLength(1);
      expect(updates[0]?.allowedAgentCommandPolicies[0]?.command).toBe(
        "/home/terasumi/.bun/bin/claude-code-acp"
      );
      expect(updates[0]?.allowedEnvKeys).toEqual(["PATH", "HOME", "API_KEY"]);

      expect(
        events.some(
          (event) =>
            event.type === "settings_updated" &&
            event.changedKeys.includes("ALLOWED_AGENT_COMMAND_POLICIES")
        )
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "dashboard_refresh" &&
            event.reason === "settings_updated"
        )
      ).toBe(true);
    } finally {
      ENV.allowedAgentCommandPolicies = originalAgentPolicies;
      ENV.allowedTerminalCommandPolicies = originalTerminalPolicies;
      ENV.allowedAgentCommands = [...originalAllowedAgentCommands];
      ENV.allowedTerminalCommands = [...originalAllowedTerminalCommands];
      ENV.allowedEnvKeys = [...originalAllowedEnvKeys];
      if (previousBootPath === undefined) {
        delete process.env[BOOT_CONFIG_PATH_ENV_KEY];
      } else {
        process.env[BOOT_CONFIG_PATH_ENV_KEY] = previousBootPath;
      }
    }
  });
});
