import type {
  ApproveHookRunInput,
  ExportHookRunsInput,
  HookDescriptor,
  HookRunExport,
  HooksData,
  HooksListResult,
  HooksProjectInput,
  ReviewHookRunInput,
  RunHookBatchInput,
  RunHookInput,
  ToggleHookInput,
  TrustHookInput,
  UpdateHookLifecyclePolicyInput,
  UpdateHookSchedulingPolicyInput,
  UpsertHookInput,
} from "./contracts/hooks.contract";
import type { HooksPort } from "./ports/hooks.port";

export class HooksService {
  private readonly hooks: HooksPort;

  constructor(hooks: HooksPort) {
    this.hooks = hooks;
  }

  async list(
    userId: string,
    input?: HooksProjectInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.listHooks(userId, input));
  }

  async upsert(
    userId: string,
    input: UpsertHookInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.upsertHook(userId, input));
  }

  async toggle(
    userId: string,
    input: ToggleHookInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.toggleHook(userId, input));
  }

  async updateLifecyclePolicy(
    userId: string,
    input: UpdateHookLifecyclePolicyInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.updateLifecyclePolicy(userId, input));
  }

  async updateSchedulingPolicy(
    userId: string,
    input: UpdateHookSchedulingPolicyInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.updateSchedulingPolicy(userId, input));
  }

  async trust(userId: string, input: TrustHookInput): Promise<HooksListResult> {
    return toResult(await this.hooks.trustHook(userId, input));
  }

  async approveRun(
    userId: string,
    input: ApproveHookRunInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.approveRun(userId, input));
  }

  async run(userId: string, input: RunHookInput): Promise<HooksListResult> {
    return toResult(await this.hooks.runHook(userId, input));
  }

  async runBatch(
    userId: string,
    input: RunHookBatchInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.runBatch(userId, input));
  }

  async reviewRun(
    userId: string,
    input: ReviewHookRunInput
  ): Promise<HooksListResult> {
    return toResult(await this.hooks.reviewRun(userId, input));
  }

  async exportRuns(
    userId: string,
    input?: ExportHookRunsInput
  ): Promise<HookRunExport> {
    return await this.hooks.exportRuns(userId, input);
  }
}

function toResult(data: HooksData): HooksListResult {
  const hooks = data.hooks;
  return {
    ...data,
    enabledCount: hooks.filter((hook) => hook.enabled).length,
    readyCount: hooks.filter(isReadyHook).length,
    totalCount: hooks.length,
    trustedCount: hooks.filter((hook) => hook.trustStatus === "trusted").length,
  };
}

function isReadyHook(hook: HookDescriptor): boolean {
  return (
    hook.enabled &&
    hook.trustStatus === "trusted" &&
    hook.executionPolicy.status === "allowed" &&
    hook.scheduling.status === "ready"
  );
}
