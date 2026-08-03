import { describe, expect, test } from "bun:test";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  SupervisorChatPort,
  SupervisorProjectContextPort,
  SupervisorProjectIntelligencePort,
} from "./ports/supervisor-chat.port";
import { SupervisorChatService } from "./supervisor-chat.service";

describe("SupervisorChatService", () => {
  test("builds a side-chat snapshot from persisted session state", async () => {
    const captured: Parameters<SupervisorChatPort["respond"]>[0][] = [];
    const service = new SupervisorChatService({
      clock: fixedClock(),
      sessionRepo: sessionRepo({
        id: "chat-1",
        userId: "user-1",
        projectRoot: "/repo",
        status: "running",
        createdAt: 1,
        lastActiveAt: 1,
        messages: [],
        plan: {
          entries: [
            {
              content: "Build Supervisos tab",
              priority: "high",
              status: "in_progress",
            },
          ],
        },
        supervisor: {
          mode: "full_autopilot",
          status: "idle",
          reason: "Supervisor enabled for session",
        },
      }),
      sessionRuntime: runtimeStore(null),
      projectContext: projectContext(),
      projectIntelligence: projectIntelligence(),
      chatPort: {
        respond(input) {
          captured.push(input);
          return Promise.resolve({
            content: "Autopilot is enabled; idle means no active review.",
            model: "MiniMax-M3",
            provider: "minimax",
          });
        },
      },
    });

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      message: "Why idle?",
      history: [{ role: "user", content: "hi" }],
      context: {
        goalModeAudit: [
          {
            phaseId: "v0",
            kind: "gate",
            decision: "needs_user",
          },
        ],
      },
    });

    expect(result.message.content).toContain("Autopilot is enabled");
    expect(result.message.model).toBe("MiniMax-M3");
    expect(result.message.createdAt).toBe(1234);
    expect(captured[0]?.projectRoot).toBe("/repo");
    expect(captured[0]?.projectContext.files[0]?.path).toBe("README.md");
    expect(captured[0]?.projectIntelligence.status).toBe("ready");
    expect(captured[0]?.projectIntelligence.scope?.primaryTarget.path).toBe(
      "src/App.tsx"
    );
    expect(captured[0]?.sideChatHistory).toEqual([
      { role: "user", content: "hi" },
    ]);
    expect(captured[0]?.goalModeAudit[0]?.phaseId).toBe("v0");
    expect(captured[0]?.supervisor.mode).toBe("full_autopilot");
  });

  test("uses live supervisor state when the runtime session belongs to the user", async () => {
    const captured: Parameters<SupervisorChatPort["respond"]>[0][] = [];
    const service = new SupervisorChatService({
      clock: fixedClock(),
      sessionRepo: sessionRepo({
        id: "chat-1",
        userId: "user-1",
        projectRoot: "/repo",
        status: "running",
        createdAt: 1,
        lastActiveAt: 1,
        messages: [],
        supervisor: {
          mode: "off",
          status: "idle",
        },
      }),
      sessionRuntime: runtimeStore({
        id: "chat-1",
        userId: "user-1",
        projectRoot: "/repo",
        supervisor: {
          mode: "full_autopilot",
          status: "reviewing",
        },
      }),
      projectContext: projectContext(),
      projectIntelligence: projectIntelligence(),
      chatPort: {
        respond(input) {
          captured.push(input);
          return Promise.resolve({
            content: "Reviewing now.",
            model: "MiniMax-M3",
            provider: "minimax",
          });
        },
      },
    });

    await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      message: "status?",
    });

    expect(captured[0]?.supervisor.mode).toBe("full_autopilot");
    expect(captured[0]?.supervisor.status).toBe("reviewing");
  });

  test("enhances implementation requests into a staged main ChatInput prompt", async () => {
    let chatResponded = false;
    const service = new SupervisorChatService({
      clock: fixedClock(),
      sessionRepo: sessionRepo({
        id: "chat-1",
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "/repo",
        status: "running",
        createdAt: 1,
        lastActiveAt: 1,
        messages: [],
        plan: {
          entries: [
            {
              content: "Build the requested website",
              priority: "high",
              status: "pending",
            },
          ],
        },
        supervisor: {
          mode: "full_autopilot",
          status: "idle",
        },
      }),
      sessionRuntime: runtimeStore(null),
      projectContext: projectContext(),
      projectIntelligence: projectIntelligence(),
      chatPort: {
        respond() {
          chatResponded = true;
          return Promise.resolve({
            content: "Should not be used for delegated implementation.",
            model: "MiniMax-M3",
            provider: "minimax",
          });
        },
      },
    });

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      message: "Create an AWWWARDS website for a hamburger shop.",
    });

    expect(chatResponded).toBe(false);
    expect(result.action?.type).toBe("stage_main_prompt");
    expect(result.action?.autoSubmit).toBe(true);
    expect(result.action?.prompt).toContain(
      "Supervisos delegated enhanced task."
    );
    expect(result.action?.prompt).toContain(
      "Create an AWWWARDS website for a hamburger shop."
    );
    expect(result.action?.prompt).toContain("Implementation instructions:");
    expect(result.message.content).toContain(
      "Enhanced prompt prepared for the main ChatInput."
    );
    expect(result.message.content).toContain("submitted automatically");
    expect(result.message.content).not.toContain("Prompt sent:");
  });

  test("stages implementation requests without auto-submit when autopilot is off", async () => {
    const modeChanges: string[] = [];
    let chatResponded = false;
    const service = new SupervisorChatService({
      clock: fixedClock(),
      sessionRepo: sessionRepo({
        id: "chat-1",
        userId: "user-1",
        projectRoot: "/repo",
        status: "running",
        createdAt: 1,
        lastActiveAt: 1,
        messages: [],
        supervisor: {
          mode: "off",
          status: "idle",
        },
      }),
      sessionRuntime: runtimeStore(null),
      projectContext: projectContext(),
      projectIntelligence: projectIntelligence(),
      chatPort: {
        respond() {
          chatResponded = true;
          return Promise.resolve({
            content: "Should not wait on side-chat provider.",
            model: "MiniMax-M3",
            provider: "minimax",
          });
        },
      },
    });

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      message: "Tạo cho tôi một trang web AWWWARDS cho cửa hàng bán Hamburger.",
    });

    expect(chatResponded).toBe(false);
    expect(modeChanges).toEqual([]);
    expect(result.action?.type).toBe("stage_main_prompt");
    expect(result.action?.autoSubmit).toBe(false);
    expect(result.action?.prompt).toContain(
      "Tạo cho tôi một trang web AWWWARDS cho cửa hàng bán Hamburger."
    );
    expect(result.message.content).toContain("Autopilot is off");
    expect(result.message.content).not.toContain("Prompt sent:");
    expect(result.message.content).not.toContain("Original user request:");
  });
});

function fixedClock(): ClockPort {
  return {
    nowMs: () => 1234,
  };
}

function projectIntelligence(): SupervisorProjectIntelligencePort {
  return {
    analyze: async () => ({
      status: "ready",
      symbolExtractionMode: "ast",
      scope: {
        resolverVersion: "v1-import-graph",
        primaryTarget: {
          path: "src/App.tsx",
          score: 10,
          reason: "importGraph AST symbol match +10",
        },
        secondaryTargets: [],
        resolvedViaLLM: false,
      },
      graphNodes: [],
      symbolMatches: [],
      routeMap: [],
      diagnostics: [],
    }),
  };
}

function sessionRepo(
  session: Awaited<ReturnType<SessionRepositoryPort["findById"]>>
): SessionRepositoryPort {
  return {
    findById: async (id, userId) =>
      session?.id === id && session.userId === userId ? session : undefined,
  } as SessionRepositoryPort;
}

function runtimeStore(session: unknown): SessionRuntimePort {
  return {
    get: () => session,
  } as unknown as SessionRuntimePort;
}

function projectContext(): SupervisorProjectContextPort {
  return {
    build: async () => ({
      topLevelEntries: ["README.md", "index.html"],
      files: [
        {
          path: "README.md",
          kind: "readme",
          excerpt: "Test project description.",
        },
      ],
      diagnostics: [],
    }),
  };
}
