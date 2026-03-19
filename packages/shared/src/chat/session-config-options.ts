import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "./types";

interface SessionConfigSelectOptionValue {
  value?: string;
  name?: string;
  description?: string | null;
}

interface SessionConfigSelectGroupValue {
  options?: SessionConfigSelectOptionValue[];
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
): SessionConfigOptionValue[] {
  const values: SessionConfigOptionValue[] = [];
  const seen = new Set<string>();

  for (const item of option.options ?? []) {
    if (isConfigSelectGroup(item)) {
      for (const nested of item.options ?? []) {
        if (!hasNonEmptyString(nested.value) || seen.has(nested.value)) {
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

    if (!hasNonEmptyString(item.value) || seen.has(item.value)) {
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

function deriveModeState(
  modeOption: SessionConfigOption | undefined,
  fallbackModes: SessionModeState | null | undefined
): SessionModeState | null {
  if (!modeOption || !hasNonEmptyString(modeOption.currentValue)) {
    return fallbackModes ?? null;
  }

  const modeValues = collectConfigOptionValues(modeOption);
  const availableModes =
    modeValues.length > 0
      ? modeValues.map((option) => ({
          id: option.value,
          name: hasNonEmptyString(option.name) ? option.name : option.value,
          description: option.description ?? undefined,
        }))
      : (fallbackModes?.availableModes ?? []);

  return {
    currentModeId: modeOption.currentValue,
    availableModes,
  };
}

function deriveModelState(
  modelOption: SessionConfigOption | undefined,
  fallbackModels: SessionModelState | null | undefined
): SessionModelState | null {
  if (!modelOption || !hasNonEmptyString(modelOption.currentValue)) {
    return fallbackModels ?? null;
  }

  const modelValues = collectConfigOptionValues(modelOption);
  const availableModels =
    modelValues.length > 0
      ? modelValues.map((option) => ({
          modelId: option.value,
          name: hasNonEmptyString(option.name) ? option.name : option.value,
          description: option.description ?? undefined,
        }))
      : (fallbackModels?.availableModels ?? []);

  return {
    currentModelId: modelOption.currentValue,
    availableModels,
  };
}

export function resolveSessionSelectionState(params: {
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
}): {
  modes: SessionModeState | null;
  models: SessionModelState | null;
} {
  return {
    modes: deriveModeState(
      findSessionConfigOption(params.configOptions, "mode"),
      params.modes
    ),
    models: deriveModelState(
      findSessionConfigOption(params.configOptions, "model"),
      params.models
    ),
  };
}

export function updateSessionConfigOptionCurrentValue(params: {
  configOptions: SessionConfigOption[] | null | undefined;
  target: "mode" | "model";
  value: string;
}): SessionConfigOption[] | null | undefined {
  if (!hasNonEmptyString(params.value) || !params.configOptions) {
    return params.configOptions;
  }
  const optionIndex = params.configOptions.findIndex((candidate) => {
    return (
      candidate.category === params.target || candidate.id === params.target
    );
  });
  if (optionIndex < 0) {
    return params.configOptions;
  }
  const currentOption = params.configOptions[optionIndex];
  if (!currentOption || currentOption.currentValue === params.value) {
    return params.configOptions;
  }
  const nextConfigOptions = [...params.configOptions];
  nextConfigOptions[optionIndex] = {
    ...currentOption,
    currentValue: params.value,
  };
  return nextConfigOptions;
}
