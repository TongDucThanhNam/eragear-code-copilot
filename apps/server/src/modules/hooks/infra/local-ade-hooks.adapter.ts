import type {
  ApproveHookRunInput,
  ExportHookRunsInput,
  HookRunExport,
  HooksData,
  HooksProjectInput,
  ReviewHookRunInput,
  RunHookBatchInput,
  RunHookInput,
  ToggleHookInput,
  TrustHookInput,
  UpdateHookLifecyclePolicyInput,
  UpdateHookSchedulingPolicyInput,
  UpsertHookInput,
} from "../application/contracts/hooks.contract";
import type { HooksPort } from "../application/ports/hooks.port";

interface LocalAdeHooksSnapshot {
  hooks: {
    configPath: string;
    lifecyclePolicy: HooksData["lifecyclePolicy"];
    schedulingPolicy: HooksData["schedulingPolicy"];
    items: HooksData["hooks"];
    recentRuns: HooksData["recentRuns"];
    recentBatches: HooksData["recentBatches"];
  };
}

export interface LocalAdeHooksSource {
  snapshot(userId: string): Promise<LocalAdeHooksSnapshot>;
  upsertHook(
    userId: string,
    input: UpsertHookInput
  ): Promise<LocalAdeHooksSnapshot>;
  toggleHook(
    userId: string,
    input: ToggleHookInput
  ): Promise<LocalAdeHooksSnapshot>;
  updateHookLifecyclePolicy(
    userId: string,
    input: UpdateHookLifecyclePolicyInput
  ): Promise<LocalAdeHooksSnapshot>;
  updateHookSchedulingPolicy(
    userId: string,
    input: UpdateHookSchedulingPolicyInput
  ): Promise<LocalAdeHooksSnapshot>;
  trustHook(
    userId: string,
    input: TrustHookInput
  ): Promise<LocalAdeHooksSnapshot>;
  approveHookRun(
    userId: string,
    input: ApproveHookRunInput
  ): Promise<LocalAdeHooksSnapshot>;
  runHook(userId: string, input: RunHookInput): Promise<LocalAdeHooksSnapshot>;
  runHookBatch(
    userId: string,
    input: RunHookBatchInput
  ): Promise<LocalAdeHooksSnapshot>;
  reviewHookRun(
    userId: string,
    input: ReviewHookRunInput
  ): Promise<LocalAdeHooksSnapshot>;
  exportHookRuns(
    userId: string,
    input?: ExportHookRunsInput
  ): Promise<HookRunExport>;
}

export class LocalAdeHooksAdapter implements HooksPort {
  private readonly localAde: LocalAdeHooksSource;

  constructor(localAde: LocalAdeHooksSource) {
    this.localAde = localAde;
  }

  async listHooks(
    userId: string,
    _input?: HooksProjectInput
  ): Promise<HooksData> {
    return toHooksData(await this.localAde.snapshot(userId));
  }

  async upsertHook(userId: string, input: UpsertHookInput): Promise<HooksData> {
    return toHooksData(await this.localAde.upsertHook(userId, input));
  }

  async toggleHook(userId: string, input: ToggleHookInput): Promise<HooksData> {
    return toHooksData(await this.localAde.toggleHook(userId, input));
  }

  async updateLifecyclePolicy(
    userId: string,
    input: UpdateHookLifecyclePolicyInput
  ): Promise<HooksData> {
    return toHooksData(
      await this.localAde.updateHookLifecyclePolicy(userId, input)
    );
  }

  async updateSchedulingPolicy(
    userId: string,
    input: UpdateHookSchedulingPolicyInput
  ): Promise<HooksData> {
    return toHooksData(
      await this.localAde.updateHookSchedulingPolicy(userId, input)
    );
  }

  async trustHook(userId: string, input: TrustHookInput): Promise<HooksData> {
    return toHooksData(await this.localAde.trustHook(userId, input));
  }

  async approveRun(
    userId: string,
    input: ApproveHookRunInput
  ): Promise<HooksData> {
    return toHooksData(await this.localAde.approveHookRun(userId, input));
  }

  async runHook(userId: string, input: RunHookInput): Promise<HooksData> {
    return toHooksData(await this.localAde.runHook(userId, input));
  }

  async runBatch(userId: string, input: RunHookBatchInput): Promise<HooksData> {
    return toHooksData(await this.localAde.runHookBatch(userId, input));
  }

  async reviewRun(
    userId: string,
    input: ReviewHookRunInput
  ): Promise<HooksData> {
    return toHooksData(await this.localAde.reviewHookRun(userId, input));
  }

  async exportRuns(
    userId: string,
    input?: ExportHookRunsInput
  ): Promise<HookRunExport> {
    return await this.localAde.exportHookRuns(userId, input ?? {});
  }
}

function toHooksData(snapshot: LocalAdeHooksSnapshot): HooksData {
  return {
    configPath: snapshot.hooks.configPath,
    lifecyclePolicy: snapshot.hooks.lifecyclePolicy,
    schedulingPolicy: snapshot.hooks.schedulingPolicy,
    hooks: snapshot.hooks.items,
    recentRuns: snapshot.hooks.recentRuns,
    recentBatches: snapshot.hooks.recentBatches,
  };
}
