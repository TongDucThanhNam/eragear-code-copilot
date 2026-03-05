import type { SessionConfigOption } from "@repo/shared";
import type { RefObject } from "react";

const SLASH_COMMAND_RECENTS_STORAGE_KEY =
  "eragear.chat-input.recent-slash-commands";
const MAX_RECENT_SLASH_COMMANDS = 8;
const MAX_QUICK_SLASH_COMMANDS = 4;

export interface RenderableConfigValue {
  value: string;
  name: string;
  description?: string | null;
  groupLabel?: string;
}

export interface NormalizedConfigOption {
  id: string;
  name: string;
  category?: string | null;
  currentValue: string;
  values: RenderableConfigValue[];
}

type ChatInputModelLike = {
  provider?: string;
  providers?: string[];
};

export function normalizeRecentSlashCommandNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string" && !!item)
    .slice(0, MAX_RECENT_SLASH_COMMANDS);
}

export function parseRecentSlashCommandNames(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    return normalizeRecentSlashCommandNames(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function normalizeModelProviders(model: ChatInputModelLike): string[] {
  const candidates = [
    ...(Array.isArray(model.providers) ? model.providers : []),
    model.provider,
  ];
  const normalized = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const provider = candidate.trim().toLowerCase();
    if (!provider) {
      continue;
    }
    normalized.add(provider);
  }
  return [...normalized];
}

export function readRecentSlashCommandNames(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  return parseRecentSlashCommandNames(
    window.localStorage.getItem(SLASH_COMMAND_RECENTS_STORAGE_KEY)
  );
}

export function applySlashCommandSelection({
  commandName,
  setInput,
  textareaRef,
}: {
  commandName: string;
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const commandText = `/${commandName} `;
  setInput(commandText);

  const textarea = textareaRef.current;
  if (!textarea) {
    return;
  }

  textarea.focus();
  requestAnimationFrame(() => {
    const cursorPos = commandText.length;
    textarea.selectionStart = cursorPos;
    textarea.selectionEnd = cursorPos;
  });
}

export function findMentionTrigger(value: string, cursor: number) {
  const upToCursor = value.slice(0, cursor);
  const atIndex = upToCursor.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }

  const before = upToCursor.slice(0, atIndex);
  if (before.length > 0 && !/\s/.test(before.slice(-1))) {
    return null;
  }

  const query = upToCursor.slice(atIndex + 1);
  if (query.includes(" ") || query.includes("\n")) {
    return null;
  }

  return { start: atIndex, query };
}

export function normalizeConfigOptions(
  options: SessionConfigOption[]
): NormalizedConfigOption[] {
  const output: NormalizedConfigOption[] = [];

  for (const option of options) {
    if (option.type !== "select") {
      continue;
    }
    const values: RenderableConfigValue[] = [];
    for (const item of option.options) {
      if ("options" in item) {
        for (const nested of item.options) {
          values.push({
            value: nested.value,
            name: nested.name,
            description: nested.description,
            groupLabel: item.name,
          });
        }
        continue;
      }
      values.push({
        value: item.value,
        name: item.name,
        description: item.description,
      });
    }
    if (values.length === 0) {
      continue;
    }
    output.push({
      id: option.id,
      name: option.name,
      category: option.category,
      currentValue: option.currentValue,
      values,
    });
  }

  return output;
}

export {
  MAX_QUICK_SLASH_COMMANDS,
  MAX_RECENT_SLASH_COMMANDS,
  SLASH_COMMAND_RECENTS_STORAGE_KEY,
};
