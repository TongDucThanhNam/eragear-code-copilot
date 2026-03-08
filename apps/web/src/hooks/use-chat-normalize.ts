import type {
  AgentInfo,
  BroadcastEvent,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
  SessionStateData,
  UIMessage,
} from "@repo/shared";
import {
  parseBroadcastEventClientSafe,
  parseUiMessageArrayClientSafe,
  parseUiMessageClientSafe,
} from "@repo/shared";

type RawAgentInfo = {
  name?: string;
  title?: string;
  version?: string;
} | null;

type RawSessionStateData = Omit<
  SessionStateData,
  | "modes"
  | "models"
  | "commands"
  | "configOptions"
  | "sessionInfo"
  | "agentInfo"
> & {
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
  commands?: SessionStateData["commands"] | null;
  configOptions?: SessionConfigOption[] | null;
  sessionInfo?: SessionInfo | null;
  agentInfo?: RawAgentInfo;
};

export const normalizeMessage = (message: unknown): UIMessage => {
  const parsed = parseUiMessageClientSafe(message);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

export const normalizeMessages = (messages: unknown): UIMessage[] => {
  const parsed = parseUiMessageArrayClientSafe(messages);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

const normalizeAgentInfo = (
  agentInfo: RawAgentInfo | undefined
): AgentInfo | null | undefined => {
  if (agentInfo === undefined) {
    return undefined;
  }
  if (agentInfo === null) {
    return null;
  }
  if (
    typeof agentInfo.name !== "string" ||
    typeof agentInfo.version !== "string"
  ) {
    return null;
  }
  return {
    name: agentInfo.name,
    version: agentInfo.version,
    ...(typeof agentInfo.title === "string" ? { title: agentInfo.title } : {}),
  };
};

export const normalizeSessionStateData = (
  data: RawSessionStateData
): SessionStateData => {
  const { agentInfo: rawAgentInfo, ...rest } = data;
  const normalized: SessionStateData = {
    ...rest,
    modes: data.modes ?? undefined,
    models: data.models ?? undefined,
    commands: data.commands ?? undefined,
    configOptions: data.configOptions ?? undefined,
    sessionInfo: data.sessionInfo ?? null,
  };

  const agentInfo = normalizeAgentInfo(rawAgentInfo);
  if (agentInfo !== undefined) {
    normalized.agentInfo = agentInfo;
  }

  return normalized;
};

export type ParseBroadcastEventResult =
  | { status: "ok"; event: BroadcastEvent }
  | { status: "ignored_unknown_event"; error: string }
  | { status: "invalid_payload"; error: string };

export const parseBroadcastEvent = (
  event: unknown
): ParseBroadcastEventResult => {
  const parsed = parseBroadcastEventClientSafe(event);
  if (parsed.ok) {
    return { status: "ok", event: parsed.value };
  }
  if (parsed.kind === "unknown_event") {
    return { status: "ignored_unknown_event", error: parsed.error };
  }
  return { status: "invalid_payload", error: parsed.error };
};
