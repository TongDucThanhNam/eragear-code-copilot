import type { MessagePart } from "@/store/chat-store";

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

export function getPartKey(part: MessagePart, index: number): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return `${part.type}-${part.text.slice(0, 30)}`;
    case "tool_call":
    case "tool_result":
      return `${part.type}-${part.toolCallId}`;
    case "plan":
      return `${part.type}-${part.items.length}-${part.items[0]?.content.slice(0, 20) ?? "empty"}`;
    case "diff":
      return `${part.type}-${part.path}`;
    case "terminal":
      return `${part.type}-${part.terminalId}`;
    default: {
      const _exhaustive: never = part;
      return `${_exhaustive}-${index}`;
    }
  }
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
