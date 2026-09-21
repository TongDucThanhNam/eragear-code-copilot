import {
  computeGoalContractHash,
  type GoalContractProposal,
  type GoalContractRevision,
  GoalIntakeService,
  type GoalRunPort,
} from "#runtime/modules/goal-intake";
import {
  AcpGoalIntakeReasonerAdapter,
  SupervisorGoalConsultationProjectSummaryAdapter,
} from "#runtime/modules/goal-intake/di";
import type { SupervisorProjectIntelligencePort } from "#runtime/modules/supervisor";
import {
  ConfiguredAgentCatalogAdapter,
  SessionRepositoryAcpManagerResultReaderAdapter,
} from "#runtime/modules/supervisor-orchestration/di";
import type {
  AgentUseCases,
  AiUseCases,
  GoalIntakeUseCases,
  SessionUseCases,
  SupervisorOrchestrationUseCases,
} from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type GoalIntakeServiceDependencies = ServiceRegistrySlice<
  "goalIntakeRepo" | "sessionRepo"
>;

export function createGoalIntakeUseCases(
  deps: GoalIntakeServiceDependencies,
  session: Pick<SessionUseCases, "create" | "stop">,
  ai: Pick<AiUseCases, "sendMessage" | "setMode">,
  agents: Pick<AgentUseCases, "list">,
  supervisor: Pick<
    SupervisorOrchestrationUseCases,
    "orchestrator" | "profiles"
  >,
  projectIntelligence: SupervisorProjectIntelligencePort
): GoalIntakeUseCases {
  const agentCatalog = new ConfiguredAgentCatalogAdapter(
    agents.list,
    supervisor.profiles
  );
  const reasoner = new AcpGoalIntakeReasonerAdapter({
    createSession: session.create,
    sendMessage: ai.sendMessage,
    stopSession: session.stop,
    setMode: ai.setMode,
    results: new SessionRepositoryAcpManagerResultReaderAdapter(
      deps.sessionRepo
    ),
    agents: {
      async list(input) {
        const eligible = await agentCatalog.listEligible(input);
        return eligible
          .filter((agent) => agent.managerEligible !== false)
          .map((agent) => ({
            agentId: agent.agentId,
            displayName: agent.displayName,
          }));
      },
    },
  });
  return {
    intake: new GoalIntakeService({
      repository: deps.goalIntakeRepo,
      reasoner,
      goalRun: new SupervisorGoalRunAdapter(supervisor.orchestrator),
      projectSummary: new SupervisorGoalConsultationProjectSummaryAdapter(
        projectIntelligence
      ),
    }),
  };
}

export class SupervisorGoalRunAdapter implements GoalRunPort {
  private readonly orchestrator: SupervisorOrchestrationUseCases["orchestrator"];

  constructor(orchestrator: SupervisorOrchestrationUseCases["orchestrator"]) {
    this.orchestrator = orchestrator;
  }

  async createFromContract(
    input: Parameters<GoalRunPort["createFromContract"]>[0]
  ): Promise<{ runId: string; status: string }> {
    const contract = input.contractRevision;
    if (contract.intakeId !== input.sourceIntakeId) {
      throw new Error("Goal Contract does not belong to its source intake");
    }
    const proposal = toContractProposal(contract);
    if (computeGoalContractHash(proposal) !== contract.hash) {
      throw new Error("Goal Contract hash does not match its frozen content");
    }

    // Consultation responses are deliberately excluded. They are advisory
    // records and cannot silently expand scope, authority, or acceptance.
    const run = await this.orchestrator.createDraft({
      userId: input.userId,
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      sourceGoalContract: {
        intakeId: input.sourceIntakeId,
        revisionId: contract.revisionId,
        revision: contract.revision,
        hash: contract.hash,
        createdAt: contract.createdAt,
        contract: structuredClone(proposal),
      },
      intent: renderGoalContractIntent(proposal),
      constraints: renderGoalContractConstraints(proposal),
      priority: "normal",
    });
    return { runId: run.runId, status: run.status };
  }
}

export function renderGoalContractIntent(
  contract: GoalContractProposal
): string {
  const intent = [
    `Goal: ${contract.title}`,
    "",
    "Objective",
    contract.objective,
  ].join("\n");
  if (intent.length > 32_000) {
    throw new Error(
      `Approved Goal Contract intent exceeds the 32000-character run limit (${intent.length})`
    );
  }
  return intent;
}

export function renderGoalContractConstraints(
  contract: GoalContractProposal
): string[] {
  const constraints: string[] = [];
  const append = (label: string, content: string): void => {
    appendLabeledChunks(constraints, label, content);
    if (constraints.length > 128) {
      throw new Error(
        `Approved Goal Contract requires ${constraints.length} constraint chunks, exceeding the run limit of 128`
      );
    }
  };

  contract.lockedStrategicDecisions.forEach((item, index) => {
    append(`Locked strategic decision ${index + 1}`, item);
  });
  contract.assumptions.forEach((item, index) => {
    append(`Explicit assumption ${index + 1}`, item);
  });
  contract.nonGoals.forEach((item, index) => {
    append(`Non-goal ${index + 1}`, item);
  });
  contract.changeBoundary.forEach((item, index) => {
    append(`Change boundary ${index + 1}`, item);
  });
  contract.acceptanceCriteria.forEach((item, index) => {
    append(
      `Acceptance criterion ${index + 1} (${item.criterionId}, ${item.evidence} evidence)`,
      item.statement
    );
  });
  contract.trustedVerificationCommands.forEach((command, index) => {
    append(`Trusted verification command ${index + 1}`, command);
  });
  append("Authority policy", JSON.stringify(contract.authority));
  contract.unresolvedQuestions.forEach((question, index) => {
    append(`Unresolved question ${index + 1}`, question);
  });
  return constraints;
}

function appendLabeledChunks(
  target: string[],
  label: string,
  content: string
): void {
  let offset = 0;
  let part = 1;
  while (offset < content.length) {
    const prefix = `${label} [part ${part}]: `;
    const available = 4000 - prefix.length;
    if (available < 1) {
      throw new Error(`Goal Contract constraint label is too long: ${label}`);
    }
    const chunk = content.slice(offset, offset + available);
    target.push(`${prefix}${chunk}`);
    offset += chunk.length;
    part += 1;
  }
}

function toContractProposal(
  revision: GoalContractRevision
): GoalContractProposal {
  const {
    revisionId: _revisionId,
    intakeId: _intakeId,
    revision: _revision,
    hash: _hash,
    createdAt: _createdAt,
    ...proposal
  } = revision;
  return proposal;
}
