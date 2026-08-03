// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import {
  Bot,
  ChevronDown,
  Code2,
  ExternalLink,
  Folder,
  FolderOpen,
  GitFork,
  Github,
  Info,
  LogOut,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  SquareTerminal,
  Terminal,
  X,
} from "lucide-react";
import { type ComponentType, Fragment, memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRightSidebarControls } from "@/components/layout/three-pane-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DesktopWindowState,
  ExternalProjectAppTarget,
} from "@/lib/desktop-bootstrap";
import { cn } from "@/lib/utils";
import { SidebarTrigger } from "../ui/sidebar";
import type { ChatDisplayConnectionStatus } from "./chat-connection-display";

export interface ChatHeaderAgentDisplay {
  name: string;
  source: "session" | "selected" | "fallback";
  version?: string;
}

export interface ChatHeaderProps {
  agentDisplay: ChatHeaderAgentDisplay;
  chatTitle?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  connStatus: ChatDisplayConnectionStatus;
  onStopChat: () => void;
  onResumeChat?: () => void;
  onForkChat?: () => void;
  onToggleSupervisos?: () => void;
  onToggleSidePanel?: () => void;
  isSupervisosOpen?: boolean;
  isResuming?: boolean;
  isForking?: boolean;
  /** True when agent doesn't support session load */
  loadNotSupported?: boolean;
}

const getConnectionTone = (connStatus: ChatHeaderProps["connStatus"]) => {
  switch (connStatus) {
    case "connected":
      return "bg-green-500";
    case "connecting":
      return "animate-pulse bg-amber-500";
    case "error":
      return "bg-red-500";
    case "inactive":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
};

const getDesktopWindowControls = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.eragearDesktop?.windowControls ?? null;
};

const getDesktopProjectExternalOpener = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.eragearDesktop?.openProjectExternally ?? null;
};

const PROJECT_OPEN_TARGETS: Array<{
  icon: ComponentType<{ className?: string }>;
  label: string;
  target: ExternalProjectAppTarget;
}> = [
  { icon: Code2, label: "Zed", target: "zed" },
  { icon: Code2, label: "VS Code", target: "vscode" },
  { icon: Bot, label: "Antigravity", target: "antigravity" },
  { icon: SquareTerminal, label: "Warp Terminal", target: "warp" },
  { icon: Github, label: "GitHub Desktop", target: "github-desktop" },
  { icon: FolderOpen, label: "File Explorer", target: "file-explorer" },
  { icon: Terminal, label: "Terminal", target: "terminal" },
  { icon: Terminal, label: "Git Bash", target: "git-bash" },
];

function ProjectOpenMenu({
  projectName,
  projectPath,
}: {
  projectName?: string | null;
  projectPath?: string | null;
}) {
  const normalizedProjectPath = projectPath?.trim() ?? "";
  const opener = getDesktopProjectExternalOpener();
  const disabled = !(normalizedProjectPath && opener);
  const projectLabel = projectName?.trim() || "Workspace";

  const openTarget = (target: ExternalProjectAppTarget, label: string) => {
    if (!normalizedProjectPath) {
      toast.error("No project folder selected");
      return;
    }
    const currentOpener = getDesktopProjectExternalOpener();
    if (!currentOpener) {
      toast.error("External app launcher is only available in desktop mode");
      return;
    }
    void currentOpener({ projectPath: normalizedProjectPath, target })
      .then(() => {
        toast.success(`Opened ${projectLabel} in ${label}`);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Open project in app"
          className="hidden gap-1 text-muted-foreground hover:text-foreground sm:inline-flex"
          disabled={disabled}
          size="sm"
          title="Open project in app"
          type="button"
          variant="outline"
        >
          <ExternalLink className="size-3.5" />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Open project in</DropdownMenuLabel>
        {PROJECT_OPEN_TARGETS.map((item, index) => {
          const Icon = item.icon;
          return (
            <Fragment key={item.target}>
              {index === 4 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={disabled}
                onSelect={() => openTarget(item.target, item.label)}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span>{item.label}</span>
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ElectronWindowControls = memo(function ElectronWindowControls() {
  const controls = getDesktopWindowControls();
  const [windowState, setWindowState] = useState<DesktopWindowState | null>(
    null
  );

  useEffect(() => {
    const bridge = getDesktopWindowControls();
    if (!bridge) {
      return;
    }

    let mounted = true;
    void bridge
      .getState()
      .then((nextState) => {
        if (mounted && nextState) {
          setWindowState(nextState);
        }
      })
      .catch((error) => {
        console.warn("[desktop] Failed to read window state", error);
      });

    const unsubscribe = bridge.onStateChange((nextState) => {
      setWindowState(nextState);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!controls) {
    return null;
  }

  const isMaximized = windowState?.isMaximized ?? false;
  const MaximizeIcon = isMaximized ? Minimize2 : Maximize2;
  const maximizeLabel = isMaximized ? "Restore window" : "Maximize window";

  return (
    <div
      className="-mr-3 flex h-12 shrink-0 items-center border-l"
      data-eragear-window-no-drag="true"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Minimize window"
            className="h-12 w-10 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              void controls.minimize();
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Minus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Minimize window</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={maximizeLabel}
            className="h-12 w-10 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              void controls.toggleMaximize().then((nextState) => {
                if (nextState) {
                  setWindowState(nextState);
                }
              });
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MaximizeIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{maximizeLabel}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Close window"
            className="h-12 w-10 rounded-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              void controls.close();
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close window</TooltipContent>
      </Tooltip>
    </div>
  );
});

export const ChatHeader = memo(function ChatHeader({
  agentDisplay,
  chatTitle,
  projectName,
  projectPath,
  connStatus,
  onStopChat,
  onResumeChat,
  onForkChat,
  onToggleSupervisos,
  onToggleSidePanel,
  isSupervisosOpen = false,
  isResuming,
  isForking,
  loadNotSupported,
}: ChatHeaderProps) {
  const rightSidebar = useRightSidebarControls();
  const displayTitle = chatTitle?.trim() || "New Task";
  const projectLabel = projectName?.trim() || "Workspace";
  const sidebarIcon = rightSidebar.isOpen ? PanelRightClose : PanelRightOpen;
  const SidebarIcon = sidebarIcon;

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur-sm"
      data-eragear-window-drag="true"
    >
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="min-w-0 max-w-[min(42rem,48vw)] truncate font-semibold text-foreground text-sm leading-none">
          {displayTitle}
        </h1>

        <div
          className="hidden h-8 min-w-0 max-w-72 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs shadow-sm sm:flex"
          data-eragear-window-no-drag="true"
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">
            {projectLabel}
          </span>
          <span className="h-3 w-px shrink-0 bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex min-w-0 items-center gap-1">
                <Bot className="size-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">{agentDisplay.name}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{agentDisplay.name}</TooltipContent>
          </Tooltip>
        </div>

        <ProjectOpenMenu projectName={projectName} projectPath={projectPath} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden h-7 items-center gap-1.5 rounded-md border bg-muted/20 px-2 text-muted-foreground text-xs md:flex">
          <span
            className={cn(
              "size-1.5 rounded-full",
              getConnectionTone(connStatus)
            )}
          />
          <span className="font-medium">{connStatus}</span>
        </div>

        {connStatus === "connected" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Disconnect"
                className="text-muted-foreground hover:text-destructive"
                onClick={onStopChat}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <LogOut className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Disconnect</TooltipContent>
          </Tooltip>
        )}
        {onForkChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={isForking ? "Forking task" : "Fork task"}
                className="text-muted-foreground hover:text-foreground"
                disabled={isForking}
                onClick={onForkChat}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <GitFork className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isForking ? "Forking task" : "Fork task"}
            </TooltipContent>
          </Tooltip>
        )}
        {(connStatus === "idle" || connStatus === "inactive") &&
          onResumeChat && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={
                    isResuming ? "Loading session" : "Load from agent"
                  }
                  className="text-muted-foreground hover:text-foreground"
                  disabled={isResuming}
                  onClick={onResumeChat}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  {isResuming ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4 fill-current" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isResuming ? "Loading session" : "Load from agent"}
              </TooltipContent>
            </Tooltip>
          )}
        {(connStatus === "idle" || connStatus === "inactive") &&
          !onResumeChat &&
          loadNotSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Read-only session"
                  className="text-muted-foreground"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Info className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>This agent does not support session load.</p>
                <p className="text-muted-foreground text-xs">
                  Start a new chat to interact with the agent.
                </p>
              </TooltipContent>
            </Tooltip>
          )}

        {onToggleSupervisos ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls="supervisos-panel"
                aria-label={
                  isSupervisosOpen ? "Close Supervisos" : "Open Supervisos"
                }
                aria-pressed={isSupervisosOpen}
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  isSupervisosOpen && "bg-muted text-foreground"
                )}
                onClick={onToggleSupervisos}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Bot className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isSupervisosOpen ? "Close Supervisos" : "Open Supervisos"}
            </TooltipContent>
          </Tooltip>
        ) : null}

        {rightSidebar.hasRightSidebar ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls="context-panel"
                aria-label={
                  rightSidebar.isOpen
                    ? "Close context sidebar"
                    : "Open context sidebar"
                }
                aria-pressed={rightSidebar.isOpen}
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  rightSidebar.isOpen && "bg-muted text-foreground"
                )}
                onClick={onToggleSidePanel ?? rightSidebar.toggle}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <SidebarIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {rightSidebar.isOpen
                ? "Close context sidebar"
                : "Open context sidebar"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <ElectronWindowControls />
    </header>
  );
});
