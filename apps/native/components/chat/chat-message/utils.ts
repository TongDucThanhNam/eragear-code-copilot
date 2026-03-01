import type { DataUIPart, ToolUIPart, UIMessagePart } from "@repo/shared";

// Inline helper if not exists
export const cn_inline = (
  ...classes: Array<string | false | null | undefined>
) =>
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
  const keySuffix = `-${index}`;

  if (part.type === "text" || part.type === "reasoning") {
    return `${part.type}-${part.text.slice(0, 30)}${keySuffix}`;
  }
  if (part.type === "source-url") {
    return `${part.type}-${part.url}${keySuffix}`;
  }
  if (part.type === "source-document") {
    return `${part.type}-${part.sourceId}${keySuffix}`;
  }
  if (part.type === "file") {
    return `${part.type}-${part.url ?? part.filename ?? "file"}${keySuffix}`;
  }
  if (part.type === "step-start") {
    return `${part.type}${keySuffix}`;
  }
  if (part.type.startsWith("data-")) {
    const dataPart = part as DataUIPart;
    return `${part.type}-${dataPart.id ?? "data"}${keySuffix}`;
  }
  if (part.type.startsWith("tool-")) {
    return `${part.type}-${(part as ToolUIPart).toolCallId}${keySuffix}`;
  }
  return `${part.type}${keySuffix}`;
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
