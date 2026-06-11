import readline from "node:readline";
import { getTRPCErrorFromUnknown, getTRPCErrorShape } from "@trpc/server";
import { isObservable, observableToAsyncIterable } from "@trpc/server/observable";
import {
  callProcedure,
  isAsyncIterable,
} from "@trpc/server/unstable-core-do-not-import";
import type {
  RuntimeDiagnostics,
  RuntimeEndpoint,
  RuntimeProcedureType,
  RuntimeServiceClientMessage,
  RuntimeServiceErrorPayload,
  RuntimeServiceOperation,
  RuntimeServiceResponseMessage,
  RuntimeServiceServerMessage,
  RuntimeServiceSubscriptionEventMessage,
} from "@repo/shared";
import type { TRPCContext } from "@/transport/trpc/context";
import { appRouter } from "@/transport/trpc/router";
import {
  type RuntimeCore,
  createRuntimeCoreFromSettings,
} from "./core";
import { getLogStore } from "@/platform/logging/log-store";
import type { LogLevel } from "@/shared/types/log.types";
import { createId } from "@/shared/utils/id.util";
import { isAcpLogMessage } from "@/shared/utils/acp-log.util";

const DESKTOP_SERVICE_TOKEN = process.env.ERAGEAR_DESKTOP_SERVICE_TOKEN ?? "";
const LOCAL_DESKTOP_USER_ID =
  process.env.ERAGEAR_DESKTOP_LOCAL_USER_ID ?? "local-desktop-user";
const DESKTOP_SERVICE_CHANNEL = "eragear-desktop-runtime-service";

const desktopServiceEndpoint: RuntimeEndpoint = {
  kind: "desktop-service",
  channelName: DESKTOP_SERVICE_CHANNEL,
  networkExposed: false,
  description:
    "Electron main bridges renderer IPC to the Bun runtime core over stdio NDJSON.",
};

const LOG_TEXT_PATTERN =
  /^\S+\s+(DEBUG|INFO|WARN|ERROR)\s+\[([^\]]+)\]\s+([\s\S]*?)\s*(\{[\s\S]*\})?$/;

function levelFromConsoleMethod(method: "log" | "info" | "warn" | "error"): LogLevel {
  if (method === "warn") {
    return "warn";
  }
  if (method === "error") {
    return "error";
  }
  return "info";
}

function sanitizeDesktopLogMeta(
  value: unknown
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const meta: Record<string, string | number | boolean | null> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (key === "rawPayload") {
      continue;
    }
    if (
      rawValue === null ||
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      meta[key] = rawValue;
    }
  }
  return meta;
}

function parseDesktopStructuredLog(rendered: string): {
  level?: LogLevel;
  tag?: string;
  message: string;
  context?: Record<string, string | number | boolean | null>;
} {
  const match = rendered.match(LOG_TEXT_PATTERN);
  if (!match) {
    return { message: rendered };
  }
  const level = match[1]?.toLowerCase() as LogLevel | undefined;
  const tag = match[2];
  const message = match[3]?.trim() ?? rendered;
  let context: Record<string, string | number | boolean | null> | undefined;
  if (match[4]) {
    try {
      context = sanitizeDesktopLogMeta(JSON.parse(match[4]));
    } catch {
      context = undefined;
    }
  }
  return { level, tag, message, context };
}

function appendDesktopServiceLog(
  method: "log" | "info" | "warn" | "error",
  rendered: string
): void {
  const parsed = parseDesktopStructuredLog(rendered);
  const context = parsed.context ?? {};
  const chatId = typeof context.chatId === "string" ? context.chatId : undefined;
  const userId = typeof context.userId === "string" ? context.userId : undefined;
  const source = isAcpLogMessage(parsed.message) ? "acp" : "console";
  getLogStore().append({
    id: createId("log"),
    timestamp: Date.now(),
    level: parsed.level ?? levelFromConsoleMethod(method),
    message: parsed.message,
    source,
    ...(chatId ? { chatId } : {}),
    ...(userId ? { userId } : {}),
    meta: {
      ...context,
      ...(parsed.tag ? { structuredTag: parsed.tag } : {}),
    },
  });
}

for (const method of ["log", "info", "warn", "error"] as const) {
  console[method] = (...args: unknown[]) => {
    const rendered = args
      .map((arg) =>
        typeof arg === "string" ? arg : JSON.stringify(arg, null, 2)
      )
      .join(" ");
    appendDesktopServiceLog(method, rendered);
    process.stderr.write(`${rendered}\n`);
  };
}

let runtimeCore: RuntimeCore | null = null;
let ensureLocalDefaultsPromise: Promise<void> | null = null;
const subscriptions = new Map<string, AbortController>();

function writeMessage(message: RuntimeServiceServerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toDesktopDiagnostics(
  diagnostics: RuntimeDiagnostics
): RuntimeDiagnostics {
  return {
    ...diagnostics,
    mode: "main-thread",
    endpoint: desktopServiceEndpoint,
    childProcess: {
      ...diagnostics.childProcess,
      role: "runtime-host",
      pid: process.pid,
      message: "Bun runtime core is hosted by the desktop service channel.",
    },
    messages: [
      ...diagnostics.messages,
      "Desktop service channel is active; Hono/tRPC/WS HTTP host is not started.",
    ],
    updatedAt: new Date().toISOString(),
  };
}

async function getDesktopDiagnostics(): Promise<RuntimeDiagnostics> {
  if (!runtimeCore) {
    return {
      mode: "main-thread",
      endpoint: desktopServiceEndpoint,
      health: {
        state: "not-started",
        ready: false,
        checkedAt: new Date().toISOString(),
        message: "Runtime core is not started.",
      },
      childProcess: {
        role: "runtime-host",
        status: "not-started",
        pid: process.pid,
      },
      cliAvailability: [],
      messages: ["Desktop service process is not attached to a runtime core."],
      updatedAt: new Date().toISOString(),
    };
  }
  return toDesktopDiagnostics(await runtimeCore.diagnostics());
}

async function ensureLocalDefaults(core: RuntimeCore): Promise<void> {
  ensureLocalDefaultsPromise ??= core.composition.deps.useCases.agent
    .ensureDefaults
    .execute(LOCAL_DESKTOP_USER_ID);
  await ensureLocalDefaultsPromise;
}

async function createDesktopTrpcContext(core: RuntimeCore): Promise<TRPCContext> {
  await ensureLocalDefaults(core);
  return {
    useCases: core.composition.deps.useCases,
    appConfig: core.composition.deps.appConfig,
    auth: {
      type: "local",
      userId: LOCAL_DESKTOP_USER_ID,
      user: {
        id: LOCAL_DESKTOP_USER_ID,
        email: null,
        username: "local",
        name: "Local Desktop",
        image: null,
      },
    },
  };
}

function validateAuth(message: RuntimeServiceClientMessage): void {
  if (!(message.kind === "request" || message.kind === "subscribe")) {
    return;
  }
  if (!DESKTOP_SERVICE_TOKEN) {
    throw new Error("Desktop service token is not configured.");
  }
  if (message.auth?.localAuthToken !== DESKTOP_SERVICE_TOKEN) {
    throw new Error("Invalid desktop service token.");
  }
}

function toErrorPayload(
  cause: unknown,
  operation?: RuntimeServiceOperation,
  ctx?: TRPCContext
): RuntimeServiceErrorPayload {
  if (operation) {
    const error = getTRPCErrorFromUnknown(cause);
    const shape = getTRPCErrorShape({
      config: appRouter._def._config,
      ctx,
      error,
      input: operation.input,
      path: operation.path,
      type: operation.type,
    });
    return JSON.parse(JSON.stringify(shape)) as RuntimeServiceErrorPayload;
  }

  if (cause instanceof Error) {
    return {
      message: cause.message,
      name: cause.name,
      stack: cause.stack,
    };
  }
  return {
    message: String(cause),
  };
}

async function callRuntimeProcedure(input: {
  core: RuntimeCore;
  operation: RuntimeServiceOperation;
  signal: AbortSignal;
}): Promise<{ data: unknown; ctx: TRPCContext }> {
  const ctx = await createDesktopTrpcContext(input.core);
  const data = await callProcedure({
    router: appRouter,
    path: input.operation.path,
    getRawInput: async () => input.operation.input,
    ctx,
    type: input.operation.type as RuntimeProcedureType,
    signal: input.signal,
  });
  return { data, ctx };
}

async function handleRequest(message: RuntimeServiceClientMessage): Promise<void> {
  if (!runtimeCore) {
    throw new Error("Runtime core is not ready.");
  }
  validateAuth(message);

  switch (message.kind) {
    case "request": {
      const abortController = new AbortController();
      let ctx: TRPCContext | undefined;
      try {
        const result = await callRuntimeProcedure({
          core: runtimeCore,
          operation: message.operation,
          signal: abortController.signal,
        });
        ctx = result.ctx;
        const response: RuntimeServiceResponseMessage = {
          kind: "response",
          id: message.id,
          ok: true,
          data: result.data,
        };
        writeMessage(response);
      } catch (error) {
        writeMessage({
          kind: "response",
          id: message.id,
          ok: false,
          error: toErrorPayload(error, message.operation, ctx),
        });
      }
      return;
    }

    case "subscribe": {
      startSubscription(message.id, message.operation).catch((error) => {
        writeSubscriptionEvent({
          kind: "subscription-event",
          id: message.id,
          event: {
            type: "error",
            error: toErrorPayload(error, message.operation),
          },
        });
      });
      return;
    }

    case "unsubscribe": {
      const controller = subscriptions.get(message.id);
      controller?.abort();
      subscriptions.delete(message.id);
      return;
    }

    case "diagnostics": {
      writeMessage({
        kind: "response",
        id: message.id,
        ok: true,
        data: await getDesktopDiagnostics(),
      });
      return;
    }

    case "shutdown": {
      await shutdown(message.reason ?? "SIGTERM");
      writeMessage({
        kind: "response",
        id: message.id,
        ok: true,
        data: null,
      });
      process.exit(0);
    }
  }
}

function writeSubscriptionEvent(
  message: RuntimeServiceSubscriptionEventMessage
): void {
  writeMessage(message);
}

async function startSubscription(
  id: string,
  operation: RuntimeServiceOperation
): Promise<void> {
  if (!runtimeCore) {
    throw new Error("Runtime core is not ready.");
  }

  const abortController = new AbortController();
  subscriptions.set(id, abortController);
  let ctx: TRPCContext | undefined;

  try {
    const result = await callRuntimeProcedure({
      core: runtimeCore,
      operation,
      signal: abortController.signal,
    });
    ctx = result.ctx;
    const source = isObservable(result.data)
      ? observableToAsyncIterable(result.data, abortController.signal)
      : result.data;
    if (!isAsyncIterable(source)) {
      throw new Error("Subscription procedure did not return an event stream.");
    }

    writeSubscriptionEvent({
      kind: "subscription-event",
      id,
      event: { type: "started" },
    });

    for await (const item of source) {
      if (abortController.signal.aborted) {
        break;
      }
      writeSubscriptionEvent({
        kind: "subscription-event",
        id,
        event: {
          type: "data",
          data: item,
        },
      });
    }

    writeSubscriptionEvent({
      kind: "subscription-event",
      id,
      event: { type: "complete" },
    });
  } catch (error) {
    if (!abortController.signal.aborted) {
      writeSubscriptionEvent({
        kind: "subscription-event",
        id,
        event: {
          type: "error",
          error: toErrorPayload(error, operation, ctx),
        },
      });
    }
  } finally {
    subscriptions.delete(id);
  }
}

async function shutdown(reason: string): Promise<void> {
  for (const controller of subscriptions.values()) {
    controller.abort();
  }
  subscriptions.clear();
  if (runtimeCore) {
    await runtimeCore.stop(reason);
    runtimeCore = null;
  }
}

async function main(): Promise<void> {
  try {
    runtimeCore = await createRuntimeCoreFromSettings();
    const diagnostics = await runtimeCore.start();
    writeMessage({
      kind: "ready",
      diagnostics: toDesktopDiagnostics(diagnostics),
    });
  } catch (error) {
    writeMessage({
      kind: "fatal",
      error: toErrorPayload(error),
    });
    process.exitCode = 1;
    return;
  }

  const reader = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  reader.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let message: RuntimeServiceClientMessage;
    try {
      message = JSON.parse(line) as RuntimeServiceClientMessage;
    } catch (error) {
      console.warn("Ignoring invalid desktop service message", error);
      return;
    }
    handleRequest(message).catch((error) => {
      if ("id" in message) {
        writeMessage({
          kind: "response",
          id: message.id,
          ok: false,
          error: toErrorPayload(error),
        });
      }
    });
  });
}

process.once("SIGTERM", () => {
  shutdown("SIGTERM")
    .catch((error) => {
      console.error("Desktop service shutdown failed", error);
    })
    .finally(() => process.exit(0));
});

process.once("SIGINT", () => {
  shutdown("SIGINT")
    .catch((error) => {
      console.error("Desktop service shutdown failed", error);
    })
    .finally(() => process.exit(0));
});

void main();
