import type {
  RuntimeDiagnostics,
  RuntimeEndpoint,
  RuntimeHealth,
  RuntimeHealthState,
  RuntimeChildProcessState,
  RuntimeHost,
} from "@repo/shared";
import {
  type AppComposition,
  createAppCompositionFromSettings,
} from "@/bootstrap/composition";
import type { ServerRuntimePolicy } from "@/bootstrap/server-runtime-policy";
import { resolveAgentCliAvailability } from "./agent-cli-diagnostics";
import { createRuntimeCapabilityRegistrySnapshot } from "./capability-registry";

export interface RuntimeCore extends RuntimeHost {
  readonly composition: AppComposition;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function createEndpoint(policy: ServerRuntimePolicy): RuntimeEndpoint {
  return {
    kind: "remote-http",
    runtimeUrl: `ws://${policy.wsHost}:${policy.wsPort}`,
    healthUrl: `http://${policy.wsHost}:${policy.wsPort}/api/health`,
    host: policy.wsHost,
    port: policy.wsPort,
    boundToLoopback: isLoopbackHost(policy.wsHost),
    networkExposed: true,
    description: "Server/remote compatibility HTTP, tRPC, and WebSocket host.",
  };
}

function toChildProcessStatus(
  state: RuntimeHealthState
): RuntimeChildProcessState {
  if (state === "ready") {
    return "running";
  }
  if (state === "degraded") {
    return "running";
  }
  return state;
}

class AppRuntimeCore implements RuntimeCore {
  readonly composition: AppComposition;
  private state: RuntimeHealthState = "not-started";
  private readonly messages: string[] = [];
  private startedAt: string | undefined;
  private stoppedAt: string | undefined;
  private startPromise: Promise<RuntimeDiagnostics> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(composition: AppComposition) {
    this.composition = composition;
  }

  start(): Promise<RuntimeDiagnostics> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      if (this.state === "ready") {
        return await this.diagnostics();
      }

      this.state = "starting";
      this.startedAt = new Date().toISOString();
      try {
        await this.composition.deps.lifecycle.prepareStartup();
        this.composition.deps.lifecycle.startBackground();
        this.state = "ready";
        this.messages.push("Runtime core started.");
        return await this.diagnostics();
      } catch (error) {
        this.state = "error";
        this.messages.push(
          `Runtime core startup failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        throw error;
      }
    })();

    return this.startPromise;
  }

  async stop(signal: string = "SIGTERM"): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (this.state === "stopped") {
      return;
    }

    this.state = "stopping";
    this.stopPromise = (async () => {
      try {
        const shutdownSignal = signal === "SIGINT" ? "SIGINT" : "SIGTERM";
        await this.composition.deps.lifecycle.shutdown(shutdownSignal);
        await this.composition.dispose();
        await this.composition.deps.logStore.flush();
        this.state = "stopped";
        this.stoppedAt = new Date().toISOString();
        this.messages.push("Runtime core stopped.");
      } catch (error) {
        this.state = "error";
        this.messages.push(
          `Runtime core shutdown failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        throw error;
      }
    })();

    return this.stopPromise;
  }

  health(): RuntimeHealth {
    const ready = this.state === "ready";
    return {
      state: this.state,
      ready,
      checkedAt: new Date().toISOString(),
      message: ready ? "Runtime core is ready." : `Runtime core is ${this.state}.`,
    };
  }

  async diagnostics(): Promise<RuntimeDiagnostics> {
    const policy = this.composition.runtimePolicy;
    const cliAvailability = await resolveAgentCliAvailability();
    return {
      mode: "server",
      endpoint: createEndpoint(policy),
      health: this.health(),
      childProcess: {
        role: "server-process",
        status: toChildProcessStatus(this.state),
        pid: process.pid,
        ...(this.startedAt ? { startedAt: this.startedAt } : {}),
        ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
      },
      cliAvailability,
      capabilityRegistry:
        createRuntimeCapabilityRegistrySnapshot(cliAvailability),
      messages: [...this.messages],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function createRuntimeCoreFromSettings(): Promise<RuntimeCore> {
  const composition = await createAppCompositionFromSettings();
  return new AppRuntimeCore(composition);
}
