import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "#runtime/config/constants";
import type { AgentInfo } from "#runtime/shared/types/agent.types";
import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "#runtime/shared/types/session.types";

/**
 * Parameters for capping a model list.
 */
export interface CapModelListParams {
  /**
   * The list of available models to cap. Pass null/undefined for empty list.
   */
  models?: SessionModelState["availableModels"] | null;
  /**
   * The list of config options to cap. Pass null/undefined for empty list.
   */
  configOptions?: SessionConfigOption[] | null;
  /**
   * The model ID of the currently selected model (must be preserved in output).
   */
  currentModelId?: string | null;
  /**
   * Maximum number of items to return per list.
   * Defaults to DEFAULT_MAX_VISIBLE_MODEL_COUNT (100).
   */
  maxVisible?: number;
}

/**
 * Result of capping a model list.
 */
export interface CapModelListResult {
  /** The capped list of available models. */
  models: SessionModelState["availableModels"];
  /** The capped list of config options. */
  configOptions: SessionConfigOption[];
  /** True if the model list was truncated. */
  truncated: boolean;
  /** Number of models dropped from the model list. */
  truncatedCount: number;
}

export interface CapSessionSelectionStateParams {
  models?: SessionModelState | null;
  configOptions?: SessionConfigOption[] | null;
  maxVisible?: number;
  stripAvailableModels?: boolean;
}

export interface CapSessionSelectionStateResult {
  models?: SessionModelState | null;
  configOptions: SessionConfigOption[];
  truncated: boolean;
  truncatedCount: number;
}

export function shouldStripAvailableModelsForAgent(
  agentInfo?: AgentInfo | null
): boolean {
  const candidates = [agentInfo?.name, agentInfo?.title];
  return candidates.some((value) => normalizeAgentLabel(value) === "opencode");
}

interface SessionSelectionTarget {
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState;
  models?: SessionModelState;
}

export interface SessionSelectionSyncResult {
  modeId?: string;
  modelId?: string;
  modeChanged: boolean;
  modelChanged: boolean;
}

export interface SessionConfigOptionValue {
  value: string;
  name?: string;
  description?: string | null;
}

interface NormalizedConfigSelectOptionValue {
  value: string;
  name: string;
  description?: string | null;
}

interface SessionConfigSelectOptionValue {
  value?: string;
  name?: string;
  description?: string | null;
}

interface SessionConfigSelectGroupValue {
  options?: SessionConfigSelectOptionValue[];
}

type SessionConfigSelectOption = Extract<
  SessionConfigOption,
  { type: "select" }
>;

function isConfigSelectGroup(
  value: SessionConfigSelectOptionValue | SessionConfigSelectGroupValue
): value is SessionConfigSelectGroupValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as SessionConfigSelectGroupValue).options)
  );
}

function hasNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAgentLabel(value: string | null | undefined): string {
  return value?.replace(/\s+/g, "").toLowerCase() ?? "";
}

export function isSessionConfigSelectOption(
  option: SessionConfigOption | undefined
): option is SessionConfigSelectOption {
  return option?.type === "select" && Array.isArray(option.options);
}

function getCurrentStringValue(
  option: SessionConfigOption | undefined
): string | undefined {
  const currentValue = option?.currentValue;
  return typeof currentValue === "string" && hasNonEmptyString(currentValue)
    ? currentValue
    : undefined;
}

/**
 * Caps a config option's values to maxVisible items, preserving currentValue.
 * Flattens nested grouped options into a flat options array.
 * Returns a cloned config option — never mutates input.
 *
 * Behavior for maxVisible=0: returns an empty options array (prefer empty).
 */
function capConfigOption(
  option: SessionConfigOption,
  maxVisible: number
): { option: SessionConfigOption; truncated: boolean; truncatedCount: number } {
  if (!isSessionConfigSelectOption(option)) {
    return {
      option: { ...option },
      truncated: false,
      truncatedCount: 0,
    };
  }

  // Flatten all options (including nested groups) with deduplication
  const flatOptions = flattenConfigOptionValues(option);
  const currentValue = getCurrentStringValue(option);

  // Reorder currentValue to front if it exists
  if (currentValue) {
    const currentIdx = flatOptions.findIndex(
      (opt) => opt.value === currentValue
    );
    if (currentIdx > 0) {
      const [removed] = flatOptions.splice(currentIdx, 1);
      if (removed) {
        flatOptions.unshift(removed);
      }
    }
  }

  // Truncate to maxVisible (currentValue at front is always preserved when maxVisible > 0)
  const wasTruncated = flatOptions.length > maxVisible;
  const truncCount = wasTruncated ? flatOptions.length - maxVisible : 0;
  const cappedOptions = wasTruncated
    ? flatOptions.slice(0, maxVisible)
    : flatOptions;

  // Build a cloned config option with the capped flat options
  const cloned: SessionConfigOption = {
    id: option.id,
    name: option.name,
    description: option.description,
    type: option.type,
    currentValue: currentValue ?? option.currentValue,
    category: option.category,
    options: cappedOptions,
  };

  return {
    option: cloned,
    truncated: wasTruncated,
    truncatedCount: truncCount,
  };
}

/**
 * Flattens all option values (including nested groups) into a deduplicated
 * flat array with normalized description (null-coalesced).
 */
function flattenConfigOptionValues(
  option: SessionConfigOption
): NormalizedConfigSelectOptionValue[] {
  if (!isSessionConfigSelectOption(option)) {
    return [];
  }

  const flatOptions: NormalizedConfigSelectOptionValue[] = [];
  const seen = new Set<string>();

  for (const item of option.options ?? []) {
    if (isConfigSelectGroup(item)) {
      for (const nested of item.options ?? []) {
        if (!hasNonEmptyString(nested.value) || seen.has(nested.value)) {
          continue;
        }
        seen.add(nested.value);
        flatOptions.push({
          value: nested.value,
          name: nested.name ?? nested.value,
          description: nested.description ?? null,
        });
      }
      continue;
    }

    if (!hasNonEmptyString(item.value) || seen.has(item.value)) {
      continue;
    }
    seen.add(item.value);
    flatOptions.push({
      value: item.value,
      name: item.name ?? item.value,
      description: item.description ?? null,
    });
  }

  return flatOptions;
}

/**
 * Caps model and config option lists to prevent excessive payload sizes,
 * preserving the currently selected model and config option.
 *
 * - Returns a **capped copy** — never mutates input arrays.
 * - If `currentModelId` is set and the model exists in the input list,
 *   it is always included (replaces the last item if beyond cap).
 * - For config options, ensures the option matching `currentValue` is retained.
 * - Flattens nested grouped model options in the returned capped copy.
 *
 * @param params - The capping parameters.
 * @returns The capped result with truncation metadata.
 */
export function capModelList(params: CapModelListParams): CapModelListResult {
  const maxVisible = params.maxVisible ?? DEFAULT_MAX_VISIBLE_MODEL_COUNT;

  // Normalize models input
  const inputModels = params.models ?? null;

  // Normalize configOptions input
  const inputConfigOptions = params.configOptions ?? null;

  // --- Cap models ---
  let resultModels: SessionModelState["availableModels"];
  let truncated = false;
  let truncatedCount = 0;

  if (!inputModels || inputModels.length === 0) {
    resultModels = [];
  } else if (inputModels.length <= maxVisible) {
    // No truncation needed — return a copy
    resultModels = inputModels.map((m) => ({ ...m }));
  } else {
    // Need to truncate
    truncated = true;
    truncatedCount = inputModels.length - maxVisible;

    // If currentModelId is set and present in the list, ensure it survives the cap
    const currentModelId = params.currentModelId ?? null;
    let currentModelIndex = -1;
    if (currentModelId) {
      currentModelIndex = inputModels.findIndex(
        (m) => m.modelId === currentModelId
      );
    }

    if (currentModelIndex >= 0 && currentModelIndex >= maxVisible) {
      // Current model is beyond cap boundary — replace the last item with it
      resultModels = inputModels
        .slice(0, maxVisible - 1)
        .map((m) => ({ ...m }));
      const cur = inputModels[currentModelIndex];
      if (cur) {
        resultModels.push({ ...cur });
      }
    } else {
      // Either no current model, or it's already within cap range
      resultModels = inputModels.slice(0, maxVisible).map((m) => ({ ...m }));
    }
  }

  // --- Cap configOptions ---
  // Cap model/mode config options: flatten nested groups, preserve currentValue
  // at front, and truncate to maxVisible. Internal server state stays uncapped.
  let resultConfigOptions: SessionConfigOption[];
  let configOptionsTruncated = false;

  if (!inputConfigOptions || inputConfigOptions.length === 0) {
    resultConfigOptions = [];
  } else {
    resultConfigOptions = inputConfigOptions.map((opt) => {
      if (
        opt.category === "mode" ||
        opt.category === "model" ||
        opt.id === "mode" ||
        opt.id === "model"
      ) {
        const result = capConfigOption(opt, maxVisible);
        if (result.truncated) {
          configOptionsTruncated = true;
        }
        return result.option;
      }
      // For other config options, return a shallow copy
      return { ...opt };
    });
  }

  // Set truncated flag if either models or configOptions were truncated
  if (configOptionsTruncated) {
    truncated = true;
  }

  return {
    models: resultModels,
    configOptions: resultConfigOptions,
    truncated,
    truncatedCount,
  };
}

export function capSessionSelectionState(
  params: CapSessionSelectionStateParams
): CapSessionSelectionStateResult {
  const capped = capModelList({
    models: params.models?.availableModels,
    configOptions: params.configOptions,
    currentModelId: params.models?.currentModelId,
    maxVisible: params.maxVisible,
  });
  const configOptions = params.stripAvailableModels
    ? capped.configOptions.filter(
        (option) =>
          !(option.category === "model" || option.id.toLowerCase() === "model")
      )
    : capped.configOptions;

  return {
    models: params.models
      ? {
          ...params.models,
          availableModels: params.stripAvailableModels ? [] : capped.models,
        }
      : params.models,
    configOptions,
    truncated: capped.truncated,
    truncatedCount: capped.truncatedCount,
  };
}

function collectConfigOptionValues(
  option: SessionConfigOption
): NormalizedConfigSelectOptionValue[] {
  if (!isSessionConfigSelectOption(option)) {
    return [];
  }

  const values: NormalizedConfigSelectOptionValue[] = [];
  const seen = new Set<string>();

  for (const item of option.options ?? []) {
    if (isConfigSelectGroup(item)) {
      for (const nested of item.options ?? []) {
        if (!hasNonEmptyString(nested.value)) {
          continue;
        }
        if (seen.has(nested.value)) {
          continue;
        }
        seen.add(nested.value);
        values.push({
          value: nested.value,
          name: nested.name ?? nested.value,
          description: nested.description,
        });
      }
      continue;
    }

    if (!hasNonEmptyString(item.value)) {
      continue;
    }
    if (seen.has(item.value)) {
      continue;
    }
    seen.add(item.value);
    values.push({
      value: item.value,
      name: item.name ?? item.value,
      description: item.description,
    });
  }

  return values;
}

export function getSessionConfigOptionValues(
  option: SessionConfigOption | undefined
): SessionConfigOptionValue[] {
  if (!option) {
    return [];
  }
  return collectConfigOptionValues(option);
}

export function hasSessionConfigOptionValue(params: {
  option: SessionConfigOption | undefined;
  value: string;
}): boolean {
  if (!hasNonEmptyString(params.value)) {
    return false;
  }
  return getSessionConfigOptionValues(params.option).some(
    (candidate) => candidate.value === params.value
  );
}

export function getSessionConfigOptionCurrentValue(params: {
  configOptions: SessionConfigOption[] | null | undefined;
  target: "mode" | "model";
}): string | undefined {
  const option = findSessionConfigOption(params.configOptions, params.target);
  const currentValue = getCurrentStringValue(option);
  if (!currentValue) {
    return undefined;
  }
  return currentValue;
}

export function findSessionConfigOption(
  configOptions: SessionConfigOption[] | null | undefined,
  target: "mode" | "model"
): SessionConfigOption | undefined {
  if (!configOptions || configOptions.length === 0) {
    return undefined;
  }
  return (
    configOptions.find((option) => option.category === target) ??
    configOptions.find((option) => option.id === target)
  );
}

function deriveModeState(
  modeOption: SessionConfigOption | undefined,
  existingModes: SessionModeState | undefined
): SessionModeState | undefined {
  const currentValue = getCurrentStringValue(modeOption);
  if (!(modeOption && currentValue)) {
    return existingModes;
  }

  const modeValues = collectConfigOptionValues(modeOption);
  const nextAvailableModes =
    modeValues.length > 0
      ? modeValues.map((option) => ({
          id: option.value,
          name: hasNonEmptyString(option.name) ? option.name : option.value,
          description: option.description ?? undefined,
        }))
      : (existingModes?.availableModes ?? []);

  return {
    currentModeId: currentValue,
    availableModes: nextAvailableModes,
  };
}

function deriveModelState(
  modelOption: SessionConfigOption | undefined,
  existingModels: SessionModelState | undefined
): SessionModelState | undefined {
  const currentValue = getCurrentStringValue(modelOption);
  if (!(modelOption && currentValue)) {
    return existingModels;
  }

  const modelValues = collectConfigOptionValues(modelOption);
  const nextAvailableModels =
    modelValues.length > 0
      ? modelValues.map((option) => ({
          modelId: option.value,
          name: hasNonEmptyString(option.name) ? option.name : option.value,
          description: option.description ?? undefined,
        }))
      : (existingModels?.availableModels ?? []);

  return {
    currentModelId: currentValue,
    availableModels: nextAvailableModels,
  };
}

export function syncSessionSelectionFromConfigOptions(
  target: SessionSelectionTarget
): SessionSelectionSyncResult {
  const modeOption = findSessionConfigOption(target.configOptions, "mode");
  const modelOption = findSessionConfigOption(target.configOptions, "model");

  const previousModeId = target.modes?.currentModeId;
  const previousModelId = target.models?.currentModelId;

  const nextModes = deriveModeState(modeOption, target.modes);
  const nextModels = deriveModelState(modelOption, target.models);

  if (nextModes) {
    target.modes = nextModes;
  }
  if (nextModels) {
    target.models = nextModels;
  }

  const modeId = nextModes?.currentModeId;
  const modelId = nextModels?.currentModelId;

  return {
    modeId,
    modelId,
    modeChanged:
      typeof modeId === "string" &&
      modeId.length > 0 &&
      modeId !== previousModeId,
    modelChanged:
      typeof modelId === "string" &&
      modelId.length > 0 &&
      modelId !== previousModelId,
  };
}

export function updateSessionConfigOptionCurrentValue(params: {
  configOptions: SessionConfigOption[] | null | undefined;
  target: "mode" | "model";
  value: string;
}): boolean {
  const option = findSessionConfigOption(params.configOptions, params.target);
  if (
    !(
      option &&
      isSessionConfigSelectOption(option) &&
      hasNonEmptyString(params.value)
    )
  ) {
    return false;
  }
  if (option.currentValue === params.value) {
    return false;
  }
  option.currentValue = params.value;
  return true;
}
