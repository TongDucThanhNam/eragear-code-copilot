import { createId } from "#runtime/shared/utils/id.util";
import {
  AnswerGoalIntakeInputSchema,
  ApproveGoalContractInputSchema,
  ConvertGoalIntakeInputSchema,
  CreateGoalIntakeInputSchema,
  ExportGoalConsultationInputSchema,
  GetGoalIntakeInputSchema,
  GOAL_INTAKE_MINIMUM_ROUNDS,
  GOAL_INTAKE_SCHEMA_VERSION,
  type GoalConsultationRequest,
  GoalConsultationRequestSchema,
  type GoalContractRevision,
  type GoalIntakeReasonerResult,
  type GoalIntakeState,
  GoalIntakeStateSchema,
  ImportGoalConsultationInputSchema,
  ListGoalIntakesInputSchema,
  PrepareGoalConsultationInputSchema,
  ResumeGoalIntakeInputSchema,
} from "../domain/goal-intake.schemas";
import {
  createClientSafeGoalIntakeProjection,
  type GoalIntakeClientProjection,
} from "./goal-intake.projection";
import {
  buildGoalIntakeReasonerPrompt,
  computeGoalContractHash,
  computeGoalIntakeTextHash,
  parseGoalIntakeReasonerResult,
} from "./goal-intake-prompt.builder";
import type {
  GoalConsultationProjectSummary,
  GoalConsultationProjectSummaryPort,
} from "./ports/goal-consultation-project-summary.port";
import type {
  GoalIntakeReasonerPort,
  GoalIntakeReasonerSnapshot,
  GoalRunPort,
} from "./ports/goal-intake-reasoner.port";
import type { GoalIntakeRepositoryPort } from "./ports/goal-intake-repository.port";

const INITIAL_DISCOVERY_QUESTION =
  "Before I accept this as the goal: who should experience the outcome, what observable evidence would prove success, which constraints or non-goals are fixed, and which assumption do you most want me to challenge?";

type GoalIntakePendingTurn = NonNullable<GoalIntakeState["pendingTurn"]>;

/**
 * Production constructs one GoalIntakeService for one repository. Repository
 * scoping also prevents a second service over that same repository from
 * dispatching the same frozen turn again inside the live runtime process.
 * The registry is intentionally memory-only: a restarted process has no live
 * owner, so the durable pending turn becomes resumable immediately.
 */
const reasoningFlightsByRepository = new WeakMap<
  GoalIntakeRepositoryPort,
  Map<string, Promise<GoalIntakeClientProjection>>
>();

export interface GoalIntakeServiceDeps {
  repository: GoalIntakeRepositoryPort;
  reasoner: GoalIntakeReasonerPort;
  goalRun: GoalRunPort;
  projectSummary: GoalConsultationProjectSummaryPort;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface PreparedGoalConsultations {
  intake: GoalIntakeClientProjection;
  requests: GoalConsultationRequest[];
}

export class GoalIntakeService {
  private readonly repository: GoalIntakeRepositoryPort;
  private readonly reasoner: GoalIntakeReasonerPort;
  private readonly goalRun: GoalRunPort;
  private readonly projectSummary: GoalConsultationProjectSummaryPort;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private readonly reasoningFlights: Map<
    string,
    Promise<GoalIntakeClientProjection>
  >;

  constructor(deps: GoalIntakeServiceDeps) {
    this.repository = deps.repository;
    this.reasoner = deps.reasoner;
    this.goalRun = deps.goalRun;
    this.projectSummary = deps.projectSummary;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
    this.reasoningFlights = reasoningFlightsFor(this.repository);
  }

  async create(input: unknown): Promise<GoalIntakeClientProjection> {
    const parsed = CreateGoalIntakeInputSchema.parse(input);
    const now = this.now();
    const intakeId = this.idFactory("goal-intake");
    const state = GoalIntakeStateSchema.parse({
      schemaVersion: GOAL_INTAKE_SCHEMA_VERSION,
      intakeId,
      revision: 0,
      userId: parsed.userId,
      projectId: parsed.projectId,
      projectRoot: parsed.projectRoot,
      ...(parsed.originatingChatId
        ? { originatingChatId: parsed.originatingChatId }
        : {}),
      ...(parsed.title ? { title: parsed.title } : {}),
      roughOutcome: parsed.roughOutcome,
      depth: parsed.depth,
      providers: [...new Set(parsed.providers)],
      status: "interviewing",
      discoveryRoundCount: 0,
      messages: [
        {
          messageId: this.idFactory("goal-message"),
          role: "user",
          kind: "seed",
          content: parsed.roughOutcome,
          createdAt: now,
        },
        {
          messageId: this.idFactory("goal-message"),
          role: "supervisor",
          kind: "question",
          content: INITIAL_DISCOVERY_QUESTION,
          createdAt: now,
        },
      ],
      contractRevisions: [],
      consultations: [],
      createdAt: now,
      updatedAt: now,
    });
    return this.project(await this.repository.create(state));
  }

  async get(input: unknown): Promise<GoalIntakeClientProjection | null> {
    const parsed = GetGoalIntakeInputSchema.parse(input);
    const state = await this.repository.get(parsed.intakeId, parsed.userId);
    return state ? this.project(state) : null;
  }

  async list(input: unknown): Promise<GoalIntakeClientProjection[]> {
    const parsed = ListGoalIntakesInputSchema.parse(input);
    const states = await this.repository.list(parsed);
    return states.map((state) => this.project(state));
  }

  async answer(input: unknown): Promise<GoalIntakeClientProjection> {
    const parsed = AnswerGoalIntakeInputSchema.parse(input);
    const current = await this.requireState(parsed.intakeId, parsed.userId);
    const duplicate = current.messages.find(
      (message) => message.idempotencyKey === parsed.idempotencyKey
    );
    if (duplicate) {
      if (duplicate.content !== parsed.message) {
        throw new Error(
          `Goal answer idempotency key was already used with different content: ${parsed.idempotencyKey}`
        );
      }
      return current.pendingTurn?.idempotencyKey === parsed.idempotencyKey
        ? await this.completePendingTurn(current)
        : this.project(current);
    }
    if (
      current.status !== "interviewing" &&
      current.status !== "contract_ready"
    ) {
      throw new Error(
        `Goal intake cannot accept an answer from ${current.status}`
      );
    }
    this.assertRevision(current, parsed.expectedRevision);
    if (current.pendingTurn) {
      throw new Error("Goal discovery reasoning is already pending");
    }

    const pending = await this.saveNext(current, (draft) => {
      const now = this.now();
      draft.status = "interviewing";
      Reflect.deleteProperty(draft, "approval");
      draft.messages.push({
        messageId: this.idFactory("goal-message"),
        role: "user",
        kind: "answer",
        content: parsed.message,
        idempotencyKey: parsed.idempotencyKey,
        createdAt: now,
      });
      draft.discoveryRoundCount += 1;
      this.prepareReasoningTurn(draft, parsed.idempotencyKey, now);
    });
    return await this.completePendingTurn(pending);
  }

  async resume(input: unknown): Promise<GoalIntakeClientProjection> {
    const parsed = ResumeGoalIntakeInputSchema.parse(input);
    const current = await this.requireState(parsed.intakeId, parsed.userId);
    if (!current.pendingTurn) {
      return this.project(current);
    }
    this.assertRevision(current, parsed.expectedRevision);
    return await this.completePendingTurn(current);
  }

  async prepareConsultation(
    input: unknown
  ): Promise<PreparedGoalConsultations> {
    const parsed = PrepareGoalConsultationInputSchema.parse(input);
    const current = await this.requireState(parsed.intakeId, parsed.userId);
    if (
      current.status !== "interviewing" &&
      current.status !== "contract_ready"
    ) {
      throw new Error(`Goal intake cannot be consulted from ${current.status}`);
    }
    this.assertRevision(current, parsed.expectedRevision);
    const unsupported = parsed.providers.find(
      (provider) => !current.providers.includes(provider)
    );
    if (unsupported) {
      throw new Error(`External advisor ${unsupported} is not enabled`);
    }

    const activeContract = this.activeContract(current);
    const projectSummary = await this.projectSummary.build({
      userId: current.userId,
      projectId: current.projectId,
      projectRoot: current.projectRoot,
      intent: buildProjectSummaryIntent(current, activeContract, parsed.reason),
    });
    const created: GoalConsultationRequest[] = [];
    const saved = await this.saveNext(current, (draft) => {
      const now = this.now();
      for (const provider of [...new Set(parsed.providers)]) {
        const consultationId = this.idFactory("goal-consultation");
        const packet = buildConsultationPacket({
          consultationId,
          provider,
          reason: parsed.reason,
          state: draft,
          activeContract,
          projectSummary,
        });
        const request = GoalConsultationRequestSchema.parse({
          consultationId,
          provider,
          status: "prepared",
          reason: parsed.reason,
          packet,
          packetHash: computeGoalIntakeTextHash(packet),
          ...(activeContract
            ? {
                contractRevisionId: activeContract.revisionId,
                contractHash: activeContract.hash,
              }
            : {}),
          createdAt: now,
        });
        draft.consultations.push(request);
        created.push(request);
      }
    });
    return {
      intake: this.project(saved),
      requests: structuredClone(created),
    };
  }

  async exportConsultation(input: unknown): Promise<GoalConsultationRequest> {
    const parsed = ExportGoalConsultationInputSchema.parse(input);
    const current = await this.requireState(parsed.intakeId, parsed.userId);
    const request = current.consultations.find(
      (candidate) => candidate.consultationId === parsed.consultationId
    );
    if (!request) {
      throw new Error(
        `Consultation request not found: ${parsed.consultationId}`
      );
    }
    return structuredClone(request);
  }

  async importConsultation(
    input: unknown
  ): Promise<GoalIntakeClientProjection> {
    const parsed = ImportGoalConsultationInputSchema.parse(input);
    const current = await this.requireState(parsed.intakeId, parsed.userId);
    const existing = current.consultations.find(
      (request) => request.consultationId === parsed.consultationId
    );
    if (!existing) {
      throw new Error(
        `Consultation request not found: ${parsed.consultationId}`
      );
    }
    if (existing.status === "imported") {
      if (existing.result?.response !== parsed.response) {
        throw new Error(
          `Consultation ${parsed.consultationId} was already imported with a different response`
        );
      }
      return current.pendingTurn?.idempotencyKey ===
        `consultation-${parsed.consultationId}`
        ? await this.completePendingTurn(current)
        : this.project(current);
    }
    if (
      current.status !== "interviewing" &&
      current.status !== "contract_ready"
    ) {
      throw new Error(
        `Goal intake cannot import consultation from ${current.status}`
      );
    }
    this.assertRevision(current, parsed.expectedRevision);
    if (current.pendingTurn) {
      throw new Error("Goal discovery reasoning is already pending");
    }
    if (existing.status !== "prepared") {
      throw new Error(
        `Consultation ${parsed.consultationId} is not importable`
      );
    }
    assertConsultationResultBinding(parsed.response, parsed.consultationId);

    const saved = await this.saveNext(current, (draft) => {
      const now = this.now();
      const request = draft.consultations.find(
        (candidate) => candidate.consultationId === parsed.consultationId
      );
      if (!request || request.status !== "prepared") {
        throw new Error("Consultation changed before import");
      }
      request.status = "imported";
      request.result = {
        response: parsed.response,
        importedAt: now,
        importedByUserId: parsed.userId,
      };
      Reflect.deleteProperty(draft, "approval");
      const activeContract = this.activeContract(draft);
      const challengesExactActiveContract = Boolean(
        draft.status === "contract_ready" &&
          activeContract &&
          request.contractRevisionId === activeContract.revisionId &&
          request.contractHash === activeContract.hash
      );
      if (!challengesExactActiveContract) {
        draft.status = "interviewing";
        this.prepareReasoningTurn(
          draft,
          `consultation-${parsed.consultationId}`,
          now
        );
      }
    });
    return saved.pendingTurn
      ? await this.completePendingTurn(saved)
      : this.project(saved);
  }

  async approveContract(input: unknown): Promise<GoalIntakeClientProjection> {
    const parsed = ApproveGoalContractInputSchema.parse(input);
    const current = await this.requireState(parsed.intakeId, parsed.userId);
    this.assertRevision(current, parsed.expectedRevision);
    if (current.status !== "contract_ready") {
      throw new Error(
        `Goal contract cannot be approved from ${current.status}`
      );
    }
    const contract = this.activeContract(current);
    if (
      !contract ||
      contract.revisionId !== parsed.revisionId ||
      contract.hash !== parsed.hash
    ) {
      throw new Error(
        "Goal contract revision/hash does not match the active draft"
      );
    }
    const importedProviders = new Set(
      current.consultations
        .filter(
          (request) =>
            request.status === "imported" &&
            request.result &&
            request.contractRevisionId === contract.revisionId &&
            request.contractHash === contract.hash
        )
        .map((request) => request.provider)
    );
    const missingProviders = current.providers.filter(
      (provider) => !importedProviders.has(provider)
    );
    if (missingProviders.length > 0) {
      throw new Error(
        `Goal contract approval requires exact-revision consultation results from: ${missingProviders.join(", ")}`
      );
    }
    if (contract.unresolvedQuestions.length > 0) {
      throw new Error(
        "Resolve or explicitly remove open contract questions first"
      );
    }
    return this.project(
      await this.saveNext(current, (draft) => {
        draft.status = "approved";
        draft.approval = {
          revisionId: contract.revisionId,
          hash: contract.hash,
          approvedAt: this.now(),
          approvedByUserId: parsed.userId,
        };
      })
    );
  }

  async convert(input: unknown): Promise<GoalIntakeClientProjection> {
    const parsed = ConvertGoalIntakeInputSchema.parse(input);
    let current = await this.requireState(parsed.intakeId, parsed.userId);
    if (current.status === "converted") {
      return this.project(current);
    }
    this.assertRevision(current, parsed.expectedRevision);
    if (current.status !== "approved" && current.status !== "converting") {
      throw new Error(`Goal intake cannot convert from ${current.status}`);
    }
    const approved = this.approvedContract(current);
    if (current.status === "approved") {
      try {
        current = await this.saveNext(current, (draft) => {
          draft.status = "converting";
          Reflect.deleteProperty(draft, "reasoningError");
        });
      } catch (error) {
        const raced = await this.requireState(parsed.intakeId, parsed.userId);
        if (raced.status === "converted") {
          return this.project(raced);
        }
        if (
          raced.status !== "converting" ||
          !hasExactApproval(raced, approved)
        ) {
          throw error;
        }
        current = raced;
      }
    }
    if (!hasExactApproval(current, approved)) {
      throw new Error("Goal Contract approval changed during conversion");
    }
    let createdRunId: string | undefined;
    try {
      const created = await this.goalRun.createFromContract({
        sourceIntakeId: current.intakeId,
        userId: current.userId,
        projectId: current.projectId,
        projectRoot: current.projectRoot,
        ...(current.title ? { title: current.title } : {}),
        contractRevision: approved,
        consultationResults: current.consultations.flatMap((request) =>
          request.status === "imported" && request.result
            ? [
                {
                  consultationId: request.consultationId,
                  provider: request.provider,
                  response: stripConsultationResultBinding(
                    request.result.response,
                    request.consultationId
                  ),
                },
              ]
            : []
        ),
      });
      createdRunId = created.runId;
      return this.project(
        await this.persistConvertedRun(current, approved, created.runId)
      );
    } catch (error) {
      const latest = await this.requireState(
        parsed.intakeId,
        parsed.userId
      ).catch(() => undefined);
      if (
        latest?.status === "converted" &&
        (!createdRunId || latest.convertedRunId === createdRunId) &&
        hasExactApproval(latest, approved)
      ) {
        return this.project(latest);
      }
      if (
        latest?.status === "converting" &&
        hasExactApproval(latest, approved)
      ) {
        await this.recordError(latest, error).catch(() => undefined);
      }
      throw error;
    }
  }

  private async persistConvertedRun(
    initial: GoalIntakeState,
    approved: GoalContractRevision,
    runId: string
  ): Promise<GoalIntakeState> {
    let current = initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (current.status === "converted") {
        if (
          current.convertedRunId !== runId ||
          !hasExactApproval(current, approved)
        ) {
          throw new Error("Goal Intake is bound to a different Supervisor run");
        }
        return current;
      }
      if (
        current.status !== "converting" ||
        !hasExactApproval(current, approved)
      ) {
        throw new Error("Goal Intake conversion authority changed");
      }
      try {
        return await this.saveNext(current, (draft) => {
          draft.status = "converted";
          draft.convertedRunId = runId;
          Reflect.deleteProperty(draft, "reasoningError");
        });
      } catch (error) {
        const latest = await this.requireState(
          current.intakeId,
          current.userId
        );
        if (
          latest.revision === current.revision ||
          (latest.status !== "converting" && latest.status !== "converted") ||
          !hasExactApproval(latest, approved)
        ) {
          throw error;
        }
        current = latest;
      }
    }
    throw new Error("Goal Intake conversion changed too many times");
  }

  private async completePendingTurn(
    state: GoalIntakeState
  ): Promise<GoalIntakeClientProjection> {
    const pending = state.pendingTurn;
    if (!pending) {
      return this.project(state);
    }
    const flightKey = this.reasoningFlightKey(state, pending);
    const activeFlight = this.reasoningFlights.get(flightKey);
    if (activeFlight) {
      return await activeFlight;
    }

    let trackedFlight: Promise<GoalIntakeClientProjection>;
    trackedFlight = this.executePendingTurn(state, pending).finally(() => {
      if (this.reasoningFlights.get(flightKey) === trackedFlight) {
        this.reasoningFlights.delete(flightKey);
      }
    });
    this.reasoningFlights.set(flightKey, trackedFlight);
    return await trackedFlight;
  }

  private async executePendingTurn(
    state: GoalIntakeState,
    pending: GoalIntakePendingTurn
  ): Promise<GoalIntakeClientProjection> {
    try {
      const snapshot = this.reasonerSnapshot(state);
      let result = parseGoalIntakeReasonerResult(
        await this.reasoner.advance({
          turnId: pending.turnId,
          idempotencyKey: pending.idempotencyKey,
          prompt: pending.prompt,
          promptHash: pending.promptHash,
          snapshot,
        })
      );
      if (
        result.kind === "propose_contract" &&
        state.discoveryRoundCount < this.minimumRounds(state)
      ) {
        result = minimumRoundQuestion(state);
      }
      const completed = await this.saveApplicablePendingTurn(
        state,
        pending,
        (draft) => {
          Reflect.deleteProperty(draft, "pendingTurn");
          Reflect.deleteProperty(draft, "reasoningError");
          this.applyReasonerResult(draft, result);
        }
      );
      return this.project(completed);
    } catch (error) {
      await this.recordApplicablePendingTurnError(state, pending, error).catch(
        () => undefined
      );
      throw error;
    }
  }

  private async saveApplicablePendingTurn(
    initial: GoalIntakeState,
    pending: GoalIntakePendingTurn,
    mutate: (draft: GoalIntakeState) => void
  ): Promise<GoalIntakeState> {
    let current = await this.requireState(initial.intakeId, initial.userId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!current.pendingTurn) {
        return current;
      }
      if (!samePendingTurn(current.pendingTurn, pending)) {
        throw new Error(
          `Goal Intake reasoning turn authority changed: ${pending.turnId}`
        );
      }
      try {
        return await this.saveNext(current, mutate);
      } catch (error) {
        const latest = await this.requireState(
          initial.intakeId,
          initial.userId
        );
        if (latest.revision === current.revision) {
          throw error;
        }
        current = latest;
      }
    }
    throw new Error(
      `Goal Intake reasoning turn changed too many times: ${pending.turnId}`
    );
  }

  private async recordApplicablePendingTurnError(
    state: GoalIntakeState,
    pending: GoalIntakePendingTurn,
    error: unknown
  ): Promise<GoalIntakeState> {
    const message = error instanceof Error ? error.message : String(error);
    return await this.saveApplicablePendingTurn(state, pending, (draft) => {
      draft.reasoningError = message;
    });
  }

  private reasoningFlightKey(
    state: GoalIntakeState,
    pending: GoalIntakePendingTurn
  ): string {
    return [
      state.userId,
      state.intakeId,
      pending.turnId,
      pending.promptHash,
    ].join("\u0000");
  }

  private isReasoningActive(state: GoalIntakeState): boolean {
    return state.pendingTurn
      ? this.reasoningFlights.has(
          this.reasoningFlightKey(state, state.pendingTurn)
        )
      : false;
  }

  private applyReasonerResult(
    draft: GoalIntakeState,
    result: GoalIntakeReasonerResult
  ): void {
    const now = this.now();
    if (result.kind === "ask_question") {
      draft.status = "interviewing";
      draft.messages.push({
        messageId: this.idFactory("goal-message"),
        role: "supervisor",
        kind: "question",
        content: result.question,
        createdAt: now,
      });
      return;
    }
    const revisionNumber = (draft.contractRevisions.at(-1)?.revision ?? 0) + 1;
    const revision: GoalContractRevision = {
      ...structuredClone(result.contract),
      revisionId: this.idFactory("goal-contract"),
      intakeId: draft.intakeId,
      revision: revisionNumber,
      hash: computeGoalContractHash(result.contract),
      createdAt: now,
    };
    draft.contractRevisions.push(revision);
    draft.activeContractRevisionId = revision.revisionId;
    draft.title = revision.title;
    draft.status = "contract_ready";
    draft.messages.push({
      messageId: this.idFactory("goal-message"),
      role: "supervisor",
      kind: "synthesis",
      content: `Goal Contract v${revision.revision} is ready for review. ${result.rationale}`,
      createdAt: now,
    });
  }

  private prepareReasoningTurn(
    draft: GoalIntakeState,
    idempotencyKey: string,
    now: string
  ): void {
    const snapshot = this.reasonerSnapshot(draft);
    const prompt = buildGoalIntakeReasonerPrompt(snapshot);
    draft.pendingTurn = {
      turnId: this.idFactory("goal-reasoning-turn"),
      idempotencyKey,
      prompt,
      promptHash: computeGoalIntakeTextHash(prompt),
      startedAt: now,
    };
    Reflect.deleteProperty(draft, "reasoningError");
  }

  private reasonerSnapshot(state: GoalIntakeState): GoalIntakeReasonerSnapshot {
    const activeContract = this.activeContract(state);
    return {
      intakeId: state.intakeId,
      userId: state.userId,
      projectId: state.projectId,
      projectRoot: state.projectRoot,
      ...(state.title ? { title: state.title } : {}),
      roughOutcome: state.roughOutcome,
      depth: state.depth,
      minimumRounds: this.minimumRounds(state),
      discoveryRoundCount: state.discoveryRoundCount,
      messages: structuredClone(state.messages),
      importedConsultations: state.consultations.flatMap((request) =>
        request.status === "imported" && request.result
          ? [
              {
                provider: request.provider,
                reason: request.reason,
                response: stripConsultationResultBinding(
                  request.result.response,
                  request.consultationId
                ),
              },
            ]
          : []
      ),
      ...(activeContract ? { activeContract } : {}),
    };
  }

  private async saveNext(
    current: GoalIntakeState,
    mutate: (draft: GoalIntakeState) => void
  ): Promise<GoalIntakeState> {
    const draft = structuredClone(current);
    mutate(draft);
    draft.revision = current.revision + 1;
    draft.updatedAt = this.now();
    return await this.repository.save(
      GoalIntakeStateSchema.parse(draft),
      current.revision
    );
  }

  private recordError(
    state: GoalIntakeState,
    error: unknown
  ): Promise<GoalIntakeState> {
    return this.saveNext(state, (draft) => {
      draft.reasoningError =
        error instanceof Error ? error.message : String(error);
    });
  }

  private async requireState(
    intakeId: string,
    userId: string
  ): Promise<GoalIntakeState> {
    const state = await this.repository.get(intakeId, userId);
    if (!state) {
      throw new Error(`Goal intake not found: ${intakeId}`);
    }
    return state;
  }

  private assertRevision(
    state: GoalIntakeState,
    expectedRevision: number
  ): void {
    if (state.revision !== expectedRevision) {
      throw new Error(
        `Goal intake revision changed: expected ${expectedRevision}, actual ${state.revision}`
      );
    }
  }

  private minimumRounds(state: GoalIntakeState): number {
    return GOAL_INTAKE_MINIMUM_ROUNDS[state.depth];
  }

  private activeContract(
    state: GoalIntakeState
  ): GoalContractRevision | undefined {
    return state.contractRevisions.find(
      (candidate) => candidate.revisionId === state.activeContractRevisionId
    );
  }

  private approvedContract(state: GoalIntakeState): GoalContractRevision {
    const approval = state.approval;
    const contract = approval
      ? state.contractRevisions.find(
          (candidate) =>
            candidate.revisionId === approval.revisionId &&
            candidate.hash === approval.hash
        )
      : undefined;
    if (!contract) {
      throw new Error("Approved Goal Contract revision is unavailable");
    }
    return contract;
  }

  private project(state: GoalIntakeState): GoalIntakeClientProjection {
    return createClientSafeGoalIntakeProjection(
      state,
      this.minimumRounds(state),
      this.isReasoningActive(state)
    );
  }
}

function reasoningFlightsFor(
  repository: GoalIntakeRepositoryPort
): Map<string, Promise<GoalIntakeClientProjection>> {
  const existing = reasoningFlightsByRepository.get(repository);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Promise<GoalIntakeClientProjection>>();
  reasoningFlightsByRepository.set(repository, created);
  return created;
}

function samePendingTurn(
  left: GoalIntakePendingTurn,
  right: GoalIntakePendingTurn
): boolean {
  return (
    left.turnId === right.turnId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.prompt === right.prompt &&
    left.promptHash === right.promptHash &&
    left.startedAt === right.startedAt
  );
}

function minimumRoundQuestion(
  state: GoalIntakeState
): GoalIntakeReasonerResult {
  const remaining =
    GOAL_INTAKE_MINIMUM_ROUNDS[state.depth] - state.discoveryRoundCount;
  return {
    kind: "ask_question",
    question: `The contract is still premature. Challenge the most consequential unresolved assumption and ask for the missing outcome, boundary, or acceptance evidence (${remaining} discovery round${remaining === 1 ? "" : "s"} still required).`,
    rationale: "The configured discovery depth has not been satisfied.",
    missingTopics: ["critical assumptions", "acceptance evidence"],
  };
}

function hasExactApproval(
  state: GoalIntakeState,
  contract: GoalContractRevision
): boolean {
  return (
    state.approval?.revisionId === contract.revisionId &&
    state.approval.hash === contract.hash
  );
}

function buildConsultationPacket(input: {
  consultationId: string;
  provider: GoalConsultationRequest["provider"];
  reason: string;
  state: GoalIntakeState;
  activeContract?: GoalContractRevision;
  projectSummary: GoalConsultationProjectSummary;
}): string {
  const packet = [
    `CONSULTATION ID: ${input.consultationId}`,
    `TARGET ADVISOR: ${input.provider}`,
    "",
    "ROLE",
    "Act as an independent, critical product and engineering advisor. Do not flatter the premise. Find contradictions, hidden assumptions, missing evidence, unsafe scope, and simpler alternatives.",
    "",
    "REQUEST",
    input.reason,
    "",
    "SECURITY AND CONSENT — REVIEW BEFORE COPY",
    "The automatically gathered project summary is limited to sanitized, repo-relative structural metadata. It excludes source excerpts, vault content, diffs, environment values, and credential values.",
    "Your consultation request, rough outcome, interview messages, and active contract text are included verbatim and may contain secrets. Eragear does not scan or redact that user-authored text. Review and scrub tokens, passwords, private URLs, personal data, and other sensitive content before copying or sending this packet to an external advisor.",
    "",
    "BOUNDED GOAL CONTEXT",
    JSON.stringify({
      title: input.state.title,
      roughOutcome: input.state.roughOutcome,
      discoveryDepth: input.state.depth,
      discoveryRoundCount: input.state.discoveryRoundCount,
      conversation: input.state.messages.slice(-32).map((message) => ({
        role: message.role,
        kind: message.kind,
        content: message.content,
      })),
      contract: input.activeContract,
    }),
    "",
    "BOUNDED PROJECT STRUCTURE",
    JSON.stringify(input.projectSummary),
    "",
    "RETURN FORMAT",
    "1. Restate the actual outcome.\n2. Identify contradictions.\n3. Challenge assumptions.\n4. Propose alternatives.\n5. List missing decisions.\n6. Recommend falsifiable acceptance criteria.\n7. End with a concise recommendation.",
    "",
    `End your response with: RESULT ${input.consultationId}`,
  ].join("\n");
  if (packet.length > 64_000) {
    throw new Error(
      `Goal consultation packet exceeds the 64000-character limit (${packet.length})`
    );
  }
  return packet;
}

function buildProjectSummaryIntent(
  state: GoalIntakeState,
  activeContract: GoalContractRevision | undefined,
  consultationReason: string
): string {
  return [
    state.title,
    state.roughOutcome,
    activeContract?.objective,
    consultationReason,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .slice(0, 32_000);
}

function assertConsultationResultBinding(
  response: string,
  consultationId: string
): void {
  const lastLine = response
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  const expected = `RESULT ${consultationId}`;
  if (lastLine !== expected) {
    throw new Error(
      `Consultation response must end with the exact binding marker: ${expected}`
    );
  }
}

function stripConsultationResultBinding(
  response: string,
  consultationId: string
): string {
  const marker = `RESULT ${consultationId}`;
  const trimmed = response.trim();
  return trimmed.endsWith(marker)
    ? trimmed.slice(0, -marker.length).trimEnd()
    : trimmed;
}
