import {
  AgentTypeSchema,
  type CreateAgentInput,
  CreateAgentInputSchema,
  type UpdateAgentInput,
  UpdateAgentInputSchema,
} from "@/modules/agent";
import { parseArgsInput } from "../../../shared/utils/cli-args.util";

export type AgentRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: string };

const AGENT_TYPES = AgentTypeSchema.options;
const AGENT_TYPE_SET = new Set<string>(AGENT_TYPES);
const AGENT_TYPE_ERROR = `type must be one of: ${AGENT_TYPES.join(", ")}`;

interface AgentRoutePayload {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is AgentRoutePayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentType(value: unknown): value is CreateAgentInput["type"] {
  return typeof value === "string" && AGENT_TYPE_SET.has(value);
}

function resolveAgentArgs(input: {
  args?: unknown;
  argsInput?: unknown;
}): AgentRouteInputResult<string[] | undefined> {
  if (Array.isArray(input.args)) {
    if (input.args.every((item) => typeof item === "string")) {
      return { ok: true, input: input.args };
    }
    return { ok: false, error: "args must be an array of strings" };
  }
  if (typeof input.argsInput !== "string" || input.argsInput.length === 0) {
    return { ok: true, input: undefined };
  }
  const parsed = parseArgsInput(input.argsInput);
  if (parsed.error) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, input: parsed.args };
}

function firstSchemaError(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues[0]?.message ?? "Invalid agent payload";
}

export function parseCreateAgentRouteInput(
  payload: unknown
): AgentRouteInputResult<CreateAgentInput> {
  if (!isRecord(payload)) {
    return { ok: false, error: "name, type, and command are required" };
  }
  if (
    !(
      typeof payload.name === "string" &&
      payload.name.length > 0 &&
      payload.type &&
      typeof payload.command === "string" &&
      payload.command.length > 0
    )
  ) {
    return { ok: false, error: "name, type, and command are required" };
  }
  if (!isAgentType(payload.type)) {
    return { ok: false, error: AGENT_TYPE_ERROR };
  }
  const args = resolveAgentArgs({
    args: payload.args,
    argsInput: payload.argsInput,
  });
  if (!args.ok) {
    return args;
  }

  const parsed = CreateAgentInputSchema.safeParse({
    name: payload.name,
    type: payload.type,
    command: payload.command,
    args: args.input,
    resumeCommandTemplate: payload.resumeCommandTemplate,
    env: payload.env,
    projectId: payload.projectId,
  });
  if (!parsed.success) {
    return { ok: false, error: firstSchemaError(parsed.error) };
  }
  return { ok: true, input: parsed.data };
}

export function parseUpdateAgentRouteInput(
  payload: unknown
): AgentRouteInputResult<UpdateAgentInput> {
  if (!isRecord(payload) || typeof payload.id !== "string" || !payload.id) {
    return { ok: false, error: "id is required" };
  }
  if (payload.type !== undefined && !isAgentType(payload.type)) {
    return { ok: false, error: AGENT_TYPE_ERROR };
  }
  const args = resolveAgentArgs({
    args: payload.args,
    argsInput: payload.argsInput,
  });
  if (!args.ok) {
    return args;
  }

  const parsed = UpdateAgentInputSchema.safeParse({
    id: payload.id,
    name: payload.name,
    type: payload.type,
    command: payload.command,
    args: args.input,
    resumeCommandTemplate: payload.resumeCommandTemplate,
    env: payload.env,
    projectId: payload.projectId,
  });
  if (!parsed.success) {
    return { ok: false, error: firstSchemaError(parsed.error) };
  }
  return { ok: true, input: parsed.data };
}

export function parseDeleteAgentRouteInput(
  payload: unknown
): AgentRouteInputResult<{ agentId: string }> {
  if (!isRecord(payload) || typeof payload.agentId !== "string") {
    return { ok: false, error: "agentId is required" };
  }
  if (payload.agentId.length === 0) {
    return { ok: false, error: "agentId is required" };
  }
  return { ok: true, input: { agentId: payload.agentId } };
}
