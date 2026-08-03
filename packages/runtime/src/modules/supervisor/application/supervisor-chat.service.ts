import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import { NotFoundError } from "#runtime/shared/errors";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  SupervisorChatPort,
  SupervisorProjectContextPort,
  SupervisorProjectContextSnapshot,
  SupervisorProjectIntelligencePort,
  SupervisorProjectIntelligenceSnapshot,
} from "./ports/supervisor-chat.port";
import type { SupervisorChatInput } from "./supervisor-chat.contract";
import { normalizeSupervisorState } from "./supervisor-state.util";

const OP = "supervisor.chat";
const PROJECT_CONTEXT_TIMEOUT_MS = 2000;
const PROJECT_INTELLIGENCE_TIMEOUT_MS = 3000;
const SIDE_CHAT_RESPONSE_TIMEOUT_MS = 20_000;

export interface SupervisorChatOutput {
  message: {
    role: "assistant";
    content: string;
    createdAt: number;
    model: string;
  };
  supervisor: ReturnType<typeof normalizeSupervisorState>;
  action?: {
    type: "stage_main_prompt";
    prompt: string;
    autoSubmit: boolean;
  };
}

/**
 * Dedicated side-chat use case for Supervisos.
 *
 * Invariant: this reads compact session state only. It never injects the raw
 * main transcript or raw diffs into supervisor prompts. When the user asks for
 * implementation, it returns an enhanced prompt for the renderer to stage in
 * the main ChatInput instead of submitting hidden work from the side chat.
 */
export class SupervisorChatService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly chatPort: SupervisorChatPort;
  private readonly projectContext: SupervisorProjectContextPort;
  private readonly projectIntelligence?: SupervisorProjectIntelligencePort;
  private readonly clock: ClockPort;

  constructor(deps: {
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
    chatPort: SupervisorChatPort;
    projectContext: SupervisorProjectContextPort;
    projectIntelligence?: SupervisorProjectIntelligencePort;
    clock: ClockPort;
  }) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.chatPort = deps.chatPort;
    this.projectContext = deps.projectContext;
    this.projectIntelligence = deps.projectIntelligence;
    this.clock = deps.clock;
  }

  async execute(input: SupervisorChatInput & { userId: string }) {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "supervisor",
        op: OP,
        details: { chatId: input.chatId },
      });
    }

    const runtimeSession = this.sessionRuntime.get(input.chatId);
    const supervisor = normalizeSupervisorState(
      runtimeSession?.userId === input.userId
        ? runtimeSession.supervisor
        : stored.supervisor
    );
    const projectContext = await this.buildProjectContext(stored.projectRoot);
    const phaseGoal = stored.plan?.entries
      .filter((entry) => entry.status !== "completed")
      .map((entry) => entry.content)
      .join("\n");
    const projectIntelligence = await this.buildProjectIntelligence({
      intent: input.message,
      ...(phaseGoal ? { phaseGoal } : {}),
      ...(stored.projectId ? { projectId: stored.projectId } : {}),
      projectRoot: stored.projectRoot,
      userId: input.userId,
    });

    if (shouldDelegateToMainAgent(input.message)) {
      const delegatedPrompt = buildDelegatedSupervisorPrompt({
        originalRequest: input.message,
        projectContext,
        projectIntelligence,
        projectRoot: stored.projectRoot,
      });
      const autoSubmit = supervisor.mode === "full_autopilot";
      return {
        message: {
          role: "assistant" as const,
          content: formatStagePromptResponse(autoSubmit),
          createdAt: this.clock.nowMs(),
          model: "supervisos-prompt-enhancer",
        },
        action: {
          type: "stage_main_prompt" as const,
          prompt: delegatedPrompt,
          autoSubmit,
        },
        supervisor,
      } satisfies SupervisorChatOutput;
    }

    const response = await withSoftTimeout(
      this.chatPort.respond({
        chatId: stored.id,
        goalModeAudit: input.context?.goalModeAudit ?? [],
        plan: stored.plan,
        projectContext,
        ...(stored.projectId ? { projectId: stored.projectId } : {}),
        projectIntelligence,
        projectRoot: stored.projectRoot,
        sideChatHistory: input.history ?? [],
        supervisor,
        userMessage: input.message,
      }),
      SIDE_CHAT_RESPONSE_TIMEOUT_MS,
      () => ({
        content:
          "Supervisos side-chat provider timed out before returning an advisory answer. I did not submit a task from this message. For implementation requests, phrase it as a direct action such as `Create...` or `Build...`; those are delegated to the main coding agent without waiting for MiniMax side chat.",
        model: "supervisos-timeout",
        provider: "timeout",
      })
    );

    return {
      message: {
        role: "assistant" as const,
        content: response.content,
        createdAt: this.clock.nowMs(),
        model: response.model,
      },
      supervisor,
    } satisfies SupervisorChatOutput;
  }

  private async buildProjectContext(
    projectRoot: string
  ): Promise<SupervisorProjectContextSnapshot> {
    try {
      return await withSoftTimeout(
        this.projectContext.build({ projectRoot }),
        PROJECT_CONTEXT_TIMEOUT_MS,
        () => ({
          topLevelEntries: [],
          files: [],
          diagnostics: [
            `Project context timed out after ${PROJECT_CONTEXT_TIMEOUT_MS}ms.`,
          ],
        })
      );
    } catch (error) {
      return {
        topLevelEntries: [],
        files: [],
        diagnostics: [
          `Project context unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }

  private async buildProjectIntelligence(input: {
    userId: string;
    projectId?: string;
    projectRoot: string;
    intent: string;
    phaseGoal?: string;
    activePathHints?: string[];
  }): Promise<SupervisorProjectIntelligenceSnapshot> {
    if (!this.projectIntelligence) {
      return unavailableProjectIntelligence(
        "Project intelligence adapter is not configured."
      );
    }
    try {
      return await withSoftTimeout(
        this.projectIntelligence.analyze(input),
        PROJECT_INTELLIGENCE_TIMEOUT_MS,
        () =>
          unavailableProjectIntelligence(
            `Project intelligence timed out after ${PROJECT_INTELLIGENCE_TIMEOUT_MS}ms.`
          )
      );
    } catch (error) {
      return unavailableProjectIntelligence(
        `Project intelligence unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

function unavailableProjectIntelligence(
  diagnostic: string
): SupervisorProjectIntelligenceSnapshot {
  return {
    status: "unavailable",
    symbolExtractionMode: "none",
    graphNodes: [],
    symbolMatches: [],
    routeMap: [],
    diagnostics: [diagnostic],
  };
}

function shouldDelegateToMainAgent(userMessage: string): boolean {
  const normalized = normalizeIntentText(userMessage);
  if (normalized.includes("?")) {
    return false;
  }
  const advisorySignals = [
    "tai sao",
    "vi sao",
    "why",
    "status",
    "trang thai",
    "giai thich",
    "explain",
    "review",
    "kiem tra",
    "co chua",
    "chua hoat dong",
  ];
  if (advisorySignals.some((signal) => normalized.includes(signal))) {
    return false;
  }
  const implementationSignals = [
    "tao",
    "lam",
    "dung",
    "xay",
    "xay dung",
    "trien khai",
    "viet",
    "sua",
    "them",
    "cap nhat",
    "build",
    "create",
    "make",
    "implement",
    "add",
    "fix",
    "update",
    "design",
    "generate",
  ];
  return implementationSignals.some((signal) => normalized.includes(signal));
}

function buildDelegatedSupervisorPrompt(params: {
  originalRequest: string;
  projectRoot: string;
  projectContext: SupervisorProjectContextSnapshot;
  projectIntelligence: SupervisorProjectIntelligenceSnapshot;
}): string {
  return [
    "Supervisos delegated enhanced task.",
    "",
    "Original user request:",
    params.originalRequest.trim(),
    "",
    "Project context:",
    `- Project root: ${params.projectRoot}`,
    params.projectContext.topLevelEntries.length > 0
      ? `- Top-level entries: ${params.projectContext.topLevelEntries.join(", ")}`
      : "- Top-level entries: (none)",
    ...params.projectContext.files.map((file) => {
      return `- ${file.path} (${file.kind}): ${truncateForDelegation(file.excerpt, 500)}`;
    }),
    params.projectContext.diagnostics.length > 0
      ? `- Context diagnostics: ${params.projectContext.diagnostics.join("; ")}`
      : "",
    "",
    "Precomputed project intelligence:",
    formatDelegatedProjectIntelligence(params.projectIntelligence),
    "",
    "Implementation instructions:",
    "- Treat the original request as the current user-approved scope.",
    "- Read the existing project structure first and follow its stack and conventions.",
    "- Build the actual usable experience, not a placeholder explanation.",
    "- For website/UI work, use strong visual assets, polished responsive layout, and verify desktop/mobile text does not overlap.",
    "- Keep changes scoped to the requested experience and avoid unrelated refactors.",
    "- Do not commit, push, delete unrelated files, or perform destructive actions unless the human explicitly asks.",
    "- Run the relevant verification command(s). If a dev server is needed, start it and report the local URL.",
    "",
    "Completion response expected:",
    "- Summarize changed files.",
    "- Report verification commands and results.",
    "- Report the local preview URL if one is running.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDelegatedProjectIntelligence(
  intelligence: SupervisorProjectIntelligenceSnapshot
): string {
  const scope = intelligence.scope
    ? [
        `- resolve_scope: ${intelligence.scope.resolverVersion}, symbolExtraction=${intelligence.symbolExtractionMode}`,
        `- primaryTarget: ${intelligence.scope.primaryTarget.path} (${intelligence.scope.primaryTarget.reason})`,
        intelligence.scope.secondaryTargets.length > 0
          ? `- secondaryTargets: ${intelligence.scope.secondaryTargets
              .map((target) => target.path)
              .join(", ")}`
          : "",
      ]
    : [`- resolve_scope: ${intelligence.status}`];
  const graph = intelligence.graphNodes.slice(0, 4).map((node) => {
    return `- graphNode: ${node.path}; imports=${node.imports.join(", ") || "(none)"}; importedBy=${node.importedBy.join(", ") || "(none)"}; symbols=${node.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`).join(", ") || "(none)"}`;
  });
  const symbols = intelligence.symbolMatches.slice(0, 8).map((symbol) => {
    return `- symbol: ${symbol.name} (${symbol.kind}) ${symbol.path}:${symbol.line} via ${symbol.source}`;
  });
  const diagnostics =
    intelligence.diagnostics.length > 0
      ? [`- diagnostics: ${intelligence.diagnostics.join("; ")}`]
      : [];
  return [...scope, ...graph, ...symbols, ...diagnostics]
    .filter(Boolean)
    .join("\n");
}

function formatStagePromptResponse(autoSubmit: boolean): string {
  return [
    "Enhanced prompt prepared for the main ChatInput.",
    "",
    autoSubmit
      ? "Autopilot is on, so it will be submitted automatically when the main chat is ready."
      : "Autopilot is off, so review or edit it in the main input and send when ready.",
  ]
    .filter(Boolean)
    .join("\n");
}

function truncateForDelegation(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 14).trimEnd()}\n... [truncated]`;
}

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: () => T
): Promise<T> {
  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.catch((error) => {
    if (didTimeout) {
      return fallback();
    }
    throw error;
  });
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      resolve(fallback());
    }, timeoutMs);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
