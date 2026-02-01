import type { ToolUIPart, UIMessagePart } from "@repo/shared";

// Inline helper if not exists
export const cn_inline = (...classes: (string | undefined)[]) =>
  classes.filter(Boolean).join(" ");

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

export function getPartKey(part: UIMessagePart, index: number): string {
  if (part.type === "text" || part.type === "reasoning") {
    return `${part.type}-${part.text.slice(0, 30)}`;
  }
  if (part.type === "source-url") {
    return `${part.type}-${part.url}`;
  }
  if (part.type === "source-document") {
    return `${part.type}-${part.sourceId}`;
  }
  if (part.type === "file") {
    return `${part.type}-${part.url ?? part.filename ?? index}`;
  }
  if (part.type === "step-start") {
    return `${part.type}-${index}`;
  }
  if (part.type.startsWith("data-")) {
    return `${part.type}-${part.id ?? index}`;
  }
  if (part.type.startsWith("tool-")) {
    return `${part.type}-${(part as ToolUIPart).toolCallId}`;
  }
  return `${part.type}-${index}`;
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
