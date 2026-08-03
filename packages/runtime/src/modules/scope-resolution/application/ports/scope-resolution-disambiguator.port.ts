import type { ScopeTarget } from "../contracts/scope-resolution.contract";

export interface ScopeResolutionDisambiguationInput {
  intent: string;
  phaseGoal?: string;
  candidates: ScopeTarget[];
}

export interface ScopeResolutionDisambiguatorPort {
  chooseTarget(
    input: ScopeResolutionDisambiguationInput
  ): Promise<ScopeTarget | null>;
}
