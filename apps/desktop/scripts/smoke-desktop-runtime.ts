import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RuntimeSecurityPosture, RuntimeServiceOperation } from "@repo/shared";
import { DesktopRuntimeHost } from "../src/runtime-host.js";

interface ProjectSummary {
  id: string;
  name: string;
  path: string;
}

interface ProjectListResult {
  projects: ProjectSummary[];
  activeProjectId: string | null;
}

interface AgentSummary {
  id: string;
  name: string;
  type: string;
  command: string;
  args?: string[];
}

interface AgentListResult {
  agents: AgentSummary[];
  activeAgentId: string | null;
}

interface SessionCreateResult {
  chatId: string;
  sessionId?: string | null;
  chatStatus?: string;
}

interface SessionStateResult {
  status: string;
  chatStatus: string;
  models?: {
    currentModelId: string;
    availableModels: Array<{ modelId: string; name: string }>;
  } | null;
  agentInfo?: {
    name?: string;
    title?: string;
  } | null;
}

interface CapabilitySummary {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  sourcePath?: string;
}

interface CheckpointSessionAttribution {
  chatId: string;
  source: "active" | "stored" | "missing";
  status: string;
  messageCount: number;
  sessionId?: string;
  agentName?: string;
  activeTurnId?: string;
  lastCompletedTurnId?: string;
}

interface ProcessIsolationSummary {
  mode: "job-process-tree";
  processTreeKill: "available" | "best-effort";
  processTreeTerminated?: boolean;
  cwdScope: "project-root" | "temporary-sandbox";
  projectRootExposed: boolean;
}

interface LocalAdeSnapshot {
  projectRoot: string;
  sessions: {
    active: Array<{
      id: string;
      chatStatus: string;
      agentName?: string;
      subscriberCount?: number;
      pendingPermissions?: number;
      activeToolCalls?: number;
      pid?: number;
      model: {
        currentModelId: string | null;
        supportsSwitching: boolean;
        source: "config-option" | "models" | "none";
        availableModels: Array<{ modelId: string; name: string }>;
      };
    }>;
  };
  agents: {
    activeAgentId: string | null;
    items: Array<{
      id: string;
      name: string;
      type: string;
      command: string;
      args: string[];
      envKeys: string[];
      isActive: boolean;
    }>;
  };
  runtime: {
    defaultModel: string;
    defaultModelProviderId: string | null;
    defaultModelStatus: "not-set" | "selected" | "unverified";
    diagnostics: string[];
    background: {
      enabled: boolean;
      startedAt?: number;
      tickMs: number;
      tasks: Array<{
        name: string;
        intervalMs: number;
        timeoutMs: number;
        running: boolean;
        lastStartedAt?: number;
        lastFinishedAt?: number;
        lastDurationMs?: number;
        successCount: number;
        failureCount: number;
        lastError?: string;
        lastResult?: Record<string, string | number | boolean | null | undefined>;
      }>;
    } | null;
  };
  providers: Array<{
    id: string;
    status: string;
    cliStatus?: string;
    authStatus?: string;
    modelStatus?: string;
    version?: string;
    modelList?: string[];
    modelListSource?: "readiness-probe" | "fallback";
    selectedModel?: string;
    diagnostics?: string[];
    remediation?: string[];
  }>;
  mcp: {
    configPath: string;
    agentRouting: {
      status: "ready" | "attention" | "empty";
      injectableCount: number;
      conditionalCount: number;
      blockedCount: number;
      skippedCount: number;
      routes: Array<{
        serverId: string;
        serverName: string;
        transport: "stdio" | "sse" | "streamable-http";
        status: "injectable" | "conditional" | "blocked" | "skipped";
        reason: string;
        brokerMode: "stdio-proxy" | "native-agent-transport" | "none";
        requiresAgentCapability?: "http" | "sse";
        agentSupport: "not-required" | "required-at-session-start";
        agentInvocationCount: number;
        lastAgentInvocation?: {
          method: "tools/call" | "resources/read";
          target: string;
          status: "success" | "failed";
          resultText?: string;
          error?: string;
        };
        headerEnv: Array<{ header: string; envKey: string; present: boolean }>;
      }>;
      agentInvocationHistory: Array<{
        serverId: string;
        method: "tools/call" | "resources/read";
        target: string;
        status: "success" | "failed";
        resultText?: string;
        error?: string;
      }>;
      diagnostics: string[];
    };
    servers: Array<{
      id: string;
      name: string;
      transport: "stdio" | "sse" | "streamable-http";
      enabled: boolean;
      health: string;
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      trustedAt?: string;
      protocol: {
        status: string;
        toolsDiscovered: number;
        resourcesDiscovered: number;
      };
      remoteControls: {
        requestTimeoutMs: number;
        reconnectAttempts: number;
        notificationWatchMs: number;
        mode: "default" | "custom";
        diagnostics: string[];
      };
      headerEnv: Array<{ header: string; envKey: string; present: boolean }>;
      probe: {
        status: string;
        retryable: boolean;
        stepCount: number;
        failedStepCount: number;
        steps: Array<{
          step: string;
          status: string;
          latencyMs: number;
          detail?: string;
          error?: string;
        }>;
      };
      probeHistory: Array<{
        id: string;
        status: string;
        protocolStatus: string;
        durationMs: number;
        stepCount: number;
        failedStepCount: number;
        toolsDiscovered: number;
        resourcesDiscovered: number;
        steps: Array<{ step: string; status: string }>;
      }>;
      invocationHistory: Array<{
        method: "tools/call" | "resources/read";
        target: string;
        status: "success" | "failed";
        resultText: string;
        finishedAt: string;
        durationMs: number;
      }>;
      notificationHistory: Array<{
        source: "probe" | "invocation" | "monitor";
        method: string;
        payloadText: string;
        receivedAt: string;
        truncated: boolean;
      }>;
      notificationMonitorHistory: Array<{
        id: string;
        status: "success" | "failed" | "unsupported";
        durationMs: number;
        requestedDurationMs: number;
        reconnectCount: number;
        streamOpenCount: number;
        notificationCount: number;
        finishedAt: string;
        diagnostics: string[];
        notifications: Array<{
          source: "probe" | "invocation" | "monitor";
          method: string;
          payloadText: string;
          receivedAt: string;
          truncated: boolean;
        }>;
      }>;
      tools: Array<{ name: string }>;
      resources: Array<{ uri: string; name?: string }>;
    }>;
  };
  checkpoints: {
    items: Array<{
      id: string;
      patchBytes: number;
      restoreMode?: "reverse-patch" | "apply-patch";
      sessionAttributions: CheckpointSessionAttribution[];
      changedFiles: string[];
      partialRestores?: Array<{
        restoredAt: string;
        files: string[];
        resolution?: "restore" | "current" | "mixed";
        hunks?: Array<{ file: string; hunkIndex: number; header: string }>;
        hunkChoices?: Array<{
          file: string;
          hunkIndex: number;
          header: string;
          resolution: "restore" | "current";
        }>;
        safetyCheckpointId?: string;
      }>;
      conflictShelves?: Array<{
        shelvedAt: string;
        files: string[];
        shelfPath: string;
        reason: string;
      }>;
      safetyForCheckpointId?: string;
    }>;
  };
  changeTrust: {
    isGitRepo: boolean;
    changedFiles: string[];
  };
  capabilities: {
    capabilities: CapabilitySummary[];
  };
  commands: Array<{
    name: string;
    enabled: boolean;
    prompt: string;
    argumentHint?: string;
    sourcePath: string;
  }>;
  skills: Array<{
    name: string;
    enabled: boolean;
    prompt: string;
    sourcePath: string;
  }>;
  outputStyles: Array<{
    name: string;
    enabled: boolean;
    prompt: string;
    sourcePath: string;
  }>;
  acpActivity: {
    entries: Array<{
      id: string;
      message: string;
      chatId?: string;
      kind?: string;
      payloadBytes?: number;
      metadata: Record<string, string | number | boolean | null>;
    }>;
    correlations: Array<{
      key: string;
      label: string;
      eventCount: number;
      firstTimestamp: number;
      lastTimestamp: number;
      durationMs: number;
      latestMessage: string;
      latestLevel: string;
      chatId?: string;
      sessionId?: string;
      turnId?: string;
      levels: Record<string, number>;
      kinds: Record<string, number>;
    }>;
    timeline: {
      lanes: Array<{
        key: string;
        label: string;
        eventCount: number;
        firstTimestamp: number;
        lastTimestamp: number;
        durationMs: number;
        latestMessage: string;
        latestLevel: string;
        latestKind?: string;
        chatId?: string;
        sessionId?: string;
        source: string;
        levels: Record<string, number>;
        kinds: Record<string, number>;
      }>;
      frames: Array<{
        id: string;
        sequence: number;
        timestamp: number;
        offsetMs: number;
        deltaMs: number;
        laneKey: string;
        laneLabel: string;
        correlationKey: string;
        correlationLabel: string;
        message: string;
        chatId?: string;
        kind?: string;
        payloadBytes?: number;
        metadata: Record<string, string | number | boolean | null>;
      }>;
      transitions: Array<{
        sequence: number;
        timestamp: number;
        deltaMs: number;
        fromLaneKey: string;
        fromLaneLabel: string;
        toLaneKey: string;
        toLaneLabel: string;
        fromKind?: string;
        toKind?: string;
        fromChatId?: string;
        toChatId?: string;
      }>;
      spanMs: number;
      omittedFrames: number;
    };
    stream: {
      status: "idle" | "healthy" | "attention" | "stale";
      latestTimestamp?: number;
      latestAgeMs: number;
      staleAfterMs: number;
      heartbeatWindowMs: number;
      retryDelayMs: number;
      retryMaxAttempts: number;
      retryEligible: boolean;
      rootCount: number;
      correlatedFrameCount: number;
      orphanFrameCount: number;
      longestChainLength: number;
      maxSilenceMs: number;
      averageDeltaMs: number;
      gapThresholdMs: number;
      gaps: Array<{
        sequence: number;
        deltaMs: number;
        fromFrameId: string;
        toFrameId: string;
        fromKind?: string;
        toKind?: string;
        fromChatId?: string;
        toChatId?: string;
      }>;
      chains: Array<{
        key: string;
        label: string;
        eventCount: number;
        firstTimestamp: number;
        lastTimestamp: number;
        durationMs: number;
        latestMessage: string;
        latestLevel: string;
        chatId?: string;
        sessionId?: string;
        turnId?: string;
        levels: Record<string, number>;
        kinds: Record<string, number>;
      }>;
      diagnostics: string[];
    };
    stats: {
      total: number;
      chatCount: number;
      kinds: Record<string, number>;
    };
    replayPresets: Array<{
      id: string;
      name: string;
      chatId?: string;
      correlationKey?: string;
      kind?: string;
      limit: number;
      createdAt: string;
      updatedAt: string;
    }>;
    diagnostics: string[];
  };
  projectIndex: {
    storagePath: string;
    indexedAt?: string;
    indexedFiles: number;
    totalBytes: number;
    semantic: {
      status: "ready" | "empty";
      profiledFiles: number;
      tokenCount: number;
      source: "local-token-profile" | "model-embedding";
      embeddedFiles?: number;
      model?: string;
      dimensions?: number;
      provider?: "openai-compatible";
    };
    extensions: Array<{ extension: string; count: number }>;
    files: Array<{
      path: string;
      sizeBytes: number;
      extension: string;
      embeddingModel?: string;
      embeddingDimensions?: number;
      embeddingHash?: string;
    }>;
    symbols: Array<{ path: string; name: string; kind: string; line: number }>;
    tasks: Array<{ path: string; marker: string; line: number; text: string }>;
  };
  hooks: {
    configPath: string;
    lifecyclePolicy: {
      enabled: boolean;
      disabledEvents: string[];
      failureMode: "continue" | "stop-on-failure";
      updatedAt?: string;
      diagnostics: string[];
    };
    schedulingPolicy: {
      enabled: boolean;
      maxConcurrentRuns: number;
      cooldownMs: number;
      updatedAt?: string;
      diagnostics: string[];
    };
    items: Array<{
      id: string;
      name: string;
      event: string;
      enabled: boolean;
      policyPreset: "standard" | "restricted" | "blocked";
      envKeys: string[];
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      runConfirmationToken: string;
      runOperation: {
        operation: "manual-run";
        fingerprint: string;
        approvalStatus: "missing" | "approved" | "expired" | "consumed" | "changed";
        approvalId?: string;
        approvedAt?: string;
        expiresAt?: string;
        consumedAt?: string;
        cwd: string;
        command: string;
        args: string[];
        event: string;
        envKeys: string[];
        executionFingerprint: string;
        isolation: ProcessIsolationSummary;
        diagnostics: string[];
      };
      executionPolicy: {
        status: "allowed" | "blocked";
        isolation: ProcessIsolationSummary;
        blockers: string[];
        warnings: string[];
      };
      scheduling: {
        status: "ready" | "paused" | "cooldown" | "parallel-limit";
        activeRuns: number;
        maxConcurrentRuns: number;
        cooldownMs: number;
        nextAllowedAt?: string;
        diagnostics: string[];
      };
      diagnostics: string[];
      lastRun?: {
        id: string;
        status: string;
        finishedAt: string;
        durationMs: number;
        batchId?: string;
        stdout: string;
        stderr: string;
        isolation?: ProcessIsolationSummary;
        diagnostics: string[];
        reviewedAt?: string;
      };
    }>;
    recentRuns: Array<{
      id: string;
      hookId: string;
      hookName: string;
      event: string;
      status: string;
      finishedAt: string;
      durationMs: number;
      batchId?: string;
      stdout: string;
      stderr: string;
      isolation?: ProcessIsolationSummary;
      diagnostics: string[];
      reviewedAt?: string;
    }>;
    recentBatches: Array<{
      id: string;
      hookIds: string[];
      hookNames: string[];
      runIds: string[];
      failureMode: "continue" | "stop-on-failure";
      status: "success" | "partial" | "failed" | "blocked";
      counts: Record<"success" | "failed" | "timeout" | "disabled", number>;
      diagnostics: string[];
    }>;
  };
  plugins: {
    configPath: string;
    schedulingPolicy: {
      enabled: boolean;
      maxConcurrentRuns: number;
      cooldownMs: number;
      updatedAt?: string;
      diagnostics: string[];
    };
    items: Array<{
      id: string;
      name: string;
      enabled: boolean;
      policyPreset: "standard" | "restricted" | "blocked";
      installSource?: "manual" | "signed-package";
      publisher?: string;
      packagePublisherId?: string;
      packageManifestPath?: string;
      packageRegistryUrl?: string;
      packageRegistryName?: string;
      packageRegistryPackageId?: string;
      packageSignatureHash?: string;
      packagePublicKeyFingerprint?: string;
      packageIssuedAt?: string;
      packageExpiresAt?: string;
      packageExpiryStatus?: "valid" | "expired" | "not-declared";
      packageVerifiedAt?: string;
      packageGovernanceStatus?: "verified" | "verification-failed";
      packageGovernanceDiagnostics?: string[];
      scopes: Array<"process" | "project-root" | "env">;
      dependencyIds: string[];
      envKeys: string[];
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      permissionFingerprint: string;
      permissionStatus: "granted" | "missing" | "changed";
      grantedPermissionFingerprint?: string;
      runConfirmationToken: string;
      runOperation: {
        operation: "manual-run";
        fingerprint: string;
        approvalStatus: "missing" | "approved" | "expired" | "consumed" | "changed";
        approvalId?: string;
        approvedAt?: string;
        expiresAt?: string;
        consumedAt?: string;
        workspaceAccess: "project-root" | "sandbox";
        cwd: string;
        command: string;
        args: string[];
        scopes: Array<"process" | "project-root" | "env">;
        envKeys: string[];
        executionFingerprint: string;
        permissionFingerprint: string;
        isolation: ProcessIsolationSummary;
        diagnostics: string[];
      };
      executionPolicy: {
        status: "allowed" | "blocked";
        isolation: ProcessIsolationSummary;
        blockers: string[];
        warnings: string[];
      };
      scheduling: {
        status: "ready" | "paused" | "cooldown" | "parallel-limit";
        activeRuns: number;
        maxConcurrentRuns: number;
        cooldownMs: number;
        nextAllowedAt?: string;
        diagnostics: string[];
      };
      diagnostics: string[];
      lastRun?: {
        id: string;
        status: string;
        finishedAt: string;
        durationMs: number;
        batchId?: string;
        stdout: string;
        stderr: string;
        isolation?: ProcessIsolationSummary;
        diagnostics: string[];
        preRunCheckpointId?: string;
        postRunCheckpointId?: string;
        workspaceStatusBefore?: string[];
        workspaceStatusAfter?: string[];
        workspaceChangedFiles?: string[];
        reviewedAt?: string;
      };
    }>;
    catalog: Array<{
      manifestPath: string;
      status: "installable" | "installed" | "update-available" | "invalid";
      id?: string;
      name?: string;
      publisher?: string;
      publisherId?: string;
      issuedAt?: string;
      expiresAt?: string;
      expiryStatus: "valid" | "expired" | "not-declared";
      scopes: Array<"process" | "project-root" | "env">;
      envKeys: string[];
      command?: string;
      args: string[];
      workspaceAccess: "project-root" | "sandbox";
      signatureHash?: string;
      publicKeyFingerprint?: string;
      installedPluginId?: string;
      diagnostics: string[];
    }>;
    registries: Array<{
      id: string;
      name: string;
      url: string;
      enabled: boolean;
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      lastRefreshAt?: string;
      status: "ready" | "disabled" | "untrusted" | "failed" | "empty";
      revokedSigners: Array<{
        publicKeyFingerprint: string;
        revokedAt: string;
        reason?: string;
        source: "manual" | "registry";
      }>;
      packages: Array<{
        id: string;
        name?: string;
        publisher?: string;
        publisherId?: string;
        issuedAt?: string;
        expiresAt?: string;
        expiryStatus: "valid" | "expired" | "not-declared";
        manifestUrl: string;
        signatureHash: string;
        publicKeyFingerprint: string;
        status:
          | "installable"
          | "installed"
          | "update-available"
          | "invalid"
          | "revoked";
        signingStatus: "trusted" | "revoked";
        installedPluginId?: string;
        revokedAt?: string;
        revocationReason?: string;
        revocationSource?: "manual" | "registry";
        diagnostics: string[];
      }>;
      diagnostics: string[];
    }>;
    recentRuns: Array<{
      id: string;
      pluginId: string;
      pluginName: string;
      batchId?: string;
      status: string;
      finishedAt: string;
      durationMs: number;
      stdout: string;
      stderr: string;
      isolation?: ProcessIsolationSummary;
      diagnostics: string[];
      preRunCheckpointId?: string;
      postRunCheckpointId?: string;
      workspaceStatusBefore?: string[];
      workspaceStatusAfter?: string[];
      workspaceChangedFiles?: string[];
      reviewedAt?: string;
    }>;
    recentBatches: Array<{
      id: string;
      pluginIds: string[];
      pluginNames: string[];
      runIds: string[];
      failureMode: "continue" | "stop-on-failure";
      status: "success" | "partial" | "failed" | "blocked";
      counts: Record<"success" | "failed" | "timeout" | "disabled", number>;
      diagnostics: string[];
    }>;
    batchPresets: Array<{
      id: string;
      name: string;
      pluginIds: string[];
      pluginNames: string[];
      failureMode: "continue" | "stop-on-failure";
      lastRunBatchId?: string;
      diagnostics: string[];
    }>;
    batchSchedules: Array<{
      id: string;
      name: string;
      presetId: string;
      presetName?: string;
      enabled: boolean;
      intervalMs: number;
      nextRunAt: string;
      lastRunAt?: string;
      lastRunBatchId?: string;
      lastRunStatus?: "success" | "partial" | "failed" | "blocked";
      pluginIds: string[];
      pluginNames: string[];
      status:
        | "due"
        | "scheduled"
        | "paused"
        | "missing-preset"
        | "stale-fingerprint";
      diagnostics: string[];
    }>;
    dependencyGraph: {
      nodes: Array<{
        pluginId: string;
        pluginName: string;
        dependencyIds: string[];
        dependencyNames: string[];
        dependentIds: string[];
        dependentNames: string[];
        status: "ready" | "missing-dependency" | "cycle";
        diagnostics: string[];
      }>;
      edges: Array<{
        pluginId: string;
        pluginName: string;
        dependencyId: string;
        dependencyName?: string;
        status: "ready" | "missing" | "cycle";
      }>;
      diagnostics: string[];
    };
  };
  projectMemory: {
    sources: Array<{ id: string; relativePath: string; enabled: boolean }>;
    presets: Array<{
      id: string;
      name: string;
      sourcePaths: string[];
      defaultQuery?: string;
      retrievalMode: "full" | "semantic";
      maxBytes: number;
      maxChunks: number;
      diagnostics: string[];
    }>;
  };
  subagents: Array<{
    name: string;
    description?: string;
    enabled: boolean;
    sourcePath: string;
    prompt: string;
  }>;
  dashboardParity: Array<{
    workflow: string;
    status: "available" | "partial" | "blocked" | "not-applicable";
    electronSurface: string;
    reason?: string;
    blockerFile?: string;
    policy?: {
      scope: "local-desktop" | "remote-admin";
      decision: "exposed" | "not-applicable";
      rationale: string;
      reviewedAt: string;
    };
  }>;
  blockers: Array<{ workflow: string }>;
}

interface McpInvocationResult {
  serverId: string;
  serverName: string;
  transport: "stdio" | "sse" | "streamable-http";
  method: "tools/call" | "resources/read";
  target: string;
  status: "success" | "failed";
  isError: boolean;
  resultText: string;
  resultJson: string;
  diagnostics: string[];
  content: Array<{
    type: string;
    text?: string;
    uri?: string;
    mimeType?: string;
  }>;
}

interface ProjectIndexSearchResult {
  status: "ready" | "not-indexed" | "no-results";
  query: string;
  results: Array<{
    type: string;
    path: string;
    title: string;
    detail: string;
    score?: number;
    matchKind?: "direct" | "semantic" | "embedding";
  }>;
  prompt: string;
  diagnostics: string[];
}

interface ProjectMemoryContextResult {
  status: "ready" | "no-enabled-sources";
  query: string;
  retrievalMode: "full" | "semantic";
  presetId?: string;
  presetName?: string;
  sources: Array<{
    id: string;
    relativePath: string;
    includedBytes: number;
    truncated: boolean;
  }>;
  chunks: Array<{
    sourceId: string;
    relativePath: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    score: number;
    ranker?: "model-embedding" | "local-token-vector";
    embeddingModel?: string;
    includedBytes: number;
    truncated: boolean;
  }>;
  semantic?: {
    ranker: "model-embedding" | "local-token-vector";
    model?: string;
    dimensions?: number;
    diagnostics: string[];
  };
  prompt: string;
  diagnostics: string[];
}

interface MockEmbeddingServerContext {
  calls: string[][];
  url: string;
}

interface MockEmbeddingServerHandle extends MockEmbeddingServerContext {
  stop: () => Promise<void>;
}

function mockEmbeddingVector(text: string): number[] {
  const lower = text.toLowerCase();
  const includesAny = (tokens: string[]) =>
    tokens.some((token) => lower.includes(token));
  return [
    includesAny(["checkpoint", "restore", "rollback", "safety", "snapshot", "recovery"])
      ? 1
      : 0,
    includesAny(["provider", "auth", "login", "credential"]) ? 1 : 0,
    includesAny(["runtime", "local ade", "session"]) ? 1 : 0,
    includesAny(["plugin", "hook", "extension"]) ? 1 : 0,
    Math.min(1, lower.length / 1000),
  ];
}

async function startMockEmbeddingServer(): Promise<MockEmbeddingServerHandle> {
  const previousEndpoint = process.env.ERAGEAR_EMBEDDINGS_ENDPOINT;
  const previousModel = process.env.ERAGEAR_EMBEDDINGS_MODEL;
  const previousApiKey = process.env.ERAGEAR_EMBEDDINGS_API_KEY;
  const calls: string[][] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        input?: unknown;
        model?: string;
      };
      const input = Array.isArray(body.input)
        ? body.input.map((item) => String(item))
        : [String(body.input ?? "")];
      calls.push(input);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          model: body.model ?? "smoke-embedding",
          data: input.map((text, index) => ({
            object: "embedding",
            index,
            embedding: mockEmbeddingVector(text),
          })),
        })
      );
    })().catch((error) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  process.env.ERAGEAR_EMBEDDINGS_ENDPOINT = `http://127.0.0.1:${address.port}/v1/embeddings`;
  process.env.ERAGEAR_EMBEDDINGS_MODEL = "smoke-embedding";
  process.env.ERAGEAR_EMBEDDINGS_API_KEY = "smoke-embedding-secret";
  return {
    calls,
    url: process.env.ERAGEAR_EMBEDDINGS_ENDPOINT,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (previousEndpoint === undefined) {
        delete process.env.ERAGEAR_EMBEDDINGS_ENDPOINT;
      } else {
        process.env.ERAGEAR_EMBEDDINGS_ENDPOINT = previousEndpoint;
      }
      if (previousModel === undefined) {
        delete process.env.ERAGEAR_EMBEDDINGS_MODEL;
      } else {
        process.env.ERAGEAR_EMBEDDINGS_MODEL = previousModel;
      }
      if (previousApiKey === undefined) {
        delete process.env.ERAGEAR_EMBEDDINGS_API_KEY;
      } else {
        process.env.ERAGEAR_EMBEDDINGS_API_KEY = previousApiKey;
      }
    },
  };
}

interface AcpActivityExportResult {
  schemaVersion: 1;
  exportedAt: string;
  projectRoot: string;
  filters: {
    chatId?: string;
    limit: number;
  };
  redacted: true;
  entries: Array<{
    id: string;
    message: string;
    chatId?: string;
    kind?: string;
    payloadBytes?: number;
    metadata: Record<string, string | number | boolean | null>;
  }>;
  correlations: Array<{
    key: string;
    label: string;
    eventCount: number;
    firstTimestamp: number;
    lastTimestamp: number;
    durationMs: number;
    latestMessage: string;
    latestLevel: string;
    chatId?: string;
    sessionId?: string;
    turnId?: string;
    levels: Record<string, number>;
    kinds: Record<string, number>;
  }>;
  stats: {
    total: number;
    chatCount: number;
    kinds: Record<string, number>;
  };
  diagnostics: string[];
}

interface AcpActivityReplayResult {
  schemaVersion: 1;
  replayedAt: string;
  projectRoot: string;
  filters: {
    chatId?: string;
    correlationKey?: string;
    kind?: string;
    limit: number;
  };
  redacted: true;
  frames: Array<{
    id: string;
    sequence: number;
    timestamp: number;
    elapsedMs: number;
    deltaMs: number;
    level: string;
    message: string;
    chatId?: string;
    kind?: string;
    payloadBytes?: number;
    correlationKey: string;
    correlationLabel: string;
    metadata: Record<string, string | number | boolean | null>;
  }>;
  correlations: Array<{
    key: string;
    label: string;
    eventCount: number;
    chatId?: string;
    sessionId?: string;
    turnId?: string;
  }>;
  stats: {
    total: number;
    chatCount: number;
    kinds: Record<string, number>;
  };
  diagnostics: string[];
}

interface CheckpointPreviewResult {
  checkpointId: string;
  canRestore: boolean;
  restoreMode: "reverse-patch" | "apply-patch";
  restoreToken: string;
  sessionAttributions: CheckpointSessionAttribution[];
  diffFiles: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    hunks: Array<{
      rows: Array<{
        kind: string;
        oldLine?: number;
        newLine?: number;
        oldText?: string;
        newText?: string;
      }>;
    }>;
  }>;
  restoreRisks: Array<{
    file: string;
    level: "safe" | "warning" | "blocked";
    patchAction: string;
    reason: string;
  }>;
  restoreBlockers: Array<{ file: string; reason: string }>;
}

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const smokeMcpScript = path.join(desktopRoot, "scripts", "mcp-smoke-server.js");
const acpMcpCaptureAgentScript = path.join(
  desktopRoot,
  "scripts",
  "acp-mcp-capture-agent.js"
);
const smokeCommandPath = path.join(
  repoRoot,
  ".eragear",
  "commands",
  "desktop-smoke.md"
);
const smokeSkillPath = path.join(
  repoRoot,
  ".eragear",
  "skills",
  "desktop-smoke",
  "SKILL.md"
);
const smokeOutputStylePath = path.join(
  repoRoot,
  ".eragear",
  "output-styles",
  "desktop-smoke.md"
);
const smokeMemoryPath = path.join(repoRoot, ".eragear", "context.md");
const smokeMemoryPresetPath = path.join(
  repoRoot,
  ".eragear",
  "project-memory-presets.json"
);
const repoIndexPath = path.join(repoRoot, ".eragear", "repo-index.json");
const smokeSemanticIndexPath = path.join(repoRoot, "desktop-semantic-smoke.md");
const capabilitiesStatePath = path.join(
  repoRoot,
  ".eragear",
  "capabilities-state.json"
);
const providerHealthPath = path.join(repoRoot, ".eragear", "provider-health.json");
const hooksPath = path.join(repoRoot, ".eragear", "hooks.json");
const pluginsPath = path.join(repoRoot, ".eragear", "plugins.json");
const pluginRegistriesPath = path.join(repoRoot, ".eragear", "plugin-registries.json");
const signedPluginManifestPath = path.join(
  repoRoot,
  ".eragear",
  "plugin-packages",
  "desktop-signed-plugin.json"
);
const token = `smoke-${Date.now()}`;
const promptWaitMs = Number(process.env.ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS ?? 20_000);
const execFileAsync = promisify(execFile);
const smokeSecurityPosture: RuntimeSecurityPosture = {
  status: "development-warning",
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  preloadBridge: true,
  contentSecurityPolicy: "development-warning",
  endpointNetworkExposed: false,
  localAuthTokenRedacted: true,
  diagnostics: [
    "Smoke mirrors Electron main security posture for the development renderer.",
    "Runtime service uses a private desktop-service channel and is not network exposed.",
    "Desktop local auth token is redacted from diagnostics.",
  ],
};

const host = new DesktopRuntimeHost({
  mode: "main-thread",
  repoRoot,
  rendererUrl: "http://127.0.0.1:3001",
  runtimePort: 443,
  localAuthToken: token,
  remoteRuntimeUrl: "",
  securityPosture: smokeSecurityPosture,
});

let sequence = 1;

type SmokeCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | SmokeCanonicalJsonValue[]
  | { [key: string]: SmokeCanonicalJsonValue | undefined };

function operation(
  type: RuntimeServiceOperation["type"],
  rpcPath: string,
  input?: unknown
): RuntimeServiceOperation {
  return {
    id: sequence++,
    type,
    path: rpcPath,
    input,
  };
}

function canonicalSmokeJson(value: SmokeCanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSmokeJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter((entry): entry is [string, SmokeCanonicalJsonValue] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalSmokeJson(entryValue)}`)
    .join(",")}}`;
}

function smokeSubagentSlashCommandName(name: string): string {
  return `agent-${name
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function resolveSmokeSubagentCommand(params: {
  text: string;
  subagents: LocalAdeSnapshot["subagents"];
}): { command: string; prompt: string; sourcePath: string } | null {
  const leadingCommand = params.text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!leadingCommand) {
    return null;
  }

  const commandName = leadingCommand[1];
  if (!commandName) {
    return null;
  }
  const subagent = params.subagents.find(
    (item) =>
      item.enabled && smokeSubagentSlashCommandName(item.name) === commandName
  );
  if (!subagent) {
    return null;
  }

  const request =
    leadingCommand[2]?.trim() ||
    "Review the current project state and report findings.";
  return {
    command: commandName,
    sourcePath: subagent.sourcePath,
    prompt: [
      `Delegate this task to the "${subagent.name}" subagent profile.`,
      subagent.description ? `Subagent description: ${subagent.description}` : "",
      `Subagent source: ${subagent.sourcePath}`,
      "",
      "Subagent instructions:",
      subagent.prompt,
      "",
      "User request:",
      request,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  };
}

async function request<T>(runtimeOperation: RuntimeServiceOperation): Promise<T> {
  const response = await host.requestOperation({
    auth: { localAuthToken: token },
    operation: runtimeOperation,
  });
  if (!response.ok) {
    throw new Error(JSON.stringify(response.error));
  }
  return response.data as T;
}

async function approveHookRunOperation(hookId: string): Promise<{
  approvalId: string;
  fingerprint: string;
}> {
  const snapshot = await request<LocalAdeSnapshot>(
    operation("query", "settings.getLocalAdeSnapshot")
  );
  const hook = snapshot.hooks.items.find((item) => item.id === hookId);
  if (!hook?.runOperation.fingerprint?.startsWith("sha256:")) {
    throw new Error(`Hook run operation fingerprint missing for ${hookId}.`);
  }
  const approved = await request<LocalAdeSnapshot>(
    operation("mutation", "settings.approveHookRun", {
      hookId,
      operationFingerprint: hook.runOperation.fingerprint,
    })
  );
  const approvedHook = approved.hooks.items.find((item) => item.id === hookId);
  if (
    approvedHook?.runOperation.approvalStatus !== "approved" ||
    !approvedHook.runOperation.approvalId
  ) {
    throw new Error(`Hook run operation approval did not persist for ${hookId}.`);
  }
  return {
    approvalId: approvedHook.runOperation.approvalId,
    fingerprint: approvedHook.runOperation.fingerprint,
  };
}

async function approvePluginRunOperation(pluginId: string): Promise<{
  approvalId: string;
  fingerprint: string;
}> {
  const snapshot = await request<LocalAdeSnapshot>(
    operation("query", "settings.getLocalAdeSnapshot")
  );
  const plugin = snapshot.plugins.items.find((item) => item.id === pluginId);
  if (!plugin?.runOperation.fingerprint?.startsWith("sha256:")) {
    throw new Error(`Plugin run operation fingerprint missing for ${pluginId}.`);
  }
  const approved = await request<LocalAdeSnapshot>(
    operation("mutation", "settings.approvePluginRun", {
      pluginId,
      operationFingerprint: plugin.runOperation.fingerprint,
    })
  );
  const approvedPlugin = approved.plugins.items.find((item) => item.id === pluginId);
  if (
    approvedPlugin?.runOperation.approvalStatus !== "approved" ||
    !approvedPlugin.runOperation.approvalId
  ) {
    throw new Error(`Plugin run operation approval did not persist for ${pluginId}.`);
  }
  return {
    approvalId: approvedPlugin.runOperation.approvalId,
    fingerprint: approvedPlugin.runOperation.fingerprint,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJsonFile<T>(
  filePath: string,
  timeoutMs = 5000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      lastError = error;
      await wait(150);
    }
  }
  throw new Error(
    `Timed out waiting for JSON file ${filePath}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function requestStdioJsonRpc(params: {
  command: string;
  args: string[];
  cwd: string;
  method: string;
  rpcParams?: unknown;
}): Promise<Record<string, unknown>> {
  const child = spawn(params.command, params.args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  const id = `desktop-smoke-${Date.now()}-${Math.random()}`;
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP ${params.method}`));
      }, 6000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          const message = JSON.parse(line) as Record<string, unknown>;
          if (message.id !== id) {
            continue;
          }
          clearTimeout(timeout);
          resolve(message);
        }
      });
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: params.method,
          ...(params.rpcParams === undefined ? {} : { params: params.rpcParams }),
        })}\n`
      );
    });
  } finally {
    child.kill();
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function restoreOptionalFile(
  filePath: string,
  previous: string | null
): Promise<void> {
  if (previous === null) {
    await rm(filePath, { force: true }).catch(() => undefined);
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, previous, "utf8");
}

async function waitForHookRun(
  hookId: string,
  stdoutNeedle: string,
  timeoutMs = 8000
): Promise<NonNullable<LocalAdeSnapshot["hooks"]["items"][number]["lastRun"]>> {
  const deadline = Date.now() + timeoutMs;
  let lastRun:
    | NonNullable<LocalAdeSnapshot["hooks"]["items"][number]["lastRun"]>
    | undefined;
  while (Date.now() < deadline) {
    const snapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    lastRun = snapshot.hooks.items.find((hook) => hook.id === hookId)?.lastRun;
    if (lastRun?.status === "success" && lastRun.stdout.includes(stdoutNeedle)) {
      return lastRun;
    }
    await wait(250);
  }
  throw new Error(
    `Timed out waiting for hook ${hookId}; last status ${lastRun?.status ?? "missing"} stdout ${lastRun?.stdout ?? ""}`
  );
}

async function waitForPluginBatchSchedule(
  scheduleId: string,
  timeoutMs = 10000
): Promise<LocalAdeSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "missing";
  let lastRunStatus = "missing";
  while (Date.now() < deadline) {
    const snapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const schedule = snapshot.plugins.batchSchedules.find(
      (item) => item.id === scheduleId
    );
    lastStatus = schedule?.status ?? "missing";
    lastRunStatus = schedule?.lastRunStatus ?? "missing";
    if (
      schedule?.lastRunBatchId &&
      schedule.lastRunStatus === "success" &&
      schedule.status === "scheduled"
    ) {
      return snapshot;
    }
    await wait(350);
  }
  throw new Error(
    `Timed out waiting for plugin batch schedule ${scheduleId}; status ${lastStatus}; last ${lastRunStatus}`
  );
}

async function startSseMcpFixture(options: {
  closeFirstStreamOnFirstRequest?: boolean;
  closeOnceOnMethod?: string;
} = {}): Promise<{
  streamUrl: string;
  messageEndpoint: string;
  requestCounts: Record<string, number>;
  closeNextStreamOnFirstRequest: () => void;
  close: () => Promise<void>;
}> {
  const expectedAuthorization = process.env.ERAGEAR_DESKTOP_MCP_AUTH;
  const clients = new Set<ServerResponse>();
  const requestCounts: Record<string, number> = {};
  let firstRequestStreamClosed = false;
  let methodStreamClosed = false;
  let closeNextStreamOnFirstRequest = false;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/sse") {
      if (
        expectedAuthorization &&
        request.headers.authorization !== expectedAuthorization
      ) {
        response
          .writeHead(401, { "content-type": "text/plain" })
          .end(`missing ${expectedAuthorization}`);
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      clients.add(response);
      response.write("event: endpoint\ndata: /messages\n\n");
      request.on("close", () => {
        clients.delete(response);
      });
      return;
    }
    if (request.method === "POST" && request.url === "/messages") {
      if (
        expectedAuthorization &&
        request.headers.authorization !== expectedAuthorization
      ) {
        response
          .writeHead(401, { "content-type": "text/plain" })
          .end(`missing ${expectedAuthorization}`);
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.writeHead(202).end();
        const message = JSON.parse(body);
        requestCounts[message.method] = (requestCounts[message.method] ?? 0) + 1;
        if (
          options.closeFirstStreamOnFirstRequest &&
          !firstRequestStreamClosed
        ) {
          firstRequestStreamClosed = true;
          for (const client of clients) {
            client.end();
          }
          return;
        }
        if (closeNextStreamOnFirstRequest) {
          closeNextStreamOnFirstRequest = false;
          for (const client of clients) {
            client.end();
          }
          return;
        }
        if (
          options.closeOnceOnMethod === message.method &&
          !methodStreamClosed
        ) {
          methodStreamClosed = true;
          for (const client of clients) {
            client.end();
          }
          return;
        }
        if (message.method === "notifications/initialized") {
          return;
        }
        let result: unknown = {};
        if (message.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "desktop-smoke-sse", version: "1.0.0" },
            capabilities: { tools: {}, resources: {} },
          };
        } else if (message.method === "tools/list") {
          result = {
            tools: [
              {
                name: "desktop_smoke_sse_tool",
                description: "Desktop smoke SSE tool",
              },
            ],
          };
        } else if (message.method === "resources/list") {
          result = {
            resources: [
              { uri: "memory://desktop-smoke-sse", name: "desktop-sse-resource" },
            ],
          };
        } else if (message.method === "tools/call") {
          result = {
            content: [
              {
                type: "text",
                text: `desktop sse tool ${message.params.name} authorization=${request.headers.authorization ?? ""}`,
              },
            ],
          };
        } else if (message.method === "resources/read") {
          result = {
            contents: [
              {
                uri: message.params.uri,
                mimeType: "text/plain",
                text: `desktop sse resource ${message.params.uri}`,
              },
            ],
          };
        }
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result,
        });
        const notificationPayload = JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            level: "info",
            data: `desktop sse ${message.method} authorization=${request.headers.authorization ?? ""}`,
          },
        });
        for (const client of clients) {
          client.write(`event: message\ndata: ${notificationPayload}\n\n`);
          client.write(`event: message\ndata: ${payload}\n\n`);
        }
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    streamUrl: `${baseUrl}/sse`,
    messageEndpoint: `${baseUrl}/messages`,
    requestCounts,
    closeNextStreamOnFirstRequest: () => {
      closeNextStreamOnFirstRequest = true;
    },
    close: async () => {
      for (const client of clients) {
        client.end();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

async function ensureRepoProject(): Promise<ProjectSummary> {
  const projectsData = await request<ProjectListResult>(
    operation("query", "listProjects")
  );
  let project = projectsData.projects.find(
    (item) => path.resolve(item.path).toLowerCase() === repoRoot.toLowerCase()
  );
  if (!project) {
    project = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Eragear Code Copilot",
        path: repoRoot,
        description: "Desktop IPC smoke project",
        tags: ["desktop-smoke"],
      })
    );
  }
  await request<unknown>(
    operation("mutation", "setActiveProject", { id: project.id })
  );
  return project;
}

async function chooseAgent(): Promise<AgentSummary> {
  const agentsData = await request<AgentListResult>(
    operation("query", "agents.list")
  );
  const agent =
    agentsData.agents.find((item) => item.type === "opencode") ??
    agentsData.agents.find((item) => item.type === "codex") ??
    agentsData.agents.find((item) => item.id === agentsData.activeAgentId) ??
    agentsData.agents[0];
  if (!agent) {
    throw new Error("No agent configuration available for desktop smoke.");
  }
  return agent;
}

async function resolveCliCommand(command: string): Promise<string | null> {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(lookupCommand, [command], {
      timeout: 5000,
      windowsHide: true,
    });
    return (
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

function smokeCommandToken(value: string | undefined): string {
  const first = (value ?? "").trim().split(/\s+/)[0] ?? "";
  const basename = first.split(/[\\/]/).pop() ?? first;
  return basename.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "");
}

async function withCodexProviderAgent<T>(
  run: (agent: AgentSummary, created: boolean) => Promise<T>
): Promise<T | null> {
  const agentsData = await request<AgentListResult>(
    operation("query", "agents.list")
  );
  const existing = agentsData.agents.find((item) => item.type === "codex");
  if (existing) {
    return await run(existing, false);
  }

  const codexCommand = await resolveCliCommand("codex");
  if (!codexCommand) {
    console.log(
      "CODEX_PROVIDER_DOCTOR",
      JSON.stringify({ skipped: "codex cli missing" })
    );
    return null;
  }
  const agentCommand = /\s/.test(codexCommand) ? "codex" : codexCommand;
  const previousProviderHealth = await readOptionalFile(providerHealthPath);

  const created = await request<AgentSummary>(
    operation("mutation", "agents.create", {
      name: "Desktop Smoke Codex Provider",
      type: "codex",
      command: agentCommand,
      args: ["acp"],
      env: {},
      projectId: null,
    })
  );
  try {
    return await run(created, true);
  } finally {
    await request<unknown>(
      operation("mutation", "agents.delete", { id: created.id })
    ).catch((error) => {
      console.log(
        "CODEX_PROVIDER_DOCTOR_CLEANUP_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    });
    await restoreOptionalFile(providerHealthPath, previousProviderHealth).catch(
      (error) => {
        console.log(
          "CODEX_PROVIDER_HEALTH_RESTORE_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }
    );
  }
}

async function testCodexProviderDoctor(): Promise<void> {
  await withCodexProviderAgent(async (codexAgent, created) => {
    const providerSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.testProvider", {
        providerId: `provider.agent.${codexAgent.id}`,
      })
    );
    const provider = providerSnapshot.providers.find(
      (item) => item.id === `provider.agent.${codexAgent.id}`
    );
    console.log(
      "CODEX_PROVIDER_DOCTOR",
      JSON.stringify({
        id: codexAgent.id,
        temporary: created,
        command: codexAgent.command,
        args: codexAgent.args ?? [],
        status: provider?.status ?? "missing",
        cliStatus: provider?.cliStatus ?? "missing",
        authStatus: provider?.authStatus ?? "missing",
        modelStatus: provider?.modelStatus ?? "missing",
        modelList: provider?.modelList ?? [],
        diagnostics: provider?.diagnostics?.slice(-8) ?? [],
        doctor:
          provider?.diagnostics?.some((item) =>
            item.includes("Codex doctor overall status")
          ) ?? false,
      })
    );
    if (!provider) {
      throw new Error("Codex provider descriptor was missing after readiness probe.");
    }
    if (provider.cliStatus !== "ok") {
      throw new Error("Codex provider CLI probe did not report ok.");
    }
    if (
      provider.authStatus === "ok" &&
      (!provider.diagnostics?.some((item) =>
        item.includes("Codex doctor overall status")
      ) ||
        provider.modelStatus !== "ok" ||
        (provider.modelList?.length ?? 0) === 0)
    ) {
      throw new Error("Codex provider doctor probe did not classify model readiness.");
    }
    if (provider.modelStatus === "ok" && (provider.modelList?.length ?? 0) > 0) {
      const originalDefaultModel = providerSnapshot.runtime.defaultModel;
      const modelId = provider.modelList?.[0] ?? "";
      const canRestoreOriginal =
        originalDefaultModel.length === 0 ||
        originalDefaultModel === modelId ||
        (provider.modelList ?? []).includes(originalDefaultModel);
      if (!canRestoreOriginal) {
        console.log(
          "PROVIDER_MODEL_SELECTION",
          JSON.stringify({
            skipped: "original default model is not restorable through this provider",
            originalDefaultModel,
            candidate: modelId,
          })
        );
      } else {
        const selectedSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.selectProviderModel", {
            providerId: provider.id,
            modelId,
          })
        );
        const selectedProvider = selectedSnapshot.providers.find(
          (item) => item.id === provider.id
        );
        console.log(
          "PROVIDER_MODEL_SELECTION",
          JSON.stringify({
            providerId: provider.id,
            modelId,
            defaultModel: selectedSnapshot.runtime.defaultModel,
            defaultModelProviderId: selectedSnapshot.runtime.defaultModelProviderId,
            selectedModel: selectedProvider?.selectedModel ?? null,
            modelListSource: selectedProvider?.modelListSource ?? null,
          })
        );
        if (
          selectedSnapshot.runtime.defaultModel !== modelId ||
          selectedSnapshot.runtime.defaultModelProviderId !== provider.id ||
          selectedProvider?.selectedModel !== modelId ||
          selectedProvider?.modelListSource !== "readiness-probe"
        ) {
          throw new Error("Provider model selection did not update runtime default model.");
        }
        if (originalDefaultModel.length === 0) {
          await request<LocalAdeSnapshot>(
            operation("mutation", "settings.clearProviderModel", {})
          );
        } else if (originalDefaultModel !== modelId) {
          await request<LocalAdeSnapshot>(
            operation("mutation", "settings.selectProviderModel", {
              providerId: provider.id,
              modelId: originalDefaultModel,
            })
          );
        }
      }
    }
  });
}

async function withFileBackup<T>(
  filePath: string,
  run: () => Promise<T>
): Promise<T> {
  let previous: string | null = null;
  try {
    previous = await readFile(filePath, "utf8");
  } catch {
    previous = null;
  }
  try {
    return await run();
  } finally {
    if (previous === null) {
      await rm(filePath, { force: true }).catch(() => undefined);
    } else {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, previous, "utf8");
    }
  }
}

async function runCheckpointRiskSmoke(
  repoProjectId: string,
  agentId: string
): Promise<void> {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    console.log("CHECKPOINT_RISK", JSON.stringify({ skipped: "git missing" }));
    return;
  }

  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-checkpoint-smoke-")
  );
  let tempProject: ProjectSummary | null = null;
  let checkpointChatId: string | null = null;
  try {
    await execFileAsync("git", ["init"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "desktop-smoke@example.test"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Desktop Smoke"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(path.join(tempProjectRoot, "README.md"), "initial\n", "utf8");
    await writeFile(path.join(tempProjectRoot, "NOTES.md"), "notes\n", "utf8");
    await writeFile(
      path.join(tempProjectRoot, "PLUGIN_AUDIT.md"),
      "plugin audit\n",
      "utf8"
    );
    const hunkBaseLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    await writeFile(
      path.join(tempProjectRoot, "HUNKS.md"),
      `${hunkBaseLines.join("\n")}\n`,
      "utf8"
    );
    await execFileAsync("git", ["add", "README.md", "NOTES.md", "HUNKS.md", "PLUGIN_AUDIT.md"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(
      path.join(tempProjectRoot, "README.md"),
      "initial\nchanged\n",
      "utf8"
    );
    await writeFile(
      path.join(tempProjectRoot, "NOTES.md"),
      "notes\nchanged\n",
      "utf8"
    );
    const hunkChangedLines = [...hunkBaseLines];
    hunkChangedLines[1] = "line 2 changed";
    hunkChangedLines[17] = "line 18 changed";
    await writeFile(
      path.join(tempProjectRoot, "HUNKS.md"),
      `${hunkChangedLines.join("\n")}\n`,
      "utf8"
    );
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke Checkpoint",
        path: tempProjectRoot,
        description: "Temporary checkpoint risk project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const checkpointSession = await request<SessionCreateResult>(
      operation("mutation", "createSession", {
        projectId: tempProject.id,
        agentId,
      })
    );
    checkpointChatId = checkpointSession.chatId;
    const checkpointSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.createCheckpoint", {
        name: "Desktop Smoke Checkpoint",
      })
    );
    const checkpoint = checkpointSnapshot.checkpoints.items[0];
    if (!checkpoint) {
      throw new Error("Desktop smoke checkpoint was not created.");
    }
    const checkpointAttribution = checkpoint.sessionAttributions.find(
      (item) => item.chatId === checkpointChatId
    );
    const preview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const previewAttribution = preview.sessionAttributions.find(
      (item) => item.chatId === checkpointChatId
    );
    const readmeDiff = preview.diffFiles.find((file) => file.path === "README.md");
    const hasChangedAddition =
      readmeDiff?.hunks.some((hunk) =>
        hunk.rows.some(
          (row) => row.kind === "add" && row.newText === "changed"
        )
      ) ?? false;
    const hunkDiff = preview.diffFiles.find((file) => file.path === "HUNKS.md");
    const safeRisk = preview.restoreRisks.find(
      (risk) => risk.file === "README.md"
    );
    await writeFile(path.join(tempProjectRoot, "EXTRA.md"), "conflict\n", "utf8");
    const conflictPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const blockedRisk = conflictPreview.restoreRisks.find(
      (risk) => risk.file === "EXTRA.md"
    );
    const conflictPatchFiles = new Set(
      conflictPreview.diffFiles.map((file) => file.path)
    );
    const safeRestoreFiles = [
      ...new Set(
        conflictPreview.restoreRisks
          .filter(
            (risk) => risk.level === "safe" && conflictPatchFiles.has(risk.file)
          )
          .map((risk) => risk.file)
      ),
    ].sort((left, right) => left.localeCompare(right));
    const visualMergeCurrentLabel =
      preview.restoreMode === "apply-patch" ? "Current baseline" : "Current workspace";
    const visualMergeRestoreLabel =
      preview.restoreMode === "apply-patch" ? "Restore target" : "Checkpoint side";
    const readmeRows = readmeDiff?.hunks.flatMap((hunk) => hunk.rows) ?? [];
    const readmeCurrentRows = readmeRows.filter((row) =>
      preview.restoreMode === "apply-patch"
        ? Boolean(row.oldText)
        : Boolean(row.newText)
    );
    const readmeRestoreRows = readmeRows.filter((row) =>
      preview.restoreMode === "apply-patch"
        ? Boolean(row.newText)
        : Boolean(row.oldText)
    );
    const readmeCurrentOnlyRows = readmeRows.filter((row) =>
      preview.restoreMode === "apply-patch"
        ? Boolean(row.oldText) && !row.newText
        : Boolean(row.newText) && !row.oldText
    );
    const readmeRestoreOnlyRows = readmeRows.filter((row) =>
      preview.restoreMode === "apply-patch"
        ? Boolean(row.newText) && !row.oldText
        : Boolean(row.oldText) && !row.newText
    );
    console.log(
      "CHECKPOINT_VISUAL_MERGE",
      JSON.stringify({
        mode: preview.restoreMode,
        currentLabel: visualMergeCurrentLabel,
        restoreLabel: visualMergeRestoreLabel,
        files: preview.diffFiles.length,
        readmeHunks: readmeDiff?.hunks.length ?? -1,
        readmeRows: readmeRows.length,
        readmeCurrentRows: readmeCurrentRows.length,
        readmeRestoreRows: readmeRestoreRows.length,
        readmeCurrentOnlyRows: readmeCurrentOnlyRows.length,
        readmeRestoreOnlyRows: readmeRestoreOnlyRows.length,
        hunkSelectable: (hunkDiff?.hunks.length ?? 0) > 1,
      })
    );
    if (
      preview.restoreMode !== "reverse-patch" ||
      visualMergeCurrentLabel !== "Current workspace" ||
      visualMergeRestoreLabel !== "Checkpoint side" ||
      (readmeDiff?.hunks.length ?? 0) === 0 ||
      readmeCurrentOnlyRows.length === 0 ||
      readmeCurrentRows.length <= readmeRestoreRows.length ||
      (hunkDiff?.hunks.length ?? 0) < 2
    ) {
      throw new Error("Desktop smoke checkpoint visual merge preview failed.");
    }
    console.log(
      "CHECKPOINT_SAFE_RESTORE_PLAN",
      JSON.stringify({
        fullRestoreBlocked: !conflictPreview.canRestore,
        safeFiles: safeRestoreFiles,
        warningFiles: conflictPreview.restoreRisks.filter(
          (risk) => risk.level === "warning"
        ).length,
        blockedFiles: conflictPreview.restoreRisks.filter(
          (risk) => risk.level === "blocked"
        ).length,
      })
    );
    const conflictShelve = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.shelveCheckpointConflicts", {
        checkpointId: checkpoint.id,
        confirmation: preview.restoreToken,
        files: ["EXTRA.md"],
      })
    );
    const shelvedCheckpoint = conflictShelve.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const conflictShelf = shelvedCheckpoint?.conflictShelves?.[0];
    const shelvedExtra =
      conflictShelf?.shelfPath && existsSync(path.join(conflictShelf.shelfPath, "EXTRA.md"))
        ? await readFile(path.join(conflictShelf.shelfPath, "EXTRA.md"), "utf8")
        : "";
    const rootExtraExistsAfterShelve = existsSync(
      path.join(tempProjectRoot, "EXTRA.md")
    );
    const postShelvePreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    console.log(
      "CHECKPOINT_CONFLICT_SHELVE",
      JSON.stringify({
        files: conflictShelf?.files ?? [],
        fullRestoreReady: postShelvePreview.canRestore,
        rootExtraExists: rootExtraExistsAfterShelve,
        shelfPath: conflictShelf?.shelfPath ?? "missing",
      })
    );
    await writeFile(path.join(tempProjectRoot, "EXTRA.md"), "conflict\n", "utf8");
    const hunkRestore = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.restoreCheckpointHunks", {
        checkpointId: checkpoint.id,
        confirmation: preview.restoreToken,
        hunks: [{ file: "HUNKS.md", hunkIndex: 0 }],
      })
    );
    const hunkCheckpoint = hunkRestore.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const hunkSafetyCheckpoint = hunkRestore.checkpoints.items.find(
      (item) => item.id === hunkCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
    );
    const afterHunkRestore = (
      await readFile(path.join(tempProjectRoot, "HUNKS.md"), "utf8")
    )
      .replace(/\r\n/g, "\n")
      .split("\n");
    const selectedRestore = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.restoreCheckpointFiles", {
        checkpointId: checkpoint.id,
        confirmation: preview.restoreToken,
        files: ["README.md"],
      })
    );
    const selectedCheckpoint = selectedRestore.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const selectedSafetyCheckpoint = selectedRestore.checkpoints.items.find(
      (item) => item.id === selectedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
    );
    const restoredReadme = await readFile(
      path.join(tempProjectRoot, "README.md"),
      "utf8"
    );
    const untouchedNotes = await readFile(
      path.join(tempProjectRoot, "NOTES.md"),
      "utf8"
    );
    const untouchedExtra = await readFile(
      path.join(tempProjectRoot, "EXTRA.md"),
      "utf8"
    );
    const hunkAfterFileRestore = (
      await readFile(path.join(tempProjectRoot, "HUNKS.md"), "utf8")
    )
      .replace(/\r\n/g, "\n")
      .split("\n");
    console.log(
      "CHECKPOINT_RISK",
      JSON.stringify({
        checkpointId: checkpoint.id,
        initialCanRestore: preview.canRestore,
        safeRisk: safeRisk?.level ?? "missing",
        attributionSource: previewAttribution?.source ?? "missing",
        attributionStatus: previewAttribution?.status ?? "missing",
        attributionMessages: previewAttribution?.messageCount ?? -1,
        diffFiles: preview.diffFiles.length,
        diffStatus: readmeDiff?.status ?? "missing",
        diffAdditions: readmeDiff?.additions ?? -1,
        diffHasChangedAddition: hasChangedAddition,
        hunkDiffCount: hunkDiff?.hunks.length ?? -1,
        conflictCanRestore: conflictPreview.canRestore,
        blockedRisk: blockedRisk?.level ?? "missing",
        blockers: conflictPreview.restoreBlockers.length,
        conflictShelveFiles: conflictShelf?.files.length ?? -1,
        conflictShelveReady: postShelvePreview.canRestore,
        selectedHunkRestores:
          hunkCheckpoint?.partialRestores?.[0]?.hunks?.length ?? -1,
        selectedHunkSafetyFiles: hunkSafetyCheckpoint?.changedFiles.length ?? -1,
        selectedHunkFirstRestored: afterHunkRestore[1] === "line 2",
        selectedHunkSecondPreserved: afterHunkRestore[17] === "line 18 changed",
        selectedRestoreFiles:
          selectedCheckpoint?.partialRestores?.[0]?.files.length ?? -1,
        selectedSafetyFiles: selectedSafetyCheckpoint?.changedFiles.length ?? -1,
        selectedReadmeRestored:
          restoredReadme.replace(/\r\n/g, "\n") === "initial\n",
        selectedNotesPreserved:
          untouchedNotes.replace(/\r\n/g, "\n") === "notes\nchanged\n",
        selectedExtraPreserved:
          untouchedExtra.replace(/\r\n/g, "\n") === "conflict\n",
        selectedHunkPreservedAfterFileRestore:
          hunkAfterFileRestore[1] === "line 2" &&
          hunkAfterFileRestore[17] === "line 18 changed",
      })
    );
    if (
      !preview.canRestore ||
      safeRisk?.level !== "safe" ||
      checkpointAttribution?.source !== "active" ||
      previewAttribution?.source !== "active" ||
      readmeDiff?.status !== "modified" ||
      readmeDiff.additions < 1 ||
      !hasChangedAddition ||
      hunkDiff?.hunks.length !== 2 ||
      conflictPreview.canRestore ||
      !safeRestoreFiles.includes("README.md") ||
      blockedRisk?.level !== "blocked" ||
      conflictPreview.restoreBlockers.length === 0 ||
      conflictShelf?.files[0] !== "EXTRA.md" ||
      shelvedExtra.replace(/\r\n/g, "\n") !== "conflict\n" ||
      rootExtraExistsAfterShelve ||
      !postShelvePreview.canRestore ||
      hunkCheckpoint?.partialRestores?.[0]?.hunks?.[0]?.file !== "HUNKS.md" ||
      hunkCheckpoint?.partialRestores?.[0]?.hunks?.[0]?.hunkIndex !== 0 ||
      hunkSafetyCheckpoint?.changedFiles[0] !== "HUNKS.md" ||
      afterHunkRestore[1] !== "line 2" ||
      afterHunkRestore[17] !== "line 18 changed" ||
      selectedCheckpoint?.partialRestores?.[0]?.files[0] !== "README.md" ||
      selectedSafetyCheckpoint?.changedFiles[0] !== "README.md" ||
      restoredReadme.replace(/\r\n/g, "\n") !== "initial\n" ||
      untouchedNotes.replace(/\r\n/g, "\n") !== "notes\nchanged\n" ||
      untouchedExtra.replace(/\r\n/g, "\n") !== "conflict\n" ||
      hunkAfterFileRestore[1] !== "line 2" ||
      hunkAfterFileRestore[17] !== "line 18 changed"
    ) {
      throw new Error("Desktop smoke checkpoint restore risk preview failed.");
    }

    const pluginAuditSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertPlugin", {
        id: "desktop-smoke-plugin-workspace-audit",
        name: "Desktop Smoke Plugin Workspace Audit",
        enabled: true,
        scopes: ["process", "project-root"],
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "fs.appendFileSync(path.join(process.env.ERAGEAR_PROJECT_ROOT, 'PLUGIN_AUDIT.md'), 'plugin wrote\\n');",
            "process.stdout.write('plugin workspace audit ok');",
          ].join(" "),
        ],
        timeoutMs: 5000,
      })
    );
    const auditPlugin = pluginAuditSnapshot.plugins.items.find(
      (plugin) => plugin.id === "desktop-smoke-plugin-workspace-audit"
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustPlugin", {
        pluginId: "desktop-smoke-plugin-workspace-audit",
        fingerprint: auditPlugin?.fingerprint ?? "",
      })
    );
    const auditRunApproval = await approvePluginRunOperation(
      "desktop-smoke-plugin-workspace-audit"
    );
    const pluginAuditRunSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.runPlugin", {
        pluginId: "desktop-smoke-plugin-workspace-audit",
        confirmation: "RUN PLUGIN desktop-smoke-plugin-workspace-audit",
        operationApprovalId: auditRunApproval.approvalId,
      })
    );
    const auditRun = pluginAuditRunSnapshot.plugins.items.find(
      (plugin) => plugin.id === "desktop-smoke-plugin-workspace-audit"
    )?.lastRun;
    const auditPreCheckpoint = pluginAuditRunSnapshot.checkpoints.items.find(
      (item) => item.id === auditRun?.preRunCheckpointId
    );
    const auditPostCheckpoint = pluginAuditRunSnapshot.checkpoints.items.find(
      (item) => item.id === auditRun?.postRunCheckpointId
    );
    console.log(
      "PLUGIN_WORKSPACE_AUDIT",
      JSON.stringify({
        status: auditRun?.status ?? "missing",
        preCheckpoint: Boolean(auditPreCheckpoint),
        postCheckpoint: Boolean(auditPostCheckpoint),
        preMode: auditPreCheckpoint?.restoreMode ?? "missing",
        postMode: auditPostCheckpoint?.restoreMode ?? "missing",
        changedFiles: auditRun?.workspaceChangedFiles ?? [],
        before: auditRun?.workspaceStatusBefore?.length ?? -1,
        after: auditRun?.workspaceStatusAfter?.length ?? -1,
      })
    );
    if (
      auditRun?.status !== "success" ||
      !auditRun.stdout.includes("plugin workspace audit ok") ||
      auditPreCheckpoint?.restoreMode !== "apply-patch" ||
      auditPostCheckpoint?.restoreMode !== "reverse-patch" ||
      !auditRun.workspaceChangedFiles?.includes("PLUGIN_AUDIT.md")
    ) {
      throw new Error("Desktop smoke plugin workspace audit failed.");
    }
  } finally {
    if (checkpointChatId) {
      await request<unknown>(
        operation("mutation", "stopSession", { chatId: checkpointChatId })
      ).catch(() => undefined);
    }
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function runTrackedCheckpointConflictSmoke(
  repoProjectId: string
): Promise<void> {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    console.log(
      "CHECKPOINT_TRACKED_CONFLICT_RESOLVE",
      JSON.stringify({ skipped: "git missing" })
    );
    return;
  }

  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-checkpoint-tracked-smoke-")
  );
  let tempProject: ProjectSummary | null = null;
  try {
    await execFileAsync("git", ["init"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "desktop-smoke@example.test"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Desktop Smoke"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(
      path.join(tempProjectRoot, "TRACKED.md"),
      "line 1\nline 2\n",
      "utf8"
    );
    await execFileAsync("git", ["add", "TRACKED.md"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(
      path.join(tempProjectRoot, "TRACKED.md"),
      "line 1\nline 2 checkpoint\n",
      "utf8"
    );
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke Tracked Checkpoint",
        path: tempProjectRoot,
        description: "Temporary tracked checkpoint conflict project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const checkpointSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.createCheckpoint", {
        name: "Desktop Smoke Tracked Conflict",
      })
    );
    const checkpoint = checkpointSnapshot.checkpoints.items[0];
    if (!checkpoint) {
      throw new Error("Desktop smoke tracked checkpoint was not created.");
    }
    const initialPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    await writeFile(
      path.join(tempProjectRoot, "TRACKED.md"),
      "line 1\nline 2 user edit\n",
      "utf8"
    );
    const conflictPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const trackedRisk = conflictPreview.restoreRisks.find(
      (risk) => risk.file === "TRACKED.md"
    );
    const resolved = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.resolveCheckpointTrackedConflicts", {
        checkpointId: checkpoint.id,
        confirmation: conflictPreview.restoreToken,
        files: ["TRACKED.md"],
      })
    );
    const resolvedCheckpoint = resolved.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const safetyCheckpoint = resolved.checkpoints.items.find(
      (item) => item.id === resolvedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
    );
    const afterResolve = await readFile(
      path.join(tempProjectRoot, "TRACKED.md"),
      "utf8"
    );
    const safetyPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: safetyCheckpoint?.id ?? "",
      })
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.restoreCheckpoint", {
        checkpointId: safetyCheckpoint?.id ?? "",
        confirmation: safetyPreview.restoreToken,
      })
    );
    const afterSafetyRestore = await readFile(
      path.join(tempProjectRoot, "TRACKED.md"),
      "utf8"
    );
    console.log(
      "CHECKPOINT_TRACKED_CONFLICT_RESOLVE",
      JSON.stringify({
        initialReady: initialPreview.canRestore,
        conflictReady: conflictPreview.canRestore,
        risk: trackedRisk?.level ?? "missing",
        safetyMode: safetyCheckpoint?.restoreMode ?? "missing",
        resolvedFiles: resolvedCheckpoint?.partialRestores?.[0]?.files ?? [],
        resetToHead: afterResolve.replace(/\r\n/g, "\n") === "line 1\nline 2\n",
        safetyReapplied:
          afterSafetyRestore.replace(/\r\n/g, "\n") ===
          "line 1\nline 2 user edit\n",
      })
    );
    if (
      !initialPreview.canRestore ||
      conflictPreview.canRestore ||
      trackedRisk?.level !== "blocked" ||
      !trackedRisk.reason.includes("Tracked checkpoint patch no longer applies") ||
      safetyCheckpoint?.restoreMode !== "apply-patch" ||
      resolvedCheckpoint?.partialRestores?.[0]?.files[0] !== "TRACKED.md" ||
      afterResolve.replace(/\r\n/g, "\n") !== "line 1\nline 2\n" ||
      afterSafetyRestore.replace(/\r\n/g, "\n") !==
        "line 1\nline 2 user edit\n"
    ) {
      throw new Error("Desktop smoke tracked checkpoint conflict resolve failed.");
    }
  } finally {
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function runTrackedCheckpointConflictChoiceSmoke(
  repoProjectId: string
): Promise<void> {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    console.log(
      "CHECKPOINT_TRACKED_CONFLICT_CHOICE",
      JSON.stringify({ skipped: "git missing" })
    );
    return;
  }

  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-checkpoint-choice-smoke-")
  );
  let tempProject: ProjectSummary | null = null;
  try {
    await execFileAsync("git", ["init"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "desktop-smoke@example.test"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Desktop Smoke"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(path.join(tempProjectRoot, "KEEP.md"), "keep base\n", "utf8");
    await writeFile(
      path.join(tempProjectRoot, "RESTORE.md"),
      "restore base\n",
      "utf8"
    );
    await execFileAsync("git", ["add", "KEEP.md", "RESTORE.md"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(
      path.join(tempProjectRoot, "KEEP.md"),
      "keep checkpoint\n",
      "utf8"
    );
    await writeFile(
      path.join(tempProjectRoot, "RESTORE.md"),
      "restore checkpoint\n",
      "utf8"
    );
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke Tracked Choice",
        path: tempProjectRoot,
        description: "Temporary tracked checkpoint conflict choice project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const checkpointSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.createCheckpoint", {
        name: "Desktop Smoke Tracked Choice",
      })
    );
    const checkpoint = checkpointSnapshot.checkpoints.items[0];
    if (!checkpoint) {
      throw new Error("Desktop smoke tracked choice checkpoint was not created.");
    }
    await writeFile(
      path.join(tempProjectRoot, "KEEP.md"),
      "keep user edit\n",
      "utf8"
    );
    const conflictPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const conflictRisk = conflictPreview.restoreRisks.find(
      (risk) => risk.file === "KEEP.md"
    );
    const editorTrackedChoices = conflictPreview.restoreRisks
      .filter(
        (risk) =>
          risk.level === "blocked" &&
          risk.reason.includes("Tracked checkpoint patch no longer applies")
      )
      .map((risk) => risk.file)
      .sort();
    const editorSafeFiles = conflictPreview.restoreRisks
      .filter((risk) => risk.level === "safe")
      .map((risk) => risk.file)
      .sort();
    const choiceSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.resolveCheckpointTrackedConflictChoice", {
        checkpointId: checkpoint.id,
        confirmation: conflictPreview.restoreToken,
        files: ["KEEP.md"],
        resolution: "current",
      })
    );
    const choiceCheckpoint = choiceSnapshot.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const readyPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const keepRisk = readyPreview.restoreRisks.find(
      (risk) => risk.file === "KEEP.md"
    );
    const restoreRisk = readyPreview.restoreRisks.find(
      (risk) => risk.file === "RESTORE.md"
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.restoreCheckpoint", {
        checkpointId: checkpoint.id,
        confirmation: readyPreview.restoreToken,
      })
    );
    const keepContent = await readFile(path.join(tempProjectRoot, "KEEP.md"), "utf8");
    const restoreContent = await readFile(
      path.join(tempProjectRoot, "RESTORE.md"),
      "utf8"
    );
    const keptCurrent = keepContent.replace(/\r\n/g, "\n") === "keep user edit\n";
    const restoredOther =
      restoreContent.replace(/\r\n/g, "\n") === "restore base\n";
    const mixedEditor =
      editorTrackedChoices.includes("KEEP.md") &&
      editorSafeFiles.includes("RESTORE.md") &&
      choiceCheckpoint?.partialRestores?.[0]?.files[0] === "KEEP.md" &&
      choiceCheckpoint?.partialRestores?.[0]?.resolution === "current" &&
      restoreRisk?.level === "safe";
    console.log(
      "CHECKPOINT_MIXED_CONFLICT_EDITOR",
      JSON.stringify({
        trackedChoices: editorTrackedChoices,
        safeFiles: editorSafeFiles,
        selectedChoiceFiles: choiceCheckpoint?.partialRestores?.[0]?.files ?? [],
        selectedChoice: choiceCheckpoint?.partialRestores?.[0]?.resolution ?? null,
        mixedEditor,
      })
    );
    console.log(
      "CHECKPOINT_TRACKED_CONFLICT_CHOICE",
      JSON.stringify({
        conflictReady: conflictPreview.canRestore,
        conflictRisk: conflictRisk?.level ?? "missing",
        editorTrackedChoices,
        editorSafeFiles,
        choice: choiceCheckpoint?.partialRestores?.[0]?.resolution ?? "missing",
        afterChoiceReady: readyPreview.canRestore,
        keepRisk: keepRisk?.level ?? "missing",
        restoreRisk: restoreRisk?.level ?? "missing",
        keptCurrent,
        restoredOther,
      })
    );
    if (
      conflictPreview.canRestore ||
      conflictRisk?.level !== "blocked" ||
      !mixedEditor ||
      choiceCheckpoint?.partialRestores?.[0]?.resolution !== "current" ||
      !readyPreview.canRestore ||
      keepRisk?.level !== "warning" ||
      restoreRisk?.level !== "safe" ||
      !keptCurrent ||
      !restoredOther
    ) {
      throw new Error("Desktop smoke tracked checkpoint conflict choice failed.");
    }
  } finally {
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function runTrackedCheckpointConflictHunkChoiceSmoke(
  repoProjectId: string
): Promise<void> {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    console.log(
      "CHECKPOINT_CONFLICT_HUNK_CHOICES",
      JSON.stringify({ skipped: "git missing" })
    );
    return;
  }

  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-checkpoint-hunk-choice-smoke-")
  );
  let tempProject: ProjectSummary | null = null;
  try {
    await execFileAsync("git", ["init"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "desktop-smoke@example.test"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Desktop Smoke"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    const baseLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    await writeFile(
      path.join(tempProjectRoot, "MIXED.md"),
      `${baseLines.join("\n")}\n`,
      "utf8"
    );
    await execFileAsync("git", ["add", "MIXED.md"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    const checkpointLines = [...baseLines];
    checkpointLines[1] = "line 2 checkpoint";
    checkpointLines[17] = "line 18 checkpoint";
    await writeFile(
      path.join(tempProjectRoot, "MIXED.md"),
      `${checkpointLines.join("\n")}\n`,
      "utf8"
    );
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke Hunk Choices",
        path: tempProjectRoot,
        description: "Temporary tracked checkpoint hunk choice project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const checkpointSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.createCheckpoint", {
        name: "Desktop Smoke Hunk Choices",
      })
    );
    const checkpoint = checkpointSnapshot.checkpoints.items[0];
    if (!checkpoint) {
      throw new Error("Desktop smoke hunk choice checkpoint was not created.");
    }
    const preview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const diff = preview.diffFiles.find((file) => file.path === "MIXED.md");
    const currentLines = [...checkpointLines];
    currentLines[17] = "line 18 user current";
    await writeFile(
      path.join(tempProjectRoot, "MIXED.md"),
      `${currentLines.join("\n")}\n`,
      "utf8"
    );
    const conflictPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const risk = conflictPreview.restoreRisks.find(
      (item) => item.file === "MIXED.md"
    );
    const mixedSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.resolveCheckpointTrackedConflictHunks", {
        checkpointId: checkpoint.id,
        confirmation: conflictPreview.restoreToken,
        hunks: [{ file: "MIXED.md", hunkIndex: 0 }],
      })
    );
    const mixedCheckpoint = mixedSnapshot.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const latestRestore = mixedCheckpoint?.partialRestores?.[0];
    const safetyCheckpoint = mixedSnapshot.checkpoints.items.find(
      (item) => item.id === latestRestore?.safetyCheckpointId
    );
    const afterMixed = (await readFile(path.join(tempProjectRoot, "MIXED.md"), "utf8"))
      .replace(/\r\n/g, "\n")
      .split("\n");
    const restoreChoices =
      latestRestore?.hunkChoices?.filter((choice) => choice.resolution === "restore") ??
      [];
    const currentChoices =
      latestRestore?.hunkChoices?.filter((choice) => choice.resolution === "current") ??
      [];
    console.log(
      "CHECKPOINT_CONFLICT_HUNK_CHOICES",
      JSON.stringify({
        initialHunks: diff?.hunks.length ?? -1,
        conflictReady: conflictPreview.canRestore,
        risk: risk?.level ?? "missing",
        resolution: latestRestore?.resolution ?? "missing",
        restoredHunks: restoreChoices.map(
          (choice) => `${choice.file}#${choice.hunkIndex}`
        ),
        currentHunks: currentChoices.map(
          (choice) => `${choice.file}#${choice.hunkIndex}`
        ),
        safety: Boolean(safetyCheckpoint),
        safetyMode: safetyCheckpoint?.restoreMode ?? "missing",
        line2Restored: afterMixed[1] === "line 2",
        line18Kept: afterMixed[17] === "line 18 user current",
      })
    );
    if (
      diff?.hunks.length !== 2 ||
      conflictPreview.canRestore ||
      risk?.level !== "blocked" ||
      !risk.reason.includes("Tracked checkpoint patch no longer applies") ||
      latestRestore?.resolution !== "mixed" ||
      restoreChoices[0]?.file !== "MIXED.md" ||
      restoreChoices[0]?.hunkIndex !== 0 ||
      currentChoices[0]?.file !== "MIXED.md" ||
      currentChoices[0]?.hunkIndex !== 1 ||
      safetyCheckpoint?.restoreMode !== "apply-patch" ||
      afterMixed[1] !== "line 2" ||
      afterMixed[17] !== "line 18 user current"
    ) {
      throw new Error("Desktop smoke checkpoint conflict hunk choices failed.");
    }
  } finally {
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function runMcpSessionInjectionSmoke(repoProjectId: string): Promise<void> {
  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-mcp-session-smoke-")
  );
  const capturePath = path.join(tempProjectRoot, "mcp-session-capture.json");
  let tempProject: ProjectSummary | null = null;
  let tempAgent: AgentSummary | null = null;
  let mcpChatId: string | null = null;
  let injectedSseMcp: Awaited<ReturnType<typeof startSseMcpFixture>> | null = null;
  const previousSessionMcpAuth = process.env.ERAGEAR_DESKTOP_MCP_AUTH;
  let sessionMcpAuthChanged = false;
  try {
    await writeFile(path.join(tempProjectRoot, "README.md"), "mcp session\n", "utf8");
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke MCP Session",
        path: tempProjectRoot,
        description: "Temporary MCP session injection project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const mcpSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertMcpServer", {
        projectId: tempProject.id,
        id: "desktop-session-injected-mcp",
        name: "Desktop Session Injected MCP",
        transport: "stdio",
        enabled: true,
        command: process.execPath,
        args: [smokeMcpScript],
      })
    );
    const mcpServer = mcpSnapshot.mcp.servers.find(
      (server) => server.id === "desktop-session-injected-mcp"
    );
    if (!mcpServer) {
      throw new Error("Desktop smoke MCP session server was not created.");
    }
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustMcpServer", {
        projectId: tempProject.id,
        serverId: mcpServer.id,
        fingerprint: mcpServer.fingerprint,
      })
    );
    process.env.ERAGEAR_DESKTOP_MCP_AUTH = "Bearer desktop-session-mcp-secret";
    sessionMcpAuthChanged = true;
    injectedSseMcp = await startSseMcpFixture();
    const sseSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertMcpServer", {
        projectId: tempProject.id,
        id: "desktop-session-injected-sse-mcp",
        name: "Desktop Session Injected SSE MCP",
        transport: "sse",
        enabled: true,
        url: injectedSseMcp.streamUrl,
        messageEndpoint: injectedSseMcp.messageEndpoint,
        headerEnv: {
          Authorization: "ERAGEAR_DESKTOP_MCP_AUTH",
        },
      })
    );
    const sseServer = sseSnapshot.mcp.servers.find(
      (server) => server.id === "desktop-session-injected-sse-mcp"
    );
    if (!sseServer) {
      throw new Error("Desktop smoke MCP session SSE server was not created.");
    }
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustMcpServer", {
        projectId: tempProject.id,
        serverId: sseServer.id,
        fingerprint: sseServer.fingerprint,
      })
    );
    tempAgent = await request<AgentSummary>(
      operation("mutation", "agents.create", {
        name: "Desktop MCP Capture Agent",
        type: "other",
        command: process.execPath,
        args: [acpMcpCaptureAgentScript, capturePath],
        env: {},
        projectId: tempProject.id,
      })
    );
    const session = await request<SessionCreateResult>(
      operation("mutation", "createSession", {
        projectId: tempProject.id,
        agentId: tempAgent.id,
      })
    );
    mcpChatId = session.chatId;
    const capture = await waitForJsonFile<{
      method: string;
      cwd?: string;
      mcpServers: Array<{
        name?: string;
        command?: string;
        args?: string[];
      }>;
    }>(capturePath);
    console.log(
      "MCP_SESSION_INJECTION",
      JSON.stringify({
        method: capture.method,
        cwd: capture.cwd,
        serverCount: capture.mcpServers.length,
        servers: capture.mcpServers.map((server) => [
          server.name ?? null,
          server.command ?? null,
          server.args ?? [],
        ]),
      })
    );
    if (
      capture.method !== "session/new" ||
      capture.cwd !== tempProjectRoot ||
      capture.mcpServers.length !== 2 ||
      capture.mcpServers.some((server) => server.command !== process.execPath) ||
      !capture.mcpServers.every((server) =>
        server.args?.some((arg) => arg.includes("mcp-agent-broker.js"))
      ) ||
      !capture.mcpServers.some((server) =>
        server.args?.includes("desktop-session-injected-mcp")
      ) ||
      !capture.mcpServers.some((server) =>
        server.args?.includes("desktop-session-injected-sse-mcp")
      ) ||
      JSON.stringify(capture.mcpServers).includes("desktop-session-mcp-secret")
    ) {
      throw new Error("Desktop smoke MCP server was not injected into ACP newSession.");
    }
    const stdioInjectedServer = capture.mcpServers.find(
      (server) => server.name === "Desktop Session Injected MCP"
    );
    const sseInjectedServer = capture.mcpServers.find(
      (server) => server.name === "Desktop Session Injected SSE MCP"
    );
    if (
      !stdioInjectedServer?.command ||
      !sseInjectedServer?.command
    ) {
      throw new Error("Desktop smoke MCP session injection missed broker routes.");
    }
    const brokerCall = await requestStdioJsonRpc({
      command: stdioInjectedServer.command,
      args: stdioInjectedServer.args ?? [],
      cwd: tempProjectRoot,
      method: "tools/call",
      rpcParams: {
        name: "desktop_smoke_tool",
        arguments: { path: "README.md" },
      },
    });
    const sseBrokerCall = await requestStdioJsonRpc({
      command: sseInjectedServer.command,
      args: sseInjectedServer.args ?? [],
      cwd: tempProjectRoot,
      method: "tools/call",
      rpcParams: {
        name: "desktop_smoke_sse_tool",
        arguments: { path: "SSE.md" },
      },
    });
    const brokerSnapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const brokerRoute = brokerSnapshot.mcp.agentRouting.routes.find(
      (route) => route.serverId === "desktop-session-injected-mcp"
    );
    const sseBrokerRoute = brokerSnapshot.mcp.agentRouting.routes.find(
      (route) => route.serverId === "desktop-session-injected-sse-mcp"
    );
    console.log(
      "MCP_SESSION_BROKER",
      JSON.stringify({
        responseHasResult: Boolean(brokerCall.result),
        sseResponseHasResult: Boolean(sseBrokerCall.result),
        brokerMode: brokerRoute?.brokerMode ?? null,
        sseBrokerMode: sseBrokerRoute?.brokerMode ?? null,
        agentInvocationCount: brokerRoute?.agentInvocationCount ?? 0,
        sseAgentInvocationCount: sseBrokerRoute?.agentInvocationCount ?? 0,
        last: brokerRoute?.lastAgentInvocation
          ? [
              brokerRoute.lastAgentInvocation.method,
              brokerRoute.lastAgentInvocation.status,
              brokerRoute.lastAgentInvocation.target,
            ]
          : null,
        sseLast: sseBrokerRoute?.lastAgentInvocation
          ? [
              sseBrokerRoute.lastAgentInvocation.method,
              sseBrokerRoute.lastAgentInvocation.status,
              sseBrokerRoute.lastAgentInvocation.target,
            ]
          : null,
      })
    );
    if (
      !JSON.stringify(brokerCall).includes("desktop tool call desktop_smoke_tool") ||
      !JSON.stringify(sseBrokerCall).includes(
        "desktop sse tool desktop_smoke_sse_tool"
      ) ||
      JSON.stringify(sseBrokerCall).includes("desktop-session-mcp-secret") ||
      !JSON.stringify(sseBrokerCall).includes("[redacted]") ||
      brokerRoute?.brokerMode !== "stdio-proxy" ||
      sseBrokerRoute?.brokerMode !== "stdio-proxy" ||
      (brokerRoute.agentInvocationCount ?? 0) < 1 ||
      (sseBrokerRoute.agentInvocationCount ?? 0) < 1 ||
      brokerRoute.lastAgentInvocation?.method !== "tools/call" ||
      brokerRoute.lastAgentInvocation?.status !== "success" ||
      brokerRoute.lastAgentInvocation?.target !== "desktop_smoke_tool" ||
      sseBrokerRoute.lastAgentInvocation?.method !== "tools/call" ||
      sseBrokerRoute.lastAgentInvocation?.status !== "success" ||
      sseBrokerRoute.lastAgentInvocation?.target !== "desktop_smoke_sse_tool"
    ) {
      throw new Error("Desktop smoke MCP broker did not execute and audit agent call.");
    }
  } finally {
    if (sessionMcpAuthChanged) {
      if (previousSessionMcpAuth === undefined) {
        delete process.env.ERAGEAR_DESKTOP_MCP_AUTH;
      } else {
        process.env.ERAGEAR_DESKTOP_MCP_AUTH = previousSessionMcpAuth;
      }
    }
    if (mcpChatId) {
      await request<unknown>(
        operation("mutation", "stopSession", { chatId: mcpChatId })
      ).catch(() => undefined);
    }
    if (tempAgent) {
      await request<unknown>(
        operation("mutation", "agents.delete", { id: tempAgent.id })
      ).catch(() => undefined);
    }
    if (injectedSseMcp) {
      await injectedSseMcp.close().catch(() => undefined);
    }
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function subscribeUntilConnected(chatId: string): Promise<{
  subscriptionId: string | null;
  connected: boolean;
  assistantSeen: () => boolean;
}> {
  let subscriptionId: string | null = null;
  let assistantObserved = false;
  const connected = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    host
      .subscribeOperation({
        auth: { localAuthToken: token },
        operation: operation("subscription", "onSessionEvents", { chatId }),
        onEvent: (event) => {
          if (event.type === "started") {
            console.log("SUBSCRIPTION_STARTED");
          }
          if (event.type === "data") {
            const data = event.data as { type?: string } | undefined;
            if (data?.type === "connected") {
              clearTimeout(timer);
              resolve(true);
            }
            if (
              data?.type === "message" ||
              data?.type === "message_part" ||
              data?.type === "ui_message"
            ) {
              assistantObserved = true;
            }
          }
          if (event.type === "error") {
            console.log("SUBSCRIPTION_ERROR", JSON.stringify(event.error));
          }
        },
      })
      .then((result) => {
        subscriptionId = result.subscriptionId;
      })
      .catch((error) => {
        clearTimeout(timer);
        console.log(
          "SUBSCRIBE_FAILED",
          error instanceof Error ? error.message : String(error)
        );
        resolve(false);
      });
  });

  return {
    subscriptionId,
    connected,
    assistantSeen: () => assistantObserved,
  };
}

async function main(): Promise<void> {
  let chatId: string | null = null;
  let timelineChatId: string | null = null;
  let subscriptionId: string | null = null;
  let sessionLifecycleHooksBackup: string | null | undefined;
  let embeddingServer: MockEmbeddingServerHandle | undefined;
  const previousMcpAuth = process.env.ERAGEAR_DESKTOP_MCP_AUTH;
  const previousAllowedAgentPolicies = process.env.ALLOWED_AGENT_COMMAND_POLICIES;
  const smokeAgentPolicies: Array<{ command: string; allowAnyArgs: true }> = [
    { command: process.execPath, allowAnyArgs: true },
  ];
  for (const command of ["opencode", "codex", "claude", "gemini"]) {
    const resolved = await resolveCliCommand(command);
    if (resolved) {
      smokeAgentPolicies.push({ command: resolved, allowAnyArgs: true });
    }
  }
  process.env.ALLOWED_AGENT_COMMAND_POLICIES = JSON.stringify(smokeAgentPolicies);
  process.env.ERAGEAR_DESKTOP_MCP_AUTH = "Bearer desktop-mcp-secret";

  try {
    embeddingServer = await startMockEmbeddingServer();
    const diagnostics = await host.start();
    console.log(
      "START",
      JSON.stringify({
        endpoint: diagnostics.endpoint.kind,
        ready: diagnostics.health.ready,
        clis: diagnostics.cliAvailability.map((cli) => [
          cli.id,
          cli.available,
          cli.version ?? null,
        ]),
      })
    );
    console.log(
      "RUNTIME_SECURITY_POSTURE",
      JSON.stringify({
        status: diagnostics.securityPosture?.status ?? "missing",
        csp: diagnostics.securityPosture?.contentSecurityPolicy ?? "missing",
        contextIsolation: diagnostics.securityPosture?.contextIsolation ?? false,
        nodeIntegration: diagnostics.securityPosture?.nodeIntegration ?? true,
        sandbox: diagnostics.securityPosture?.sandbox ?? false,
        endpointNetworkExposed:
          diagnostics.securityPosture?.endpointNetworkExposed ??
          diagnostics.endpoint.networkExposed,
        localAuthTokenRedacted:
          diagnostics.securityPosture?.localAuthTokenRedacted ?? false,
        messagesLeakToken: diagnostics.messages.some((message) => message.includes(token)),
      })
    );
    if (
      !diagnostics.securityPosture ||
      !diagnostics.securityPosture.contextIsolation ||
      diagnostics.securityPosture.nodeIntegration ||
      diagnostics.securityPosture.endpointNetworkExposed ||
      !diagnostics.securityPosture.localAuthTokenRedacted ||
      diagnostics.messages.some((message) => message.includes(token))
    ) {
      throw new Error("Desktop runtime security posture diagnostics are not hardened enough.");
    }

    const project = await ensureRepoProject();
    let ade = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const activeAgentForProviderProbe = ade.agents.items.find(
      (item) => item.id === ade.agents.activeAgentId
    );
    const activeProviderForProbe = activeAgentForProviderProbe
      ? ade.providers.find(
          (provider) =>
            provider.id === `provider.agent.${activeAgentForProviderProbe.id}`
        )
      : undefined;
    const activeCliForProviderProbe = activeAgentForProviderProbe
      ? diagnostics.cliAvailability.find(
          (item) =>
            item.id === activeAgentForProviderProbe.type ||
            smokeCommandToken(item.command) ===
              smokeCommandToken(activeAgentForProviderProbe.command) ||
            smokeCommandToken(item.executablePath) ===
              smokeCommandToken(activeAgentForProviderProbe.command)
        )
      : undefined;
    if (
      activeAgentForProviderProbe &&
      activeCliForProviderProbe?.available &&
      (activeProviderForProbe?.status === "unavailable" ||
        activeProviderForProbe?.cliStatus === "failed" ||
        activeProviderForProbe?.cliStatus === "missing")
    ) {
      ade = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.testProvider", {
          providerId: `provider.agent.${activeAgentForProviderProbe.id}`,
        })
      );
    }
    console.log(
      "ADE",
      JSON.stringify({
        projectRoot: ade.projectRoot,
        providers: ade.providers.map((provider) => [
          provider.id,
          provider.status,
          provider.cliStatus ?? null,
          provider.authStatus ?? null,
          provider.modelStatus ?? null,
          provider.version ?? null,
        ]),
        mcp: ade.mcp.servers.map((server) => [
          server.name,
          server.health,
          server.protocol.status,
          server.protocol.toolsDiscovered,
          server.protocol.resourcesDiscovered,
        ]),
        checkpoints: ade.checkpoints.items.length,
        projectIndex: [
          ade.projectIndex.indexedFiles,
          ade.projectIndex.indexedAt ?? null,
        ],
        hooks: ade.hooks.items.map((hook) => [
          hook.name,
          hook.event,
          hook.enabled,
        ]),
        plugins: ade.plugins.items.map((plugin) => [
          plugin.name,
          plugin.enabled,
        ]),
        commands: ade.capabilities.capabilities
          .filter((item) => item.kind === "command")
          .map((item) => item.name),
        subagents: ade.subagents.map((item) => [item.name, item.enabled]),
        memory: ade.projectMemory.sources.map((source) => source.relativePath),
        blockers: ade.blockers.map((blocker) => blocker.workflow),
      })
    );
    const readyProviderCount = ade.providers.filter(
      (provider) => provider.status === "ready"
    ).length;
    const enabledMcpServers = ade.mcp.servers.filter((server) => server.enabled);
    const initializedMcpServers = enabledMcpServers.filter(
      (server) => server.protocol.status === "initialized"
    );
    const enabledMemorySources = ade.projectMemory.sources.filter(
      (source) => source.enabled
    ).length;
    const primaryDeckAction =
      ade.providers.length === 0 || readyProviderCount < ade.providers.length
        ? "provider"
        : ade.changeTrust.changedFiles.length > 0
          ? "checkpoint"
          : initializedMcpServers.length > 0
            ? "mcp"
            : ade.projectIndex.indexedAt
              ? "session"
              : "index";
    console.log(
      "ADE_COMMAND_DECK",
      JSON.stringify({
        status: ade.sessions.active.length > 0 ? "running" : "ready",
        primaryAction: primaryDeckAction,
        panels: ["operation", "guardrail", "tooling", "context"],
        guardrail: ade.changeTrust.isGitRepo
          ? `${ade.changeTrust.changedFiles.length} changed`
          : "not git",
        tooling: `${initializedMcpServers.length}/${enabledMcpServers.length}`,
        context: ade.projectIndex.indexedAt
          ? `${ade.projectIndex.indexedFiles} indexed`
          : `${enabledMemorySources} memory`,
        commands: [
          ade.projectIndex.indexedAt ? "/index <query>" : null,
          enabledMemorySources > 0 ? "/memory <request>" : null,
          ade.subagents.some((item) => item.name === "code-reviewer" && item.enabled)
            ? "/agent-code-reviewer"
            : null,
        ].filter((item): item is string => typeof item === "string"),
      })
    );
    console.log(
      "PROVIDER_REMEDIATION_MATRIX",
      JSON.stringify({
        providers: ade.providers.map((provider) => ({
          id: provider.id,
          status: provider.status,
          cliStatus: provider.cliStatus ?? "unknown",
          authStatus: provider.authStatus ?? "unknown",
          modelStatus: provider.modelStatus ?? "unknown",
          modelListSource: provider.modelListSource ?? "fallback",
          remediationCount: provider.remediation?.length ?? 0,
          hasSecretValue:
            (provider.remediation ?? []).some((item) =>
              /secret|token|api[_-]?key/i.test(item)
            ) &&
            !(provider.remediation ?? []).some((item) =>
              /redacted|env key|without exposing/i.test(item)
            ),
        })),
      })
    );
    const agentLaunchMatrix = ade.agents.items.map((agent) => {
      const provider = ade.providers.find(
        (item) => item.id === `provider.agent.${agent.id}`
      );
      const cli = diagnostics.cliAvailability.find(
        (item) =>
          item.id === agent.type ||
          smokeCommandToken(item.command) === smokeCommandToken(agent.command) ||
          smokeCommandToken(item.executablePath) ===
            smokeCommandToken(agent.command)
      );
      const cliAvailable = cli?.available ?? provider?.cliStatus === "ok";
      const providerBlocked =
        provider?.status === "missing-config" ||
        provider?.status === "unavailable" ||
        provider?.cliStatus === "missing" ||
        provider?.cliStatus === "failed";
      const status = !cliAvailable
        ? "missing-cli"
        : providerBlocked
          ? "unavailable"
          : provider?.status === "ready"
            ? "ready"
            : "needs-probe";
      return {
        id: agent.id,
        type: agent.type,
        active: agent.isActive,
        command: agent.command,
        cliAvailable,
        providerStatus: provider?.status ?? "missing-provider",
        status,
        canStart: status === "ready" || status === "needs-probe",
      };
    });
    console.log(
      "AGENT_LAUNCH_MATRIX",
      JSON.stringify({
        activeAgentId: ade.agents.activeAgentId,
        agents: agentLaunchMatrix,
      })
    );
    if (
      agentLaunchMatrix.length === 0 ||
      !agentLaunchMatrix.some((agent) => agent.canStart)
    ) {
      throw new Error("No startable agent launch target was visible in Local ADE.");
    }
    const authAdminPolicy = ade.dashboardParity.find(
      (item) => item.workflow === "Auth admin and device sessions"
    );
    console.log(
      "DASHBOARD_LOCAL_POLICY",
      JSON.stringify({
        workflow: authAdminPolicy?.workflow ?? "missing",
        status: authAdminPolicy?.status ?? "missing",
        decision: authAdminPolicy?.policy?.decision ?? "missing",
        scope: authAdminPolicy?.policy?.scope ?? "missing",
        inBlockers: ade.blockers.some(
          (blocker) => blocker.workflow === "Auth admin and device sessions"
        ),
        reviewedAt: authAdminPolicy?.policy?.reviewedAt ?? null,
      })
    );
    if (
      !authAdminPolicy ||
      authAdminPolicy.status !== "not-applicable" ||
      authAdminPolicy.policy?.decision !== "not-applicable" ||
      ade.blockers.some(
        (blocker) => blocker.workflow === "Auth admin and device sessions"
      )
    ) {
      throw new Error("Dashboard auth admin policy is not classified as local N/A.");
    }
    if (!ade.subagents.some((item) => item.name === "code-reviewer" && item.enabled)) {
      throw new Error("Expected enabled code-reviewer subagent in Local ADE snapshot.");
    }
    const subagentCommand = ade.capabilities.capabilities.find(
      (item) =>
        item.kind === "subagent" && item.name === "code-reviewer" && item.enabled
    );
    if (!subagentCommand) {
      throw new Error("Expected code-reviewer subagent command in Local ADE capabilities.");
    }
    console.log(
      "SUBAGENT_COMMAND_READY",
      JSON.stringify({
        command: "/agent-code-reviewer",
        name: subagentCommand.name,
        sourcePath: subagentCommand.sourcePath ?? null,
      })
    );

    const agent = await chooseAgent();

    await runCheckpointRiskSmoke(project.id, agent.id);
    await runTrackedCheckpointConflictSmoke(project.id);
    await runTrackedCheckpointConflictChoiceSmoke(project.id);
    await runTrackedCheckpointConflictHunkChoiceSmoke(project.id);
    await runMcpSessionInjectionSmoke(project.id);

    await withFileBackup(smokeCommandPath, async () => {
      await mkdir(path.dirname(smokeCommandPath), { recursive: true });
      await writeFile(
        smokeCommandPath,
        [
          "---",
          "name: /desktop-smoke",
          "description: Desktop smoke local command",
          "argument-hint: <smoke request>",
          "---",
          "Reply with exactly: desktop command smoke ok for $ARGUMENTS",
          "",
        ].join("\n"),
        "utf8"
      );
      const commandSnapshot = await request<LocalAdeSnapshot>(
        operation("query", "settings.getLocalAdeSnapshot")
      );
      const smokeCommand = commandSnapshot.commands.find(
        (command) => command.name === "/desktop-smoke" && command.enabled
      );
      console.log(
        "COMMAND_DISCOVERY",
        JSON.stringify({
          present: Boolean(smokeCommand),
          promptHasPlaceholder: smokeCommand?.prompt.includes("$ARGUMENTS") ?? false,
          argumentHint: smokeCommand?.argumentHint ?? null,
          capabilityPresent: commandSnapshot.capabilities.capabilities.some(
            (item) =>
              item.kind === "command" &&
              item.name === "/desktop-smoke" &&
              item.enabled
          ),
        })
      );
      if (
        !smokeCommand ||
        smokeCommand.argumentHint !== "<smoke request>" ||
        !smokeCommand.prompt.includes("$ARGUMENTS")
      ) {
        throw new Error("Desktop smoke local slash command discovery did not complete.");
      }
    });

    await withFileBackup(capabilitiesStatePath, async () => {
    await withFileBackup(smokeMemoryPath, async () => {
      await withFileBackup(smokeMemoryPresetPath, async () => {
        await mkdir(path.dirname(smokeMemoryPath), { recursive: true });
        await writeFile(
          smokeMemoryPath,
          [
            "# Desktop smoke provider notes",
            "Use provider-only setup notes for unrelated auth work.",
            "",
            "# Desktop smoke project context",
            "Prefer runtime-backed Local ADE actions.",
            "api_key=desktop-memory-secret",
            "",
          ].join("\n"),
          "utf8"
        );
        let memorySnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const memorySource = memorySnapshot.projectMemory.sources.find(
          (source) => source.relativePath === ".eragear/context.md"
        );
        if (!memorySource) {
          throw new Error("Desktop smoke project memory source was not discovered.");
        }
        if (!memorySource.enabled) {
          await request<LocalAdeSnapshot>(
            operation("mutation", "settings.updateCapabilityState", {
              capabilityId: memorySource.id,
              enabled: true,
            })
          );
        }
        const memoryContext = await request<ProjectMemoryContextResult>(
          operation("query", "settings.buildProjectMemoryContext", {
            query: "desktop smoke memory policy",
            sourcePaths: [memorySource.relativePath],
            maxBytes: 4000,
          })
        );
        console.log(
          "PROJECT_MEMORY_CONTEXT",
          JSON.stringify({
            status: memoryContext.status,
            sourceCount: memoryContext.sources.length,
            sources: memoryContext.sources.map((source) => [
              source.relativePath,
              source.includedBytes,
              source.truncated,
            ]),
            promptHasMemory: memoryContext.prompt.includes(
              "Prefer runtime-backed Local ADE actions."
            ),
            promptRedacted:
              memoryContext.prompt.includes("api_key= [redacted]") &&
              !memoryContext.prompt.includes("desktop-memory-secret"),
          })
        );
        if (
          memoryContext.status !== "ready" ||
          memoryContext.sources.length <= 0 ||
          !memoryContext.prompt.includes("Prefer runtime-backed Local ADE actions.") ||
          !memoryContext.prompt.includes("api_key= [redacted]") ||
          memoryContext.prompt.includes("desktop-memory-secret")
        ) {
          throw new Error("Desktop smoke project memory context did not complete.");
        }
        const semanticMemoryContext = await request<ProjectMemoryContextResult>(
          operation("query", "settings.buildProjectMemoryContext", {
            query: "runtime-backed Local ADE actions",
            sourcePaths: [memorySource.relativePath],
            retrievalMode: "semantic",
            maxChunks: 1,
            maxBytes: 4000,
          })
        );
        console.log(
          "PROJECT_MEMORY_SEMANTIC",
          JSON.stringify({
            status: semanticMemoryContext.status,
            retrievalMode: semanticMemoryContext.retrievalMode,
            ranker: semanticMemoryContext.semantic?.ranker ?? null,
            model: semanticMemoryContext.semantic?.model ?? null,
            dimensions: semanticMemoryContext.semantic?.dimensions ?? null,
            sourceCount: semanticMemoryContext.sources.length,
            chunkCount: semanticMemoryContext.chunks.length,
            chunk: semanticMemoryContext.chunks[0]
              ? [
                  semanticMemoryContext.chunks[0].relativePath,
                  semanticMemoryContext.chunks[0].startLine,
                  semanticMemoryContext.chunks[0].endLine,
                  semanticMemoryContext.chunks[0].score,
                  semanticMemoryContext.chunks[0].ranker ?? null,
                ]
              : null,
            promptHasRelevant: semanticMemoryContext.prompt.includes(
              "Prefer runtime-backed Local ADE actions."
            ),
            promptSkippedUnrelated: !semanticMemoryContext.prompt.includes(
              "Use provider-only setup notes"
            ),
            promptRedacted:
              semanticMemoryContext.prompt.includes("api_key= [redacted]") &&
              !semanticMemoryContext.prompt.includes("desktop-memory-secret"),
          })
        );
        console.log(
          "PROJECT_MEMORY_MODEL_EMBEDDING",
          JSON.stringify({
            ranker: semanticMemoryContext.semantic?.ranker ?? null,
            model: semanticMemoryContext.semantic?.model ?? null,
            dimensions: semanticMemoryContext.semantic?.dimensions ?? null,
            embeddingCalls: embeddingServer?.calls.length ?? 0,
            promptHasModelBacked: semanticMemoryContext.prompt.includes(
              "model-backed embedding chunk ranking"
            ),
            diagnosticsRedacted: !semanticMemoryContext.diagnostics
              .join("\n")
              .includes("smoke-embedding-secret"),
          })
        );
        if (
          semanticMemoryContext.status !== "ready" ||
          semanticMemoryContext.retrievalMode !== "semantic" ||
          semanticMemoryContext.semantic?.ranker !== "model-embedding" ||
          semanticMemoryContext.semantic?.model !== "smoke-embedding" ||
          semanticMemoryContext.chunks.length !== 1 ||
          semanticMemoryContext.chunks[0]?.ranker !== "model-embedding" ||
          (semanticMemoryContext.chunks[0]?.score ?? 0) <= 0 ||
          !semanticMemoryContext.prompt.includes(
            "model-backed embedding chunk ranking"
          ) ||
          !semanticMemoryContext.prompt.includes(
            "Prefer runtime-backed Local ADE actions."
          ) ||
          semanticMemoryContext.prompt.includes("Use provider-only setup notes") ||
          !semanticMemoryContext.prompt.includes("api_key= [redacted]") ||
          semanticMemoryContext.prompt.includes("desktop-memory-secret")
        ) {
          throw new Error("Desktop smoke semantic project memory did not complete.");
        }
        const memoryPresetSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertProjectMemoryPreset", {
            id: "desktop-smoke-memory-preset",
            name: "Desktop Smoke Memory Preset",
            sourcePaths: [memorySource.relativePath],
            defaultQuery: "desktop smoke preset policy",
            maxBytes: 4000,
          })
        );
        const memoryPreset = memoryPresetSnapshot.projectMemory.presets.find(
          (preset) => preset.id === "desktop-smoke-memory-preset"
        );
        const presetContext = await request<ProjectMemoryContextResult>(
          operation("query", "settings.buildProjectMemoryContext", {
            presetId: "desktop-smoke-memory-preset",
          })
        );
        console.log(
          "PROJECT_MEMORY_PRESET",
          JSON.stringify({
            saved: Boolean(memoryPreset),
            presetName: memoryPreset?.name ?? "",
            sourcePaths: memoryPreset?.sourcePaths ?? [],
            contextStatus: presetContext.status,
            presetId: presetContext.presetId ?? "",
            presetNameFromContext: presetContext.presetName ?? "",
            query: presetContext.query,
            promptHasPreset: presetContext.prompt.includes(
              'Use project memory preset "Desktop Smoke Memory Preset"'
            ),
            promptHasMemory: presetContext.prompt.includes(
              "Prefer runtime-backed Local ADE actions."
            ),
            promptRedacted:
              presetContext.prompt.includes("api_key= [redacted]") &&
              !presetContext.prompt.includes("desktop-memory-secret"),
          })
        );
        if (
          !memoryPreset ||
          presetContext.status !== "ready" ||
          presetContext.presetId !== "desktop-smoke-memory-preset" ||
          presetContext.presetName !== "Desktop Smoke Memory Preset" ||
          presetContext.query !== "desktop smoke preset policy" ||
          !presetContext.prompt.includes(
            'Use project memory preset "Desktop Smoke Memory Preset"'
          ) ||
          !presetContext.prompt.includes("Prefer runtime-backed Local ADE actions.") ||
          !presetContext.prompt.includes("api_key= [redacted]") ||
          presetContext.prompt.includes("desktop-memory-secret")
        ) {
          throw new Error("Desktop smoke project memory preset did not complete.");
        }
        const deletedPresetSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.deleteProjectMemoryPreset", {
            id: "desktop-smoke-memory-preset",
          })
        );
        if (
          deletedPresetSnapshot.projectMemory.presets.some(
            (preset) => preset.id === "desktop-smoke-memory-preset"
          )
        ) {
          throw new Error("Desktop smoke project memory preset was not deleted.");
        }
      });
    });

    await withFileBackup(smokeSkillPath, async () => {
      await withFileBackup(smokeOutputStylePath, async () => {
        await mkdir(path.dirname(smokeSkillPath), { recursive: true });
        await mkdir(path.dirname(smokeOutputStylePath), { recursive: true });
        await writeFile(
          smokeSkillPath,
          [
            "---",
            "name: Desktop Smoke Skill",
            "description: Verify skill invocation descriptors",
            "---",
            "Use the desktop smoke skill instructions.",
            "",
          ].join("\n"),
          "utf8"
        );
        await writeFile(
          smokeOutputStylePath,
          [
            "---",
            "name: Desktop Smoke Style",
            "description: Verify output style descriptors",
            "---",
            "Answer in the desktop smoke output style.",
            "",
          ].join("\n"),
          "utf8"
        );
        const instructionSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const smokeSkill = instructionSnapshot.skills.find(
          (skill) => skill.name === "Desktop Smoke Skill" && skill.enabled
        );
        const smokeStyle = instructionSnapshot.outputStyles.find(
          (style) => style.name === "Desktop Smoke Style" && style.enabled
        );
        console.log(
          "INSTRUCTION_DISCOVERY",
          JSON.stringify({
            skillPresent: Boolean(smokeSkill),
            skillPrompt: smokeSkill?.prompt.includes("desktop smoke skill") ?? false,
            stylePresent: Boolean(smokeStyle),
            stylePrompt:
              smokeStyle?.prompt.includes("desktop smoke output style") ?? false,
            skillCapability: instructionSnapshot.capabilities.capabilities.some(
              (item) =>
                item.kind === "skill" &&
                item.name === "Desktop Smoke Skill" &&
                item.enabled
            ),
            styleCapability: instructionSnapshot.capabilities.capabilities.some(
              (item) =>
                item.kind === "output-style" &&
                item.name === "Desktop Smoke Style" &&
                item.enabled
            ),
          })
        );
        if (
          !smokeSkill ||
          !smokeSkill.prompt.includes("desktop smoke skill") ||
          !smokeStyle ||
          !smokeStyle.prompt.includes("desktop smoke output style")
        ) {
          throw new Error(
            "Desktop smoke local skill/output-style discovery did not complete."
          );
        }
      });
    });

    await withFileBackup(repoIndexPath, async () => {
      await withFileBackup(smokeSemanticIndexPath, async () => {
        await writeFile(
          smokeSemanticIndexPath,
          [
            "# Desktop semantic smoke",
            "",
            "Checkpoint restore safety planning handles snapshot recovery.",
            "The rollback query should find this file through the local semantic profile.",
            "",
          ].join("\n"),
          "utf8"
        );
        const indexSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.refreshProjectIndex", {})
        );
        const persisted = JSON.parse(await readFile(repoIndexPath, "utf8")) as {
          files?: Array<{
            path?: string;
            embeddingVector?: unknown;
            embeddingModel?: string;
            embeddingHash?: string;
          }>;
          symbols?: Array<{ name?: string }>;
          tasks?: Array<{ marker?: string }>;
        };
        const hasGoal =
          persisted.files?.some((file) => file.path === "GOAL.md") ?? false;
        const persistedSemanticSmoke = persisted.files?.find(
          (file) => file.path === "desktop-semantic-smoke.md"
        );
        const hasSymbols = (persisted.symbols?.length ?? 0) > 0;
        const hasTasks = (persisted.tasks?.length ?? 0) > 0;
        console.log(
          "PROJECT_INDEX",
          JSON.stringify({
            indexedFiles: indexSnapshot.projectIndex.indexedFiles,
            totalBytes: indexSnapshot.projectIndex.totalBytes,
            extensions: indexSnapshot.projectIndex.extensions.slice(0, 5),
            symbolCount: indexSnapshot.projectIndex.symbols.length,
            taskCount: indexSnapshot.projectIndex.tasks.length,
            symbolSample: indexSnapshot.projectIndex.symbols
              .slice(0, 3)
              .map((symbol) => `${symbol.kind}:${symbol.name}`),
            taskSample: indexSnapshot.projectIndex.tasks
              .slice(0, 3)
              .map((task) => `${task.marker}:${task.path}:${task.line}`),
            semantic: indexSnapshot.projectIndex.semantic,
            visibleSample: indexSnapshot.projectIndex.files
              .slice(0, 5)
              .map((file) => file.path),
            persistedHasGoal: hasGoal,
            persistedHasSymbols: hasSymbols,
            persistedHasTasks: hasTasks,
            persistedSemanticEmbedding: Array.isArray(
              persistedSemanticSmoke?.embeddingVector
            ),
            visibleLeaksVector: indexSnapshot.projectIndex.files.some((file) =>
              "embeddingVector" in file
            ),
          })
        );
        if (
          indexSnapshot.projectIndex.indexedFiles <= 0 ||
          indexSnapshot.projectIndex.semantic.status !== "ready" ||
          indexSnapshot.projectIndex.semantic.source !== "model-embedding" ||
          indexSnapshot.projectIndex.semantic.model !== "smoke-embedding" ||
          indexSnapshot.projectIndex.symbols.length <= 0 ||
          indexSnapshot.projectIndex.tasks.length <= 0 ||
          !Array.isArray(persistedSemanticSmoke?.embeddingVector) ||
          indexSnapshot.projectIndex.files.some((file) =>
            "embeddingVector" in file
          ) ||
          !hasGoal ||
          !hasSymbols ||
          !hasTasks
        ) {
          throw new Error("Desktop smoke project index refresh did not complete.");
        }
        const searchQuery =
          indexSnapshot.projectIndex.tasks[0]?.marker ??
          indexSnapshot.projectIndex.symbols[0]?.name ??
          "GOAL.md";
        const indexSearch = await request<ProjectIndexSearchResult>(
          operation("query", "settings.searchProjectIndex", {
            query: searchQuery,
            limit: 6,
          })
        );
        console.log(
          "PROJECT_INDEX_SEARCH",
          JSON.stringify({
            status: indexSearch.status,
            query: indexSearch.query,
            resultCount: indexSearch.results.length,
            sample: indexSearch.results.slice(0, 3).map((item) => [
              item.type,
              item.title,
              item.path,
            ]),
            promptHasContext:
              indexSearch.prompt.includes("Matched project index entries") &&
              indexSearch.prompt.includes("Before editing, read the referenced files directly."),
          })
        );
        if (
          indexSearch.status !== "ready" ||
          indexSearch.results.length <= 0 ||
          !indexSearch.prompt.includes("Matched project index entries") ||
          !indexSearch.prompt.includes(
            "Before editing, read the referenced files directly."
          )
        ) {
          throw new Error("Desktop smoke project index search did not complete.");
        }
        const semanticSearch = await request<ProjectIndexSearchResult>(
          operation("query", "settings.searchProjectIndex", {
            query: "rollback safety",
            limit: 6,
          })
        );
        const semanticHit = semanticSearch.results.find(
          (item) => item.path === "desktop-semantic-smoke.md"
        );
        console.log(
          "PROJECT_INDEX_SEMANTIC_SEARCH",
          JSON.stringify({
            status: semanticSearch.status,
            resultCount: semanticSearch.results.length,
            semanticStatus: indexSnapshot.projectIndex.semantic.status,
            semanticSource: indexSnapshot.projectIndex.semantic.source,
            model: indexSnapshot.projectIndex.semantic.model ?? null,
            embeddedFiles: indexSnapshot.projectIndex.semantic.embeddedFiles ?? 0,
            semanticProfiledFiles:
              indexSnapshot.projectIndex.semantic.profiledFiles,
            hitPath: semanticHit?.path ?? null,
            matchKind: semanticHit?.matchKind ?? null,
            promptHasSemantic: semanticSearch.prompt.includes("semantic"),
            promptHasEmbedding: semanticSearch.prompt.includes(
              "model-backed embedding vectors"
            ),
          })
        );
        console.log(
          "PROJECT_INDEX_MODEL_EMBEDDING",
          JSON.stringify({
            source: indexSnapshot.projectIndex.semantic.source,
            model: indexSnapshot.projectIndex.semantic.model ?? null,
            dimensions: indexSnapshot.projectIndex.semantic.dimensions ?? null,
            embeddedFiles: indexSnapshot.projectIndex.semantic.embeddedFiles ?? 0,
            hitPath: semanticHit?.path ?? null,
            matchKind: semanticHit?.matchKind ?? null,
            diagnosticsRedacted: !semanticSearch.diagnostics
              .join("\n")
              .includes("smoke-embedding-secret"),
          })
        );
        if (
          semanticSearch.status !== "ready" ||
          !semanticHit ||
          semanticHit.matchKind !== "embedding" ||
          indexSnapshot.projectIndex.semantic.source !== "model-embedding" ||
          indexSnapshot.projectIndex.semantic.model !== "smoke-embedding" ||
          !semanticSearch.prompt.includes("model-backed embedding vectors") ||
          semanticSearch.diagnostics.join("\n").includes("smoke-embedding-secret")
        ) {
          throw new Error(
            "Desktop smoke model-backed project index search did not complete."
          );
        }
      });
    });
    });

    await withFileBackup(hooksPath, async () => {
      const hookSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertHook", {
          id: "desktop-smoke-hook",
          name: "Desktop Smoke Hook",
          event: "manual",
          enabled: true,
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('desktop hook ok '+process.env.ERAGEAR_HOOK_EVENT)",
          ],
          timeoutMs: 5000,
        })
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertHook", {
          id: "desktop-smoke-index-hook",
          name: "Desktop Smoke Index Hook",
          event: "after-project-index-refresh",
          enabled: true,
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('desktop lifecycle '+process.env.ERAGEAR_HOOK_EVENT)",
          ],
          timeoutMs: 5000,
        })
      );
      const smokeHookBeforeTrust = hookSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const untrustedHookCapability = hookSnapshot.capabilities.capabilities.find(
        (item) =>
          item.kind === "hook" &&
          item.name === "Desktop Smoke Hook"
      );
      let untrustedRunBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runHook", {
            hookId: "desktop-smoke-hook",
            confirmation:
              smokeHookBeforeTrust?.runConfirmationToken ??
              "RUN HOOK desktop-smoke-hook",
            operationApprovalId: "hook-approval-unused",
          })
        );
      } catch {
        untrustedRunBlocked = true;
      }
      const hookTrustSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustHook", {
          hookId: "desktop-smoke-hook",
          fingerprint: smokeHookBeforeTrust?.fingerprint ?? "",
        })
      );
      const lifecycleBeforeTrust = hookTrustSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-index-hook"
      );
      const trustedSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustHook", {
          hookId: "desktop-smoke-index-hook",
          fingerprint: lifecycleBeforeTrust?.fingerprint ?? "",
        })
      );
      const trustedHook = trustedSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const hookCapability = trustedSnapshot.capabilities.capabilities.some(
        (item) =>
          item.kind === "hook" &&
          item.name === "Desktop Smoke Hook" &&
          item.enabled
      );
      console.log(
        "HOOK_TRUST",
        JSON.stringify({
          beforeCapabilityEnabled: untrustedHookCapability?.enabled ?? null,
          beforeTrustStatus: smokeHookBeforeTrust?.trustStatus ?? "missing",
          trustStatus: trustedHook?.trustStatus ?? "missing",
          trusted: trustedHook?.trustedFingerprint === trustedHook?.fingerprint,
          untrustedRunBlocked,
          capabilityEnabled: hookCapability,
        })
      );
      if (
        untrustedHookCapability?.enabled !== false ||
        smokeHookBeforeTrust?.trustStatus !== "untrusted" ||
        !untrustedRunBlocked ||
        trustedHook?.trustStatus !== "trusted" ||
        !hookCapability
      ) {
        throw new Error("Desktop smoke hook trust gate did not complete.");
      }
      let hookConfirmationBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runHook", {
            hookId: "desktop-smoke-hook",
            confirmation: "RUN HOOK wrong",
            operationApprovalId: "hook-approval-unused",
          })
        );
      } catch (error) {
        hookConfirmationBlocked = error instanceof Error
          ? error.message.includes("confirmation")
          : String(error).includes("confirmation");
      }
      console.log(
        "HOOK_RUN_CONFIRMATION",
        JSON.stringify({
          blocked: hookConfirmationBlocked,
          token: trustedHook?.runConfirmationToken ?? "",
        })
      );
      if (!hookConfirmationBlocked || !trustedHook?.runConfirmationToken) {
        throw new Error("Desktop smoke hook run confirmation gate did not complete.");
      }
      const hookRunApproval = await approveHookRunOperation("desktop-smoke-hook");
      console.log(
        "HOOK_RUN_APPROVAL",
        JSON.stringify({
          hookId: "desktop-smoke-hook",
          approvalId: hookRunApproval.approvalId,
          fingerprint: hookRunApproval.fingerprint,
        })
      );
      const runSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runHook", {
          hookId: "desktop-smoke-hook",
          confirmation: trustedHook.runConfirmationToken,
          operationApprovalId: hookRunApproval.approvalId,
        })
      );
      const smokeHook = runSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      console.log(
        "HOOK_RUN",
        JSON.stringify({
          capabilityPresent: hookCapability,
          present: Boolean(smokeHook),
          status: smokeHook?.lastRun?.status ?? "missing",
          approvalStatus: smokeHook?.runOperation.approvalStatus ?? "missing",
          stdout: smokeHook?.lastRun?.stdout ?? "",
        })
      );
      const smokeHookLastRun = smokeHook?.lastRun;
      if (
        !hookCapability ||
        smokeHookLastRun?.status !== "success" ||
        smokeHook?.runOperation.approvalStatus !== "consumed" ||
        !smokeHookLastRun.stdout.includes("desktop hook ok manual")
      ) {
        throw new Error("Desktop smoke hook execution did not complete.");
      }
      console.log(
        "HOOK_PROCESS_ISOLATION",
        JSON.stringify({
          policyMode: smokeHook!.executionPolicy.isolation.mode,
          runMode: smokeHookLastRun.isolation?.mode ?? "missing",
          cwdScope: smokeHook!.runOperation.isolation.cwdScope,
          processTreeKill:
            smokeHookLastRun.isolation?.processTreeKill ?? "missing",
          shellFree: smokeHookLastRun.diagnostics.some((entry) =>
            entry.includes("shell:false") || entry.includes("without shell expansion")
          ),
        })
      );
      if (
        smokeHook!.executionPolicy.isolation.mode !== "job-process-tree" ||
        smokeHookLastRun.isolation?.mode !== "job-process-tree" ||
        smokeHook!.runOperation.isolation.cwdScope !== "project-root" ||
        smokeHookLastRun.isolation.processTreeKill !== "available"
      ) {
        throw new Error("Desktop smoke hook process isolation metadata missing.");
      }
      const reviewedHookSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.reviewHookRun", {
          runId: smokeHookLastRun.id,
          reviewed: true,
        })
      );
      const reviewedHook = reviewedHookSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      console.log(
        "HOOK_RUN_REVIEW",
        JSON.stringify({
          present: Boolean(reviewedHook),
          runId: reviewedHook?.lastRun?.id ?? "",
          reviewed: Boolean(reviewedHook?.lastRun?.reviewedAt),
        })
      );
      if (
        reviewedHook?.lastRun?.id !== smokeHookLastRun.id ||
        !reviewedHook.lastRun.reviewedAt
      ) {
        throw new Error("Desktop smoke hook run review did not persist.");
      }
      const hookAuditExport = await request<{
        schemaVersion: 1;
        redacted: true;
        filters: { reviewState: string; limit: number };
        stats: { matching: number; included: number; reviewed: number };
        runs: Array<{ id: string; reviewedAt?: string; stdout: string; stderr: string }>;
      }>(
        operation("mutation", "settings.exportHookRuns", {
          reviewState: "reviewed",
          limit: 5,
        })
      );
      console.log(
        "HOOK_RUN_AUDIT_EXPORT",
        JSON.stringify({
          redacted: hookAuditExport.redacted,
          reviewState: hookAuditExport.filters.reviewState,
          runs: hookAuditExport.runs.length,
          reviewed: hookAuditExport.runs.some(
            (run) => run.id === smokeHookLastRun.id && Boolean(run.reviewedAt)
          ),
        })
      );
      if (
        !hookAuditExport.redacted ||
        hookAuditExport.filters.reviewState !== "reviewed" ||
        !hookAuditExport.runs.some(
          (run) => run.id === smokeHookLastRun.id && Boolean(run.reviewedAt)
        )
      ) {
        throw new Error("Desktop smoke hook audit export did not include reviewed run.");
      }
      const cooldownHookPolicy = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.updateHookSchedulingPolicy", {
          enabled: true,
          maxConcurrentRuns: 1,
          cooldownMs: 600000,
        })
      );
      const cooldownHook = cooldownHookPolicy.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const cooldownHookCapability =
        cooldownHookPolicy.capabilities.capabilities.find(
          (item) => item.id === "hook.project.desktop-smoke-hook"
        );
      const cooldownHookApproval =
        await approveHookRunOperation("desktop-smoke-hook");
      const cooldownHookRunSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runHook", {
          hookId: "desktop-smoke-hook",
          confirmation:
            cooldownHook?.runConfirmationToken ??
            trustedHook.runConfirmationToken,
          operationApprovalId: cooldownHookApproval.approvalId,
        })
      );
      const cooldownRunHook = cooldownHookRunSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const resetHookScheduling = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.updateHookSchedulingPolicy", {
          enabled: true,
          maxConcurrentRuns: 1,
          cooldownMs: 0,
        })
      );
      console.log(
        "HOOK_SCHEDULING_POLICY",
        JSON.stringify({
          enabled: cooldownHookPolicy.hooks.schedulingPolicy.enabled,
          maxConcurrentRuns:
            cooldownHookPolicy.hooks.schedulingPolicy.maxConcurrentRuns,
          cooldownMs: cooldownHookPolicy.hooks.schedulingPolicy.cooldownMs,
          itemStatus: cooldownHook?.scheduling.status ?? "missing",
          capabilityEnabled: cooldownHookCapability?.enabled ?? null,
          blockedRunStatus: cooldownRunHook?.lastRun?.status ?? "missing",
          approvalStatus:
            cooldownRunHook?.runOperation.approvalStatus ?? "missing",
          diagnostic:
            cooldownRunHook?.lastRun?.diagnostics.some((entry) =>
              entry.includes("cooldown")
            ) ?? false,
          resetCooldownMs: resetHookScheduling.hooks.schedulingPolicy.cooldownMs,
        })
      );
      if (
        cooldownHookPolicy.hooks.schedulingPolicy.enabled !== true ||
        cooldownHookPolicy.hooks.schedulingPolicy.maxConcurrentRuns !== 1 ||
        cooldownHookPolicy.hooks.schedulingPolicy.cooldownMs !== 600000 ||
        cooldownHook?.scheduling.status !== "cooldown" ||
        cooldownHookCapability?.enabled !== false ||
        cooldownRunHook?.lastRun?.status !== "disabled" ||
        cooldownRunHook.runOperation.approvalStatus !== "consumed" ||
        cooldownRunHook.lastRun.diagnostics.some((entry) =>
          entry.includes("cooldown")
        ) !== true ||
        resetHookScheduling.hooks.schedulingPolicy.enabled !== true ||
        resetHookScheduling.hooks.schedulingPolicy.cooldownMs !== 0
      ) {
        throw new Error(
          "Desktop smoke hook scheduling policy did not block and audit cooldown run."
        );
      }
      const batchReadyHook = resetHookScheduling.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const batchReadyLifecycleHook = resetHookScheduling.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-index-hook"
      );
      const hookBatchSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runHookBatch", {
          hookIds: ["desktop-smoke-hook", "desktop-smoke-index-hook"],
          operationFingerprints: {
            "desktop-smoke-hook": batchReadyHook?.runOperation.fingerprint ?? "",
            "desktop-smoke-index-hook":
              batchReadyLifecycleHook?.runOperation.fingerprint ?? "",
          },
          confirmation: "RUN HOOK BATCH",
          failureMode: "stop-on-failure",
        })
      );
      const hookBatch = hookBatchSnapshot.hooks.recentBatches[0];
      const batchedHook = hookBatchSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const batchedLifecycleHook = hookBatchSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-index-hook"
      );
      console.log(
        "HOOK_BATCH_QUEUE",
        JSON.stringify({
          batchId: hookBatch?.id ?? "",
          status: hookBatch?.status ?? "missing",
          success: hookBatch?.counts.success ?? -1,
          disabled: hookBatch?.counts.disabled ?? -1,
          runIds: hookBatch?.runIds.length ?? -1,
          firstStatus: batchedHook?.lastRun?.status ?? "missing",
          secondStatus: batchedLifecycleHook?.lastRun?.status ?? "missing",
          firstBatch: batchedHook?.lastRun?.batchId ?? "",
          secondBatch: batchedLifecycleHook?.lastRun?.batchId ?? "",
        })
      );
      if (
        !hookBatch?.id.startsWith("hook-batch-") ||
        hookBatch.status !== "success" ||
        hookBatch.counts.success !== 2 ||
        hookBatch.runIds.length !== 2 ||
        batchedHook?.lastRun?.status !== "success" ||
        batchedLifecycleHook?.lastRun?.status !== "success" ||
        batchedHook.lastRun.batchId !== hookBatch.id ||
        batchedLifecycleHook.lastRun.batchId !== hookBatch.id
      ) {
        throw new Error("Desktop smoke hook batch queue did not execute hooks.");
      }
      const shellHookSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertHook", {
          id: "desktop-smoke-shell-hook",
          name: "Desktop Smoke Shell Hook",
          event: "manual",
          enabled: true,
          command: process.platform === "win32" ? "powershell" : "sh",
          args:
            process.platform === "win32"
              ? ["-NoProfile", "-Command", "Write-Output blocked"]
              : ["-c", "printf blocked"],
          timeoutMs: 5000,
        })
      );
      const shellHook = shellHookSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-shell-hook"
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustHook", {
          hookId: "desktop-smoke-shell-hook",
          fingerprint: shellHook?.fingerprint ?? "",
        })
      );
      let shellHookBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runHook", {
            hookId: "desktop-smoke-shell-hook",
            confirmation: "RUN HOOK desktop-smoke-shell-hook",
            operationApprovalId: "hook-approval-unused",
          })
        );
      } catch (error) {
        shellHookBlocked = error instanceof Error
          ? error.message.includes("sandbox")
          : String(error).includes("sandbox");
      }
      console.log(
        "HOOK_SANDBOX_BLOCK",
        JSON.stringify({
          policy: shellHook?.executionPolicy?.status ?? "missing",
          blocked: shellHookBlocked,
        })
      );
      if (shellHook?.executionPolicy?.status !== "blocked" || !shellHookBlocked) {
        throw new Error("Desktop smoke hook sandbox did not block shell evaluation.");
      }
      const policyHookSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertHook", {
          id: "desktop-smoke-policy-hook",
          name: "Desktop Smoke Policy Hook",
          event: "manual",
          enabled: true,
          policyPreset: "restricted",
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('policy hook should not run')",
          ],
          timeoutMs: 5000,
        })
      );
      const policyHook = policyHookSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-policy-hook"
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustHook", {
          hookId: "desktop-smoke-policy-hook",
          fingerprint: policyHook?.fingerprint ?? "",
        })
      );
      let restrictedHookApprovalBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.approveHookRun", {
            hookId: "desktop-smoke-policy-hook",
            operationFingerprint: policyHook?.runOperation.fingerprint ?? "",
          })
        );
      } catch (error) {
        restrictedHookApprovalBlocked = error instanceof Error
          ? error.message.includes("restricted policy")
          : String(error).includes("restricted policy");
      }
      console.log(
        "HOOK_POLICY_PRESET",
        JSON.stringify({
          preset: policyHook?.policyPreset ?? "missing",
          policy: policyHook?.executionPolicy.status ?? "missing",
          manualApprovalBlocked: restrictedHookApprovalBlocked,
          capabilityEnabled:
            policyHookSnapshot.capabilities.capabilities.find(
              (item) => item.id === "hook.project.desktop-smoke-policy-hook"
            )?.enabled ?? null,
        })
      );
      if (
        policyHook?.policyPreset !== "restricted" ||
        policyHook.executionPolicy.status !== "blocked" ||
        !restrictedHookApprovalBlocked ||
        policyHookSnapshot.capabilities.capabilities.find(
          (item) => item.id === "hook.project.desktop-smoke-policy-hook"
        )?.enabled !== false
      ) {
        throw new Error("Desktop smoke hook policy preset gate did not complete.");
      }
      await withFileBackup(repoIndexPath, async () => {
        const pausedLifecyclePolicy = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.updateHookLifecyclePolicy", {
            disabledEvents: ["after-project-index-refresh"],
            failureMode: "stop-on-failure",
          })
        );
        const pausedLifecycleSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.refreshProjectIndex", {})
        );
        const pausedLifecycleHook = pausedLifecycleSnapshot.hooks.items.find(
          (hook) => hook.id === "desktop-smoke-index-hook"
        );
        const reenabledLifecyclePolicy = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.updateHookLifecyclePolicy", {
            disabledEvents: [],
            failureMode: "continue",
          })
        );
        console.log(
          "HOOK_LIFECYCLE_GOVERNANCE",
          JSON.stringify({
            pausedEvents:
              pausedLifecyclePolicy.hooks.lifecyclePolicy.disabledEvents,
            pausedFailureMode:
              pausedLifecyclePolicy.hooks.lifecyclePolicy.failureMode,
            pausedStatus: pausedLifecycleHook?.lastRun?.status ?? "missing",
            pausedBatch:
              pausedLifecycleHook?.lastRun?.batchId?.startsWith("hook-batch-") ??
              false,
            pausedDiagnostic:
              pausedLifecycleHook?.lastRun?.diagnostics.some((entry) =>
                entry.includes("event after-project-index-refresh is paused")
              ) ?? false,
            reenabledEvents:
              reenabledLifecyclePolicy.hooks.lifecyclePolicy.disabledEvents,
            reenabledFailureMode:
              reenabledLifecyclePolicy.hooks.lifecyclePolicy.failureMode,
          })
        );
        if (
          !pausedLifecyclePolicy.hooks.lifecyclePolicy.disabledEvents.includes(
            "after-project-index-refresh"
          ) ||
          pausedLifecyclePolicy.hooks.lifecyclePolicy.failureMode !==
            "stop-on-failure" ||
          pausedLifecycleHook?.lastRun?.status !== "disabled" ||
          pausedLifecycleHook.lastRun.batchId?.startsWith("hook-batch-") !==
            true ||
          pausedLifecycleHook.lastRun.diagnostics.some((entry) =>
            entry.includes("event after-project-index-refresh is paused")
          ) !== true ||
          reenabledLifecyclePolicy.hooks.lifecyclePolicy.disabledEvents.length !==
            0 ||
          reenabledLifecyclePolicy.hooks.lifecyclePolicy.failureMode !==
            "continue"
        ) {
          throw new Error(
            "Desktop smoke hook lifecycle governance did not pause and re-enable event dispatch."
          );
        }
        const lifecycleSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.refreshProjectIndex", {})
        );
        const lifecycleHook = lifecycleSnapshot.hooks.items.find(
          (hook) => hook.id === "desktop-smoke-index-hook"
        );
        console.log(
          "HOOK_LIFECYCLE",
          JSON.stringify({
            present: Boolean(lifecycleHook),
            status: lifecycleHook?.lastRun?.status ?? "missing",
            batch: lifecycleHook?.lastRun?.batchId ?? "",
            stdout: lifecycleHook?.lastRun?.stdout ?? "",
          })
        );
        if (
          lifecycleHook?.lastRun?.status !== "success" ||
          lifecycleHook.lastRun.batchId?.startsWith("hook-batch-") !== true ||
          !lifecycleHook.lastRun.stdout.includes(
            "desktop lifecycle after-project-index-refresh"
          )
        ) {
          throw new Error("Desktop smoke lifecycle hook execution did not complete.");
        }
      });
    });

    const previousPluginAllowed = process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED;
    const previousPlugin_BLOCKED = process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED;
    process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED = "allowed-plugin-secret";
    process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED = "blocked-plugin-secret";
    try {
    await withFileBackup(pluginsPath, async () => {
      await withFileBackup(pluginRegistriesPath, async () => {
        await rm(pluginRegistriesPath, { force: true }).catch(() => undefined);
      const pluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPlugin", {
          id: "desktop-smoke-plugin",
          name: "Desktop Smoke Plugin",
          description: "Desktop smoke executable plugin",
          enabled: true,
          scopes: ["process", "env"],
          envKeys: ["ERAGEAR_DESKTOP_PLUGIN_ALLOWED"],
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write(['desktop plugin ok '+process.env.ERAGEAR_PLUGIN_NAME,'allowed_secret='+process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED,'blocked='+Boolean(process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED),'scopes='+process.env.ERAGEAR_PLUGIN_SCOPES].join('\\n'))",
          ],
          timeoutMs: 5000,
        })
      );
      const pluginCapability = pluginSnapshot.capabilities.capabilities.some(
        (item) =>
          item.kind === "plugin" &&
          item.name === "Desktop Smoke Plugin" &&
          item.enabled
      );
      const savedPlugin = pluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      let untrustedRunBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runPlugin", {
            pluginId: "desktop-smoke-plugin",
            confirmation:
              savedPlugin?.runConfirmationToken ??
              "RUN PLUGIN desktop-smoke-plugin",
            operationApprovalId: "plugin-approval-unused",
          })
        );
      } catch (error) {
        untrustedRunBlocked = error instanceof Error
          ? error.message.includes("trusted")
          : String(error).includes("trusted");
      }
      if (!savedPlugin?.fingerprint || !untrustedRunBlocked) {
        throw new Error("Desktop smoke plugin trust gate did not block execution.");
      }
      const trustSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustPlugin", {
          pluginId: "desktop-smoke-plugin",
          fingerprint: savedPlugin.fingerprint,
        })
      );
      const trustedPlugin = trustSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const trustedCapability = trustSnapshot.capabilities.capabilities.some(
        (item) =>
          item.kind === "plugin" &&
          item.name === "Desktop Smoke Plugin" &&
          item.enabled
      );
      console.log(
        "PLUGIN_TRUST",
        JSON.stringify({
          present: Boolean(trustedPlugin),
          beforeCapabilityEnabled: pluginCapability,
          trustStatus: trustedPlugin?.trustStatus ?? "missing",
          trusted: trustedPlugin?.trustedFingerprint === trustedPlugin?.fingerprint,
          permissionStatus: trustedPlugin?.permissionStatus ?? "missing",
          permissionsGranted:
            trustedPlugin?.grantedPermissionFingerprint ===
            trustedPlugin?.permissionFingerprint,
          scopes: trustedPlugin?.scopes ?? [],
          envKeys: trustedPlugin?.envKeys ?? [],
          untrustedRunBlocked,
          capabilityEnabled: trustedCapability,
        })
      );
      let pluginConfirmationBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runPlugin", {
            pluginId: "desktop-smoke-plugin",
            confirmation: "RUN PLUGIN wrong",
            operationApprovalId: "plugin-approval-unused",
          })
        );
      } catch (error) {
        pluginConfirmationBlocked = error instanceof Error
          ? error.message.includes("confirmation")
          : String(error).includes("confirmation");
      }
      console.log(
        "PLUGIN_RUN_CONFIRMATION",
        JSON.stringify({
          blocked: pluginConfirmationBlocked,
          token: trustedPlugin?.runConfirmationToken ?? "",
        })
      );
      if (!pluginConfirmationBlocked || !trustedPlugin?.runConfirmationToken) {
        throw new Error("Desktop smoke plugin run confirmation gate did not complete.");
      }
      const permissionRevokedSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.updatePluginPermissionGrant", {
          pluginId: "desktop-smoke-plugin",
          permissionFingerprint: trustedPlugin.permissionFingerprint,
          granted: false,
        })
      );
      const permissionRevokedPlugin = permissionRevokedSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const revokedCapabilityEnabled =
        permissionRevokedSnapshot.capabilities.capabilities.some(
          (item) =>
            item.kind === "plugin" &&
            item.name === "Desktop Smoke Plugin" &&
            item.enabled
        );
      let permissionRunBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runPlugin", {
            pluginId: "desktop-smoke-plugin",
            confirmation: trustedPlugin.runConfirmationToken,
            operationApprovalId: "plugin-approval-unused",
          })
        );
      } catch (error) {
        permissionRunBlocked = error instanceof Error
          ? error.message.includes("permissions")
          : String(error).includes("permissions");
      }
      const permissionGrantedSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.updatePluginPermissionGrant", {
          pluginId: "desktop-smoke-plugin",
          permissionFingerprint:
            permissionRevokedPlugin?.permissionFingerprint ??
            trustedPlugin.permissionFingerprint,
          granted: true,
        })
      );
      const permissionGrantedPlugin = permissionGrantedSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const grantedCapabilityEnabled =
        permissionGrantedSnapshot.capabilities.capabilities.some(
          (item) =>
            item.kind === "plugin" &&
            item.name === "Desktop Smoke Plugin" &&
            item.enabled
        );
      console.log(
        "PLUGIN_PERMISSION_GRANT",
        JSON.stringify({
          revokedStatus: permissionRevokedPlugin?.permissionStatus ?? "missing",
          revokedCapabilityEnabled,
          permissionRunBlocked,
          grantedStatus: permissionGrantedPlugin?.permissionStatus ?? "missing",
          grantedCapabilityEnabled,
          permissionFingerprint:
            permissionGrantedPlugin?.permissionFingerprint ?? "",
        })
      );
      if (
        permissionRevokedPlugin?.permissionStatus !== "missing" ||
        revokedCapabilityEnabled ||
        !permissionRunBlocked ||
        permissionGrantedPlugin?.permissionStatus !== "granted" ||
        !grantedCapabilityEnabled
      ) {
        throw new Error("Desktop smoke plugin permission grant flow did not complete.");
      }
      const pluginRunApproval = await approvePluginRunOperation(
        "desktop-smoke-plugin"
      );
      console.log(
        "PLUGIN_RUN_APPROVAL",
        JSON.stringify({
          pluginId: "desktop-smoke-plugin",
          approvalId: pluginRunApproval.approvalId,
          fingerprint: pluginRunApproval.fingerprint,
        })
      );
      const runSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPlugin", {
          pluginId: "desktop-smoke-plugin",
          confirmation:
            permissionGrantedPlugin?.runConfirmationToken ??
            trustedPlugin.runConfirmationToken,
          operationApprovalId: pluginRunApproval.approvalId,
        })
      );
      const smokePlugin = runSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      console.log(
        "PLUGIN_RUN",
        JSON.stringify({
          capabilityPresent: trustedCapability,
          present: Boolean(smokePlugin),
          status: smokePlugin?.lastRun?.status ?? "missing",
          approvalStatus: smokePlugin?.runOperation.approvalStatus ?? "missing",
          stdout: smokePlugin?.lastRun?.stdout ?? "",
        })
      );
      const smokePluginLastRun = smokePlugin?.lastRun;
      if (
        pluginCapability ||
        !trustedCapability ||
        trustedPlugin?.trustStatus !== "trusted" ||
        !trustedPlugin?.scopes.includes("env") ||
        trustedPlugin?.scopes.includes("project-root") ||
        trustedPlugin?.envKeys[0] !== "ERAGEAR_DESKTOP_PLUGIN_ALLOWED" ||
        smokePluginLastRun?.status !== "success" ||
        smokePlugin?.runOperation.approvalStatus !== "consumed" ||
        !smokePluginLastRun.stdout.includes(
          "desktop plugin ok Desktop Smoke Plugin"
        ) ||
        !smokePluginLastRun.stdout.includes("allowed_secret= [redacted]") ||
        !smokePluginLastRun.stdout.includes("blocked=false")
      ) {
        throw new Error("Desktop smoke plugin execution did not complete.");
      }
      console.log(
        "PLUGIN_PROCESS_ISOLATION",
        JSON.stringify({
          policyMode: smokePlugin!.executionPolicy.isolation.mode,
          runMode: smokePluginLastRun.isolation?.mode ?? "missing",
          cwdScope: smokePlugin!.runOperation.isolation.cwdScope,
          projectRootExposed:
            smokePlugin!.runOperation.isolation.projectRootExposed,
          processTreeKill:
            smokePluginLastRun.isolation?.processTreeKill ?? "missing",
        })
      );
      if (
        smokePlugin!.executionPolicy.isolation.mode !== "job-process-tree" ||
        smokePluginLastRun.isolation?.mode !== "job-process-tree" ||
        smokePlugin!.runOperation.isolation.cwdScope !== "temporary-sandbox" ||
        smokePlugin!.runOperation.isolation.projectRootExposed !== false ||
        smokePluginLastRun.isolation.processTreeKill !== "available"
      ) {
        throw new Error("Desktop smoke plugin process isolation metadata missing.");
      }
      const reviewedPluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.reviewPluginRun", {
          runId: smokePluginLastRun.id,
          reviewed: true,
        })
      );
      const reviewedPlugin = reviewedPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      console.log(
        "PLUGIN_RUN_REVIEW",
        JSON.stringify({
          present: Boolean(reviewedPlugin),
          runId: reviewedPlugin?.lastRun?.id ?? "",
          reviewed: Boolean(reviewedPlugin?.lastRun?.reviewedAt),
        })
      );
      if (
        reviewedPlugin?.lastRun?.id !== smokePluginLastRun.id ||
        !reviewedPlugin.lastRun.reviewedAt
      ) {
        throw new Error("Desktop smoke plugin run review did not persist.");
      }
      const pluginAuditExport = await request<{
        schemaVersion: 1;
        redacted: true;
        filters: { reviewState: string; limit: number };
        stats: { matching: number; included: number; reviewed: number };
        runs: Array<{ id: string; reviewedAt?: string; stdout: string; stderr: string }>;
      }>(
        operation("mutation", "settings.exportPluginRuns", {
          reviewState: "reviewed",
          limit: 5,
        })
      );
      const pluginAuditText = JSON.stringify(pluginAuditExport);
      console.log(
        "PLUGIN_RUN_AUDIT_EXPORT",
        JSON.stringify({
          redacted: pluginAuditExport.redacted,
          reviewState: pluginAuditExport.filters.reviewState,
          runs: pluginAuditExport.runs.length,
          reviewed: pluginAuditExport.runs.some(
            (run) => run.id === smokePluginLastRun.id && Boolean(run.reviewedAt)
          ),
          leakedSecret: pluginAuditText.includes("allowed-plugin-secret"),
        })
      );
      if (
        !pluginAuditExport.redacted ||
        pluginAuditExport.filters.reviewState !== "reviewed" ||
        !pluginAuditExport.runs.some(
          (run) => run.id === smokePluginLastRun.id && Boolean(run.reviewedAt)
        ) ||
        pluginAuditText.includes("allowed-plugin-secret")
      ) {
        throw new Error("Desktop smoke plugin audit export did not include a redacted reviewed run.");
      }
      const pausedPluginPolicy = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.updatePluginSchedulingPolicy", {
          enabled: false,
          maxConcurrentRuns: 1,
          cooldownMs: 0,
        })
      );
      const pausedPlugin = pausedPluginPolicy.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const pausedPluginCapability =
        pausedPluginPolicy.capabilities.capabilities.find(
          (item) => item.id === "plugin.project.desktop-smoke-plugin"
        );
      const pausedPluginApproval =
        await approvePluginRunOperation("desktop-smoke-plugin");
      const pausedPluginRunSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPlugin", {
          pluginId: "desktop-smoke-plugin",
          confirmation:
            pausedPlugin?.runConfirmationToken ??
            permissionGrantedPlugin?.runConfirmationToken ??
            trustedPlugin.runConfirmationToken,
          operationApprovalId: pausedPluginApproval.approvalId,
        })
      );
      const pausedRunPlugin = pausedPluginRunSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const resetPluginScheduling = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.updatePluginSchedulingPolicy", {
          enabled: true,
          maxConcurrentRuns: 1,
          cooldownMs: 0,
        })
      );
      console.log(
        "PLUGIN_SCHEDULING_POLICY",
        JSON.stringify({
          enabled: pausedPluginPolicy.plugins.schedulingPolicy.enabled,
          maxConcurrentRuns:
            pausedPluginPolicy.plugins.schedulingPolicy.maxConcurrentRuns,
          cooldownMs: pausedPluginPolicy.plugins.schedulingPolicy.cooldownMs,
          itemStatus: pausedPlugin?.scheduling.status ?? "missing",
          capabilityEnabled: pausedPluginCapability?.enabled ?? null,
          blockedRunStatus: pausedRunPlugin?.lastRun?.status ?? "missing",
          approvalStatus:
            pausedRunPlugin?.runOperation.approvalStatus ?? "missing",
          diagnostic:
            pausedRunPlugin?.lastRun?.diagnostics.some((entry) =>
              entry.includes("scheduling is paused")
            ) ?? false,
          resetEnabled: resetPluginScheduling.plugins.schedulingPolicy.enabled,
        })
      );
      if (
        pausedPluginPolicy.plugins.schedulingPolicy.enabled !== false ||
        pausedPluginPolicy.plugins.schedulingPolicy.maxConcurrentRuns !== 1 ||
        pausedPluginPolicy.plugins.schedulingPolicy.cooldownMs !== 0 ||
        pausedPlugin?.scheduling.status !== "paused" ||
        pausedPluginCapability?.enabled !== false ||
        pausedRunPlugin?.lastRun?.status !== "disabled" ||
        pausedRunPlugin.runOperation.approvalStatus !== "consumed" ||
        pausedRunPlugin.lastRun.diagnostics.some((entry) =>
          entry.includes("scheduling is paused")
        ) !== true ||
        resetPluginScheduling.plugins.schedulingPolicy.enabled !== true
      ) {
        throw new Error(
          "Desktop smoke plugin scheduling policy did not pause and audit blocked run."
        );
      }
      const batchPluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPlugin", {
          id: "desktop-smoke-plugin-batch",
          name: "Desktop Smoke Batch Plugin",
          description: "Desktop smoke batch executable plugin",
          enabled: true,
          scopes: ["process"],
          dependencyIds: ["desktop-smoke-plugin"],
          envKeys: [],
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('desktop batch plugin ok '+process.env.ERAGEAR_PLUGIN_NAME)",
          ],
          timeoutMs: 5000,
        })
      );
      const batchPlugin = batchPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin-batch"
      );
      const trustedBatchPluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustPlugin", {
          pluginId: "desktop-smoke-plugin-batch",
          fingerprint: batchPlugin?.fingerprint ?? "",
        })
      );
      const batchReadyPlugin = trustedBatchPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const batchReadySecond = trustedBatchPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin-batch"
      );
      const dependencyNode = trustedBatchPluginSnapshot.plugins.dependencyGraph.nodes.find(
        (node) => node.pluginId === "desktop-smoke-plugin-batch"
      );
      const dependencyEdge = trustedBatchPluginSnapshot.plugins.dependencyGraph.edges.find(
        (edge) =>
          edge.pluginId === "desktop-smoke-plugin-batch" &&
          edge.dependencyId === "desktop-smoke-plugin"
      );
      console.log(
        "PLUGIN_DEPENDENCY_GRAPH",
        JSON.stringify({
          nodeStatus: dependencyNode?.status ?? "missing",
          dependencyIds: dependencyNode?.dependencyIds ?? [],
          edgeStatus: dependencyEdge?.status ?? "missing",
          dependentCount:
            trustedBatchPluginSnapshot.plugins.dependencyGraph.nodes.find(
              (node) => node.pluginId === "desktop-smoke-plugin"
            )?.dependentIds.length ?? -1,
        })
      );
      if (
        dependencyNode?.status !== "ready" ||
        dependencyNode.dependencyIds[0] !== "desktop-smoke-plugin" ||
        dependencyEdge?.status !== "ready"
      ) {
        throw new Error("Desktop smoke plugin dependency graph was not ready.");
      }
      const pluginBatchSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPluginBatch", {
          pluginIds: ["desktop-smoke-plugin-batch", "desktop-smoke-plugin"],
          operationFingerprints: {
            "desktop-smoke-plugin":
              batchReadyPlugin?.runOperation.fingerprint ?? "",
            "desktop-smoke-plugin-batch":
              batchReadySecond?.runOperation.fingerprint ?? "",
          },
          confirmation: "RUN PLUGIN BATCH",
          failureMode: "continue",
        })
      );
      const pluginBatch = pluginBatchSnapshot.plugins.recentBatches[0];
      const batchedPrimary = pluginBatchSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const batchedSecond = pluginBatchSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin-batch"
      );
      console.log(
        "PLUGIN_BATCH_QUEUE",
        JSON.stringify({
          batchId: pluginBatch?.id ?? "",
          status: pluginBatch?.status ?? "missing",
          success: pluginBatch?.counts.success ?? -1,
          disabled: pluginBatch?.counts.disabled ?? -1,
          runIds: pluginBatch?.runIds.length ?? -1,
          primaryStatus: batchedPrimary?.lastRun?.status ?? "missing",
          secondStatus: batchedSecond?.lastRun?.status ?? "missing",
          primaryBatch: batchedPrimary?.lastRun?.batchId ?? "",
          secondBatch: batchedSecond?.lastRun?.batchId ?? "",
          secondStdout: batchedSecond?.lastRun?.stdout ?? "",
          order: pluginBatch?.pluginIds ?? [],
        })
      );
      if (
        !pluginBatch?.id.startsWith("plugin-batch-") ||
        pluginBatch.status !== "success" ||
        pluginBatch.counts.success !== 2 ||
        pluginBatch.counts.disabled !== 0 ||
        pluginBatch.runIds.length !== 2 ||
        pluginBatch.pluginIds[0] !== "desktop-smoke-plugin" ||
        pluginBatch.pluginIds[1] !== "desktop-smoke-plugin-batch" ||
        batchedPrimary?.lastRun?.status !== "success" ||
        batchedSecond?.lastRun?.status !== "success" ||
        batchedPrimary.lastRun.batchId !== pluginBatch.id ||
        batchedSecond.lastRun.batchId !== pluginBatch.id ||
        !batchedSecond.lastRun.stdout.includes(
          "desktop batch plugin ok Desktop Smoke Batch Plugin"
        )
      ) {
        throw new Error("Desktop smoke plugin batch queue did not execute two plugins.");
      }
      const stopBatchTempRoot = await mkdtemp(
        path.join(os.tmpdir(), "eragear-plugin-batch-stop-")
      );
      try {
        const skippedOutputPath = path.join(stopBatchTempRoot, "skipped.txt");
        const stopBatchFailSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertPlugin", {
            id: "desktop-smoke-plugin-batch-fail",
            name: "Desktop Smoke Batch Fail Plugin",
            description: "Desktop smoke batch failure-mode failing plugin",
            enabled: true,
            scopes: ["process"],
            envKeys: [],
            command: process.execPath,
            args: [
              "-e",
              "process.stderr.write('desktop batch fail'); process.exit(3)",
            ],
            timeoutMs: 5000,
          })
        );
        const stopBatchFail = stopBatchFailSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-smoke-plugin-batch-fail"
        );
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustPlugin", {
            pluginId: "desktop-smoke-plugin-batch-fail",
            fingerprint: stopBatchFail?.fingerprint ?? "",
          })
        );
        const stopBatchSkipSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertPlugin", {
            id: "desktop-smoke-plugin-batch-skip",
            name: "Desktop Smoke Batch Skip Plugin",
            description: "Desktop smoke batch failure-mode skipped plugin",
            enabled: true,
            scopes: ["process"],
            envKeys: [],
            command: process.execPath,
            args: [
              "-e",
              `require('node:fs').writeFileSync(${JSON.stringify(
                skippedOutputPath
              )}, 'should-not-run'); process.stdout.write('desktop batch skip ran')`,
            ],
            timeoutMs: 5000,
          })
        );
        const stopBatchSkip = stopBatchSkipSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-smoke-plugin-batch-skip"
        );
        const trustedStopSkipSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustPlugin", {
            pluginId: "desktop-smoke-plugin-batch-skip",
            fingerprint: stopBatchSkip?.fingerprint ?? "",
          })
        );
        const stopReadyFail = trustedStopSkipSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-smoke-plugin-batch-fail"
        );
        const stopReadySkip = trustedStopSkipSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-smoke-plugin-batch-skip"
        );
        const stopBatchSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runPluginBatch", {
            pluginIds: [
              "desktop-smoke-plugin-batch-fail",
              "desktop-smoke-plugin-batch-skip",
            ],
            operationFingerprints: {
              "desktop-smoke-plugin-batch-fail":
                stopReadyFail?.runOperation.fingerprint ?? "",
              "desktop-smoke-plugin-batch-skip":
                stopReadySkip?.runOperation.fingerprint ?? "",
            },
            confirmation: "RUN PLUGIN BATCH",
            failureMode: "stop-on-failure",
          })
        );
        const stopBatch = stopBatchSnapshot.plugins.recentBatches[0];
        const failedBatchPlugin = stopBatchSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-smoke-plugin-batch-fail"
        );
        const skippedBatchPlugin = stopBatchSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-smoke-plugin-batch-skip"
        );
        console.log(
          "PLUGIN_BATCH_STOP_ON_FAILURE",
          JSON.stringify({
            batchId: stopBatch?.id ?? "",
            failureMode: stopBatch?.failureMode ?? "missing",
            status: stopBatch?.status ?? "missing",
            failed: stopBatch?.counts.failed ?? -1,
            disabled: stopBatch?.counts.disabled ?? -1,
            runIds: stopBatch?.runIds.length ?? -1,
            firstStatus: failedBatchPlugin?.lastRun?.status ?? "missing",
            secondStatus: skippedBatchPlugin?.lastRun?.status ?? "missing",
            skippedSpawned: existsSync(skippedOutputPath),
          })
        );
        if (
          !stopBatch?.id.startsWith("plugin-batch-") ||
          stopBatch.failureMode !== "stop-on-failure" ||
          stopBatch.status !== "partial" ||
          stopBatch.counts.failed !== 1 ||
          stopBatch.counts.disabled !== 1 ||
          stopBatch.runIds.length !== 2 ||
          failedBatchPlugin?.lastRun?.status !== "failed" ||
          skippedBatchPlugin?.lastRun?.status !== "disabled" ||
          skippedBatchPlugin.lastRun.batchId !== stopBatch.id ||
          existsSync(skippedOutputPath) ||
          !skippedBatchPlugin.lastRun.diagnostics.some((entry) =>
            entry.includes("stop-on-failure")
          )
        ) {
          throw new Error(
            "Desktop smoke plugin batch stop-on-failure did not skip remaining plugin."
          );
        }
      } finally {
        await rm(stopBatchTempRoot, { force: true, recursive: true });
      }
      const savedBatchPresetSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPluginBatchPreset", {
          id: "desktop-smoke-batch-preset",
          name: "Desktop Smoke Batch Preset",
          pluginIds: ["desktop-smoke-plugin", "desktop-smoke-plugin-batch"],
          failureMode: "continue",
        })
      );
      const savedBatchPreset =
        savedBatchPresetSnapshot.plugins.batchPresets.find(
          (preset) => preset.id === "desktop-smoke-batch-preset"
        );
      const presetReadyPrimary = savedBatchPresetSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const presetReadySecond = savedBatchPresetSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin-batch"
      );
      const presetRunSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPluginBatchPreset", {
          presetId: "desktop-smoke-batch-preset",
          operationFingerprints: {
            "desktop-smoke-plugin":
              presetReadyPrimary?.runOperation.fingerprint ?? "",
            "desktop-smoke-plugin-batch":
              presetReadySecond?.runOperation.fingerprint ?? "",
          },
          confirmation: "RUN PLUGIN BATCH",
        })
      );
      const presetBatch = presetRunSnapshot.plugins.recentBatches[0];
      const runBatchPreset = presetRunSnapshot.plugins.batchPresets.find(
        (preset) => preset.id === "desktop-smoke-batch-preset"
      );
      console.log(
        "PLUGIN_BATCH_PRESET",
        JSON.stringify({
          presetId: savedBatchPreset?.id ?? "",
          presetPlugins: savedBatchPreset?.pluginIds.length ?? -1,
          batchId: presetBatch?.id ?? "",
          status: presetBatch?.status ?? "missing",
          failureMode: presetBatch?.failureMode ?? "missing",
          success: presetBatch?.counts.success ?? -1,
          lastRunBatchId: runBatchPreset?.lastRunBatchId ?? "",
        })
      );
      if (
        savedBatchPreset?.id !== "desktop-smoke-batch-preset" ||
        savedBatchPreset.pluginIds.length !== 2 ||
        !presetBatch?.id.startsWith("plugin-batch-") ||
        presetBatch.status !== "success" ||
        presetBatch.failureMode !== "continue" ||
        presetBatch.counts.success !== 2 ||
        runBatchPreset?.lastRunBatchId !== presetBatch.id
      ) {
        throw new Error("Desktop smoke plugin batch preset did not run.");
      }
      const savedBatchScheduleSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPluginBatchSchedule", {
          id: "desktop-smoke-batch-schedule",
          name: "Desktop Smoke Batch Schedule",
          presetId: "desktop-smoke-batch-preset",
          intervalMs: 60000,
          nextRunAt: new Date(Date.now() - 1000).toISOString(),
          operationFingerprints: {
            "desktop-smoke-plugin":
              presetReadyPrimary?.runOperation.fingerprint ?? "",
            "desktop-smoke-plugin-batch":
              presetReadySecond?.runOperation.fingerprint ?? "",
          },
        })
      );
      const savedBatchSchedule =
        savedBatchScheduleSnapshot.plugins.batchSchedules.find(
          (schedule) => schedule.id === "desktop-smoke-batch-schedule"
        );
      const dueScheduleSnapshot = await waitForPluginBatchSchedule(
        "desktop-smoke-batch-schedule"
      );
      const ranBatchSchedule =
        dueScheduleSnapshot.plugins.batchSchedules.find(
          (schedule) => schedule.id === "desktop-smoke-batch-schedule"
        );
      const scheduleBatch = dueScheduleSnapshot.plugins.recentBatches[0];
      const scheduleTask = dueScheduleSnapshot.runtime.background?.tasks.find(
        (task) => task.name === "plugin-batch-schedule-dispatch"
      );
      const scheduleTaskDispatched =
        typeof scheduleTask?.lastResult?.dispatchedSchedules === "number"
          ? scheduleTask.lastResult.dispatchedSchedules
          : -1;
      console.log(
        "PLUGIN_BATCH_SCHEDULE",
        JSON.stringify({
          scheduleId: savedBatchSchedule?.id ?? "",
          savedStatus: savedBatchSchedule?.status ?? "missing",
          runStatus: ranBatchSchedule?.lastRunStatus ?? "missing",
          visibleStatus: ranBatchSchedule?.status ?? "missing",
          batchId: scheduleBatch?.id ?? "",
          success: scheduleBatch?.counts.success ?? -1,
          lastRunBatchId: ranBatchSchedule?.lastRunBatchId ?? "",
          nextRunAt: ranBatchSchedule?.nextRunAt ?? "",
          daemon: true,
          taskVisible: Boolean(scheduleTask),
          taskSuccessCount: scheduleTask?.successCount ?? -1,
          taskDispatchedSchedules: scheduleTaskDispatched,
        })
      );
      console.log(
        "BACKGROUND_TASK_FLEET",
        JSON.stringify({
          enabled: dueScheduleSnapshot.runtime.background?.enabled ?? false,
          taskCount: dueScheduleSnapshot.runtime.background?.tasks.length ?? 0,
          tasks:
            dueScheduleSnapshot.runtime.background?.tasks
              .map((task) => ({
                name: task.name,
                running: task.running,
                successCount: task.successCount,
                failureCount: task.failureCount,
              }))
              .slice(0, 8) ?? [],
          scheduleTask: Boolean(scheduleTask),
        })
      );
      if (
        savedBatchSchedule?.status !== "due" ||
        !scheduleBatch?.id.startsWith("plugin-batch-") ||
        scheduleBatch.status !== "success" ||
        scheduleBatch.counts.success !== 2 ||
        ranBatchSchedule?.lastRunStatus !== "success" ||
        ranBatchSchedule.lastRunBatchId !== scheduleBatch.id ||
        ranBatchSchedule.status !== "scheduled" ||
        !scheduleTask ||
        scheduleTask.successCount < 1
      ) {
        throw new Error(
          "Desktop smoke plugin batch schedule daemon did not run due batch."
        );
      }
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.deletePluginBatchSchedule", {
          scheduleId: "desktop-smoke-batch-schedule",
        })
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.deletePluginBatchPreset", {
          presetId: "desktop-smoke-batch-preset",
        })
      );
      await withFileBackup(signedPluginManifestPath, async () => {
        await mkdir(path.dirname(signedPluginManifestPath), { recursive: true });
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const signedPayload = {
          schemaVersion: 1,
          publisher: "Desktop Smoke Publisher",
          publisherId: "desktop.smoke.publisher",
          issuedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
          plugin: {
            id: "desktop-signed-plugin",
            name: "Desktop Signed Plugin",
            description: "Desktop smoke signed plugin package",
            enabled: true,
            scopes: ["process"],
            envKeys: [],
            command: process.execPath,
            args: [
              "-e",
              "process.stdout.write(['desktop signed plugin ok '+process.env.ERAGEAR_PLUGIN_NAME,'root='+Boolean(process.env.ERAGEAR_PROJECT_ROOT),'access='+process.env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS].join('\\n'))",
            ],
            timeoutMs: 5000,
          },
        } as const;
        const signature = sign(
          null,
          Buffer.from(
            canonicalSmokeJson(signedPayload as unknown as SmokeCanonicalJsonValue),
            "utf8"
          ),
          privateKey
        ).toString("base64");
        await writeFile(
          signedPluginManifestPath,
          `${JSON.stringify(
            {
              ...signedPayload,
              publicKeyPem: publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
              signature,
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        const signedCatalogSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const signedCatalogItem = signedCatalogSnapshot.plugins.catalog.find(
          (item) => item.id === "desktop-signed-plugin"
        );
        console.log(
          "PLUGIN_CATALOG",
          JSON.stringify({
            present: Boolean(signedCatalogItem),
            status: signedCatalogItem?.status ?? "missing",
            manifestPath: signedCatalogItem?.manifestPath ?? "",
            publisher: signedCatalogItem?.publisher ?? "",
            publisherId: signedCatalogItem?.publisherId ?? "",
            expiryStatus: signedCatalogItem?.expiryStatus ?? "missing",
            expiresAt: signedCatalogItem?.expiresAt ?? "",
            workspaceAccess: signedCatalogItem?.workspaceAccess ?? "missing",
            signatureHash: signedCatalogItem?.signatureHash ?? "",
            publicKeyFingerprint: signedCatalogItem?.publicKeyFingerprint ?? "",
          })
        );
        if (
          signedCatalogItem?.status !== "installable" ||
          signedCatalogItem.manifestPath !==
            ".eragear/plugin-packages/desktop-signed-plugin.json" ||
          signedCatalogItem.publisher !== "Desktop Smoke Publisher" ||
          signedCatalogItem.publisherId !== "desktop.smoke.publisher" ||
          signedCatalogItem.expiryStatus !== "valid" ||
          signedCatalogItem.expiresAt !== "2099-01-01T00:00:00.000Z" ||
          signedCatalogItem.workspaceAccess !== "sandbox" ||
          !signedCatalogItem.signatureHash?.startsWith("sha256:") ||
          !signedCatalogItem.publicKeyFingerprint?.startsWith("sha256:")
        ) {
          throw new Error("Desktop smoke signed plugin catalog did not verify package.");
        }
        const signedInstallSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.installPluginPackage", {
            manifestPath: signedCatalogItem.manifestPath,
          })
        );
        const signedPlugin = signedInstallSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-signed-plugin"
        );
        const installedCatalogItem = signedInstallSnapshot.plugins.catalog.find(
          (item) => item.id === "desktop-signed-plugin"
        );
        const signedCapabilityEnabled =
          signedInstallSnapshot.capabilities.capabilities.some(
            (item) =>
              item.kind === "plugin" &&
              item.name === "Desktop Signed Plugin" &&
              item.enabled
          );
        const signedRunApproval = await approvePluginRunOperation(
          "desktop-signed-plugin"
        );
        const signedRunSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runPlugin", {
            pluginId: "desktop-signed-plugin",
            confirmation:
              signedPlugin?.runConfirmationToken ??
              "RUN PLUGIN desktop-signed-plugin",
            operationApprovalId: signedRunApproval.approvalId,
          })
        );
        const signedRunPlugin = signedRunSnapshot.plugins.items.find(
          (plugin) => plugin.id === "desktop-signed-plugin"
        );
        console.log(
          "PLUGIN_SIGNED_INSTALL",
          JSON.stringify({
            present: Boolean(signedPlugin),
            installSource: signedPlugin?.installSource ?? "missing",
            publisher: signedPlugin?.publisher ?? "",
            publisherId: signedPlugin?.packagePublisherId ?? "",
            expiryStatus: signedPlugin?.packageExpiryStatus ?? "missing",
            expiresAt: signedPlugin?.packageExpiresAt ?? "",
            trustStatus: signedPlugin?.trustStatus ?? "missing",
            signatureHash: signedPlugin?.packageSignatureHash ?? "",
            publicKeyFingerprint: signedPlugin?.packagePublicKeyFingerprint ?? "",
            catalogStatus: installedCatalogItem?.status ?? "missing",
            capabilityEnabled: signedCapabilityEnabled,
            runStatus: signedRunPlugin?.lastRun?.status ?? "missing",
            approvalStatus:
              signedRunPlugin?.runOperation.approvalStatus ?? "missing",
            stdout: signedRunPlugin?.lastRun?.stdout ?? "",
          })
        );
        if (
          signedPlugin?.installSource !== "signed-package" ||
          signedPlugin.publisher !== "Desktop Smoke Publisher" ||
          signedPlugin.packagePublisherId !== "desktop.smoke.publisher" ||
          signedPlugin.packageExpiryStatus !== "valid" ||
          signedPlugin.packageExpiresAt !== "2099-01-01T00:00:00.000Z" ||
          signedPlugin.trustStatus !== "trusted" ||
          !signedPlugin.packageSignatureHash?.startsWith("sha256:") ||
          !signedPlugin.packagePublicKeyFingerprint?.startsWith("sha256:") ||
          installedCatalogItem?.status !== "installed" ||
          !signedCapabilityEnabled ||
          signedRunPlugin?.lastRun?.status !== "success" ||
          !signedRunPlugin.lastRun.stdout.includes("desktop signed plugin ok") ||
          !signedRunPlugin.lastRun.stdout.includes("root=false") ||
          !signedRunPlugin.lastRun.stdout.includes("access=sandbox")
        ) {
          throw new Error("Desktop smoke signed plugin package did not install and run.");
        }
        const signedRevalidatedSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.revalidatePluginPackage", {
            pluginId: "desktop-signed-plugin",
          })
        );
        const signedRevalidatedPlugin =
          signedRevalidatedSnapshot.plugins.items.find(
            (plugin) => plugin.id === "desktop-signed-plugin"
          );
        await writeFile(
          signedPluginManifestPath,
          `${JSON.stringify(
            {
              ...signedPayload,
              plugin: {
                ...signedPayload.plugin,
                args: [
                  "-e",
                  "process.stdout.write('desktop signed plugin tampered')",
                ],
              },
              publicKeyPem: publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
              signature,
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        const signedFailedGovernanceSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.revalidatePluginPackage", {
            pluginId: "desktop-signed-plugin",
          })
        );
        const signedFailedGovernancePlugin =
          signedFailedGovernanceSnapshot.plugins.items.find(
            (plugin) => plugin.id === "desktop-signed-plugin"
          );
        const signedFailedGovernanceCapability =
          signedFailedGovernanceSnapshot.capabilities.capabilities.find(
            (item) => item.id === "plugin.project.desktop-signed-plugin"
          );
        console.log(
          "PLUGIN_PACKAGE_REVALIDATION",
          JSON.stringify({
            verified:
              signedRevalidatedPlugin?.packageGovernanceStatus ?? "missing",
            failed:
              signedFailedGovernancePlugin?.packageGovernanceStatus ?? "missing",
            capabilityEnabled:
              signedFailedGovernanceCapability?.enabled ?? null,
            diagnostic:
              signedFailedGovernancePlugin?.packageGovernanceDiagnostics?.join(
                " "
              ) ?? "",
          })
        );
        if (
          signedRevalidatedPlugin?.packageGovernanceStatus !== "verified" ||
          signedFailedGovernancePlugin?.packageGovernanceStatus !==
            "verification-failed" ||
          signedFailedGovernanceCapability?.enabled !== false ||
          !signedFailedGovernancePlugin.packageGovernanceDiagnostics
            ?.join("\n")
            .includes("signature verification failed")
        ) {
          throw new Error(
            "Desktop smoke signed plugin package revalidation did not govern tampering."
          );
        }
        const registryPayload = {
          schemaVersion: 1,
          publisher: "Desktop Registry Publisher",
          publisherId: "desktop.registry.publisher",
          issuedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
          plugin: {
            id: "desktop-registry-plugin",
            name: "Desktop Registry Plugin",
            description: "Desktop smoke registry plugin package",
            enabled: true,
            scopes: ["process"],
            envKeys: [],
            command: process.execPath,
            args: [
              "-e",
              "process.stdout.write(['desktop registry plugin ok '+process.env.ERAGEAR_PLUGIN_NAME,'root='+Boolean(process.env.ERAGEAR_PROJECT_ROOT),'access='+process.env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS].join('\\n'))",
            ],
            timeoutMs: 5000,
          },
        } as const;
        const registrySignature = sign(
          null,
          Buffer.from(
            canonicalSmokeJson(registryPayload as unknown as SmokeCanonicalJsonValue),
            "utf8"
          ),
          privateKey
        ).toString("base64");
        const registrySignatureHash = `sha256:${createHash("sha256")
          .update(Buffer.from(registrySignature, "base64"))
          .digest("hex")}`;
        const registryPublicKeyFingerprint = `sha256:${createHash("sha256")
          .update(publicKey.export({ type: "spki", format: "der" }))
          .digest("hex")}`;
        const registryManifest = `${JSON.stringify(
          {
            ...registryPayload,
            publicKeyPem: publicKey
              .export({ type: "spki", format: "pem" })
              .toString(),
            signature: registrySignature,
          },
          null,
          2
        )}\n`;
        let registryFeedRevokedSigners: Array<{
          publicKeyFingerprint: string;
          revokedAt: string;
          reason: string;
        }> = [];
        const registryServer = createServer((request, response) => {
          const baseUrl = `http://${request.headers.host ?? "127.0.0.1"}`;
          if (request.url === "/desktop-registry-plugin.json") {
            response
              .writeHead(200, { "content-type": "application/json" })
              .end(registryManifest);
            return;
          }
          if (request.url === "/registry.json") {
            response
              .writeHead(200, { "content-type": "application/json" })
              .end(
                JSON.stringify({
                  schemaVersion: 1,
                  name: "Desktop Smoke Registry",
                  revokedSigners: registryFeedRevokedSigners,
                  packages: [
                    {
                      id: "desktop-registry-plugin",
                      name: "Desktop Registry Plugin",
                      publisher: "Desktop Registry Publisher",
                      publisherId: "desktop.registry.publisher",
                      issuedAt: "2026-01-01T00:00:00.000Z",
                      expiresAt: "2099-01-01T00:00:00.000Z",
                      manifestUrl: `${baseUrl}/desktop-registry-plugin.json`,
                      signatureHash: registrySignatureHash,
                      publicKeyFingerprint: registryPublicKeyFingerprint,
                    },
                  ],
                })
              );
            return;
          }
          response.writeHead(404).end();
        });
        await new Promise<void>((resolve) => {
          registryServer.listen(0, "127.0.0.1", resolve);
        });
        const registryAddress = registryServer.address() as AddressInfo;
        const registryUrl = `http://127.0.0.1:${registryAddress.port}/registry.json`;
        try {
          const registrySavedSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.upsertPluginRegistry", {
              id: "desktop-smoke-registry",
              name: "Desktop Smoke Registry",
              url: registryUrl,
            })
          );
          const savedRegistry = registrySavedSnapshot.plugins.registries.find(
            (registry) => registry.id === "desktop-smoke-registry"
          );
          if (!savedRegistry || savedRegistry.trustStatus !== "untrusted") {
            throw new Error("Desktop smoke plugin registry was not saved as untrusted.");
          }
          const trustedRegistrySnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.trustPluginRegistry", {
              registryId: "desktop-smoke-registry",
              fingerprint: savedRegistry.fingerprint,
            })
          );
          const trustedRegistry = trustedRegistrySnapshot.plugins.registries.find(
            (registry) => registry.id === "desktop-smoke-registry"
          );
          if (trustedRegistry?.trustStatus !== "trusted") {
            throw new Error("Desktop smoke plugin registry trust did not persist.");
          }
          const revokedTrustSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.revokePluginRegistryTrust", {
              registryId: "desktop-smoke-registry",
            })
          );
          const revokedTrustRegistry = revokedTrustSnapshot.plugins.registries.find(
            (registry) => registry.id === "desktop-smoke-registry"
          );
          let revokedTrustRefreshBlocked = false;
          try {
            await request<LocalAdeSnapshot>(
              operation("mutation", "settings.refreshPluginRegistry", {
                registryId: "desktop-smoke-registry",
              })
            );
          } catch (error) {
            revokedTrustRefreshBlocked = error instanceof Error
              ? error.message.includes("must be trusted")
              : String(error).includes("must be trusted");
          }
          const retrustedRegistrySnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.trustPluginRegistry", {
              registryId: "desktop-smoke-registry",
              fingerprint: revokedTrustRegistry?.fingerprint ?? "",
            })
          );
          const retrustedRegistry =
            retrustedRegistrySnapshot.plugins.registries.find(
              (registry) => registry.id === "desktop-smoke-registry"
            );
          if (
            revokedTrustRegistry?.trustStatus !== "untrusted" ||
            !revokedTrustRefreshBlocked ||
            retrustedRegistry?.trustStatus !== "trusted"
          ) {
            throw new Error("Desktop smoke plugin registry trust revocation did not block refresh and re-trust cleanly.");
          }
          const refreshedRegistrySnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.refreshPluginRegistry", {
              registryId: "desktop-smoke-registry",
            })
          );
          const refreshedRegistry = refreshedRegistrySnapshot.plugins.registries.find(
            (registry) => registry.id === "desktop-smoke-registry"
          );
          const refreshedPackage = refreshedRegistry?.packages.find(
            (item) => item.id === "desktop-registry-plugin"
          );
          if (
            refreshedRegistry?.status !== "ready" ||
            refreshedPackage?.status !== "installable" ||
            refreshedPackage.signingStatus !== "trusted" ||
            refreshedPackage.publisherId !== "desktop.registry.publisher" ||
            refreshedPackage.expiryStatus !== "valid" ||
            refreshedPackage.expiresAt !== "2099-01-01T00:00:00.000Z" ||
            refreshedPackage.signatureHash !== registrySignatureHash ||
            refreshedPackage.publicKeyFingerprint !== registryPublicKeyFingerprint
          ) {
            throw new Error("Desktop smoke plugin registry refresh did not expose a pinned installable package.");
          }
          const revokedSignerSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.revokePluginRegistrySigner", {
              registryId: "desktop-smoke-registry",
              publicKeyFingerprint: registryPublicKeyFingerprint,
              reason: "Desktop smoke signer revocation",
            })
          );
          const revokedSignerRegistry =
            revokedSignerSnapshot.plugins.registries.find(
              (registry) => registry.id === "desktop-smoke-registry"
            );
          const revokedSignerPackage = revokedSignerRegistry?.packages.find(
            (item) => item.id === "desktop-registry-plugin"
          );
          let revokedSignerInstallBlocked = false;
          try {
            await request<LocalAdeSnapshot>(
              operation("mutation", "settings.installPluginRegistryPackage", {
                registryId: "desktop-smoke-registry",
                packageId: "desktop-registry-plugin",
              })
            );
          } catch (error) {
            revokedSignerInstallBlocked = error instanceof Error
              ? error.message.includes("signer is revoked")
              : String(error).includes("signer is revoked");
          }
          const restoredSignerSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.restorePluginRegistrySigner", {
              registryId: "desktop-smoke-registry",
              publicKeyFingerprint: registryPublicKeyFingerprint,
            })
          );
          const restoredSignerPackage = restoredSignerSnapshot.plugins.registries
            .find((registry) => registry.id === "desktop-smoke-registry")
            ?.packages.find((item) => item.id === "desktop-registry-plugin");
          if (
            revokedSignerRegistry?.revokedSigners.length !== 1 ||
            revokedSignerPackage?.status !== "revoked" ||
            revokedSignerPackage.signingStatus !== "revoked" ||
            revokedSignerPackage.revocationSource !== "manual" ||
            !revokedSignerInstallBlocked ||
            restoredSignerPackage?.status !== "installable" ||
            restoredSignerPackage.signingStatus !== "trusted"
          ) {
            throw new Error("Desktop smoke plugin registry signer revocation did not block and restore install policy.");
          }
          registryFeedRevokedSigners = [
            {
              publicKeyFingerprint: registryPublicKeyFingerprint,
              revokedAt: new Date().toISOString(),
              reason: "Desktop smoke registry feed revocation",
            },
          ];
          const feedRevokedSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.refreshPluginRegistry", {
              registryId: "desktop-smoke-registry",
            })
          );
          const feedRevokedRegistry = feedRevokedSnapshot.plugins.registries.find(
            (registry) => registry.id === "desktop-smoke-registry"
          );
          const feedRevokedPackage = feedRevokedRegistry?.packages.find(
            (item) => item.id === "desktop-registry-plugin"
          );
          let feedRevokedInstallBlocked = false;
          try {
            await request<LocalAdeSnapshot>(
              operation("mutation", "settings.installPluginRegistryPackage", {
                registryId: "desktop-smoke-registry",
                packageId: "desktop-registry-plugin",
              })
            );
          } catch (error) {
            feedRevokedInstallBlocked = error instanceof Error
              ? error.message.includes("signer is revoked")
              : String(error).includes("signer is revoked");
          }
          let feedRestoreBlocked = false;
          try {
            await request<LocalAdeSnapshot>(
              operation("mutation", "settings.restorePluginRegistrySigner", {
                registryId: "desktop-smoke-registry",
                publicKeyFingerprint: registryPublicKeyFingerprint,
              })
            );
          } catch (error) {
            feedRestoreBlocked = error instanceof Error
              ? error.message.includes("managed by the registry feed")
              : String(error).includes("managed by the registry feed");
          }
          registryFeedRevokedSigners = [];
          const feedClearedSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.refreshPluginRegistry", {
              registryId: "desktop-smoke-registry",
            })
          );
          const feedClearedPackage = feedClearedSnapshot.plugins.registries
            .find((registry) => registry.id === "desktop-smoke-registry")
            ?.packages.find((item) => item.id === "desktop-registry-plugin");
          if (
            feedRevokedRegistry?.revokedSigners.some(
              (item) =>
                item.publicKeyFingerprint === registryPublicKeyFingerprint &&
                item.source === "registry"
            ) !== true ||
            feedRevokedPackage?.status !== "revoked" ||
            feedRevokedPackage.signingStatus !== "revoked" ||
            feedRevokedPackage.revocationSource !== "registry" ||
            !feedRevokedInstallBlocked ||
            !feedRestoreBlocked ||
            feedClearedPackage?.status !== "installable" ||
            feedClearedPackage.signingStatus !== "trusted"
          ) {
            throw new Error("Desktop smoke plugin registry feed revocation did not block and clear install policy.");
          }
          const registryInstallSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.installPluginRegistryPackage", {
              registryId: "desktop-smoke-registry",
              packageId: "desktop-registry-plugin",
            })
          );
          const registryPlugin = registryInstallSnapshot.plugins.items.find(
            (plugin) => plugin.id === "desktop-registry-plugin"
          );
          const installedRegistry = registryInstallSnapshot.plugins.registries.find(
            (registry) => registry.id === "desktop-smoke-registry"
          );
          const installedRegistryPackage = installedRegistry?.packages.find(
            (item) => item.id === "desktop-registry-plugin"
          );
          const registryCapabilityEnabled =
            registryInstallSnapshot.capabilities.capabilities.some(
              (item) =>
                item.kind === "plugin" &&
                item.name === "Desktop Registry Plugin" &&
                item.enabled
            );
          const registryRunApproval = await approvePluginRunOperation(
            "desktop-registry-plugin"
          );
          const registryRunSnapshot = await request<LocalAdeSnapshot>(
            operation("mutation", "settings.runPlugin", {
              pluginId: "desktop-registry-plugin",
              confirmation:
                registryPlugin?.runConfirmationToken ??
                "RUN PLUGIN desktop-registry-plugin",
              operationApprovalId: registryRunApproval.approvalId,
            })
          );
          const registryRunPlugin = registryRunSnapshot.plugins.items.find(
            (plugin) => plugin.id === "desktop-registry-plugin"
          );
          console.log(
            "PLUGIN_REGISTRY_INSTALL",
            JSON.stringify({
              present: Boolean(registryPlugin),
              registryStatus: installedRegistry?.status ?? "missing",
              packageStatus: installedRegistryPackage?.status ?? "missing",
              trustStatus: installedRegistry?.trustStatus ?? "missing",
              trustRevoked: revokedTrustRegistry?.trustStatus === "untrusted",
              trustRevokedRefreshBlocked: revokedTrustRefreshBlocked,
              signerRevoked: revokedSignerPackage?.status === "revoked",
              signerRevokedInstallBlocked: revokedSignerInstallBlocked,
              signerRestored: restoredSignerPackage?.signingStatus === "trusted",
              feedSignerRevoked: feedRevokedPackage?.status === "revoked",
              feedRevokedInstallBlocked,
              feedRestoreBlocked,
              feedCleared:
                feedClearedPackage?.status === "installable" &&
                feedClearedPackage.signingStatus === "trusted",
              installSource: registryPlugin?.installSource ?? "missing",
              publisher: registryPlugin?.publisher ?? "",
              publisherId: registryPlugin?.packagePublisherId ?? "",
              expiryStatus: registryPlugin?.packageExpiryStatus ?? "missing",
              expiresAt: registryPlugin?.packageExpiresAt ?? "",
              registryName: registryPlugin?.packageRegistryName ?? "",
              registryPackageId: registryPlugin?.packageRegistryPackageId ?? "",
              registryUrl: registryPlugin?.packageRegistryUrl ?? "",
              signatureHash: registryPlugin?.packageSignatureHash ?? "",
              publicKeyFingerprint:
                registryPlugin?.packagePublicKeyFingerprint ?? "",
              capabilityEnabled: registryCapabilityEnabled,
              runStatus: registryRunPlugin?.lastRun?.status ?? "missing",
              approvalStatus:
                registryRunPlugin?.runOperation.approvalStatus ?? "missing",
              stdout: registryRunPlugin?.lastRun?.stdout ?? "",
            })
          );
          if (
            registryPlugin?.installSource !== "signed-package" ||
            installedRegistry?.status !== "ready" ||
            installedRegistry?.trustStatus !== "trusted" ||
            installedRegistryPackage?.status !== "installed" ||
            registryPlugin.publisher !== "Desktop Registry Publisher" ||
            registryPlugin.packagePublisherId !== "desktop.registry.publisher" ||
            registryPlugin.packageExpiryStatus !== "valid" ||
            registryPlugin.packageExpiresAt !== "2099-01-01T00:00:00.000Z" ||
            registryPlugin.packageRegistryName !== "Desktop Smoke Registry" ||
            registryPlugin.packageRegistryPackageId !== "desktop-registry-plugin" ||
            registryPlugin.packageRegistryUrl !== registryUrl ||
            registryPlugin.packageSignatureHash !== registrySignatureHash ||
            registryPlugin.packagePublicKeyFingerprint !==
              registryPublicKeyFingerprint ||
            !registryCapabilityEnabled ||
            registryRunPlugin?.lastRun?.status !== "success" ||
            !registryRunPlugin.lastRun.stdout.includes(
              "desktop registry plugin ok"
            ) ||
            !registryRunPlugin.lastRun.stdout.includes("root=false") ||
            !registryRunPlugin.lastRun.stdout.includes("access=sandbox")
          ) {
            throw new Error("Desktop smoke registry plugin package did not install and run.");
          }
        } finally {
          await new Promise<void>((resolve, reject) => {
            registryServer.close((error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        }
      });
      const shellPluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPlugin", {
          id: "desktop-smoke-shell-plugin",
          name: "Desktop Smoke Shell Plugin",
          enabled: true,
          command: process.platform === "win32" ? "powershell" : "sh",
          args:
            process.platform === "win32"
              ? ["-NoProfile", "-Command", "Write-Output blocked"]
              : ["-c", "printf blocked"],
          timeoutMs: 5000,
        })
      );
      const shellPlugin = shellPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-shell-plugin"
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustPlugin", {
          pluginId: "desktop-smoke-shell-plugin",
          fingerprint: shellPlugin?.fingerprint ?? "",
        })
      );
      let shellPluginBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
            operation("mutation", "settings.runPlugin", {
              pluginId: "desktop-smoke-shell-plugin",
              confirmation: "RUN PLUGIN desktop-smoke-shell-plugin",
              operationApprovalId: "plugin-approval-unused",
            })
          );
      } catch (error) {
        shellPluginBlocked = error instanceof Error
          ? error.message.includes("sandbox")
          : String(error).includes("sandbox");
      }
      console.log(
        "PLUGIN_SANDBOX_BLOCK",
        JSON.stringify({
          policy: shellPlugin?.executionPolicy?.status ?? "missing",
          blocked: shellPluginBlocked,
        })
      );
      if (
        shellPlugin?.executionPolicy?.status !== "blocked" ||
        !shellPluginBlocked
      ) {
        throw new Error(
          "Desktop smoke plugin sandbox did not block shell evaluation."
        );
      }
      const restrictedOutputPath = path.join(
        repoRoot,
        "desktop-smoke-restricted-output.txt"
      );
      await rm(restrictedOutputPath, { force: true }).catch(() => undefined);
      const restrictedPluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPlugin", {
          id: "desktop-smoke-restricted-plugin",
          name: "Desktop Smoke Restricted Plugin",
          enabled: true,
          scopes: ["process"],
          command: process.execPath,
          args: [
            "-e",
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "fs.writeFileSync(path.join(process.cwd(), 'desktop-smoke-restricted-output.txt'), 'sandboxed');",
              "process.stdout.write(['root='+Boolean(process.env.ERAGEAR_PROJECT_ROOT),'access='+process.env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS,'scopes='+process.env.ERAGEAR_PLUGIN_SCOPES].join('\\n'));",
            ].join(" "),
          ],
          timeoutMs: 5000,
        })
      );
      const restrictedPlugin = restrictedPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-restricted-plugin"
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustPlugin", {
          pluginId: "desktop-smoke-restricted-plugin",
          fingerprint: restrictedPlugin?.fingerprint ?? "",
        })
      );
      const restrictedRunApproval = await approvePluginRunOperation(
        "desktop-smoke-restricted-plugin"
      );
      const restrictedRunSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPlugin", {
          pluginId: "desktop-smoke-restricted-plugin",
          confirmation: "RUN PLUGIN desktop-smoke-restricted-plugin",
          operationApprovalId: restrictedRunApproval.approvalId,
        })
      );
      const restrictedRunPlugin = restrictedRunSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-restricted-plugin"
      );
      let workspaceFileLeaked = false;
      try {
        await readFile(restrictedOutputPath, "utf8");
        workspaceFileLeaked = true;
      } catch {
        workspaceFileLeaked = false;
      }
      console.log(
        "PLUGIN_WORKSPACE_SANDBOX",
        JSON.stringify({
          scopes: restrictedRunPlugin?.scopes ?? [],
          status: restrictedRunPlugin?.lastRun?.status ?? "missing",
          stdout: restrictedRunPlugin?.lastRun?.stdout ?? "",
          workspaceFileLeaked,
          diagnostics: restrictedRunPlugin?.lastRun?.diagnostics.some((entry) =>
            entry.includes("ERAGEAR_PROJECT_ROOT was not exposed")
          ) ?? false,
        })
      );
      await rm(restrictedOutputPath, { force: true }).catch(() => undefined);
      if (
        restrictedRunPlugin?.lastRun?.status !== "success" ||
        !restrictedRunPlugin.lastRun.stdout.includes("root=false") ||
        !restrictedRunPlugin.lastRun.stdout.includes("access=sandbox") ||
        !restrictedRunPlugin.lastRun.stdout.includes("scopes=process") ||
        workspaceFileLeaked ||
        !restrictedRunPlugin.lastRun.diagnostics.some((entry) =>
          entry.includes("ERAGEAR_PROJECT_ROOT was not exposed")
        )
      ) {
        throw new Error("Desktop smoke restricted plugin workspace sandbox failed.");
      }
      const policyOutputPath = path.join(
        repoRoot,
        "desktop-smoke-policy-output.txt"
      );
      await rm(policyOutputPath, { force: true }).catch(() => undefined);
      const policyPluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPlugin", {
          id: "desktop-smoke-policy-plugin",
          name: "Desktop Smoke Policy Plugin",
          enabled: true,
          policyPreset: "restricted",
          scopes: ["process", "project-root"],
          command: process.execPath,
          args: [
            "-e",
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "fs.writeFileSync(path.join(process.cwd(), 'desktop-smoke-policy-output.txt'), 'sandboxed');",
              "process.stdout.write(['root='+Boolean(process.env.ERAGEAR_PROJECT_ROOT),'access='+process.env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS,'scopes='+process.env.ERAGEAR_PLUGIN_SCOPES,'policy='+process.env.ERAGEAR_PLUGIN_POLICY_PRESET].join('\\n'));",
            ].join(" "),
          ],
          timeoutMs: 5000,
        })
      );
      const policyPlugin = policyPluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-policy-plugin"
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustPlugin", {
          pluginId: "desktop-smoke-policy-plugin",
          fingerprint: policyPlugin?.fingerprint ?? "",
        })
      );
      const policyRunApproval = await approvePluginRunOperation(
        "desktop-smoke-policy-plugin"
      );
      const policyRunSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPlugin", {
          pluginId: "desktop-smoke-policy-plugin",
          confirmation: "RUN PLUGIN desktop-smoke-policy-plugin",
          operationApprovalId: policyRunApproval.approvalId,
        })
      );
      const policyRunPlugin = policyRunSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-policy-plugin"
      );
      let policyWorkspaceFileLeaked = false;
      try {
        await readFile(policyOutputPath, "utf8");
        policyWorkspaceFileLeaked = true;
      } catch {
        policyWorkspaceFileLeaked = false;
      }
      console.log(
        "PLUGIN_POLICY_PRESET",
        JSON.stringify({
          preset: policyRunPlugin?.policyPreset ?? "missing",
          requestedProjectRoot: true,
          scopes: policyRunPlugin?.scopes ?? [],
          workspaceAccess:
            policyRunPlugin?.runOperation.workspaceAccess ?? "missing",
          status: policyRunPlugin?.lastRun?.status ?? "missing",
          stdout: policyRunPlugin?.lastRun?.stdout ?? "",
          workspaceFileLeaked: policyWorkspaceFileLeaked,
          diagnostics:
            policyRunPlugin?.diagnostics.some((entry) =>
              entry.includes("forces sandbox")
            ) ?? false,
        })
      );
      await rm(policyOutputPath, { force: true }).catch(() => undefined);
      if (
        policyRunPlugin?.policyPreset !== "restricted" ||
        policyRunPlugin?.runOperation.workspaceAccess !== "sandbox" ||
        policyRunPlugin?.lastRun?.status !== "success" ||
        policyRunPlugin?.lastRun?.stdout.includes("root=false") !== true ||
        policyRunPlugin?.lastRun?.stdout.includes("access=sandbox") !== true ||
        policyRunPlugin?.lastRun?.stdout.includes("scopes=process") !== true ||
        policyRunPlugin?.lastRun?.stdout.includes("policy=restricted") !== true ||
        policyWorkspaceFileLeaked ||
        policyRunPlugin?.diagnostics.some((entry) =>
          entry.includes("forces sandbox")
        ) !== true
      ) {
        throw new Error("Desktop smoke plugin policy preset sandbox failed.");
      }
      });
    });
    } finally {
      if (previousPluginAllowed === undefined) {
        delete process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED;
      } else {
        process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED = previousPluginAllowed;
      }
      if (previousPlugin_BLOCKED === undefined) {
        delete process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED;
      } else {
        process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED = previousPlugin_BLOCKED;
      }
    }

    await withFileBackup(ade.mcp.configPath, async () => {
      const sseMcp = await startSseMcpFixture({
        closeFirstStreamOnFirstRequest: true,
        closeOnceOnMethod: "resources/read",
      });
      try {
        const mcpSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertMcpServer", {
            id: "desktop-smoke-mcp",
            name: "Desktop Smoke MCP",
            transport: "stdio",
            enabled: true,
            command: process.execPath,
            args: [smokeMcpScript],
          })
        );
        let smokeMcp = mcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        const probedMcpSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.probeMcpServer", {
            id: "desktop-smoke-mcp",
          })
        );
        smokeMcp = probedMcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        console.log(
          "MCP_DISCOVERY",
          JSON.stringify({
            health: smokeMcp?.health ?? "missing",
            protocol: smokeMcp?.protocol.status ?? "missing",
            probe: smokeMcp?.probe
              ? {
                  status: smokeMcp.probe.status,
                  steps: smokeMcp.probe.steps.map((step) => [
                    step.step,
                    step.status,
                  ]),
                  history: smokeMcp.probeHistory.map((run) => [
                    run.status,
                    run.protocolStatus,
                    run.stepCount,
                  ]),
                }
              : "missing",
            tools: smokeMcp?.tools.map((tool) => tool.name) ?? [],
            resources:
              smokeMcp?.resources.map((resource) => resource.name ?? resource.uri) ?? [],
          })
        );
        if (
          smokeMcp?.health !== "available" ||
          smokeMcp.protocol.status !== "initialized" ||
          smokeMcp.probe.status !== "success" ||
          smokeMcp.probeHistory[0]?.status !== "success" ||
          smokeMcp.probeHistory[0]?.protocolStatus !== "initialized" ||
          !smokeMcp.probe.steps.some((step) => step.step === "initialize") ||
          !smokeMcp.tools.some((tool) => tool.name === "desktop_smoke_tool")
        ) {
          throw new Error("Desktop smoke MCP protocol discovery did not complete.");
        }
        if (smokeMcp.trustStatus !== "untrusted") {
          throw new Error("Desktop smoke MCP should require invocation trust first.");
        }
        const blockedStdioToolResult = await request<McpInvocationResult>(
          operation("mutation", "settings.invokeMcpTool", {
            serverId: "desktop-smoke-mcp",
            toolName: "desktop_smoke_tool",
            arguments: { path: "README.md" },
          })
        );
        console.log(
          "MCP_INVOKE_POLICY",
          JSON.stringify({
            status: blockedStdioToolResult.status,
            diagnostics: blockedStdioToolResult.diagnostics,
          })
        );
        if (
          blockedStdioToolResult.status !== "failed" ||
          !blockedStdioToolResult.diagnostics
            .join("\n")
            .includes("MCP invocation blocked by trust policy")
        ) {
          throw new Error("Desktop smoke MCP trust policy did not block invocation.");
        }
        const trustedMcpSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustMcpServer", {
            serverId: "desktop-smoke-mcp",
            fingerprint: smokeMcp.fingerprint,
          })
        );
        smokeMcp = trustedMcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        console.log(
          "MCP_TRUST",
          JSON.stringify({
            trustStatus: smokeMcp?.trustStatus ?? "missing",
            trusted: smokeMcp?.trustedFingerprint === smokeMcp?.fingerprint,
          })
        );
        if (
          smokeMcp?.trustStatus !== "trusted" ||
          smokeMcp.trustedFingerprint !== smokeMcp.fingerprint
        ) {
          throw new Error("Desktop smoke MCP trust approval did not persist.");
        }
        const stdioToolResult = await request<McpInvocationResult>(
          operation("mutation", "settings.invokeMcpTool", {
            serverId: "desktop-smoke-mcp",
            toolName: "desktop_smoke_tool",
            arguments: { path: "README.md" },
          })
        );
        const stdioResourceResult = await request<McpInvocationResult>(
          operation("mutation", "settings.readMcpResource", {
            serverId: "desktop-smoke-mcp",
            uri: "file:///desktop-smoke",
          })
        );
        console.log(
          "MCP_INVOKE",
          JSON.stringify({
            toolStatus: stdioToolResult.status,
            toolText: stdioToolResult.resultText,
            resourceStatus: stdioResourceResult.status,
            resourceText: stdioResourceResult.resultText,
          })
        );
        if (
          stdioToolResult.status !== "success" ||
          !stdioToolResult.resultText.includes("desktop tool call desktop_smoke_tool") ||
          stdioResourceResult.status !== "success" ||
          !stdioResourceResult.resultText.includes(
            "desktop resource read file:///desktop-smoke"
          )
        ) {
          throw new Error("Desktop smoke MCP invocation did not complete.");
        }
        const invokedMcpSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const invokedMcp = invokedMcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        console.log(
          "MCP_INVOKE_AUDIT",
          JSON.stringify({
            count: invokedMcp?.invocationHistory.length ?? 0,
            methods:
              invokedMcp?.invocationHistory.map((run) => [
                run.method,
                run.status,
                run.target,
              ]) ?? [],
          })
        );
        if (
          !invokedMcp ||
          invokedMcp.invocationHistory.length < 3 ||
          invokedMcp.invocationHistory[0]?.method !== "resources/read" ||
          invokedMcp.invocationHistory[1]?.method !== "tools/call" ||
          invokedMcp.invocationHistory[2]?.status !== "failed"
        ) {
          throw new Error("Desktop smoke MCP invocation audit was not persisted.");
        }
        console.log(
          "MCP_NOTIFICATIONS",
          JSON.stringify({
            count: invokedMcp.notificationHistory.length,
            notifications: invokedMcp.notificationHistory.map((notification) => [
              notification.source,
              notification.method,
              notification.payloadText,
            ]),
          })
        );
        if (
          !invokedMcp.notificationHistory.some(
            (notification) =>
              notification.source === "probe" &&
              notification.method === "notifications/message"
          ) ||
          !invokedMcp.notificationHistory.some(
            (notification) =>
              notification.source === "invocation" &&
              notification.method === "notifications/progress"
          )
        ) {
          throw new Error("Desktop smoke MCP notification history was not captured.");
        }
        const sseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertMcpServer", {
            id: "desktop-smoke-sse-mcp",
            name: "Desktop Smoke SSE MCP",
            transport: "sse",
            enabled: true,
            url: sseMcp.streamUrl,
            messageEndpoint: sseMcp.messageEndpoint,
            headerEnv: { Authorization: "ERAGEAR_DESKTOP_MCP_AUTH" },
          })
        );
        let smokeSseMcp = sseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        const sseReconnectVerified = Boolean(
          smokeSseMcp?.probe.steps.some(
            (step) => step.step === "stream-reconnect"
          ) && (sseMcp.requestCounts.initialize ?? 0) >= 2
        );
        const probedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.probeMcpServer", {
            id: "desktop-smoke-sse-mcp",
          })
        );
        smokeSseMcp = probedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_SSE_DISCOVERY",
          JSON.stringify({
            health: smokeSseMcp?.health ?? "missing",
            protocol: smokeSseMcp?.protocol.status ?? "missing",
            probe: smokeSseMcp?.probe
              ? {
                  status: smokeSseMcp.probe.status,
                  steps: smokeSseMcp.probe.steps.map((step) => [
                    step.step,
                    step.status,
                  ]),
                  history: smokeSseMcp.probeHistory.map((run) => [
                    run.status,
                    run.protocolStatus,
                    run.stepCount,
                  ]),
                }
              : "missing",
            headerEnv: smokeSseMcp?.headerEnv ?? [],
            reconnect: {
              verified: sseReconnectVerified,
              initializeRequests: sseMcp.requestCounts.initialize ?? 0,
            },
            tools: smokeSseMcp?.tools.map((tool) => tool.name) ?? [],
            resources:
              smokeSseMcp?.resources.map(
                (resource) => resource.name ?? resource.uri
              ) ?? [],
          })
        );
        if (
          smokeSseMcp?.health !== "available" ||
          smokeSseMcp.protocol.status !== "initialized" ||
          smokeSseMcp.probe.status !== "success" ||
          smokeSseMcp.probeHistory[0]?.status !== "success" ||
          smokeSseMcp.probeHistory[0]?.protocolStatus !== "initialized" ||
          !smokeSseMcp.probe.steps.some((step) => step.step === "stream-open") ||
          !smokeSseMcp.probe.steps.some((step) => step.step === "endpoint") ||
          !sseReconnectVerified ||
          smokeSseMcp.headerEnv[0]?.header !== "Authorization" ||
          smokeSseMcp.headerEnv[0]?.envKey !== "ERAGEAR_DESKTOP_MCP_AUTH" ||
          smokeSseMcp.headerEnv[0]?.present !== true ||
          !smokeSseMcp.tools.some(
            (tool) => tool.name === "desktop_smoke_sse_tool"
          )
        ) {
          throw new Error("Desktop smoke SSE MCP discovery did not complete.");
        }
        if (smokeSseMcp.trustStatus !== "untrusted") {
          throw new Error("Desktop smoke SSE MCP should require invocation trust first.");
        }
        const trustedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustMcpServer", {
            serverId: "desktop-smoke-sse-mcp",
            fingerprint: smokeSseMcp.fingerprint,
          })
        );
        smokeSseMcp = trustedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_SSE_TRUST",
          JSON.stringify({
            trustStatus: smokeSseMcp?.trustStatus ?? "missing",
            trusted: smokeSseMcp?.trustedFingerprint === smokeSseMcp?.fingerprint,
          })
        );
        if (
          smokeSseMcp?.trustStatus !== "trusted" ||
          smokeSseMcp.trustedFingerprint !== smokeSseMcp.fingerprint
        ) {
          throw new Error("Desktop smoke SSE MCP trust approval did not persist.");
        }
        const controlledSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.configureMcpRemoteControls", {
            serverId: "desktop-smoke-sse-mcp",
            fingerprint: smokeSseMcp.fingerprint,
            requestTimeoutMs: 2500,
            reconnectAttempts: 2,
            notificationWatchMs: 500,
          })
        );
        smokeSseMcp = controlledSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_REMOTE_CONTROLS",
          JSON.stringify({
            mode: smokeSseMcp?.remoteControls.mode ?? "missing",
            requestTimeoutMs: smokeSseMcp?.remoteControls.requestTimeoutMs ?? 0,
            reconnectAttempts: smokeSseMcp?.remoteControls.reconnectAttempts ?? -1,
            notificationWatchMs:
              smokeSseMcp?.remoteControls.notificationWatchMs ?? 0,
            trustStatus: smokeSseMcp?.trustStatus ?? "missing",
          })
        );
        if (
          smokeSseMcp?.remoteControls.mode !== "custom" ||
          smokeSseMcp.remoteControls.requestTimeoutMs !== 2500 ||
          smokeSseMcp.remoteControls.reconnectAttempts !== 2 ||
          smokeSseMcp.remoteControls.notificationWatchMs !== 500 ||
          smokeSseMcp.trustStatus !== "changed"
        ) {
          throw new Error("Desktop smoke MCP remote controls did not persist.");
        }
        const retrustedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustMcpServer", {
            serverId: "desktop-smoke-sse-mcp",
            fingerprint: smokeSseMcp.fingerprint,
          })
        );
        smokeSseMcp = retrustedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        if (
          smokeSseMcp?.trustStatus !== "trusted" ||
          smokeSseMcp.trustedFingerprint !== smokeSseMcp.fingerprint
        ) {
          throw new Error(
            "Desktop smoke SSE MCP trust approval did not refresh after remote controls."
          );
        }
        const agentRouting = retrustedSseSnapshot.mcp.agentRouting;
        console.log(
          "MCP_AGENT_ROUTING",
          JSON.stringify({
            status: agentRouting.status,
            direct: agentRouting.injectableCount,
            conditional: agentRouting.conditionalCount,
            blocked: agentRouting.blockedCount,
            routes: agentRouting.routes.map((route) => [
              route.serverName,
              route.status,
              route.transport,
              route.brokerMode,
              route.requiresAgentCapability ?? "none",
              route.agentSupport,
              route.agentInvocationCount,
            ]),
          })
        );
        const stdioRoute = agentRouting.routes.find(
          (route) => route.serverName === "Desktop Smoke MCP"
        );
        const sseRoute = agentRouting.routes.find(
          (route) => route.serverName === "Desktop Smoke SSE MCP"
        );
        if (
          agentRouting.injectableCount < 2 ||
          agentRouting.conditionalCount !== 0 ||
          stdioRoute?.status !== "injectable" ||
          stdioRoute.brokerMode !== "stdio-proxy" ||
          stdioRoute.agentSupport !== "not-required" ||
          sseRoute?.status !== "injectable" ||
          sseRoute.brokerMode !== "stdio-proxy" ||
          sseRoute.requiresAgentCapability !== undefined ||
          sseRoute.agentSupport !== "not-required" ||
          JSON.stringify(agentRouting).includes("Bearer desktop-mcp-secret")
        ) {
          throw new Error("Desktop smoke MCP agent routing preview was not correct.");
        }
        const sseToolResult = await request<McpInvocationResult>(
          operation("mutation", "settings.invokeMcpTool", {
            serverId: "desktop-smoke-sse-mcp",
            toolName: "desktop_smoke_sse_tool",
            arguments: { path: "SSE.md" },
          })
        );
        const sseResourceResult = await request<McpInvocationResult>(
          operation("mutation", "settings.readMcpResource", {
            serverId: "desktop-smoke-sse-mcp",
            uri: "memory://desktop-smoke-sse",
          })
        );
        console.log(
          "MCP_SSE_INVOKE",
          JSON.stringify({
            toolStatus: sseToolResult.status,
            toolText: sseToolResult.resultText,
            resourceStatus: sseResourceResult.status,
            resourceText: sseResourceResult.resultText,
            diagnostics: sseToolResult.diagnostics,
          })
        );
        console.log(
          "MCP_SSE_RESOURCE_RECONNECT",
          JSON.stringify({
            status: sseResourceResult.status,
            requests: sseMcp.requestCounts["resources/read"] ?? 0,
            diagnostics: sseResourceResult.diagnostics,
          })
        );
        if (
          sseToolResult.status !== "success" ||
          !sseToolResult.resultText.includes(
            "desktop sse tool desktop_smoke_sse_tool"
          ) ||
          !sseToolResult.resultText.includes("[redacted]") ||
          sseToolResult.resultText.includes("Bearer desktop-mcp-secret") ||
          sseResourceResult.status !== "success" ||
          !sseResourceResult.resultText.includes(
            "desktop sse resource memory://desktop-smoke-sse"
          ) ||
          (sseMcp.requestCounts["resources/read"] ?? 0) < 2 ||
          !sseResourceResult.diagnostics
            .join("\n")
            .includes("MCP SSE invocation stream closed before completion; reconnecting")
        ) {
          throw new Error("Desktop smoke SSE MCP invocation/redaction did not complete.");
        }
        const invokedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const invokedSseMcp = invokedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_SSE_INVOKE_AUDIT",
          JSON.stringify({
            count: invokedSseMcp?.invocationHistory.length ?? 0,
            methods:
              invokedSseMcp?.invocationHistory.map((run) => [
                run.method,
                run.status,
                run.target,
                run.resultText,
              ]) ?? [],
          })
        );
        const serializedSseInvocationHistory = JSON.stringify(
          invokedSseMcp?.invocationHistory ?? []
        );
        if (
          !invokedSseMcp ||
          !invokedSseMcp.invocationHistory.some(
            (run) =>
              run.method === "tools/call" &&
              run.status === "success" &&
              run.resultText.includes("[redacted]")
          ) ||
          !invokedSseMcp.invocationHistory.some(
            (run) =>
              run.method === "resources/read" &&
              run.status === "success" &&
              run.resultText.includes("desktop sse resource")
          ) ||
          serializedSseInvocationHistory.includes(
            "Bearer desktop-mcp-secret"
          )
        ) {
          throw new Error("Desktop smoke SSE MCP invocation audit/redaction failed.");
        }
        console.log(
          "MCP_SSE_NOTIFICATIONS",
          JSON.stringify({
            count: invokedSseMcp.notificationHistory.length,
            notifications: invokedSseMcp.notificationHistory.map((notification) => [
              notification.source,
              notification.method,
              notification.payloadText,
            ]),
          })
        );
        const serializedSseNotifications = JSON.stringify(
          invokedSseMcp.notificationHistory
        );
        if (
          !invokedSseMcp.notificationHistory.some(
            (notification) =>
              notification.source === "probe" &&
              notification.method === "notifications/message"
          ) ||
          !invokedSseMcp.notificationHistory.some(
            (notification) =>
              notification.source === "invocation" &&
              notification.method === "notifications/message"
          ) ||
          !serializedSseNotifications.includes("[redacted]") ||
          serializedSseNotifications.includes("Bearer desktop-mcp-secret")
        ) {
          throw new Error(
            "Desktop smoke SSE MCP notification history/redaction failed."
          );
        }
        const beforeMonitorInitializeCount = sseMcp.requestCounts.initialize ?? 0;
        sseMcp.closeNextStreamOnFirstRequest();
        const monitoredSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.watchMcpNotifications", {
            serverId: "desktop-smoke-sse-mcp",
          })
        );
        const monitoredSseMcp = monitoredSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        const monitorRun = monitoredSseMcp?.notificationMonitorHistory[0];
        console.log(
          "MCP_NOTIFICATION_MONITOR",
          JSON.stringify({
            status: monitorRun?.status ?? "missing",
            requestedDurationMs: monitorRun?.requestedDurationMs ?? 0,
            reconnectCount: monitorRun?.reconnectCount ?? 0,
            streamOpenCount: monitorRun?.streamOpenCount ?? 0,
            notificationCount: monitorRun?.notificationCount ?? 0,
            initializeRequests:
              (sseMcp.requestCounts.initialize ?? 0) - beforeMonitorInitializeCount,
            sources:
              monitorRun?.notifications.map((notification) => notification.source) ??
              [],
            methods:
              monitorRun?.notifications.map((notification) => notification.method) ??
              [],
          })
        );
        const serializedMonitor = JSON.stringify(monitoredSseMcp ?? {});
        if (
          monitorRun?.status !== "success" ||
          monitorRun.requestedDurationMs !== 500 ||
          monitorRun.reconnectCount < 1 ||
          monitorRun.streamOpenCount < 2 ||
          monitorRun.notificationCount < 1 ||
          !monitorRun.notifications.some(
            (notification) =>
              notification.source === "monitor" &&
              notification.method === "notifications/message"
          ) ||
          !serializedMonitor.includes("[redacted]") ||
          serializedMonitor.includes("Bearer desktop-mcp-secret")
        ) {
          throw new Error("Desktop smoke MCP notification monitor failed.");
        }
      } finally {
        await sseMcp.close();
      }
    });

    const providerSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.testProvider", {
        providerId: `provider.agent.${agent.id}`,
      })
    );
    const testedProvider = providerSnapshot.providers.find(
      (provider) => provider.id === `provider.agent.${agent.id}`
    );
    console.log(
      "AGENT",
      JSON.stringify({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        command: agent.command,
        args: agent.args ?? [],
        providerStatus: testedProvider?.status ?? "missing",
        providerCliStatus: testedProvider?.cliStatus ?? "missing",
        providerAuthStatus: testedProvider?.authStatus ?? "missing",
        providerModelStatus: testedProvider?.modelStatus ?? "missing",
        providerVersion: testedProvider?.version ?? null,
      })
    );
    if (testedProvider?.cliStatus !== "ok") {
      throw new Error(
        `Expected provider CLI readiness to be ok, got ${testedProvider?.cliStatus ?? "missing"}.`
      );
    }
    await testCodexProviderDoctor();

    sessionLifecycleHooksBackup = await readOptionalFile(hooksPath);
    const agentLifecycleHookScript =
      "process.stdout.write(['desktop agent lifecycle',process.env.ERAGEAR_HOOK_EVENT,process.env.ERAGEAR_CHAT_ID||'',process.env.ERAGEAR_TURN_ID||''].join(' '))";
    const createHookSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertHook", {
        id: "desktop-smoke-agent-create-hook",
        name: "Desktop Smoke Agent Create Hook",
        event: "after-agent-session-create",
        enabled: true,
        command: process.execPath,
        args: ["-e", agentLifecycleHookScript],
        timeoutMs: 5000,
      })
    );
    const messageHookSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertHook", {
        id: "desktop-smoke-agent-message-hook",
        name: "Desktop Smoke Agent Message Hook",
        event: "after-agent-message-send",
        enabled: true,
        command: process.execPath,
        args: ["-e", agentLifecycleHookScript],
        timeoutMs: 5000,
      })
    );
    const stopHookSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertHook", {
        id: "desktop-smoke-agent-stop-hook",
        name: "Desktop Smoke Agent Stop Hook",
        event: "after-agent-session-stop",
        enabled: true,
        command: process.execPath,
        args: ["-e", agentLifecycleHookScript],
        timeoutMs: 5000,
      })
    );
    const agentCreateHook = createHookSnapshot.hooks.items.find(
      (hook) => hook.id === "desktop-smoke-agent-create-hook"
    );
    const agentMessageHook = messageHookSnapshot.hooks.items.find(
      (hook) => hook.id === "desktop-smoke-agent-message-hook"
    );
    const agentStopHook = stopHookSnapshot.hooks.items.find(
      (hook) => hook.id === "desktop-smoke-agent-stop-hook"
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustHook", {
        hookId: "desktop-smoke-agent-create-hook",
        fingerprint: agentCreateHook?.fingerprint ?? "",
      })
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustHook", {
        hookId: "desktop-smoke-agent-message-hook",
        fingerprint: agentMessageHook?.fingerprint ?? "",
      })
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustHook", {
        hookId: "desktop-smoke-agent-stop-hook",
        fingerprint: agentStopHook?.fingerprint ?? "",
      })
    );

    const created = await request<SessionCreateResult>(
      operation("mutation", "createSession", {
        projectId: project.id,
        agentId: agent.id,
      })
    );
    chatId = created.chatId;
    console.log(
      "SESSION_CREATED",
      JSON.stringify({
        chatId,
        sessionId: created.sessionId ?? null,
        status: created.chatStatus,
      })
    );
    const createLifecycleRun = await waitForHookRun(
      "desktop-smoke-agent-create-hook",
      "desktop agent lifecycle after-agent-session-create"
    );
    console.log(
      "HOOK_AGENT_LIFECYCLE_CREATE",
      JSON.stringify({
        status: createLifecycleRun.status,
        stdout: createLifecycleRun.stdout,
      })
    );

    const subscription = await subscribeUntilConnected(chatId);
    subscriptionId = subscription.subscriptionId;
    const state = await request<SessionStateResult>(
      operation("query", "getSessionState", { chatId })
    );
    console.log(
      "SESSION_STATE",
      JSON.stringify({
        status: state.status,
        chatStatus: state.chatStatus,
        connected: subscription.connected,
        agent: state.agentInfo?.title ?? state.agentInfo?.name ?? null,
      })
    );
    const activeModelSnapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const activeModelSession = activeModelSnapshot.sessions.active.find(
      (session) => session.id === chatId
    );
    console.log(
      "ACTIVE_SESSION_COCKPIT",
      JSON.stringify({
        activeCount: activeModelSnapshot.sessions.active.length,
        primaryChatId: activeModelSession?.id ?? null,
        status: activeModelSession?.chatStatus ?? null,
        agent: activeModelSession?.agentName ?? null,
        subscribers: activeModelSnapshot.sessions.active.reduce(
          (total, session) => total + (session.subscriberCount ?? 0),
          0
        ),
        pendingPermissions: activeModelSnapshot.sessions.active.reduce(
          (total, session) => total + (session.pendingPermissions ?? 0),
          0
        ),
        activeToolCalls: activeModelSnapshot.sessions.active.reduce(
          (total, session) => total + (session.activeToolCalls ?? 0),
          0
        ),
        model: activeModelSession?.model.currentModelId ?? null,
        canOpenChat: Boolean(activeModelSession),
      })
    );
    if (!activeModelSession) {
      throw new Error("Expected active session cockpit snapshot after createSession.");
    }
    const nextActiveModel = activeModelSession?.model.availableModels.find(
      (model) => model.modelId !== activeModelSession.model.currentModelId
    );
    if (activeModelSession?.model.supportsSwitching && nextActiveModel) {
      await request<unknown>(
        operation("mutation", "setModel", {
          chatId,
          modelId: nextActiveModel.modelId,
        })
      );
      const switchedModelSnapshot = await request<LocalAdeSnapshot>(
        operation("query", "settings.getLocalAdeSnapshot")
      );
      const switchedModelSession = switchedModelSnapshot.sessions.active.find(
        (session) => session.id === chatId
      );
      console.log(
        "ACTIVE_SESSION_MODEL_SWITCH",
        JSON.stringify({
          chatId,
          from: activeModelSession.model.currentModelId,
          to: nextActiveModel.modelId,
          source: switchedModelSession?.model.source ?? null,
          supportsSwitching:
            switchedModelSession?.model.supportsSwitching ?? false,
          currentModelId: switchedModelSession?.model.currentModelId ?? null,
        })
      );
      if (switchedModelSession?.model.currentModelId !== nextActiveModel.modelId) {
        throw new Error("Active session model switch did not update Local ADE snapshot.");
      }
    } else {
      console.log(
        "ACTIVE_SESSION_MODEL_SWITCH",
        JSON.stringify({
          skipped: "no alternate active session model exposed",
          chatId,
          supportsSwitching: activeModelSession?.model.supportsSwitching ?? false,
          currentModelId: activeModelSession?.model.currentModelId ?? null,
          modelCount: activeModelSession?.model.availableModels.length ?? 0,
        })
      );
    }

    const launchedCommandBase = "/agent-code-reviewer";
    const launchedCommandArgument = "Reply with exactly: desktop IPC smoke ok";
    const subagentCommandText = `${launchedCommandBase} ${launchedCommandArgument}`;
    const subagentSubmission = resolveSmokeSubagentCommand({
      text: subagentCommandText,
      subagents: ade.subagents,
    });
    if (!subagentSubmission) {
      throw new Error("Expected /agent-code-reviewer to resolve for desktop smoke.");
    }
    console.log(
      "SUBAGENT_COMMAND_SUBMIT",
      JSON.stringify({
        command: subagentSubmission.command,
        sourcePath: subagentSubmission.sourcePath,
        promptIncludesDelegate: subagentSubmission.prompt.includes(
          'Delegate this task to the "code-reviewer" subagent profile.'
        ),
        promptIncludesRequest:
          subagentSubmission.prompt.includes("desktop IPC smoke ok"),
      })
    );
    console.log(
      "LOCAL_ADE_COMMAND_LAUNCH",
      JSON.stringify({
        baseCommand: launchedCommandBase,
        argument: launchedCommandArgument,
        text: subagentCommandText,
        targetChatId: chatId,
        resolved: true,
        sendPath: "sendMessage",
      })
    );

    const sent = await request<unknown>(
      operation("mutation", "sendMessage", {
        chatId,
        text: subagentSubmission.prompt,
      })
    );
    console.log("MESSAGE_SENT", JSON.stringify(sent));
    const messageLifecycleRun = await waitForHookRun(
      "desktop-smoke-agent-message-hook",
      "desktop agent lifecycle after-agent-message-send"
    );
    console.log(
      "HOOK_AGENT_LIFECYCLE_MESSAGE",
      JSON.stringify({
        status: messageLifecycleRun.status,
        stdout: messageLifecycleRun.stdout,
      })
    );
    await wait(promptWaitMs);
    console.log(
      "MESSAGE_OBSERVED",
      JSON.stringify({ assistantSeen: subscription.assistantSeen() })
    );
    const acpSnapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const ownedAcpEntries = acpSnapshot.acpActivity.entries.filter(
      (entry) => entry.chatId === chatId
    );
    console.log(
      "ACP_ACTIVITY",
      JSON.stringify({
        total: acpSnapshot.acpActivity.stats.total,
        chatCount: acpSnapshot.acpActivity.stats.chatCount,
        owned: ownedAcpEntries.length,
        correlations: acpSnapshot.acpActivity.correlations.length,
        kinds: acpSnapshot.acpActivity.stats.kinds,
        sample: ownedAcpEntries.slice(0, 3).map((entry) => ({
          message: entry.message,
          kind: entry.kind ?? null,
          payloadBytes: entry.payloadBytes ?? null,
          metadata: entry.metadata,
        })),
      })
    );
    if (ownedAcpEntries.length === 0) {
      throw new Error("Expected Local ADE ACP activity for the active smoke chat.");
    }
    if (JSON.stringify(ownedAcpEntries).includes("rawPayload")) {
      throw new Error("ACP activity leaked rawPayload metadata.");
    }
    let timelineSnapshot = acpSnapshot;
    let timelineChatLanes = timelineSnapshot.acpActivity.timeline.lanes.filter(
      (lane) => lane.chatId
    );
    if (timelineChatLanes.length < 2) {
      const timelineSession = await request<SessionCreateResult>(
        operation("mutation", "createSession", {
          projectId: project.id,
          agentId: agent.id,
        })
      );
      timelineChatId = timelineSession.chatId;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(500);
        timelineSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        timelineChatLanes = timelineSnapshot.acpActivity.timeline.lanes.filter(
          (lane) => lane.chatId
        );
        if (
          timelineChatLanes.length >= 2 &&
          timelineSnapshot.acpActivity.timeline.frames.some(
            (frame) => frame.chatId === timelineChatId
          )
        ) {
          break;
        }
      }
    }
    const workspaceReplay = await request<AcpActivityReplayResult>(
      operation("mutation", "settings.replayAcpActivity", {
        limit: 40,
      })
    );
    const workspaceReplayChatCount = new Set(
      workspaceReplay.frames
        .map((frame) => frame.chatId)
        .filter((value): value is string => Boolean(value))
    ).size;
    const timelineSerialized = JSON.stringify({
      timeline: timelineSnapshot.acpActivity.timeline,
      replay: workspaceReplay,
    });
    console.log(
      "ACP_CROSS_SESSION_TIMELINE",
      JSON.stringify({
        lanes: timelineChatLanes.map((lane) => [
          lane.chatId,
          lane.eventCount,
          lane.latestKind ?? null,
        ]),
        frames: timelineSnapshot.acpActivity.timeline.frames.length,
        transitions: timelineSnapshot.acpActivity.timeline.transitions.length,
        spanMs: timelineSnapshot.acpActivity.timeline.spanMs,
        omittedFrames: timelineSnapshot.acpActivity.timeline.omittedFrames,
        workspaceFrames: workspaceReplay.frames.length,
        workspaceChatCount: workspaceReplayChatCount,
        workspaceFilterChat: workspaceReplay.filters.chatId ?? null,
      })
    );
    if (timelineChatLanes.length < 2) {
      throw new Error("Expected ACP timeline to include at least two chat lanes.");
    }
    if (timelineSnapshot.acpActivity.timeline.frames.length === 0) {
      throw new Error("Expected ACP timeline frames.");
    }
    if (
      timelineSnapshot.acpActivity.timeline.frames.some(
        (frame, index) => frame.sequence !== index + 1
      )
    ) {
      throw new Error("ACP timeline frame sequence was not stable.");
    }
    if (
      timelineSnapshot.acpActivity.timeline.frames.some((frame, index, frames) => {
        const previous = frames[index - 1];
        return previous ? frame.timestamp < previous.timestamp : false;
      })
    ) {
      throw new Error("ACP timeline frames were not chronological.");
    }
    if (workspaceReplay.filters.chatId !== undefined) {
      throw new Error("Workspace ACP replay unexpectedly scoped to one chat.");
    }
    if (workspaceReplayChatCount < 2) {
      throw new Error("Expected workspace ACP replay to include multiple chats.");
    }
    if (
      timelineSerialized.includes("rawPayload") ||
      timelineSerialized.includes("desktop-mcp-secret")
    ) {
      throw new Error("ACP cross-session timeline leaked raw payload metadata.");
    }
    const streamDiagnostics = timelineSnapshot.acpActivity.stream;
    const streamSerialized = JSON.stringify(streamDiagnostics);
    console.log(
      "ACP_STREAM_DIAGNOSTICS",
      JSON.stringify({
        status: streamDiagnostics.status,
        retryEligible: streamDiagnostics.retryEligible,
        retryDelayMs: streamDiagnostics.retryDelayMs,
        retryMaxAttempts: streamDiagnostics.retryMaxAttempts,
        heartbeatWindowMs: streamDiagnostics.heartbeatWindowMs,
        staleAfterMs: streamDiagnostics.staleAfterMs,
        correlatedFrameCount: streamDiagnostics.correlatedFrameCount,
        orphanFrameCount: streamDiagnostics.orphanFrameCount,
        rootCount: streamDiagnostics.rootCount,
        longestChainLength: streamDiagnostics.longestChainLength,
        gaps: streamDiagnostics.gaps.length,
        chains: streamDiagnostics.chains.length,
        maxSilenceMs: streamDiagnostics.maxSilenceMs,
      })
    );
    if (
      streamDiagnostics.retryDelayMs <= 0 ||
      streamDiagnostics.retryMaxAttempts <= 0 ||
      streamDiagnostics.heartbeatWindowMs <= 0 ||
      streamDiagnostics.staleAfterMs <= 0
    ) {
      throw new Error("ACP stream diagnostics did not expose retry controls.");
    }
    if (
      streamDiagnostics.status === "idle" ||
      !streamDiagnostics.latestTimestamp ||
      streamDiagnostics.correlatedFrameCount === 0 ||
      streamDiagnostics.rootCount === 0 ||
      streamDiagnostics.chains.length === 0
    ) {
      throw new Error("ACP stream diagnostics did not expose causal activity.");
    }
    if (
      streamSerialized.includes("rawPayload") ||
      streamSerialized.includes("desktop-mcp-secret")
    ) {
      throw new Error("ACP stream diagnostics leaked raw payload metadata.");
    }
    const retriedStreamSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.retryAcpActivityStream", {})
    );
    console.log(
      "ACP_STREAM_RETRY",
      JSON.stringify({
        status: retriedStreamSnapshot.acpActivity.stream.status,
        retryDelayMs: retriedStreamSnapshot.acpActivity.stream.retryDelayMs,
        retryMaxAttempts:
          retriedStreamSnapshot.acpActivity.stream.retryMaxAttempts,
        chains: retriedStreamSnapshot.acpActivity.stream.chains.length,
      })
    );
    if (
      retriedStreamSnapshot.acpActivity.stream.retryDelayMs !==
        streamDiagnostics.retryDelayMs ||
      retriedStreamSnapshot.acpActivity.stream.retryMaxAttempts !==
        streamDiagnostics.retryMaxAttempts ||
      retriedStreamSnapshot.acpActivity.stream.chains.length === 0 ||
      JSON.stringify(retriedStreamSnapshot.acpActivity.stream).includes(
        "rawPayload"
      )
    ) {
      throw new Error("ACP stream retry did not return redacted diagnostics.");
    }
    const acpTrace = await request<AcpActivityExportResult>(
      operation("mutation", "settings.exportAcpActivity", {
        chatId,
        limit: 20,
      })
    );
    console.log(
      "ACP_EXPORT",
      JSON.stringify({
        schemaVersion: acpTrace.schemaVersion,
        redacted: acpTrace.redacted,
        chatId: acpTrace.filters.chatId,
        limit: acpTrace.filters.limit,
        entries: acpTrace.entries.length,
        correlations: acpTrace.correlations.length,
        total: acpTrace.stats.total,
        sample: acpTrace.entries.slice(0, 2).map((entry) => ({
          message: entry.message,
          kind: entry.kind ?? null,
          payloadBytes: entry.payloadBytes ?? null,
          metadata: entry.metadata,
        })),
      })
    );
    if (acpTrace.schemaVersion !== 1 || acpTrace.redacted !== true) {
      throw new Error("ACP trace export did not declare its redacted schema.");
    }
    if (acpTrace.filters.chatId !== chatId) {
      throw new Error("ACP trace export did not preserve the active chat filter.");
    }
    if (acpTrace.entries.length === 0) {
      throw new Error("Expected exported ACP trace entries for the active chat.");
    }
    if (
      !acpTrace.correlations.some((correlation) => correlation.chatId === chatId)
    ) {
      throw new Error("Expected exported ACP trace correlation for the active chat.");
    }
    if (JSON.stringify(acpTrace).includes("rawPayload")) {
      throw new Error("ACP trace export leaked rawPayload metadata.");
    }
    const acpReplay = await request<AcpActivityReplayResult>(
      operation("mutation", "settings.replayAcpActivity", {
        chatId,
        limit: 20,
      })
    );
    console.log(
      "ACP_REPLAY",
      JSON.stringify({
        schemaVersion: acpReplay.schemaVersion,
        redacted: acpReplay.redacted,
        chatId: acpReplay.filters.chatId,
        frames: acpReplay.frames.length,
        first: acpReplay.frames[0]
          ? [
              acpReplay.frames[0].sequence,
              acpReplay.frames[0].kind ?? acpReplay.frames[0].message,
              acpReplay.frames[0].elapsedMs,
              acpReplay.frames[0].deltaMs,
            ]
          : null,
        last: acpReplay.frames.at(-1)
          ? [
              acpReplay.frames.at(-1)?.sequence,
              acpReplay.frames.at(-1)?.kind ?? acpReplay.frames.at(-1)?.message,
              acpReplay.frames.at(-1)?.elapsedMs,
              acpReplay.frames.at(-1)?.deltaMs,
            ]
          : null,
        correlations: acpReplay.correlations.length,
      })
    );
    if (acpReplay.schemaVersion !== 1 || acpReplay.redacted !== true) {
      throw new Error("ACP replay did not declare its redacted schema.");
    }
    if (acpReplay.filters.chatId !== chatId) {
      throw new Error("ACP replay did not preserve the active chat filter.");
    }
    if (acpReplay.frames.length === 0) {
      throw new Error("Expected ACP replay frames for the active chat.");
    }
    if (acpReplay.frames.some((frame) => frame.chatId !== chatId)) {
      throw new Error("ACP replay included frames outside the active chat.");
    }
    if (
      acpReplay.frames.some((frame, index, frames) => {
        const previous = frames[index - 1];
        return previous ? frame.timestamp < previous.timestamp : false;
      })
    ) {
      throw new Error("ACP replay frames were not chronological.");
    }
    if (acpReplay.frames.some((frame, index) => frame.sequence !== index + 1)) {
      throw new Error("ACP replay frame sequence was not stable.");
    }
    if (!acpReplay.correlations.some((correlation) => correlation.chatId === chatId)) {
      throw new Error("Expected ACP replay correlation for the active chat.");
    }
    if (JSON.stringify(acpReplay).includes("rawPayload")) {
      throw new Error("ACP replay leaked rawPayload metadata.");
    }
    const replayKind =
      acpReplay.frames.find((frame) => frame.kind)?.kind ??
      Object.keys(acpReplay.stats.kinds)[0];
    if (!replayKind) {
      throw new Error("Expected ACP replay to expose at least one replay kind.");
    }
    const acpKindReplay = await request<AcpActivityReplayResult>(
      operation("mutation", "settings.replayAcpActivity", {
        chatId,
        kind: replayKind,
        limit: 20,
      })
    );
    console.log(
      "ACP_REPLAY_KIND_FILTER",
      JSON.stringify({
        schemaVersion: acpKindReplay.schemaVersion,
        redacted: acpKindReplay.redacted,
        chatId: acpKindReplay.filters.chatId,
        kind: acpKindReplay.filters.kind,
        frames: acpKindReplay.frames.length,
        kinds: acpKindReplay.stats.kinds,
      })
    );
    if (acpKindReplay.schemaVersion !== 1 || acpKindReplay.redacted !== true) {
      throw new Error("ACP kind-filtered replay did not declare redacted schema.");
    }
    if (
      acpKindReplay.filters.chatId !== chatId ||
      acpKindReplay.filters.kind !== replayKind
    ) {
      throw new Error("ACP kind-filtered replay did not preserve filters.");
    }
    if (acpKindReplay.frames.length === 0) {
      throw new Error("Expected ACP kind-filtered replay frames.");
    }
    if (acpKindReplay.frames.some((frame) => frame.kind !== replayKind)) {
      throw new Error("ACP kind-filtered replay included another kind.");
    }
    if (Object.keys(acpKindReplay.stats.kinds).some((kind) => kind !== replayKind)) {
      throw new Error("ACP kind-filtered replay stats included another kind.");
    }
    if (JSON.stringify(acpKindReplay).includes("rawPayload")) {
      throw new Error("ACP kind-filtered replay leaked rawPayload metadata.");
    }
    const presetSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.saveAcpReplayPreset", {
        name: "Desktop smoke initialize replay",
        chatId,
        kind: replayKind,
        limit: 20,
      })
    );
    const replayPreset = presetSnapshot.acpActivity.replayPresets.find(
      (preset) =>
        preset.name === "Desktop smoke initialize replay" &&
        preset.chatId === chatId &&
        preset.kind === replayKind
    );
    if (!replayPreset) {
      throw new Error("ACP replay preset was not persisted in Local ADE snapshot.");
    }
    const presetReplay = await request<AcpActivityReplayResult>(
      operation("mutation", "settings.replayAcpActivity", {
        ...(replayPreset.chatId ? { chatId: replayPreset.chatId } : {}),
        ...(replayPreset.correlationKey
          ? { correlationKey: replayPreset.correlationKey }
          : {}),
        ...(replayPreset.kind ? { kind: replayPreset.kind } : {}),
        limit: replayPreset.limit,
      })
    );
    const presetDeletedSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.deleteAcpReplayPreset", {
        id: replayPreset.id,
      })
    );
    console.log(
      "ACP_REPLAY_PRESET",
      JSON.stringify({
        saved: true,
        deleted: !presetDeletedSnapshot.acpActivity.replayPresets.some(
          (preset) => preset.id === replayPreset.id
        ),
        name: replayPreset.name,
        chatId: replayPreset.chatId,
        kind: replayPreset.kind,
        frames: presetReplay.frames.length,
        redacted: presetReplay.redacted,
      })
    );
    if (
      presetReplay.schemaVersion !== 1 ||
      presetReplay.redacted !== true ||
      presetReplay.filters.chatId !== chatId ||
      presetReplay.filters.kind !== replayKind ||
      presetReplay.frames.length === 0 ||
      presetReplay.frames.some((frame) => frame.kind !== replayKind) ||
      JSON.stringify(presetReplay).includes("rawPayload") ||
      presetDeletedSnapshot.acpActivity.replayPresets.some(
        (preset) => preset.id === replayPreset.id
      )
    ) {
      throw new Error("ACP replay preset save/load/delete did not complete.");
    }
  } finally {
    let cleanupError: unknown;
    try {
      if (subscriptionId) {
        await host.unsubscribeOperation(subscriptionId).catch(() => undefined);
        console.log("SUBSCRIPTION_STOPPED", subscriptionId);
      }
      if (timelineChatId && timelineChatId !== chatId) {
        await request<unknown>(
          operation("mutation", "stopSession", { chatId: timelineChatId })
        ).catch((error) => {
          cleanupError = cleanupError ?? error;
          console.log(
            "TIMELINE_SESSION_STOP_FAILED",
            error instanceof Error ? error.message : String(error)
          );
        });
        console.log("TIMELINE_SESSION_STOPPED", timelineChatId);
      }
      if (chatId) {
        await request<unknown>(
          operation("mutation", "stopSession", { chatId })
        ).catch((error) => {
          cleanupError = error;
          console.log(
            "SESSION_STOP_FAILED",
            error instanceof Error ? error.message : String(error)
          );
        });
        console.log("SESSION_STOPPED", chatId);
        if (sessionLifecycleHooksBackup !== undefined && cleanupError === undefined) {
          const stopLifecycleRun = await waitForHookRun(
            "desktop-smoke-agent-stop-hook",
            "desktop agent lifecycle after-agent-session-stop"
          );
          console.log(
            "HOOK_AGENT_LIFECYCLE_STOP",
            JSON.stringify({
              status: stopLifecycleRun.status,
              stdout: stopLifecycleRun.stdout,
            })
          );
        }
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      if (sessionLifecycleHooksBackup !== undefined) {
        await restoreOptionalFile(hooksPath, sessionLifecycleHooksBackup);
        sessionLifecycleHooksBackup = undefined;
      }
      await host.stop();
      if (embeddingServer) {
        await embeddingServer.stop();
        embeddingServer = undefined;
      }
      console.log("HOST_STOPPED");
    }
    if (previousMcpAuth === undefined) {
      delete process.env.ERAGEAR_DESKTOP_MCP_AUTH;
    } else {
      process.env.ERAGEAR_DESKTOP_MCP_AUTH = previousMcpAuth;
    }
    if (previousAllowedAgentPolicies === undefined) {
      delete process.env.ALLOWED_AGENT_COMMAND_POLICIES;
    } else {
      process.env.ALLOWED_AGENT_COMMAND_POLICIES = previousAllowedAgentPolicies;
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  }
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await host.stop().catch(() => undefined);
  process.exit(1);
});
