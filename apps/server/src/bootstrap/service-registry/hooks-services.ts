import {
  type ApproveHookRunInput,
  type ExportHookRunsInput,
  type HookRunExport,
  type HooksData,
  type HooksPort,
  type HooksProjectInput,
  HooksService,
  type ReviewHookRunInput,
  type RunHookBatchInput,
  type RunHookInput,
  type ToggleHookInput,
  type TrustHookInput,
  type UpdateHookLifecyclePolicyInput,
  type UpdateHookSchedulingPolicyInput,
  type UpsertHookInput,
} from "@/modules/hooks";
import type { LocalAdeService } from "@/modules/settings";
import type { HooksUseCases, UseCasePort } from "@/modules/use-cases";

type LocalAdeSnapshot = Awaited<ReturnType<LocalAdeService["snapshot"]>>;

class LocalAdeHooksAdapter implements HooksPort {
  private readonly localAde: UseCasePort<LocalAdeService>;

  constructor(localAde: UseCasePort<LocalAdeService>) {
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

function toHooksData(snapshot: LocalAdeSnapshot): HooksData {
  return {
    configPath: snapshot.hooks.configPath,
    lifecyclePolicy: snapshot.hooks.lifecyclePolicy,
    schedulingPolicy: snapshot.hooks.schedulingPolicy,
    hooks: snapshot.hooks.items,
    recentRuns: snapshot.hooks.recentRuns,
    recentBatches: snapshot.hooks.recentBatches,
  };
}

export function createHooksUseCases(
  localAde: UseCasePort<LocalAdeService>
): HooksUseCases {
  return {
    hooks: new HooksService(new LocalAdeHooksAdapter(localAde)),
  };
}
