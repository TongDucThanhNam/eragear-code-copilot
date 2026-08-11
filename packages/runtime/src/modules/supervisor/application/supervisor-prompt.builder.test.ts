import { describe, expect, test } from "bun:test";
import {
  buildSupervisorChatPrompt,
  buildSupervisorChatSystemPrompt,
  buildSupervisorFollowUpPrompt,
  buildSupervisorPermissionPrompt,
  buildSupervisorPermissionSystemPrompt,
  buildSupervisorTurnPrompt,
  buildSupervisorTurnSystemPrompt,
  SUPERVISOR_TURN_SYSTEM_PROMPT,
} from "./supervisor-prompt.builder";

describe("buildSupervisorTurnPrompt", () => {
  test("includes latest assistant text part without dumping recent conversation", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Implement the requested feature",
      latestAssistantTextPart: "Summary. Need user choice. Options: A or B.",
      originalTaskGoal: "First task",
      latestUserInstruction: "Implement the requested feature",
      userInstructionTimeline: [
        "First task",
        "Second task",
        "Implement the requested feature",
      ],
      autoResumeSignal: "confirmation_needed",
      recentToolCallSummary: {
        lastNToolNames: ["edit_file", "bash"],
        consecutiveFailures: 1,
      },
      lastErrorSummary: "bash failed with exit code 1",
      projectBlueprint: "Runtime is Bun. Server uses Hono. Database is D1.",
      memoryResults: [
        {
          title: "Storage decision",
          path: "Project/App/Storage.md",
          snippets: ["Use D1/SQLite for worker-side persistence."],
        },
      ],
      plan: {
        entries: [
          {
            content: "Implement feature",
            priority: "medium",
            status: "in_progress",
          },
        ],
      },
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
        continuationCount: 1,
      },
      researchResults: [],
    });

    expect(prompt).toContain("Latest assistant text part:");
    expect(prompt).toContain("Summary. Need user choice. Options: A or B.");
    expect(prompt).toContain("Auto-resume signal:");
    expect(prompt).toContain("Recent tool call summary:");
    expect(prompt).toContain("Consecutive failures: 1");
    expect(prompt).toContain("Last error summary:");
    expect(prompt).toContain("Runtime is Bun");
    expect(prompt).toContain("Storage decision");
    expect(prompt).not.toContain("Recent conversation:");
  });

  test("includes user instruction timeline in prompt", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "AppLayout first",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "First task: build reports",
      latestUserInstruction: "Third task: AppLayout first",
      userInstructionTimeline: [
        "First task: build reports",
        "Second task: add KPIGroup",
        "Third task: AppLayout first",
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    });

    expect(prompt).toContain("User instruction timeline:");
    expect(prompt).toContain("1. First task: build reports");
    expect(prompt).toContain("2. Second task: add KPIGroup");
    expect(prompt).toContain("3. Third task: AppLayout first");
  });

  test("prompt shows latest user instruction controlling current scope", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "AppLayout first",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "First task: build reports",
      latestUserInstruction: "Third task: AppLayout first",
      userInstructionTimeline: [
        "First task: build reports",
        "Second task: add KPIGroup",
        "Third task: AppLayout first",
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    });

    expect(prompt).toContain("Task goal (current user-approved scope):");
    expect(prompt).toContain("AppLayout first");
  });

  test("prompt includes precedence statement for user instructions", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Current scope",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "Original task",
      latestUserInstruction: "Latest instruction",
      userInstructionTimeline: ["Original task", "Latest instruction"],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    });

    // TR6: The precedence rule is now in the system prompt section, not the turn prompt
    expect(prompt).toContain(
      "latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task"
    );
  });

  test("memory and blueprint appear after user instructions as guardrails", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Current scope",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "Original task",
      latestUserInstruction: "Latest instruction",
      userInstructionTimeline: ["Original task", "Latest instruction"],
      projectBlueprint: "Project blueprint here",
      memoryResults: [
        {
          title: "Memory title",
          path: "path/to/memory.md",
          snippets: ["Memory snippet"],
        },
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      researchResults: [],
    });

    const userInstructionIndex = prompt.indexOf("User instruction timeline:");
    const blueprintIndex = prompt.indexOf(
      "Project blueprint (guardrail after user instructions):"
    );
    const memoryIndex = prompt.indexOf(
      "Local memory context (guardrail after user instructions):"
    );

    expect(userInstructionIndex).toBeLessThan(blueprintIndex);
    expect(userInstructionIndex).toBeLessThan(memoryIndex);
  });
});

describe("SUPERVISOR_TURN_SYSTEM_PROMPT", () => {
  // TR6: contains all 9 semantic action keywords
  test("contains all 9 semantic action keywords", () => {
    const keywords = [
      "CONTINUE",
      "APPROVE_GATE",
      "CORRECT",
      "REPLAN",
      "DONE",
      "ESCALATE",
      "ABORT",
      "SAVE_MEMORY",
      "WAIT",
    ];
    for (const keyword of keywords) {
      expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(keyword);
    }
  });

  // TR6: contains few-shot examples
  test("contains few-shot examples", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Example 1");
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Example 2");
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Example 3");
  });

  // TR6: does not contain "original user task"
  test("does not contain the phrase 'original user task'", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).not.toContain("original user task");
  });

  test("includes precedence rule for user instruction timeline", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(
      "latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task"
    );
  });

  test("still warns against commit/push/deploy/destructive options", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(
      "Avoid choosing commit, push, deploy, destructive, or credential-related options unless the human explicitly requested that action."
    );
  });

  test("requires human-style actionable follow-up prompts", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(
      "write it like a concise human approval"
    );
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Yes, please");
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("`exa-search`");
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Obsidian/local memory");
  });

  test("appends custom agent profile without replacing guardrails", () => {
    const prompt = buildSupervisorTurnSystemPrompt({
      customSystemPrompt: "Prefer compact Vietnamese status updates.",
      toolAllowlist: ["exa-search", "obsidian"],
      toolPolicy: "custom-allowlist",
    });

    expect(prompt).toContain("Avoid choosing commit, push, deploy");
    expect(prompt).toContain("Configured Supervisor Agent Profile");
    expect(prompt).toContain("Prefer compact Vietnamese status updates.");
    expect(prompt).toContain("only name these tools: exa-search, obsidian");
  });

  test("applies custom agent profile to permission prompt", () => {
    const prompt = buildSupervisorPermissionSystemPrompt({
      customSystemPrompt: "Reject risky external network access.",
      toolAllowlist: [],
      toolPolicy: "custom-allowlist",
    });

    expect(prompt).toContain("Approve only when");
    expect(prompt).toContain("Reject risky external network access.");
    expect(prompt).toContain("Custom allowlist is active but empty");
  });
});

describe("buildSupervisorChatPrompt", () => {
  test("builds a compact side-chat prompt without raw main transcript", () => {
    const prompt = buildSupervisorChatPrompt({
      userId: "user-1",
      chatId: "chat-1",
      projectRoot: "/repo",
      projectContext: {
        topLevelEntries: ["README.md", "package.json", "src/"],
        files: [
          {
            path: "README.md",
            kind: "readme",
            excerpt: "Eragear Code Copilot desktop app.",
          },
          {
            path: "package.json",
            kind: "manifest",
            excerpt: "name: eragear-code-copilot\nscripts: dev, build",
          },
        ],
        diagnostics: [],
      },
      projectIntelligence: {
        status: "ready",
        symbolExtractionMode: "ast",
        scope: {
          resolverVersion: "v1-import-graph",
          primaryTarget: {
            path: "src/components/SupervisosPanel.tsx",
            score: 42,
            reason: "importGraph AST symbol match +24",
          },
          secondaryTargets: [],
          resolvedViaLLM: false,
          graphConfidence: 0.8,
        },
        graphNodes: [
          {
            path: "src/components/SupervisosPanel.tsx",
            workspace: "src",
            imports: ["src/components/SupervisosChat.tsx"],
            importedBy: ["src/App.tsx"],
            exports: ["SupervisosPanel"],
            symbols: [
              {
                name: "SupervisosPanel",
                kind: "component",
                line: 12,
              },
            ],
            reachableFromRoots: true,
          },
        ],
        symbolMatches: [
          {
            path: "src/components/SupervisosPanel.tsx",
            name: "SupervisosPanel",
            kind: "component",
            line: 12,
            source: "ast-import-graph",
          },
        ],
        routeMap: [],
        diagnostics: [],
      },
      userMessage: "Why is Supervisos idle?",
      sideChatHistory: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Ready." },
      ],
      goalModeAudit: [
        {
          phaseId: "v0-ui",
          kind: "gate",
          decision: "needs_user",
          summary: "Verification failed and must not auto-continue.",
          targetPath: "apps/desktop/src/renderer/components/chat-ui",
          verification: "bun run --cwd apps/desktop check-types: 1",
        },
      ],
      plan: {
        entries: [
          {
            content: "Build Supervisos panel",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
      supervisor: {
        mode: "full_autopilot",
        status: "idle",
        reason: "Supervisor enabled for session",
        continuationCount: 1,
      },
    });

    expect(prompt).toContain("Supervisor state:");
    expect(prompt).toContain("Project context snapshot:");
    expect(prompt).toContain(
      "Top-level entries: README.md, package.json, src/"
    );
    expect(prompt).toContain("README.md (readme)");
    expect(prompt).toContain("Eragear Code Copilot desktop app.");
    expect(prompt).toContain("Precomputed project intelligence tools:");
    expect(prompt).toContain("resolve_scope: v1-import-graph");
    expect(prompt).toContain("ast_import_graph_context:");
    expect(prompt).toContain("SupervisosPanel:component@12");
    expect(prompt).toContain("search_symbols:");
    expect(prompt).toContain("SupervisosPanel (component)");
    expect(prompt).toContain("- mode: full_autopilot");
    expect(prompt).toContain("- status: idle");
    expect(prompt).toContain("Build Supervisos panel");
    expect(prompt).toContain("Verification failed");
    expect(prompt).toContain("Prior Supervisos side-chat messages:");
    expect(prompt).toContain("User asks Supervisos:");
    expect(prompt).not.toContain("Recent conversation:");
    expect(prompt).not.toContain("raw diff");
  });

  test("applies custom agent profile to side-chat system prompt", () => {
    const prompt = buildSupervisorChatSystemPrompt({
      customSystemPrompt: "Answer in Vietnamese.",
      toolAllowlist: ["obsidian"],
      toolPolicy: "custom-allowlist",
    });

    expect(prompt).toContain("dedicated side-chat supervisor agent");
    expect(prompt).toContain("Answer in Vietnamese.");
    expect(prompt).toContain("only name these tools: obsidian");
  });
});

describe("buildSupervisorFollowUpPrompt", () => {
  test("uses human-style approval while preserving current user-approved scope guardrails", () => {
    const prompt = buildSupervisorFollowUpPrompt({
      followUpPrompt: "Continue working",
      projectBlueprint: "Test blueprint",
      memoryResults: [],
    });

    expect(prompt).toContain("Yes, please proceed");
    expect(prompt).toContain("current user-approved scope");
    expect(prompt).not.toContain("Continue the original user task");
    expect(prompt).not.toContain("Supervisor auto-resume:");
  });

  test("includes project blueprint, memory, and web research as guardrails", () => {
    const prompt = buildSupervisorFollowUpPrompt({
      followUpPrompt: "Continue working",
      projectBlueprint: "Test blueprint",
      projectMemory: {
        obsidianProjectPath: "Project/VLXD",
        techStackTags: ["react", "heroui"],
      },
      memoryResults: [
        {
          title: "Memory title",
          path: "path/to/file.md",
          snippets: ["Some memory content"],
        },
      ],
      memoryLookupCommands: [
        "obsidian files folder=Project/VLXD",
        "obsidian search:context query=heroui path=Project/VLXD limit=4 format=json",
      ],
      researchResults: [
        {
          title: "HeroUI docs",
          url: "https://www.heroui.com/docs",
          highlights: ["Use documented exports for the installed package."],
        },
      ],
    });

    expect(prompt).toContain("Project blueprint:");
    expect(prompt).toContain("Relevant local memory:");
    expect(prompt).toContain("Relevant web research:");
    expect(prompt).toContain("HeroUI docs");
    expect(prompt).toContain("Project/VLXD");
    expect(prompt).toContain("react, heroui");
    expect(prompt).toContain("obsidian files folder=Project/VLXD");
    expect(prompt).toContain("obsidian read path=path/to/file.md");
    expect(prompt).toContain("`exa-search`");
    expect(prompt).toContain("Obsidian/local memory");
  });
});

describe("buildSupervisorPermissionPrompt", () => {
  test("includes task goal and project blueprint for permission decisions", () => {
    const prompt = buildSupervisorPermissionPrompt({
      chatId: "chat-1",
      taskGoal: "Clean generated build artifacts before rebuilding",
      projectBlueprint: "Project root is the only writable boundary.",
      requestId: "req-1",
      toolCallId: "tool-1",
      toolName: "bash",
      title: "Run rm -rf dist",
      input: { command: "rm -rf dist" },
      options: [
        { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
    });

    expect(prompt).toContain("Task goal:");
    expect(prompt).toContain("Clean generated build artifacts");
    expect(prompt).toContain("Project blueprint:");
    expect(prompt).toContain("Project root is the only writable boundary.");
  });
});
