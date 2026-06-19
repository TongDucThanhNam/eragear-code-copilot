import type { AgentInfo } from "#runtime/shared/types/agent.types";
import type {
  ChatStatus,
  PromptCapabilities,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
} from "#runtime/shared/types/session.types";
import {
  capSessionSelectionState,
  shouldStripAvailableModelsForAgent,
} from "#runtime/shared/utils/session-config-options.util";

export interface SessionStartResult {
  id: string;
  sessionId?: string;
  sessionLoadMethod?: "new_session" | "session_load" | "unstable_resume";
  chatStatus: ChatStatus;
  modes?: SessionModeState;
  models?: SessionModelState | null;
  configOptions?: SessionConfigOption[] | null;
  sessionInfo?: SessionInfo | null;
  promptCapabilities?: PromptCapabilities;
  loadSessionSupported?: boolean;
  agentInfo?: AgentInfo | null;
}

export interface SessionStartResponse {
  chatId: string;
  sessionId?: string;
  sessionLoadMethod: SessionStartResult["sessionLoadMethod"] | null;
  chatStatus: ChatStatus;
  modes?: SessionModeState;
  models?: SessionModelState | null;
  configOptions: SessionConfigOption[] | null;
  sessionInfo: SessionInfo | null;
  promptCapabilities?: PromptCapabilities;
  loadSessionSupported: boolean;
  agentInfo: AgentInfo | null;
}

export interface SessionResumeSelectionState {
  models?: SessionModelState | null;
  configOptions?: SessionConfigOption[] | null;
}

function capSelectionForClient(input: {
  models?: SessionModelState | null;
  configOptions?: SessionConfigOption[] | null;
  agentInfo?: AgentInfo | null;
}): {
  models?: SessionModelState | null;
  configOptions: SessionConfigOption[] | null;
} {
  const capped = capSessionSelectionState({
    models: input.models,
    configOptions: input.configOptions,
    stripAvailableModels: shouldStripAvailableModelsForAgent(input.agentInfo),
  });
  return {
    models: capped.models,
    configOptions:
      input.configOptions === null || input.configOptions === undefined
        ? null
        : capped.configOptions,
  };
}

export function createSessionStartResponse(
  result: SessionStartResult
): SessionStartResponse {
  const selection = capSelectionForClient({
    models: result.models,
    configOptions: result.configOptions,
    agentInfo: result.agentInfo,
  });

  return {
    chatId: result.id,
    sessionId: result.sessionId,
    sessionLoadMethod: result.sessionLoadMethod ?? null,
    chatStatus: result.chatStatus,
    modes: result.modes,
    models: selection.models,
    configOptions: selection.configOptions,
    sessionInfo: result.sessionInfo ?? null,
    promptCapabilities: result.promptCapabilities,
    loadSessionSupported: result.loadSessionSupported ?? false,
    agentInfo: result.agentInfo ?? null,
  };
}

export function createSessionResumeResponse<
  Result extends {
    models?: SessionModelState | null;
    configOptions?: SessionConfigOption[] | null;
  },
>(
  result: Result,
  sessionState: SessionResumeSelectionState
): Omit<Result, "models" | "configOptions"> & SessionResumeSelectionState {
  return {
    ...result,
    models: sessionState.models,
    configOptions: sessionState.configOptions,
  };
}
