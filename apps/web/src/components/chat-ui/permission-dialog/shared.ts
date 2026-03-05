import type { PermissionOption, PermissionOptions } from "@repo/shared";

interface NormalizedOption {
  id: string;
  label: string;
  description?: string;
  intent: PermissionIntent | "neutral";
}

const TITLE_PREVIEW_MAX_CHARS = 180;
type PermissionIntent = "allow" | "reject";

const ALLOW_KEYWORDS = [
  "allow",
  "approve",
  "approved",
  "accept",
  "accepted",
  "grant",
  "granted",
  "yes",
  "ok",
];

const REJECT_KEYWORDS = [
  "reject",
  "rejected",
  "deny",
  "denied",
  "block",
  "blocked",
  "cancel",
  "cancelled",
  "decline",
  "declined",
  "disallow",
  "no",
];

const normalizeToken = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
};

const tokenize = (value: string): string[] => {
  if (value.length === 0) {
    return [];
  }
  const words = value.split(/[^a-z0-9]+/).filter((part) => part.length > 0);
  return [value, ...words];
};

const includesKeyword = (value: string, keywords: readonly string[]) => {
  const tokens = tokenize(normalizeToken(value));
  return keywords.some((keyword) => tokens.includes(keyword));
};

const inferIntentFromKind = (kind?: string): PermissionIntent | null => {
  const normalizedKind = normalizeToken(kind);
  if (normalizedKind.startsWith("allow_")) {
    return "allow";
  }
  if (normalizedKind.startsWith("reject_")) {
    return "reject";
  }
  return null;
};

const inferIntentFromOption = (
  option: PermissionOption
): PermissionIntent | null => {
  const kindIntent = inferIntentFromKind(option.kind);
  if (kindIntent) {
    return kindIntent;
  }

  const values = [option.optionId, option.id, option.name, option.label]
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeToken(value))
    .filter((value) => value.length > 0);
  for (const value of values) {
    if (includesKeyword(value, REJECT_KEYWORDS)) {
      return "reject";
    }
    if (includesKeyword(value, ALLOW_KEYWORDS)) {
      return "allow";
    }
  }

  return null;
};

function formatTitlePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= TITLE_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, TITLE_PREVIEW_MAX_CHARS)}...`;
}

function normalizePermissionOptions(
  options?: PermissionOptions
): NormalizedOption[] {
  const list = Array.isArray(options) ? options : (options?.options ?? []);
  return list.map((option: PermissionOption, index: number) => {
    const optionIntent = inferIntentFromOption(option);

    const optionId =
      option.optionId ?? option.id ?? option.kind ?? `option-${index + 1}`;
    const label =
      option.label ??
      option.name ??
      option.optionId ??
      option.id ??
      option.kind ??
      "Option";
    return {
      id: String(optionId),
      label: String(label),
      description: option.description,
      intent: optionIntent ?? "neutral",
    };
  });
}

function formatInput(input: unknown) {
  if (input === undefined) {
    return null;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export type { NormalizedOption, PermissionIntent };
export { formatInput, formatTitlePreview, normalizePermissionOptions };
