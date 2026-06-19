// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import type {
  RuntimeServiceAuth,
  RuntimeServiceErrorPayload,
  RuntimeServiceOperation,
  RuntimeServiceSubscriptionEventMessage,
} from "@eragear-code-copilot/shared";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { EragearDesktopBootstrap } from "./desktop-bootstrap";
import type { AppRouter } from "./trpc";

type DesktopSubscriptionEvent = RuntimeServiceSubscriptionEventMessage["event"];
interface DesktopRuntimeBridge {
  requestRuntime: NonNullable<
    NonNullable<Window["eragearDesktop"]>["requestRuntime"]
  >;
  subscribeRuntime: NonNullable<
    NonNullable<Window["eragearDesktop"]>["subscribeRuntime"]
  >;
  unsubscribeRuntime: NonNullable<
    NonNullable<Window["eragearDesktop"]>["unsubscribeRuntime"]
  >;
  onRuntimeSubscriptionEvent: NonNullable<
    NonNullable<Window["eragearDesktop"]>["onRuntimeSubscriptionEvent"]
  >;
}

function getDesktopBridge(): DesktopRuntimeBridge {
  const bridge = window.eragearDesktop;
  if (
    !(
      bridge?.requestRuntime &&
      bridge.subscribeRuntime &&
      bridge.unsubscribeRuntime &&
      bridge.onRuntimeSubscriptionEvent
    )
  ) {
    throw new Error("Electron runtime bridge is unavailable.");
  }
  return bridge as DesktopRuntimeBridge;
}

function authFromBootstrap(
  bootstrap: EragearDesktopBootstrap
): RuntimeServiceAuth {
  if (bootstrap.mode === "main-thread") {
    return {
      localAuthToken: bootstrap.localAuthToken,
    };
  }
  return {
    apiKey: bootstrap.apiKey,
  };
}

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

export function toTrpcClientError(error: unknown): TRPCClientError<AppRouter> {
  if (isRuntimeServiceErrorPayload(error)) {
    if (typeof error.code !== "number") {
      const runtimeError = new Error(error.message);
      runtimeError.name = error.name ?? "RuntimeServiceError";
      runtimeError.stack = error.stack;
      return TRPCClientError.from<AppRouter>(runtimeError);
    }
    return TRPCClientError.from<AppRouter>({
      error,
    });
  }
  if (error instanceof Error) {
    return TRPCClientError.from<AppRouter>(error);
  }
  return TRPCClientError.from<AppRouter>(new Error(String(error)));
}

function isRuntimeServiceErrorPayload(
  value: unknown
): value is RuntimeServiceErrorPayload {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as RuntimeServiceErrorPayload).message === "string"
  );
}

function emitSubscriptionEvent(
  observer: {
    next: (value: any) => void;
    error?: (error: TRPCClientError<AppRouter>) => void;
    complete: () => void;
  },
  event: DesktopSubscriptionEvent
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
      observer.error?.(toTrpcClientError(event.error));
      return;
    case "complete":
      observer.complete();
      return;
  }
}

export function electronTrpcLink(
  bootstrap: EragearDesktopBootstrap
): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const bridge = getDesktopBridge();
        const auth = authFromBootstrap(bootstrap);
        const operation = toOperation(op);
        let disposed = false;
        let cleanupSubscriptionEvents: (() => void) | undefined;
        let runtimeSubscriptionId: string | undefined;

        const abort = () => {
          disposed = true;
        };
        op.signal?.addEventListener("abort", abort);

        if (op.type === "subscription") {
          observer.next({
            result: { type: "state", state: "connecting", error: null },
          });
          cleanupSubscriptionEvents = bridge.onRuntimeSubscriptionEvent(
            ({ subscriptionId, event }) => {
              if (
                disposed ||
                !runtimeSubscriptionId ||
                subscriptionId !== runtimeSubscriptionId
              ) {
                return;
              }
              emitSubscriptionEvent(observer, event);
            }
          );

          bridge
            .subscribeRuntime({ auth, operation })
            .then(({ subscriptionId }) => {
              runtimeSubscriptionId = subscriptionId;
            })
            .catch((error) => {
              if (!disposed) {
                observer.error?.(toTrpcClientError(error));
              }
            });

          return () => {
            disposed = true;
            op.signal?.removeEventListener("abort", abort);
            cleanupSubscriptionEvents?.();
            if (runtimeSubscriptionId) {
              void bridge.unsubscribeRuntime(runtimeSubscriptionId);
            }
          };
        }

        bridge
          .requestRuntime({ auth, operation })
          .then((response) => {
            if (disposed) {
              return;
            }
            if (!response.ok) {
              observer.error?.(toTrpcClientError(response.error));
              return;
            }
            observer.next({ result: { data: response.data } });
            observer.complete();
          })
          .catch((error) => {
            if (!disposed) {
              observer.error?.(toTrpcClientError(error));
            }
          });

        return () => {
          disposed = true;
          op.signal?.removeEventListener("abort", abort);
        };
      });
}
