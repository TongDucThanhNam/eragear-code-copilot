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
  parseBroadcastEventStrict,
  parseUiMessageArrayStrict,
  parseUiMessageStrict,
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

export function shouldLogChatStreamDebug(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const debugFlag = (
    window as typeof window & {
      __ERAGEAR_CHAT_DEBUG__?: boolean;
    }
  ).__ERAGEAR_CHAT_DEBUG__;
  if (typeof debugFlag === "boolean") {
    return debugFlag;
  }
  return import.meta.env.DEV;
}

export const normalizeMessage = (message: unknown): UIMessage => {
  const parsed = parseUiMessageStrict(message);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

export const normalizeMessages = (messages: unknown): UIMessage[] => {
  const parsed = parseUiMessageArrayStrict(messages);
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

export const parseBroadcastEvent = (event: unknown): BroadcastEvent => {
  const parsed = parseBroadcastEventStrict(event);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};
