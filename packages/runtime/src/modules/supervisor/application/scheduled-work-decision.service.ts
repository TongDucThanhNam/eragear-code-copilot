import type { ScheduledWorkDecisionPort } from "./ports/scheduled-work-decision.port";
import type {
  SupervisorProjectContextPort,
  SupervisorProjectIntelligencePort,
} from "./ports/supervisor-chat.port";
import type { SupervisorMemoryPort } from "./ports/supervisor-memory.port";
import type { SupervisorResearchPort } from "./ports/supervisor-research.port";
import type {
  ScheduledWorkDecisionResult,
  ScheduledWorkPriorEvidence,
} from "./scheduled-work-decision.contract";

const CONTEXT_TIMEOUT_MS = 3000;
const INTELLIGENCE_TIMEOUT_MS = 5000;
const OPTIONAL_CONTEXT_TIMEOUT_MS = 4000;
const PRIOR_EVIDENCE_LIMIT = 12;

export class ScheduledWorkDecisionService {
  private readonly decision: ScheduledWorkDecisionPort;
  private readonly projectContext: SupervisorProjectContextPort;
  private readonly projectIntelligence?: SupervisorProjectIntelligencePort;
  private readonly memory: SupervisorMemoryPort;
  private readonly research: SupervisorResearchPort;
  private readonly now: () => number;

  constructor(deps: {
    decision: ScheduledWorkDecisionPort;
    projectContext: SupervisorProjectContextPort;
    projectIntelligence?: SupervisorProjectIntelligencePort;
    memory: SupervisorMemoryPort;
    research: SupervisorResearchPort;
    now?: () => number;
  }) {
    this.decision = deps.decision;
    this.projectContext = deps.projectContext;
    this.projectIntelligence = deps.projectIntelligence;
    this.memory = deps.memory;
    this.research = deps.research;
    this.now = deps.now ?? Date.now;
  }

  async execute(input: {
    scheduleId: string;
    userId: string;
    projectId?: string;
    projectRoot: string;
    objective: string;
    workMode: "adaptive_session" | "supervisor_run";
    priorEvidence: ScheduledWorkPriorEvidence[];
  }): Promise<ScheduledWorkDecisionResult> {
    const [projectContext, projectIntelligence, memory, research] =
      await Promise.all([
        withFallback(
          this.projectContext.build({ projectRoot: input.projectRoot }),
          CONTEXT_TIMEOUT_MS,
          {
            topLevelEntries: [],
            files: [],
            diagnostics: ["Scheduled project context is unavailable."],
          }
        ),
        this.projectIntelligence
          ? withFallback(
              this.projectIntelligence.analyze({
                userId: input.userId,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                projectRoot: input.projectRoot,
                intent: input.objective,
                phaseGoal: input.objective,
              }),
              INTELLIGENCE_TIMEOUT_MS,
              unavailableIntelligence(
                "Scheduled project intelligence is unavailable."
              )
            )
          : Promise.resolve(
              unavailableIntelligence(
                "Project intelligence adapter is not configured."
              )
            ),
        withFallback(
          this.memory.lookup({
            query: input.objective,
            chatId: `scheduled:${input.scheduleId}`,
            projectRoot: input.projectRoot,
          }),
          OPTIONAL_CONTEXT_TIMEOUT_MS,
          { results: [] }
        ),
        withFallback(
          this.research.search(input.objective),
          OPTIONAL_CONTEXT_TIMEOUT_MS,
          []
        ),
      ]);

    const proposal = await this.decision.decide({
      scheduleId: input.scheduleId,
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      projectRoot: input.projectRoot,
      objective: input.objective,
      workMode: input.workMode,
      projectContext,
      projectIntelligence,
      priorEvidence: input.priorEvidence.slice(-PRIOR_EVIDENCE_LIMIT),
      memoryResults: memory.results,
      researchResults: research,
    });
    return { ...proposal, decidedAt: this.now() };
  }
}

function unavailableIntelligence(diagnostic: string) {
  return {
    status: "unavailable" as const,
    symbolExtractionMode: "none" as const,
    graphNodes: [],
    symbolMatches: [],
    routeMap: [],
    diagnostics: [diagnostic],
  };
}

async function withFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
