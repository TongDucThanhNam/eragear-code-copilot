// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Copy,
  ExternalLink,
  FileCode2,
  Globe2,
  Maximize2,
  RefreshCw,
  ScanSearch,
  SquareMousePointer,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  IntegratedBrowserContextCapture,
  IntegratedBrowserState,
} from "@/lib/desktop-bootstrap";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/project-store";

export function BrowserPanel() {
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;
  const activeProjectPath = activeProject?.path;
  const browserBridge = useMemo(() => getBrowserBridge(), []);
  const [inputValue, setInputValue] = useState("");
  const [url, setUrl] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [reactGrabEnabled, setReactGrabEnabled] = useState(true);
  const [reactScanEnabled, setReactScanEnabled] = useState(false);
  const [browserState, setBrowserState] =
    useState<IntegratedBrowserState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const normalizedUrl = useMemo(() => normalizeUrl(url), [url]);

  useEffect(() => {
    if (!browserBridge) {
      return;
    }
    let mounted = true;
    browserBridge.getState().then((state) => {
      if (mounted) {
        setBrowserState(state);
      }
    });
    const unsubscribe = browserBridge.onStateChange((state) => {
      setBrowserState(state);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [browserBridge]);

  const openBrowserUrl = useCallback(
    async (
      rawUrl: string,
      options?: {
        fullScreen?: boolean;
        reactGrab?: boolean;
        reactScan?: boolean;
        title?: string;
      }
    ) => {
      const nextUrl = normalizeUrl(rawUrl);
      if (!nextUrl) {
        return;
      }
      setUrl(nextUrl);
      setInputValue(nextUrl);
      setReloadKey((value) => value + 1);
      if (!browserBridge) {
        return;
      }
      setIsBusy(true);
      try {
        const nextState = await browserBridge.open({
          url: nextUrl,
          ...(options?.title ? { title: options.title } : {}),
          ...(activeProjectPath ? { projectRoot: activeProjectPath } : {}),
          injectReactGrab: options?.reactGrab ?? reactGrabEnabled,
          injectReactScan: options?.reactScan ?? reactScanEnabled,
          fullScreen: options?.fullScreen ?? false,
        });
        setBrowserState(nextState);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setIsBusy(false);
      }
    },
    [activeProjectPath, browserBridge, reactGrabEnabled, reactScanEnabled]
  );

  const navigate = () => {
    void openBrowserUrl(inputValue);
  };

  const openHtmlFile = async () => {
    if (!browserBridge) {
      toast.error("HTML picker is available in the desktop app.");
      return;
    }
    setIsBusy(true);
    try {
      const file = await browserBridge.openHtmlFile({
        ...(activeProjectPath ? { defaultPath: activeProjectPath } : {}),
        ...(activeProjectPath ? { projectRoot: activeProjectPath } : {}),
      });
      if (!file) {
        return;
      }
      await openBrowserUrl(file.url, { title: file.displayName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const refresh = async () => {
    setReloadKey((value) => value + 1);
    if (!browserBridge) {
      return;
    }
    try {
      const state = await browserBridge.reload();
      setBrowserState(state);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const captureContext = async () => {
    if (!browserBridge) {
      toast.error("Context capture is available in the desktop app.");
      return;
    }
    try {
      const context = await browserBridge.captureContext();
      if (!context) {
        toast.error("No browser page is active.");
        return;
      }
      await navigator.clipboard.writeText(formatBrowserContext(context));
      toast.success("Browser context copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleReactGrab = (checked: boolean) => {
    setReactGrabEnabled(checked);
    if (browserState?.url) {
      void openBrowserUrl(browserState.url, {
        reactGrab: checked,
        reactScan: reactScanEnabled,
      });
    }
  };

  const toggleReactScan = (checked: boolean) => {
    setReactScanEnabled(checked);
    if (browserState?.url) {
      void openBrowserUrl(browserState.url, {
        reactGrab: reactGrabEnabled,
        reactScan: checked,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <Globe2 className="size-4 shrink-0 text-muted-foreground" />
        <Input
          aria-label="Browser URL"
          className="h-7 min-w-0 flex-1 border-muted bg-muted/20"
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="3000 or localhost:3000"
          spellCheck={false}
          value={inputValue}
        />
        <Button disabled={isBusy} size="xs" type="submit" variant="outline">
          Open
        </Button>
        <ToolbarButton
          disabled={isBusy}
          label="Open HTML file"
          onClick={openHtmlFile}
        >
          <FileCode2 className="size-3" />
        </ToolbarButton>
      </form>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/10 px-2 py-1.5">
        <ToolbarButton
          disabled={!browserState?.canGoBack}
          label="Back"
          onClick={() => browserBridge?.goBack().then(setBrowserState)}
        >
          <ArrowLeft className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!browserState?.canGoForward}
          label="Forward"
          onClick={() => browserBridge?.goForward().then(setBrowserState)}
        >
          <ArrowRight className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!normalizedUrl && !browserState}
          label="Refresh"
          onClick={refresh}
        >
          <RefreshCw
            className={cn("size-3", browserState?.isLoading && "animate-spin")}
          />
        </ToolbarButton>
        <ToolbarButton
          disabled={!browserState}
          label="Fullscreen"
          onClick={() =>
            browserBridge
              ?.setFullScreen({ fullScreen: !browserState?.isFullScreen })
              .then(setBrowserState)
          }
        >
          <Maximize2 className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!browserState}
          label="DevTools"
          onClick={() => browserBridge?.openDevTools().then(setBrowserState)}
        >
          <Bug className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!browserState}
          label="Copy context"
          onClick={captureContext}
        >
          <Copy className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!normalizedUrl}
          label="Open externally"
          onClick={() => {
            if (normalizedUrl) {
              window.open(normalizedUrl, "_blank", "noopener,noreferrer");
            }
          }}
        >
          <ExternalLink className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!browserState}
          label="Close browser"
          onClick={() =>
            browserBridge?.close().then(() => setBrowserState(null))
          }
        >
          <X className="size-3" />
        </ToolbarButton>
        <div className="ml-auto flex min-w-0 items-center gap-2 pl-1">
          <ToggleControl
            checked={reactGrabEnabled}
            icon={<SquareMousePointer className="size-3" />}
            label="Grab"
            onCheckedChange={toggleReactGrab}
          />
          <ToggleControl
            checked={reactScanEnabled}
            icon={<ScanSearch className="size-3" />}
            label="Scan"
            onCheckedChange={toggleReactScan}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-muted/20">
        {normalizedUrl ? (
          <iframe
            className="size-full bg-background"
            key={`${normalizedUrl}:${reloadKey}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            src={normalizedUrl}
            title="Browser preview"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="grid max-w-56 gap-3">
              <div className="mx-auto flex size-9 items-center justify-center border bg-background">
                <Globe2 className="size-4 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm leading-6">
                No page loaded.
              </p>
            </div>
          </div>
        )}
        {browserState ? <BrowserStateOverlay state={browserState} /> : null}
      </div>
    </div>
  );
}

function getBrowserBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.eragearDesktop?.browserControls ?? null;
}

function ToolbarButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToggleControl({
  checked,
  icon,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  icon: ReactNode;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-6 items-center gap-1.5 text-muted-foreground text-xs">
      {icon}
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} size="sm" />
    </label>
  );
}

function BrowserStateOverlay({ state }: { state: IntegratedBrowserState }) {
  const consoleCount = state.recentConsoleMessages.length;
  return (
    <div className="absolute inset-x-2 bottom-2 border bg-background/95 p-2 shadow-sm backdrop-blur">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{state.title || "Browser"}</div>
          <div className="truncate text-muted-foreground">{state.url}</div>
        </div>
        <Badge variant={state.isLoading ? "secondary" : "outline"}>
          {state.isLoading ? "Loading" : "Ready"}
        </Badge>
        {state.instrumentation.reactGrab ? (
          <Badge
            variant={state.instrumentation.allowed ? "outline" : "destructive"}
          >
            Grab
          </Badge>
        ) : null}
        {state.instrumentation.reactScan ? (
          <Badge
            variant={state.instrumentation.allowed ? "outline" : "destructive"}
          >
            Scan
          </Badge>
        ) : null}
        {consoleCount > 0 ? (
          <Badge variant="outline">{consoleCount}</Badge>
        ) : null}
      </div>
      {state.instrumentation.diagnostics.length > 0 ? (
        <div className="mt-1 truncate text-muted-foreground text-xs">
          {state.instrumentation.diagnostics.at(-1)}
        </div>
      ) : null}
    </div>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{2,5}$/.test(trimmed)) {
    return `http://127.0.0.1:${trimmed}`;
  }
  if (/^[a-z][a-z\d+\-.]*:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function formatBrowserContext(
  context: IntegratedBrowserContextCapture
): string {
  const sections = [
    "# Browser Context",
    `URL: ${context.url}`,
    `Title: ${context.title || "Untitled"}`,
    `Captured: ${context.capturedAt}`,
    `React renderers: ${context.reactRendererCount}`,
  ];

  if (context.hoveredSelector) {
    sections.push("", "## Hovered Selector", context.hoveredSelector);
  }
  if (context.selectedText) {
    sections.push("", "## Selected Text", context.selectedText);
  }
  if (context.selectedHtml) {
    sections.push("", "## Selected HTML", context.selectedHtml);
  }
  if (context.hoveredHtml) {
    sections.push("", "## Hovered HTML", context.hoveredHtml);
  }
  if (context.visibleText) {
    sections.push("", "## Visible Text", context.visibleText);
  }
  if (context.recentConsoleMessages.length > 0) {
    sections.push(
      "",
      "## Console",
      ...context.recentConsoleMessages.map(
        (message) =>
          `[${message.level}] ${message.message}${
            message.sourceId
              ? ` (${message.sourceId}:${message.line ?? 0})`
              : ""
          }`
      )
    );
  }

  return sections.join("\n");
}
