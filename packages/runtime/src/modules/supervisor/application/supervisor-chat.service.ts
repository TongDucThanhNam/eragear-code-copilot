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
    type: "goal_draft_created";
    runId: string;
    status: string;
    requiresApproval: true;
  };
}

export interface SupervisorGoalDraftPort {
  createDraft(input: {
    userId: string;
    projectId: string;
    projectRoot: string;
    intent: string;
    constraints: string[];
    priority: "normal";
  }): Promise<{ runId: string; status: string }>;
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
  private readonly goalDraft?: SupervisorGoalDraftPort;
  private readonly clock: ClockPort;

  constructor(deps: {
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
    chatPort: SupervisorChatPort;
    projectContext: SupervisorProjectContextPort;
    projectIntelligence?: SupervisorProjectIntelligencePort;
    goalDraft?: SupervisorGoalDraftPort;
    clock: ClockPort;
  }) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.chatPort = deps.chatPort;
    this.projectContext = deps.projectContext;
    this.projectIntelligence = deps.projectIntelligence;
    this.goalDraft = deps.goalDraft;
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
      if (!this.goalDraft) {
        throw new Error("Manager Mode Goal Draft service is unavailable");
      }
      if (!stored.projectId) {
        throw new Error(
          "A persisted project id is required to create a Goal Draft"
        );
      }
      const draft = await this.goalDraft.createDraft({
        userId: input.userId,
        projectId: stored.projectId,
        projectRoot: stored.projectRoot,
        intent: input.message,
        constraints: buildGoalDraftConstraints({
          projectContext,
          projectIntelligence,
        }),
        priority: "normal",
      });
      return {
        message: {
          role: "assistant" as const,
          content: `Goal Draft ${draft.runId} was created. Its ACP manager is preparing a versioned plan; execution will remain locked until you approve that exact plan hash.`,
          createdAt: this.clock.nowMs(),
          model: "supervisos-manager-acp",
        },
        action: {
          type: "goal_draft_created" as const,
          runId: draft.runId,
          status: draft.status,
          requiresApproval: true as const,
        },
        supervisor,
      } satisfies SupervisorChatOutput;
    }

    const response = await withSoftTimeout(
      this.chatPort.respond({
        userId: input.userId,
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
          "The ACP advisory session timed out. No goal or command was submitted from this advisory message.",
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

function buildGoalDraftConstraints(input: {
  projectContext: SupervisorProjectContextSnapshot;
  projectIntelligence: SupervisorProjectIntelligenceSnapshot;
}): string[] {
  const paths = [
    ...input.projectIntelligence.symbolMatches.map((item) => item.path),
    ...input.projectIntelligence.routeMap.map((item) => item.path),
  ].slice(0, 24);
  return [
    "Respect the project-root sandbox and existing permission/command gates.",
    "Do not push, open a PR, deploy, switch branches, or modify out-of-envelope files.",
    ...(paths.length > 0
      ? [
          `Manager context hints (not pre-approved scope): ${[...new Set(paths)].join(", ")}`,
        ]
      : []),
    ...input.projectContext.diagnostics.slice(0, 4),
  ];
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
