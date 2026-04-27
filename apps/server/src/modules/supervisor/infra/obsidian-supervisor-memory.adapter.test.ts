import { describe, expect, test } from "bun:test";
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

  test("builds Obsidian CLI args as command followed by key-value options", () => {
    expect(
      __obsidianSupervisorMemoryInternals.buildObsidianArgs("read", {
        vault: "Second Brain",
        path: "Project/App/Blueprint.md",
      })
    ).toEqual(["read", "vault=Second Brain", "path=Project/App/Blueprint.md"]);
  });
});
