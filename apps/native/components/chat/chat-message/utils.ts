import type { ToolUIPart, UIMessagePart } from "@repo/shared";

// Inline helper if not exists
export const cn_inline = (
  ...classes: Array<string | false | null | undefined>
) => classes.filter(Boolean).join(" ");

// Terminal output detection patterns (defined at module level for performance)
const TERMINAL_PATTERNS = [
  /^\$ /mu, // Command prompt
  /^(?:npm|yarn|pnpm|bun|node|python|git|docker) /mu, // Common CLI prompts
  /\n(?:error|warning|info|success):/imu, // Log prefixes
  /\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[a-zA-Z0-9_./-]*)?(?::\d+)?(?::\d+)?/u,
] as const;

export function isTerminalOutput(output: unknown): boolean {
  if (typeof output !== "string") {
    return false;
  }
  return TERMINAL_PATTERNS.some((pattern) => pattern.test(output));
}

/**
 * Generate a stable key for a message part.
 *
 * Uses the same strategy as the web client:
 * - tool parts: keyed by toolCallId (stable across re-renders)
 * - source parts: keyed by sourceId
 * - file parts: keyed by url
 * - text/reasoning: keyed by index (position-stable)
 */
export function getPartKey(part: UIMessagePart, index: number): string {
  if (part.type.startsWith("tool-")) {
    return `tool-${(part as ToolUIPart).toolCallId}`;
  }
  if (part.type === "source-url" || part.type === "source-document") {
    return `source-${part.sourceId}`;
  }
  if (part.type === "file") {
    return `file-${part.url}`;
  }
  if (part.type === "reasoning") {
    return `reasoning-${index}`;
  }
  if (part.type === "text") {
    return `text-${index}`;
  }
  return `part-${index}`;
}

/**
 * Wrap getPartKey with deduplication. If two parts in the same list
 * produce the same base key, append a suffix to disambiguate.
 */
export function deduplicateKeys(
  items: UIMessagePart[],
  keyFn: (part: UIMessagePart, index: number) => string = getPartKey
): string[] {
  const seen = new Map<string, number>();
  return items.map((item, index) => {
    const base = keyFn(item, index);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count > 0 ? `${base}__${count}` : base;
  });
}

export function getPlanStatusIcon(status: string): string {
  if (status === "completed") {
    return "✓";
  }
  if (status === "in_progress") {
    return "►";
  }
  return "○";
}
