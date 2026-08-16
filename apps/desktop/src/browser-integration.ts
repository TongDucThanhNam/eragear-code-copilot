import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserWindow, OpenDialogOptions, Session } from "electron";
import {
  dialog,
  BrowserWindow as ElectronBrowserWindow,
  shell,
} from "electron";

const HTML_FILE_PATTERN = /\.html?$/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOOPBACK_URL_PATTERN =
  /^(localhost|127\.|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i;
const PORT_ONLY_PATTERN = /^\d{2,5}$/;
const PROTOCOL_PATTERN = /^[a-z][a-z\d+\-.]*:/i;
const REACT_GRAB_SCRIPT_URL =
  "https://unpkg.com/react-grab/dist/index.global.js";
const REACT_SCAN_SCRIPT_URL =
  "https://unpkg.com/react-scan/dist/auto.global.js";
const MAX_CONSOLE_MESSAGES = 80;
const MAX_CONTEXT_TEXT_LENGTH = 16_000;
const MAX_CONTEXT_HTML_LENGTH = 16_000;

export interface IntegratedBrowserOpenInput {
  url: string;
  title?: string;
  projectRoot?: string;
  injectReactGrab?: boolean;
  injectReactScan?: boolean;
  fullScreen?: boolean;
}

export interface IntegratedBrowserHtmlFileInput {
  defaultPath?: string;
  projectRoot?: string;
}

export interface IntegratedBrowserHtmlFile {
  filePath: string;
  url: string;
  displayName: string;
}

export interface IntegratedBrowserConsoleMessage {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  sourceId?: string;
  line?: number;
  timestamp: string;
}

export interface IntegratedBrowserInstrumentationState {
  reactGrab: boolean;
  reactScan: boolean;
  allowed: boolean;
  diagnostics: string[];
}

export interface IntegratedBrowserState {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  isFullScreen: boolean;
  isDevToolsOpened: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  instrumentation: IntegratedBrowserInstrumentationState;
  recentConsoleMessages: IntegratedBrowserConsoleMessage[];
  updatedAt: string;
}

export interface IntegratedBrowserContextCapture {
  url: string;
  title: string;
  selectedText: string;
  selectedHtml: string;
  hoveredHtml: string;
  hoveredSelector: string;
  activeElementHtml: string;
  visibleText: string;
  reactRendererCount: number;
  recentConsoleMessages: IntegratedBrowserConsoleMessage[];
  capturedAt: string;
}

interface IntegratedBrowserControllerOptions {
  repoRoot: string;
  notifyStateChange: (state: IntegratedBrowserState | null) => void;
}

interface BrowserInstrumentationOptions {
  reactGrab: boolean;
  reactScan: boolean;
}

interface NormalizedBrowserUrl {
  url: string;
  allowedRoots: string[];
}

export class IntegratedBrowserController {
  private readonly options: IntegratedBrowserControllerOptions;
  private readonly id = randomUUID();
  private browserWindow: BrowserWindow | null = null;
  private isLoading = false;
  private sessionConfigured = false;
  private allowedRoots: string[] = [];
  private instrumentation: BrowserInstrumentationOptions = {
    reactGrab: false,
    reactScan: false,
  };
  private instrumentationDiagnostics: string[] = [];
  private consoleMessages: IntegratedBrowserConsoleMessage[] = [];

  constructor(options: IntegratedBrowserControllerOptions) {
    this.options = {
      ...options,
      repoRoot: path.resolve(options.repoRoot),
    };
    this.allowedRoots = [this.options.repoRoot];
  }

  async pickHtmlFile(
    parentWindow: BrowserWindow | null,
    input?: IntegratedBrowserHtmlFileInput
  ): Promise<IntegratedBrowserHtmlFile | null> {
    const allowedRoots = this.resolveAllowedRoots(input?.projectRoot);
    const defaultPath = this.resolveDefaultDialogPath({
      allowedRoots,
      defaultPath: input?.defaultPath,
    });
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, {
          ...htmlDialogOptions(defaultPath),
        })
      : await dialog.showOpenDialog({
          ...htmlDialogOptions(defaultPath),
        });

    if (result.canceled) {
      return null;
    }

    const filePath = result.filePaths[0];
    if (!filePath) {
      return null;
    }
    return await this.resolveHtmlFile(filePath, allowedRoots);
  }

  async open(
    input: IntegratedBrowserOpenInput
  ): Promise<IntegratedBrowserState> {
    const normalized = await this.normalizeUrl(input.url, input.projectRoot);
    this.allowedRoots = normalized.allowedRoots;
    this.instrumentation = {
      reactGrab: input.injectReactGrab === true,
      reactScan: input.injectReactScan === true,
    };
    this.instrumentationDiagnostics = [];
    this.consoleMessages = [];

    const window = this.ensureWindow();
    if (input.title) {
      window.setTitle(input.title);
    }
    if (typeof input.fullScreen === "boolean") {
      window.setFullScreen(input.fullScreen);
    }
    await window.loadURL(normalized.url);
    window.show();
    window.focus();
    await this.injectInstrumentation();
    this.notify();
    return this.state() as IntegratedBrowserState;
  }

  reload(): IntegratedBrowserState | null {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return null;
    }
    window.webContents.reload();
    return this.state();
  }

  goBack(): IntegratedBrowserState | null {
    const window = this.browserWindow;
    if (!window || window.isDestroyed() || !window.webContents.canGoBack()) {
      return this.state();
    }
    window.webContents.goBack();
    return this.state();
  }

  goForward(): IntegratedBrowserState | null {
    const window = this.browserWindow;
    if (!window || window.isDestroyed() || !window.webContents.canGoForward()) {
      return this.state();
    }
    window.webContents.goForward();
    return this.state();
  }

  setFullScreen(fullScreen: boolean): IntegratedBrowserState | null {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return null;
    }
    window.setFullScreen(fullScreen);
    this.notify();
    return this.state();
  }

  openDevTools(): IntegratedBrowserState | null {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return null;
    }
    window.webContents.openDevTools({ mode: "detach" });
    this.notify();
    return this.state();
  }

  close(): void {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return;
    }
    window.close();
  }

  state(): IntegratedBrowserState | null {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return null;
    }
    const webContents = window.webContents;
    const url = webContents.getURL();
    return {
      id: this.id,
      url,
      title: webContents.getTitle() || window.getTitle() || "Browser",
      isLoading: this.isLoading,
      isFullScreen: window.isFullScreen(),
      isDevToolsOpened: webContents.isDevToolsOpened(),
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
      instrumentation: {
        ...this.instrumentation,
        allowed: isInstrumentationAllowed(url),
        diagnostics: [...this.instrumentationDiagnostics],
      },
      recentConsoleMessages: this.consoleMessages.slice(-8),
      updatedAt: new Date().toISOString(),
    };
  }

  async captureContext(): Promise<IntegratedBrowserContextCapture | null> {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return null;
    }
    const pageContext = await window.webContents.executeJavaScript(
      captureContextScript(),
      true
    );
    if (!isRecord(pageContext)) {
      return null;
    }
    return {
      url: asString(pageContext.url),
      title: asString(pageContext.title),
      selectedText: asString(pageContext.selectedText),
      selectedHtml: asString(pageContext.selectedHtml),
      hoveredHtml: asString(pageContext.hoveredHtml),
      hoveredSelector: asString(pageContext.hoveredSelector),
      activeElementHtml: asString(pageContext.activeElementHtml),
      visibleText: asString(pageContext.visibleText),
      reactRendererCount:
        typeof pageContext.reactRendererCount === "number"
          ? pageContext.reactRendererCount
          : 0,
      recentConsoleMessages: [...this.consoleMessages],
      capturedAt: new Date().toISOString(),
    };
  }

  private ensureWindow(): BrowserWindow {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      return this.browserWindow;
    }

    const window = new ElectronBrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 720,
      minHeight: 480,
      title: "Eragear Browser",
      autoHideMenuBar: true,
      show: false,
      backgroundColor: "#0f1115",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: true,
        partition: "persist:eragear-integrated-browser",
      },
    });

    this.browserWindow = window;
    this.configureBrowserSession(window.webContents.session);
    window.setMenuBarVisibility(false);
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      this.browserWindow = null;
      this.options.notifyStateChange(null);
    });
    window.on("enter-full-screen", () => this.notify());
    window.on("leave-full-screen", () => this.notify());
    window.webContents.on("did-start-loading", () => {
      this.isLoading = true;
      this.notify();
    });
    window.webContents.on("did-stop-loading", () => {
      this.isLoading = false;
      this.notify();
    });
    window.webContents.on("dom-ready", () => {
      this.installContextProbe().catch((error) => {
        this.instrumentationDiagnostics.push(
          `Context probe failed: ${stringifyError(error)}`
        );
      });
      this.injectInstrumentation().catch((error) => {
        this.instrumentationDiagnostics.push(
          `Instrumentation failed: ${stringifyError(error)}`
        );
        this.notify();
      });
    });
    window.webContents.on("did-finish-load", () => {
      this.injectInstrumentation().catch((error) => {
        this.instrumentationDiagnostics.push(
          `Instrumentation failed: ${stringifyError(error)}`
        );
      });
      this.notify();
    });
    window.webContents.on("did-navigate", () => this.notify());
    window.webContents.on("did-navigate-in-page", () => this.notify());
    window.webContents.on("page-title-updated", () => this.notify());
    window.webContents.on(
      "console-message",
      ({ level, message, lineNumber, sourceId }) => {
        this.consoleMessages.push({
          level,
          message,
          ...(sourceId ? { sourceId } : {}),
          ...(lineNumber ? { line: lineNumber } : {}),
          timestamp: new Date().toISOString(),
        });
        this.consoleMessages = this.consoleMessages.slice(
          -MAX_CONSOLE_MESSAGES
        );
        this.notify();
      }
    );
    window.webContents.setWindowOpenHandler(({ url }) => {
      this.handleWindowOpen(url).catch((error) => {
        this.instrumentationDiagnostics.push(
          `Window open blocked: ${stringifyError(error)}`
        );
        this.notify();
      });
      return { action: "deny" };
    });

    return window;
  }

  private configureBrowserSession(browserSession: Session): void {
    if (this.sessionConfigured) {
      return;
    }
    this.sessionConfigured = true;
    browserSession.webRequest.onHeadersReceived((details, callback) => {
      if (!isInstrumentationAllowed(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      const responseHeaders: Record<string, string[] | string> = {};
      for (const [key, value] of Object.entries(
        details.responseHeaders ?? {}
      )) {
        if (key.toLowerCase() === "content-security-policy") {
          continue;
        }
        if (value !== undefined) {
          responseHeaders[key] = value;
        }
      }
      callback({ responseHeaders });
    });
  }

  private async handleWindowOpen(url: string): Promise<void> {
    const normalized = await this.normalizeUrlFromCurrentRoots(url);
    if (normalized) {
      await this.browserWindow?.webContents.loadURL(normalized);
      return;
    }
    if (HTTP_URL_PATTERN.test(url)) {
      await shell.openExternal(url);
    }
  }

  private async installContextProbe(): Promise<void> {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return;
    }
    await window.webContents.executeJavaScript(contextProbeScript(), true);
  }

  private async injectInstrumentation(): Promise<void> {
    const window = this.browserWindow;
    if (!window || window.isDestroyed()) {
      return;
    }
    const url = window.webContents.getURL();
    if (!(this.instrumentation.reactGrab || this.instrumentation.reactScan)) {
      return;
    }
    if (!isInstrumentationAllowed(url)) {
      this.instrumentationDiagnostics = [
        "React Grab/Scan injection is limited to file and localhost targets.",
      ];
      this.notify();
      return;
    }

    const diagnostics: string[] = [];
    if (this.instrumentation.reactGrab) {
      const result = await window.webContents.executeJavaScript(
        injectScriptTagScript("eragear-react-grab", REACT_GRAB_SCRIPT_URL),
        true
      );
      diagnostics.push(`React Grab ${asString(result) || "queued"}.`);
    }
    if (this.instrumentation.reactScan) {
      const result = await window.webContents.executeJavaScript(
        injectScriptTagScript("eragear-react-scan", REACT_SCAN_SCRIPT_URL),
        true
      );
      diagnostics.push(`React Scan ${asString(result) || "queued"}.`);
    }
    this.instrumentationDiagnostics = diagnostics;
    this.notify();
  }

  private notify(): void {
    this.options.notifyStateChange(this.state());
  }

  private resolveAllowedRoots(projectRoot?: string): string[] {
    const roots = [this.options.repoRoot];
    const normalizedProjectRoot = projectRoot?.trim();
    if (normalizedProjectRoot && path.isAbsolute(normalizedProjectRoot)) {
      roots.unshift(path.resolve(normalizedProjectRoot));
    }
    return [...new Set(roots.map(normalizeComparablePath))];
  }

  private resolveDefaultDialogPath(input: {
    allowedRoots: string[];
    defaultPath?: string;
  }): string {
    const candidate = input.defaultPath?.trim();
    if (candidate) {
      const resolved = path.resolve(candidate);
      if (isPathInsideRoots(resolved, input.allowedRoots)) {
        return resolved;
      }
    }
    return input.allowedRoots[0] ?? this.options.repoRoot;
  }

  private async resolveHtmlFile(
    filePath: string,
    allowedRoots: string[]
  ): Promise<IntegratedBrowserHtmlFile> {
    const resolvedFilePath = path.resolve(filePath);
    if (!HTML_FILE_PATTERN.test(resolvedFilePath)) {
      throw new Error("Selected file must be an HTML file.");
    }
    if (!isPathInsideRoots(resolvedFilePath, allowedRoots)) {
      throw new Error("Selected HTML file is outside the active project root.");
    }
    await access(resolvedFilePath);
    return {
      filePath: resolvedFilePath,
      url: pathToFileURL(resolvedFilePath).toString(),
      displayName: path.basename(resolvedFilePath),
    };
  }

  private async normalizeUrl(
    value: string,
    projectRoot?: string
  ): Promise<NormalizedBrowserUrl> {
    const allowedRoots = this.resolveAllowedRoots(projectRoot);
    const url = await normalizeBrowserUrl(value, allowedRoots);
    return { url, allowedRoots };
  }

  private async normalizeUrlFromCurrentRoots(value: string): Promise<string> {
    return await normalizeBrowserUrl(value, this.allowedRoots);
  }
}

async function normalizeBrowserUrl(
  value: string,
  allowedRoots: string[]
): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Browser URL is required.");
  }

  if (PORT_ONLY_PATTERN.test(trimmed)) {
    return `http://127.0.0.1:${trimmed}`;
  }

  if (path.isAbsolute(trimmed) && HTML_FILE_PATTERN.test(trimmed)) {
    const resolved = path.resolve(trimmed);
    if (!isPathInsideRoots(resolved, allowedRoots)) {
      throw new Error("HTML file path is outside the active project root.");
    }
    await access(resolved);
    return pathToFileURL(resolved).toString();
  }

  let candidate: string;
  if (PROTOCOL_PATTERN.test(trimmed)) {
    candidate = trimmed;
  } else if (LOOPBACK_URL_PATTERN.test(trimmed)) {
    candidate = `http://${trimmed}`;
  } else {
    candidate = `https://${trimmed}`;
  }

  const parsed = new URL(candidate);
  if (parsed.protocol === "file:") {
    const filePath = path.resolve(fileURLToPath(parsed));
    if (!isPathInsideRoots(filePath, allowedRoots)) {
      throw new Error("File URL is outside the active project root.");
    }
    await access(filePath);
    return pathToFileURL(filePath).toString();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP, HTTPS, and project HTML files are supported.");
  }
  return parsed.toString();
}

function htmlDialogOptions(defaultPath: string): OpenDialogOptions {
  return {
    defaultPath,
    filters: [
      { name: "HTML files", extensions: ["html", "htm"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
    title: "Open HTML Preview",
  };
}

function isInstrumentationAllowed(url: string): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return true;
    }
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isPathInsideRoots(filePath: string, roots: string[]): boolean {
  const candidate = normalizeComparablePath(filePath);
  return roots.some(
    (root) => candidate === root || candidate.startsWith(`${root}${path.sep}`)
  );
}

function normalizeComparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function injectScriptTagScript(elementId: string, src: string): string {
  return `
(() => {
  const id = ${JSON.stringify(elementId)};
  const src = ${JSON.stringify(src)};
  if (document.getElementById(id)) {
    return "already present";
  }
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.crossOrigin = "anonymous";
  script.async = false;
  const target = document.head || document.documentElement;
  target.prepend(script);
  return "queued";
})()
`;
}

function contextProbeScript(): string {
  return `
(() => {
  const flag = "__eragearBrowserContextProbeInstalled";
  if (window[flag]) {
    return true;
  }
  window[flag] = true;
  let hovered = null;
  document.addEventListener("pointermove", (event) => {
    if (hovered && hovered.removeAttribute) {
      hovered.removeAttribute("data-eragear-browser-hovered");
    }
    const target = event.target;
    if (target && target.setAttribute) {
      hovered = target;
      hovered.setAttribute("data-eragear-browser-hovered", "true");
    }
  }, { capture: true, passive: true });
  return true;
})()
`;
}

function captureContextScript(): string {
  return `
(() => {
  const textLimit = ${MAX_CONTEXT_TEXT_LENGTH};
  const htmlLimit = ${MAX_CONTEXT_HTML_LENGTH};
  const clamp = (value, limit) => String(value || "").slice(0, limit);
  const selection = window.getSelection();
  let selectedHtml = "";
  if (selection && selection.rangeCount > 0) {
    const container = document.createElement("div");
    container.appendChild(selection.getRangeAt(0).cloneContents());
    selectedHtml = container.innerHTML;
  }
  const hovered = document.querySelector("[data-eragear-browser-hovered='true']");
  const active = document.activeElement;
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const rendererCount = hook && hook.renderers && typeof hook.renderers.size === "number"
    ? hook.renderers.size
    : 0;
  return {
    url: window.location.href,
    title: document.title,
    selectedText: clamp(selection ? selection.toString() : "", textLimit),
    selectedHtml: clamp(selectedHtml, htmlLimit),
    hoveredHtml: clamp(hovered && hovered.outerHTML ? hovered.outerHTML : "", htmlLimit),
    hoveredSelector: hovered ? selectorFor(hovered) : "",
    activeElementHtml: clamp(active && active.outerHTML ? active.outerHTML : "", htmlLimit),
    visibleText: clamp(document.body ? document.body.innerText : "", textLimit),
    reactRendererCount: rendererCount,
  };

  function selectorFor(element) {
    if (!(element instanceof Element)) {
      return "";
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        selector += "#" + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      const className = typeof current.className === "string"
        ? current.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2)
        : [];
      if (className.length > 0) {
        selector += "." + className.map((name) => CSS.escape(name)).join(".");
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
})()
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
