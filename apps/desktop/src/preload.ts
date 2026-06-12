import { contextBridge, ipcRenderer } from "electron";
import type {
  RuntimeServiceAuth,
  RuntimeServiceOperation,
  RuntimeServiceSubscriptionEventMessage,
} from "@repo/shared";

contextBridge.exposeInMainWorld("eragearDesktop", {
  getBootstrap: () => ipcRenderer.invoke("eragear:getBootstrap"),
  getRuntimeDiagnostics: () =>
    ipcRenderer.invoke("eragear:getRuntimeDiagnostics"),
  checkForUpdates: () => ipcRenderer.invoke("eragear:checkForUpdates"),
  requestRuntime: (input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
  }) => ipcRenderer.invoke("eragear:runtimeRequest", input),
  subscribeRuntime: (input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
  }) => ipcRenderer.invoke("eragear:runtimeSubscribe", input),
  unsubscribeRuntime: (subscriptionId: string) =>
    ipcRenderer.invoke("eragear:runtimeUnsubscribe", { subscriptionId }),
  onRuntimeSubscriptionEvent: (
    callback: (payload: {
      subscriptionId: string;
      event: RuntimeServiceSubscriptionEventMessage["event"];
    }) => void
  ) => {
    const listener = (_event: unknown, payload: unknown) => {
      callback(
        payload as {
          subscriptionId: string;
          event: RuntimeServiceSubscriptionEventMessage["event"];
        }
      );
    };
    ipcRenderer.on("eragear:runtimeSubscriptionEvent", listener);
    return () => {
      ipcRenderer.off("eragear:runtimeSubscriptionEvent", listener);
    };
  },
});
