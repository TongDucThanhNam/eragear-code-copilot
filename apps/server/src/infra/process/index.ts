// Process runtime adapter

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { AgentRuntimePort } from "../../shared/types/ports";
import { createAcpConnectionAdapter } from "../acp/connection";

export class AgentRuntimeAdapter implements AgentRuntimePort {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> }
  ): ChildProcess {
    return spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...options.env },
    });
  }

  createAcpConnection(proc: ChildProcess, handlers: any) {
    return createAcpConnectionAdapter(proc, handlers);
  }
}
