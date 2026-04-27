"use client";

import type {
  SupervisorDecisionSummary,
  SupervisorMode,
  SupervisorStatus,
} from "@repo/shared";
import { memo, useCallback, useState } from "react";
import { BotIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SupervisorControlProps {
  mode: SupervisorMode;
  status: SupervisorStatus;
  reason: string | null;
  isPending: boolean;
  lastDecision: SupervisorDecisionSummary | null;
  onSetMode: (mode: SupervisorMode) => Promise<void>;
}

const STATUS_LABELS: Record<SupervisorStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  reviewing: "Reviewing",
  continuing: "Continuing",
  done: "Done",
  needs_user: "Needs user input",
  aborted: "Aborted",
  error: "Error",
  disabled: "Disabled",
};

function SupervisorStatusBadge({ status }: { status: SupervisorStatus }) {
  const isActive =
    status === "reviewing" ||
    status === "continuing" ||
    status === "queued";
  const isError = status === "error" || status === "aborted";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isActive
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : isError
            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {isActive && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

export const SupervisorControl = memo(function SupervisorControl({
  mode,
  status,
  reason,
  isPending,
  lastDecision,
  onSetMode,
}: SupervisorControlProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const isAutopilot = mode === "full_autopilot";
  const isActive =
    status === "reviewing" ||
    status === "continuing" ||
    status === "queued";

  const handleEnableAutopilot = useCallback(async () => {
    try {
      await onSetMode("full_autopilot");
    } catch {
      // Error is handled upstream by the mutation handler
    }
  }, [onSetMode]);

  const handleDisableAutopilot = useCallback(async () => {
    try {
      await onSetMode("off");
      setDialogOpen(false);
    } catch {
      // Error is handled upstream
    }
  }, [onSetMode]);

  return (
    <>
      <Button
        className="h-8 gap-1.5 px-2 py-0"
        onClick={() => setDialogOpen(true)}
        size="sm"
        variant={isAutopilot ? "default" : "outline"}
        type="button"
      >
        {isAutopilot ? (
          <BotIcon className="size-3.5" />
        ) : (
          <ShieldCheckIcon className="size-3.5" />
        )}
        <span className="text-xs">
          {isAutopilot ? "Autopilot" : "Supervisor"}
        </span>
        {isActive && (
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
        )}
      </Button>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BotIcon className="size-5" />
              Supervisor Configuration
            </DialogTitle>
            <DialogDescription>
              Configure the supervisor mode for this session. The supervisor
              monitors agent actions and can auto-resolve permissions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Current status */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Current Status</p>
                <p className="text-muted-foreground text-xs">
                  Mode: {isAutopilot ? "Full Autopilot" : "Off"}
                </p>
              </div>
              <SupervisorStatusBadge status={status} />
            </div>

            {/* Error reason */}
            {status === "error" && reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                <p className="mb-1 text-sm font-medium text-red-800 dark:text-red-300">
                  Error Reason
                </p>
                <p className="text-muted-foreground text-xs">{reason}</p>
              </div>
            )}

            {/* Last decision */}
            {lastDecision && (
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-sm font-medium">Last Decision</p>
                <div className="space-y-1">
                  <p className="text-xs">
                    <span className="font-medium">Action:</span>{" "}
                    {lastDecision.action}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {lastDecision.reason}
                  </p>
                  {lastDecision.followUpPrompt && (
                    <p className="text-muted-foreground text-xs italic">
                      Follow-up: {lastDecision.followUpPrompt}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Full Autopilot warning */}
            {!isAutopilot && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="flex items-start gap-2">
                  <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Full Autopilot Warning
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Enabling Full Autopilot will allow the supervisor to
                      automatically approve all tool permissions without asking
                      you. This means the agent can execute commands, modify
                      files, and take actions without manual confirmation. Use
                      with caution.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {isAutopilot ? (
              <Button
                disabled={isPending}
                onClick={handleDisableAutopilot}
                type="button"
                variant="outline"
              >
                {isPending ? "Disabling..." : "Disable Autopilot"}
              </Button>
            ) : (
              <Button
                disabled={isPending}
                onClick={handleEnableAutopilot}
                type="button"
              >
                {isPending ? "Enabling..." : "Enable Full Autopilot"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
