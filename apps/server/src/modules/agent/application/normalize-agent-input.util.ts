import { ValidationError } from "@/shared/errors";
import type { AgentInput, AgentUpdateInput } from "@/shared/types/agent.types";
import { parseCommandInput } from "@/shared/utils/cli-args.util";

const MODULE = "agent";

function normalizeCommandAndArgs(
  command: string,
  op: string,
  args?: string[]
): { command: string; args?: string[] } {
  const parsed = parseCommandInput(command);
  if (parsed.error || !parsed.command) {
    throw new ValidationError(parsed.error ?? "Command is required.", {
      module: MODULE,
      op,
      details: { command },
    });
  }
  const mergedArgs = [...(parsed.args ?? [])];
  if (args?.length) {
    mergedArgs.push(...args);
  }
  return {
    command: parsed.command,
    args: mergedArgs.length > 0 ? mergedArgs : undefined,
  };
}

export function normalizeAgentInput(input: AgentInput, op: string): AgentInput {
  const normalized = normalizeCommandAndArgs(input.command, op, input.args);
  return {
    ...input,
    command: normalized.command,
    args: normalized.args,
  };
}

export function normalizeAgentUpdateInput(
  input: AgentUpdateInput,
  op: string
): AgentUpdateInput {
  if (!input.command) {
    return input;
  }
  const normalized = normalizeCommandAndArgs(input.command, op, input.args);
  return {
    ...input,
    command: normalized.command,
    args: normalized.args,
  };
}
