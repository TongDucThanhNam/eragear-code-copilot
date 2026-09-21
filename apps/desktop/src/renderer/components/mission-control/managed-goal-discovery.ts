export const MANAGED_GOAL_DISCOVERY_DEPTHS = [
  "quick",
  "thorough",
  "exhaustive",
] as const;

export const MANAGED_GOAL_DISCOVERY_PROVIDERS = ["chatgpt", "gemini"] as const;

export type ManagedGoalDiscoveryDepth =
  (typeof MANAGED_GOAL_DISCOVERY_DEPTHS)[number];

export type ManagedGoalDiscoveryProvider =
  (typeof MANAGED_GOAL_DISCOVERY_PROVIDERS)[number];

export interface ManagedGoalDiscoverySubmission {
  title: string;
  seedIntent: string;
  depth: ManagedGoalDiscoveryDepth;
  providers: ManagedGoalDiscoveryProvider[];
}

export interface ManagedGoalDiscoveryProjectSnapshot {
  id: string;
  name: string;
}

export interface ManagedGoalDiscoveryDraft {
  title: string;
  seedIntent: string;
  depth: ManagedGoalDiscoveryDepth;
  providers: Record<ManagedGoalDiscoveryProvider, boolean>;
}

export type ManagedGoalDiscoveryValidationErrors = Partial<
  Record<"title" | "seedIntent", string>
>;

export type ManagedGoalDiscoveryAction =
  | { type: "set_title"; value: string }
  | { type: "set_seed_intent"; value: string }
  | { type: "set_depth"; value: ManagedGoalDiscoveryDepth }
  | {
      type: "set_provider";
      provider: ManagedGoalDiscoveryProvider;
      enabled: boolean;
    }
  | { type: "reset" };

export type ManagedGoalDiscoveryPreparation =
  | {
      ok: true;
      submission: ManagedGoalDiscoverySubmission;
    }
  | {
      ok: false;
      errors: ManagedGoalDiscoveryValidationErrors;
    };

export function createManagedGoalDiscoveryDraft(): ManagedGoalDiscoveryDraft {
  return {
    title: "",
    seedIntent: "",
    depth: "exhaustive",
    providers: {
      chatgpt: true,
      gemini: true,
    },
  };
}

export function snapshotManagedGoalDiscoveryProject(
  project: ManagedGoalDiscoveryProjectSnapshot | null
): ManagedGoalDiscoveryProjectSnapshot | null {
  return project ? { id: project.id, name: project.name } : null;
}

export function reduceManagedGoalDiscoveryDraft(
  state: ManagedGoalDiscoveryDraft,
  action: ManagedGoalDiscoveryAction
): ManagedGoalDiscoveryDraft {
  switch (action.type) {
    case "set_title":
      return { ...state, title: action.value };
    case "set_seed_intent":
      return { ...state, seedIntent: action.value };
    case "set_depth":
      return { ...state, depth: action.value };
    case "set_provider":
      return {
        ...state,
        providers: {
          ...state.providers,
          [action.provider]: action.enabled,
        },
      };
    case "reset":
      return createManagedGoalDiscoveryDraft();
    default:
      return state;
  }
}

export function prepareManagedGoalDiscoverySubmission(
  draft: ManagedGoalDiscoveryDraft
): ManagedGoalDiscoveryPreparation {
  const title = draft.title.trim();
  const seedIntent = draft.seedIntent.trim();
  const errors: ManagedGoalDiscoveryValidationErrors = {};

  if (!title) {
    errors.title = "Enter a goal title.";
  }
  if (!seedIntent) {
    errors.seedIntent = "Describe the rough outcome you want.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    submission: {
      title,
      seedIntent,
      depth: draft.depth,
      providers: MANAGED_GOAL_DISCOVERY_PROVIDERS.filter(
        (provider) => draft.providers[provider]
      ),
    },
  };
}
