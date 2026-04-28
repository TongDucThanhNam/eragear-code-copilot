import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LoggerPort } from "@/shared/ports/logger.port";
import {
  __obsidianSupervisorMemoryInternals,
  type ObsidianCommandRunner,
  ObsidianSupervisorMemoryAdapter,
} from "./obsidian-supervisor-memory.adapter";

class CapturingLogger implements LoggerPort {
  warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];

  debug(): void {
    return;
  }
  info(): void {
    return;
  }
  error(): void {
    return;
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.warnings.push({ message, context });
  }
}

describe("ObsidianSupervisorMemoryAdapter", () => {
  test("reads blueprint and searches scoped project notes", async () => {
    const calls: string[][] = [];
    const runner: ObsidianCommandRunner = (command, args) => {
      calls.push([command, ...args]);
      if (args.includes("read")) {
        return Promise.resolve({
          stdout: "Runtime is Bun. Server uses Hono. Database is D1.\n",
          stderr: "",
        });
      }
      return Promise.resolve({
        stdout: JSON.stringify([
          {
            path: "Project/App/Storage.md",
            matches: [{ line: 12, text: "Use D1/SQLite persistence." }],
          },
        ]),
        stderr: "",
      });
    };

    const adapter = new ObsidianSupervisorMemoryAdapter(
      {
        command: "obsidian",
        vault: "Second Brain",
        blueprintPath: "Project/App/Blueprint.md",
        logPath: "Project/App/Supervisor Log.md",
        searchPath: "Project/App",
        searchLimit: 2,
        timeoutMs: 1234,
      },
      new CapturingLogger(),
      runner
    );

    const context = await adapter.lookup({
      query: "batchUpsertD1Messages",
      chatId: "chat-1",
      projectRoot: "/repo",
    });

    expect(context.projectBlueprint).toBe(
      "Runtime is Bun. Server uses Hono. Database is D1."
    );
    expect(context.results).toEqual([
      {
        title: "Storage",
        path: "Project/App/Storage.md",
        snippets: ["Use D1/SQLite persistence."],
      },
    ]);
    expect(calls).toContainEqual([
      "obsidian",
      "read",
      "vault=Second Brain",
      "path=Project/App/Blueprint.md",
    ]);
    expect(calls).toContainEqual([
      "obsidian",
      "search:context",
      "vault=Second Brain",
      "query=batchUpsertD1Messages",
      "path=Project/App",
      "limit=2",
      "format=json",
    ]);
  });

  test("appends compact decision logs without raw newlines in CLI args", async () => {
    const calls: string[][] = [];
    const runner: ObsidianCommandRunner = (command, args) => {
      calls.push([command, ...args]);
      return Promise.resolve({ stdout: "", stderr: "" });
    };
    const adapter = new ObsidianSupervisorMemoryAdapter(
      {
        logPath: "Project/App/Supervisor Log.md",
        searchPath: "Project/App",
        searchLimit: 2,
        timeoutMs: 1234,
      },
      new CapturingLogger(),
      runner
    );

    await adapter.appendLog({
      chatId: "chat-1",
      projectRoot: "/repo",
      action: "continue",
      reason: "Phase completed",
      autoResumeSignal: "phase_complete",
      latestAssistantTextPart: "Summary\nOptions",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("obsidian");
    expect(calls[0]?.[1]).toBe("append");
    expect(calls[0]?.[2]).toBe("path=Project/App/Supervisor Log.md");
    expect(calls[0]?.[3]).toContain("content=\\n### ");
    expect(calls[0]?.[3]).toContain("latest_text_part: Summary Options");
    expect(calls[0]?.[3]).not.toContain("\n");
  });

  test("falls back to plain search when search:context fails", async () => {
    const calls: string[][] = [];
    const runner: ObsidianCommandRunner = (_command, args) => {
      calls.push(args);
      if (args[0] === "search:context") {
        return Promise.reject(new Error("context command unavailable"));
      }
      return Promise.resolve({
        stdout: JSON.stringify(["Project/App/Blueprint.md"]),
        stderr: "",
      });
    };
    const logger = new CapturingLogger();
    const adapter = new ObsidianSupervisorMemoryAdapter(
      {
        searchPath: "Project/App",
        searchLimit: 2,
        timeoutMs: 1234,
      },
      logger,
      runner
    );

    const context = await adapter.lookup({
      query: "architecture",
      chatId: "chat-1",
      projectRoot: "/repo",
    });

    expect(context.results).toEqual([
      {
        title: "Blueprint",
        path: "Project/App/Blueprint.md",
        snippets: [],
      },
    ]);
    expect(calls[0]?.[0]).toBe("search:context");
    expect(calls[1]?.[0]).toBe("search");
    expect(logger.warnings[0]?.message).toBe(
      "Supervisor Obsidian search:context failed"
    );
  });

  test("falls back to local vault files when Obsidian CLI is unavailable", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "obsidian-memory-"));
    const vaultRoot = path.join(tempDir, "StudyWithTerasumi");
    const configPath = path.join(tempDir, "obsidian.json");
    const blueprintPath = path.join(vaultRoot, "Project/App/Blueprint.md");
    const desktopNotePath = path.join(
      vaultRoot,
      "Project/VLXD/business-analyst/22-apps-desktop-offline-single-store.md"
    );

    try {
      await mkdir(path.dirname(blueprintPath), { recursive: true });
      await mkdir(path.dirname(desktopNotePath), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({
          vaults: {
            abc123: {
              path: vaultRoot,
              open: true,
            },
          },
        })
      );
      await writeFile(
        blueprintPath,
        "Use local-first architecture and preserve existing routes.\n"
      );
      await writeFile(
        desktopNotePath,
        "Desktop is offline-only. Local SQLite is authoritative. Avoid cloud or multi-store wording.\n"
      );

      const runner: ObsidianCommandRunner = () => {
        return Promise.reject(
          new Error(
            "The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again."
          )
        );
      };
      const adapter = new ObsidianSupervisorMemoryAdapter(
        {
          command: "obsidian",
          vault: "StudyWithTerasumi",
          blueprintPath: "Project/App/Blueprint.md",
          searchPath: "Project",
          searchLimit: 2,
          timeoutMs: 1234,
          configPath,
        },
        new CapturingLogger(),
        runner
      );

      const context = await adapter.lookup({
        query:
          "must load Obsidian note 22-apps-desktop-offline-single-store.md before desktop work",
        chatId: "chat-1",
        projectRoot: "/repo",
      });

      expect(context.projectBlueprint).toBe(
        "Use local-first architecture and preserve existing routes."
      );
      expect(context.results[0]).toMatchObject({
        title: "22-apps-desktop-offline-single-store",
        path: "Project/VLXD/business-analyst/22-apps-desktop-offline-single-store.md",
      });
      expect(context.results[0]?.snippets.join(" ")).toContain(
        "Local SQLite is authoritative"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("builds Obsidian CLI args as command followed by key-value options", () => {
    expect(
      __obsidianSupervisorMemoryInternals.buildObsidianArgs("read", {
        vault: "Second Brain",
        path: "Project/App/Blueprint.md",
      })
    ).toEqual(["read", "vault=Second Brain", "path=Project/App/Blueprint.md"]);
  });

  // TR8: appendLog accepts { action: "save_memory" } per SAVE_MEMORY semantics
  test("appends save_memory action without breaking", async () => {
    const calls: string[][] = [];
    const runner: ObsidianCommandRunner = (command, args) => {
      calls.push([command, ...args]);
      return Promise.resolve({ stdout: "", stderr: "" });
    };
    const adapter = new ObsidianSupervisorMemoryAdapter(
      {
        logPath: "Project/App/Supervisor Log.md",
        searchPath: "Project/App",
        searchLimit: 2,
        timeoutMs: 1234,
      },
      new CapturingLogger(),
      runner
    );

    // TR8: appendLog must accept save_memory action
    await adapter.appendLog({
      chatId: "chat-1",
      projectRoot: "/repo",
      action: "save_memory",
      reason: "Notable architectural decision",
      latestAssistantTextPart: "Decision: Use D1/SQLite",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("obsidian");
    expect(calls[0]?.[1]).toBe("append");
  });
});
