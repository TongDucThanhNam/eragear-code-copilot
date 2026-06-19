// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import type {
  DesktopRemoteConnectCloudflareAccessCredentials,
  RuntimeServiceErrorPayload,
  RuntimeServiceOperation,
  RuntimeServiceResponseMessage,
  RuntimeServiceSubscriptionEventMessage,
} from "@eragear-code-copilot/shared";
import type { TRPCClientError, TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { toTrpcClientError } from "./electron-trpc-link";
import { buildHttpApiUrl } from "./server-url";
import type { AppRouter } from "./trpc";

type RemoteConnectSubscriptionEvent =
  RuntimeServiceSubscriptionEventMessage["event"];

interface RemoteConnectLinkOptions {
  serverUrl: string;
  token: string;
  cloudflareAccess?: DesktopRemoteConnectCloudflareAccessCredentials;
}

type RemoteConnectStreamMessage =
  | { kind: "subscribed"; subscriptionId: string }
  | { kind: "event"; event: RemoteConnectSubscriptionEvent };

function toOperation(op: {
  id: number;
  type: RuntimeServiceOperation["type"];
  path: string;
  input: unknown;
}): RuntimeServiceOperation {
  return {
    id: op.id,
    type: op.type,
    path: op.path,
    input: op.input,
  };
}

function headersForRemoteConnect(
  options: RemoteConnectLinkOptions,
  includeJson = true
): Headers {
  const headers = new Headers();
  if (includeJson) {
    headers.set("content-type", "application/json");
  }
  headers.set("authorization", `Bearer ${options.token}`);
  if (options.cloudflareAccess) {
    headers.set("cf-access-client-id", options.cloudflareAccess.clientId);
    headers.set(
      "cf-access-client-secret",
      options.cloudflareAccess.clientSecret
    );
  }
  return headers;
}

async function readErrorResponse(response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  return new Error(text || `Remote Connect request failed: ${response.status}`);
}

function isRuntimeServiceResponse(
  value: unknown
): value is RuntimeServiceResponseMessage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as RuntimeServiceResponseMessage).kind === "response" &&
    typeof (value as RuntimeServiceResponseMessage).ok === "boolean"
  );
}

function errorPayloadFromUnknown(error: unknown): RuntimeServiceErrorPayload {
  if (error && typeof error === "object" && "message" in error) {
    return error as RuntimeServiceErrorPayload;
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function emitSubscriptionEvent(
  observer: {
    next: (value: any) => void;
    error?: (error: TRPCClientError<AppRouter>) => void;
    complete: () => void;
  },
  event: RemoteConnectSubscriptionEvent
): void {
  switch (event.type) {
    case "started":
      observer.next({ result: { type: "started" } });
      observer.next({
        result: { type: "state", state: "pending", error: null },
      });
      return;
    case "data":
      observer.next({ result: { data: event.data } });
      return;
    case "error":
      observer.error?.(toTrpcClientError(errorPayloadFromUnknown(event.error)));
      return;
    case "complete":
      observer.complete();
      return;
  }
}

async function streamNdjson(
  response: Response,
  onMessage: (message: RemoteConnectStreamMessage) => void
): Promise<void> {
  if (!response.body) {
    throw new Error("Remote Connect subscription response has no stream body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      onMessage(JSON.parse(trimmed) as RemoteConnectStreamMessage);
    }
    if (done) {
      break;
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    onMessage(JSON.parse(trailing) as RemoteConnectStreamMessage);
  }
}

export function remoteConnectTrpcLink(
  options: RemoteConnectLinkOptions
): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        op.signal?.addEventListener("abort", abort);
        const operation = toOperation(op);

        if (op.type === "subscription") {
          observer.next({
            result: { type: "state", state: "connecting", error: null },
          });
          void (async () => {
            const response = await fetch(
              buildHttpApiUrl(
                options.serverUrl,
                "/api/remote-connect/subscribe"
              ),
              {
                method: "POST",
                headers: headersForRemoteConnect(options),
                body: JSON.stringify({ operation }),
                signal: controller.signal,
              }
            );
            if (!response.ok) {
              throw await readErrorResponse(response);
            }
            await streamNdjson(response, (message) => {
              if (message.kind === "event") {
                emitSubscriptionEvent(observer, message.event);
              }
            });
          })().catch((error) => {
            if (!controller.signal.aborted) {
              observer.error?.(toTrpcClientError(error));
            }
          });

          return () => {
            op.signal?.removeEventListener("abort", abort);
            controller.abort();
          };
        }

        void (async () => {
          const response = await fetch(
            buildHttpApiUrl(options.serverUrl, "/api/remote-connect/request"),
            {
              method: "POST",
              headers: headersForRemoteConnect(options),
              body: JSON.stringify({ operation }),
              signal: controller.signal,
            }
          );
          if (!response.ok) {
            throw await readErrorResponse(response);
          }
          const payload = await response.json();
          if (!isRuntimeServiceResponse(payload)) {
            throw new Error("Remote Connect returned an invalid response.");
          }
          if (!payload.ok) {
            observer.error?.(
              toTrpcClientError(
                payload.error ?? { message: "Remote Connect request failed." }
              )
            );
            return;
          }
          observer.next({ result: { data: payload.data } });
          observer.complete();
        })().catch((error) => {
          if (!controller.signal.aborted) {
            observer.error?.(toTrpcClientError(error));
          }
        });

        return () => {
          op.signal?.removeEventListener("abort", abort);
          controller.abort();
        };
      });
}
