// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.

import type {
  GoalModeAuditEntry,
  SupervisorDecisionSummary,
  SupervisorMode,
  SupervisorSessionState,
} from "@eragear-code-copilot/shared";
import { Bot, ListChecks, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SupervisorControl } from "./supervisor-control";
import { SupervisosRuns } from "./supervisos-runs";
import { SupervisosSideChat } from "./supervisos-side-chat";

interface ChatContextRailProps {
  chatId: string;
  isOpen: boolean;
  onClose: () => void;
  supervisor: SupervisorSessionState | null;
  supervisorCapable: boolean;
  goalModeAudit: GoalModeAuditEntry[];
  isSettingSupervisorMode: boolean;
  isSupervisosChatDisabled: boolean;
  lastSupervisorDecision: SupervisorDecisionSummary | null;
  onStageSupervisosPrompt: (input: {
    autoSubmit: boolean;
    prompt: string;
  }) => Promise<void> | void;
  onSetSupervisorMode: (mode: SupervisorMode) => Promise<void>;
}

export function ChatContextRail({
  chatId,
  isOpen,
  onClose,
  supervisor,
  supervisorCapable,
  goalModeAudit,
  isSettingSupervisorMode,
  isSupervisosChatDisabled,
  lastSupervisorDecision,
  onStageSupervisosPrompt,
  onSetSupervisorMode,
}: ChatContextRailProps) {
  const summaryQuery = trpc.git.summary.useQuery(undefined, {
    enabled: isOpen,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });
  const summary = summaryQuery.data;
  const supervisorBadge = getSupervisorBadge(supervisorCapable, supervisor);

  return (
    <aside
      aria-label="Supervisos"
      className={cn(
        "h-full min-h-0 w-72 shrink-0 border-l bg-background/95 xl:w-80",
        isOpen ? "hidden md:block" : "hidden"
      )}
      id="supervisos-panel"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <div className="min-w-0">
            <div className="font-medium text-sm leading-none">Supervisos</div>
          </div>
          <Button
            aria-label="Close Supervisos"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="px-3 py-3">
          <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-xs">
            <Bot className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="font-medium text-foreground">
                Project Supervisor
              </div>
              <div className="truncate text-muted-foreground">
                {formatSupervisorDetail(supervisorCapable, supervisor)}
              </div>
            </div>
            <Badge variant={supervisorBadge.variant}>
              {supervisorBadge.label}
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

        <SupervisosSideChat
          chatId={chatId}
          disabled={!supervisorCapable || isSupervisosChatDisabled}
          goalModeAudit={goalModeAudit}
          isSettingSupervisorMode={isSettingSupervisorMode}
          onEnableAutopilot={() => onSetSupervisorMode("full_autopilot")}
          onStageMainPrompt={onStageSupervisosPrompt}
          supervisor={supervisor}
        />

        <SupervisosRuns chatId={chatId} />

        <GoalModeDecisionLog entries={goalModeAudit} />

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

function GoalModeDecisionLog({ entries }: { entries: GoalModeAuditEntry[] }) {
  const recentEntries = entries.slice(0, 3);
  return (
    <div className="border-t px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">
            Goal Mode
          </span>
        </div>
        <Badge variant="outline">{entries.length}</Badge>
      </div>
      {recentEntries.length === 0 ? (
        <div className="rounded border border-dashed px-2 py-1.5 text-muted-foreground text-xs">
          No goal decisions
        </div>
      ) : (
        <div className="grid gap-2">
          {recentEntries.map((entry, index) => (
            <GoalModeDecisionRow
              entry={entry}
              key={`${entry.goalId}:${entry.phaseId}:${entry.attemptId ?? index}:${entry.kind}:${entry.occurredAt}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GoalModeDecisionRow({ entry }: { entry: GoalModeAuditEntry }) {
  const gateLabel = entry.gate?.decision ?? entry.kind;
  const gateTone =
    entry.gate?.decision === "needs_user" ? "destructive" : "secondary";
  const resolver = entry.scopeResolution?.resolverVersion;
  const verification =
    entry.verification?.exitCode === undefined
      ? null
      : `${entry.verification.command}: ${entry.verification.exitCode ?? "no exit"}`;
  const fileCounts = [
    entry.filesTouched ? `${entry.filesTouched.length} touched` : null,
    entry.filesCreated ? `${entry.filesCreated.length} created` : null,
    entry.filesDeleted ? `${entry.filesDeleted.length} deleted` : null,
  ].filter(Boolean);
  const detail =
    entry.gate?.reasons.join(", ") ||
    entry.decisionReason ||
    entry.outcomeSummary?.keyDecision ||
    verification ||
    resolver ||
    "recorded";
  return (
    <div className="min-w-0 rounded border px-2 py-2 text-xs">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-foreground">
          {entry.phaseId}
        </span>
        <Badge variant={gateTone}>{gateLabel}</Badge>
      </div>
      <div className="truncate text-muted-foreground" title={detail}>
        {detail}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
        {resolver ? <span>{resolver}</span> : null}
        {entry.scopeResolution ? (
          <span>{entry.scopeResolution.diagnostics.symbolExtractionMode}</span>
        ) : null}
        {fileCounts.length > 0 ? <span>{fileCounts.join(" / ")}</span> : null}
      </div>
      {entry.scopeResolution?.primaryTarget.path ? (
        <div
          className="mt-1 truncate text-muted-foreground"
          title={entry.scopeResolution.primaryTarget.path}
        >
          {entry.scopeResolution.primaryTarget.path}
        </div>
      ) : null}
    </div>
  );
}

function getSupervisorBadge(
  supervisorCapable: boolean,
  supervisor: SupervisorSessionState | null
): { label: string; variant: "secondary" | "outline" | "destructive" } {
  if (!supervisorCapable) {
    return { label: "Off", variant: "outline" };
  }
  if (!supervisor || supervisor.mode === "off") {
    return { label: "Session off", variant: "outline" };
  }
  if (supervisor.status === "error") {
    return { label: "Error", variant: "destructive" };
  }
  return { label: "Active", variant: "secondary" };
}

function formatSupervisorDetail(
  supervisorCapable: boolean,
  supervisor: SupervisorSessionState | null
) {
  if (!supervisorCapable) {
    return "Disabled by runtime policy";
  }
  if (!supervisor || supervisor.mode === "off") {
    return "Configured; enable autopilot for this session";
  }
  if (supervisor.reason) {
    return supervisor.reason;
  }
  return `Status: ${supervisor.status}`;
}
