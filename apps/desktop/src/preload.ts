import type {
  RuntimeServiceAuth,
  RuntimeServiceOperation,
  RuntimeServiceSubscriptionEventMessage,
} from "@eragear-code-copilot/shared";
import { contextBridge, ipcRenderer } from "electron";
import type {
  IntegratedBrowserHtmlFileInput,
  IntegratedBrowserOpenInput,
  IntegratedBrowserState,
} from "./browser-integration.js";

contextBridge.exposeInMainWorld("eragearDesktop", {
  getBootstrap: () => ipcRenderer.invoke("eragear:getBootstrap"),
  getRuntimeDiagnostics: () =>
    ipcRenderer.invoke("eragear:getRuntimeDiagnostics"),
  getRemoteConnectStatus: () =>
    ipcRenderer.invoke("eragear:getRemoteConnectStatus"),
  checkForUpdates: () => ipcRenderer.invoke("eragear:checkForUpdates"),
  openProjectFolder: (input?: { defaultPath?: string }) =>
    ipcRenderer.invoke("eragear:dialog:openProjectFolder", input),
  browserControls: {
    captureContext: () => ipcRenderer.invoke("eragear:browser:captureContext"),
    close: () => ipcRenderer.invoke("eragear:browser:close"),
    getState: () => ipcRenderer.invoke("eragear:browser:getState"),
    goBack: () => ipcRenderer.invoke("eragear:browser:goBack"),
    goForward: () => ipcRenderer.invoke("eragear:browser:goForward"),
    open: (input: IntegratedBrowserOpenInput) =>
      ipcRenderer.invoke("eragear:browser:open", input),
    openDevTools: () => ipcRenderer.invoke("eragear:browser:openDevTools"),
    openHtmlFile: (input?: IntegratedBrowserHtmlFileInput) =>
      ipcRenderer.invoke("eragear:browser:openHtmlFile", input),
    reload: () => ipcRenderer.invoke("eragear:browser:reload"),
    setFullScreen: (input: { fullScreen: boolean }) =>
      ipcRenderer.invoke("eragear:browser:setFullScreen", input),
    onStateChange: (
      callback: (state: IntegratedBrowserState | null) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) => {
        callback(payload as IntegratedBrowserState | null);
      };
      ipcRenderer.on("eragear:browserStateChanged", listener);
      return () => {
        ipcRenderer.off("eragear:browserStateChanged", listener);
      };
    },
  },
  windowControls: {
    close: () => ipcRenderer.invoke("eragear:window:close"),
    getState: () => ipcRenderer.invoke("eragear:window:getState"),
    minimize: () => ipcRenderer.invoke("eragear:window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("eragear:window:toggleMaximize"),
    onStateChange: (
      callback: (payload: {
        isFullScreen: boolean;
        isMaximized: boolean;
      }) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) => {
        callback(payload as { isFullScreen: boolean; isMaximized: boolean });
      };
      ipcRenderer.on("eragear:windowStateChanged", listener);
      return () => {
        ipcRenderer.off("eragear:windowStateChanged", listener);
      };
    },
  },
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
