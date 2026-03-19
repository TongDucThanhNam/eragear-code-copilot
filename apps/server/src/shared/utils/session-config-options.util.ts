import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@/shared/types/session.types";

interface SessionConfigSelectOptionValue {
  value?: string;
  name?: string;
  description?: string | null;
}

interface NormalizedConfigSelectOptionValue {
  value: string;
  name?: string;
  description?: string | null;
}

interface SessionConfigSelectGroupValue {
  options?: SessionConfigSelectOptionValue[];
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

function isConfigSelectGroup(
  value: SessionConfigSelectOptionValue | SessionConfigSelectGroupValue
): value is SessionConfigSelectGroupValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as SessionConfigSelectGroupValue).options)
  );
}

function hasNonEmptyString(
  value: string | null | undefined
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function collectConfigOptionValues(
  option: SessionConfigOption
): NormalizedConfigSelectOptionValue[] {
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
          name: nested.name,
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
      name: item.name,
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
  if (!option || !hasNonEmptyString(option.currentValue)) {
    return undefined;
  }
  return option.currentValue;
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
  if (!modeOption || !hasNonEmptyString(modeOption.currentValue)) {
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
    currentModeId: modeOption.currentValue,
    availableModes: nextAvailableModes,
  };
}

function deriveModelState(
  modelOption: SessionConfigOption | undefined,
  existingModels: SessionModelState | undefined
): SessionModelState | undefined {
  if (!modelOption || !hasNonEmptyString(modelOption.currentValue)) {
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
    currentModelId: modelOption.currentValue,
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
  if (!(option && hasNonEmptyString(params.value))) {
    return false;
  }
  if (option.currentValue === params.value) {
    return false;
  }
  option.currentValue = params.value;
  return true;
}
