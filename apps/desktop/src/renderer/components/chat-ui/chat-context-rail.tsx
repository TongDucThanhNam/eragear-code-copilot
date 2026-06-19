// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import {
  Bot,
  Circle,
  Folder,
  GitBranch,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import type {
  SupervisorDecisionSummary,
  SupervisorMode,
  SupervisorSessionState,
} from "@eragear-code-copilot/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { ChatDisplayConnectionStatus } from "./chat-connection-display";
import { SupervisorControl } from "./supervisor-control";

interface ChatContextRailProps {
  agentName: string;
  connStatus: ChatDisplayConnectionStatus;
  isOpen: boolean;
  onClose: () => void;
  projectName?: string | null;
  projectPath?: string | null;
  supervisor: SupervisorSessionState | null;
  supervisorCapable: boolean;
  isSettingSupervisorMode: boolean;
  lastSupervisorDecision: SupervisorDecisionSummary | null;
  onSetSupervisorMode: (mode: SupervisorMode) => Promise<void>;
}

export function ChatContextRail({
  agentName,
  connStatus,
  isOpen,
  onClose,
  projectName,
  projectPath,
  supervisor,
  supervisorCapable,
  isSettingSupervisorMode,
  lastSupervisorDecision,
  onSetSupervisorMode,
}: ChatContextRailProps) {
  const summaryQuery = trpc.git.summary.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });
  const summary = summaryQuery.data;

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      aria-label="Chat environment"
      className="hidden h-full min-h-0 w-72 shrink-0 border-l bg-background/95 p-3 md:block xl:w-80"
      id="chat-environment-panel"
    >
      <div className="border bg-background shadow-[var(--surface-elevated-shadow)]">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <div className="min-w-0">
            <div className="font-medium text-sm leading-none">Environment</div>
          </div>
          <Button
            aria-label="Close environment"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid gap-1.5 p-2">
          <ContextRow
            detail={projectPath ?? "No project path"}
            icon={Folder}
            label="Project"
            value={projectName ?? "Workspace"}
          />
          <ContextRow
            detail={summary?.head ? summary.head.slice(0, 8) : "No git head"}
            icon={GitBranch}
            label="Git"
            value={
              summary?.branch ?? (summaryQuery.isLoading ? "Loading" : "Local")
            }
          />
          <ContextRow
            detail={
              summary
                ? `${summary.stagedCount} staged / ${summary.unstagedCount} unstaged`
                : summaryQuery.error
                  ? "Unavailable"
                  : "Checking"
            }
            icon={SlidersHorizontal}
            label="Changes"
            value={
              summary
                ? String(summary.totalChanged)
                : summaryQuery.error
                  ? "-"
                  : "..."
            }
          />
          <ContextRow
            detail={agentName}
            icon={Circle}
            label="Agent"
            toneClassName={getConnectionTone(connStatus)}
            value={connStatus}
          />
        </div>

        <div className="border-t px-3 py-3">
          <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-xs">
            <Bot className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="font-medium text-foreground">
                Project Supervisor
              </div>
              <div className="truncate text-muted-foreground">
                {supervisorCapable
                  ? formatSupervisorDetail(supervisor)
                  : "Disabled by runtime policy"}
              </div>
            </div>
            <Badge variant={supervisorCapable ? "secondary" : "outline"}>
              {supervisorCapable ? "Ready" : "Off"}
            </Badge>
          </div>
          {supervisorCapable ? (
            <SupervisorControl
              isPending={isSettingSupervisorMode}
              lastDecision={lastSupervisorDecision}
              mode={supervisor?.mode ?? "off"}
              onSetMode={onSetSupervisorMode}
              reason={supervisor?.reason ?? null}
              status={supervisor?.status ?? "idle"}
            />
          ) : (
            <Button
              className="h-8 w-full justify-start gap-1.5 px-2 py-0 text-muted-foreground text-xs"
              disabled
              size="sm"
              type="button"
              variant="outline"
            >
              <Bot className="size-3.5" />
              Supervisor unavailable
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-muted-foreground text-xs">Sources</span>
          <div className="flex items-center gap-1.5">
            {summaryQuery.isFetching ? (
              <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            <Badge variant="outline">
              {summary?.changedFiles.length ?? 0} files
            </Badge>
          </div>
        </div>
      </div>
    </aside>
  );
}

function formatSupervisorDetail(supervisor: SupervisorSessionState | null) {
  if (!supervisor || supervisor.mode === "off") {
    return "Off for this project context";
  }
  if (supervisor.reason) {
    return supervisor.reason;
  }
  return `Status: ${supervisor.status}`;
}

interface ContextRowProps {
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  toneClassName?: string;
  value: string;
}

function ContextRow({
  detail,
  icon: Icon,
  label,
  toneClassName,
  value,
}: ContextRowProps) {
  return (
    <div className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-xs">
      <Icon
        className={cn(
          "size-4 text-muted-foreground",
          toneClassName && "fill-current",
          toneClassName
        )}
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{value}</div>
        <div className="truncate text-muted-foreground">{detail}</div>
      </div>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function getConnectionTone(connStatus: ChatDisplayConnectionStatus) {
  switch (connStatus) {
    case "connected":
      return "text-chart-2";
    case "connecting":
      return "text-chart-4";
    case "error":
    case "inactive":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}
