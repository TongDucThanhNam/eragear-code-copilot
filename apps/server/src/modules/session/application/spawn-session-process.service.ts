import type { ChatSession } from "@/shared/types/session.types";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";

/**
 * Process spawn request for an agent runtime.
 *
 * Invariant: `projectRoot` has already been validated by the project context
 * resolver and is safe to use as the child process cwd.
 */
export interface SpawnSessionProcessInput {
  projectRoot: string;
  agentCommand: string;
  agentArgs: string[];
  agentEnv: Record<string, string>;
}

/**
 * Starts the concrete agent process through the runtime adapter.
 *
 * Side effect: delegates cwd/env-sensitive process creation to
 * `AgentRuntimePort`; callers are responsible for attaching lifecycle handlers.
 */
export class SpawnSessionProcessService {
  private readonly agentRuntime: AgentRuntimePort;

  constructor(agentRuntime: AgentRuntimePort) {
    this.agentRuntime = agentRuntime;
  }

  execute(input: SpawnSessionProcessInput): ChatSession["proc"] {
    return this.agentRuntime.spawn(input.agentCommand, input.agentArgs, {
      cwd: input.projectRoot,
      env: input.agentEnv,
    });
  }
}
