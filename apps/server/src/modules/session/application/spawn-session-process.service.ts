import type { ChatSession } from "@/shared/types/session.types";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";

export interface SpawnSessionProcessInput {
  projectRoot: string;
  agentCommand: string;
  agentArgs: string[];
  agentEnv: Record<string, string>;
}

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
