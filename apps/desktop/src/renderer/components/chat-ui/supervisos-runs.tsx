import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Loader2,
  Network,
  RotateCcw,
  Square,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupervisorRuns } from "@/hooks/use-supervisor-runs";

type RunsController = ReturnType<typeof useSupervisorRuns>;

export function SupervisosRuns({ chatId }: { chatId: string }) {
  const controller = useSupervisorRuns(chatId);
  const navigate = useNavigate();
  return (
    <SupervisosRunsView
      {...controller}
      onOpenWorker={(workerChatId) =>
        navigate({
          to: "/",
          search: { chatId: workerChatId },
        })
      }
    />
  );
}

export function SupervisosRunsView(
  props: RunsController & { onOpenWorker: (chatId: string) => void }
) {
  const [intent, setIntent] = useState("");
  const submit = async () => {
    const value = intent.trim();
    if (!value) {
      return;
    }
    await props.start(value);
    setIntent("");
  };
  return (
    <section aria-label="Supervised runs" className="border-t px-3 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Network className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-medium text-xs leading-tight">Runs</h2>
            <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
              Parallel workers with dependency gates.
            </p>
          </div>
        </div>
        <Badge variant="outline">{props.runs.length}</Badge>
      </div>

      {props.error ? (
        <div className="mb-2 flex gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-destructive text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="leading-relaxed">{props.error}</span>
        </div>
      ) : null}

      <div className="mb-3 flex gap-1.5">
        <Input
          aria-label="Supervised run objective"
          disabled={!props.canStart || props.isPending}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit().catch(() => undefined);
            }
          }}
          placeholder={
            props.canStart
              ? "Describe a multi-worker run"
              : "Select a project first"
          }
          value={intent}
        />
        <Button
          aria-label="Start supervised run"
          disabled={!props.canStart || props.isPending || !intent.trim()}
          onClick={() => {
            return submit().catch(() => undefined);
          }}
          size="sm"
          type="button"
        >
          {props.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            "Start"
          )}
        </Button>
      </div>

      {props.isLoading ? (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Loading runs
        </div>
      ) : null}
      {!props.isLoading && props.runs.length === 0 ? (
        <div className="rounded-md bg-muted/60 px-3 py-3 text-center">
          <Network className="mx-auto size-4 text-muted-foreground" />
          <p className="mt-1.5 font-medium text-xs">No supervised run yet</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            Start with a bounded objective; Supervisos will plan the worker
            graph.
          </p>
        </div>
      ) : null}
      <div className="grid max-h-72 gap-2 overflow-y-auto">
        {props.runs.slice(0, 3).map((run) => (
          <RunCard controller={props} key={run.runId} run={run} />
        ))}
      </div>
    </section>
  );
}

function RunCard({
  run,
  controller,
}: {
  run: SupervisorRunClientUpdate;
  controller: RunsController & { onOpenWorker: (chatId: string) => void };
}) {
  const tone = getRunStatusTone(run.status);
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
  return (
    <article className="rounded-md bg-muted/50 px-2.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-xs" title={run.runId}>
            {run.runId}
          </div>
          <div className="mt-0.5 text-muted-foreground text-xs">
            {run.tasks.length} tasks · revision {run.revision}
          </div>
        </div>
        <Badge variant={tone.variant}>{tone.label}</Badge>
      </div>

      <div className="mt-2 grid gap-1.5">
        {run.tasks.map((task) => (
          <div
            className="rounded-sm bg-background/70 px-2 py-1.5"
            key={task.taskId}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-xs">{task.title}</div>
                <div className="mt-0.5 text-muted-foreground text-xs">
                  {task.role} · {task.executionMode.replace("_", "-")}
                  {task.dependencies.length > 0
                    ? ` · waits for ${task.dependencies.length}`
                    : ""}
                  {task.preferredModelId ? ` · ${task.preferredModelId}` : ""}
                </div>
              </div>
              <span className="shrink-0 text-muted-foreground text-xs">
                {task.status}
              </span>
            </div>
            {task.attempts.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {task.attempts.map((attempt) => (
                  <Button
                    aria-label={`Open worker ${attempt.chatId}`}
                    className="h-6 gap-1 px-1.5 text-xs"
                    key={attempt.attemptId}
                    onClick={() => controller.onOpenWorker(attempt.chatId)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <ExternalLink className="size-3 text-muted-foreground" />
                    {attempt.agentId}
                  </Button>
                ))}
              </div>
            ) : null}
            {(task.status === "failed" || task.status === "needs_user") &&
            (!run.limits ||
              task.attempts.length < run.limits.maxAttemptsPerTask) ? (
              <Button
                className="mt-1.5 h-6 gap-1 px-1.5 text-xs"
                disabled={controller.isPending}
                onClick={() => {
                  return controller
                    .retryTask(run.runId, task.taskId)
                    .catch(() => undefined);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcw className="size-3" /> Retry
              </Button>
            ) : null}
            {(task.status === "failed" || task.status === "needs_user") &&
            run.limits &&
            task.attempts.length >= run.limits.maxAttemptsPerTask ? (
              <div className="mt-1.5 text-muted-foreground text-xs">
                Attempt budget exhausted · replan required
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {run.gates
        .filter((gate) => gate.status === "pending")
        .map((gate) => (
          <div
            className="mt-2 rounded-sm bg-background/70 px-2 py-2"
            key={gate.gateId}
          >
            <div className="text-xs">
              Gate: {gate.kind.replaceAll("_", " ")}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Button
                disabled={controller.isPending || !isApprovableGate(gate.kind)}
                onClick={() => {
                  return controller
                    .approveGate(run.runId, gate.gateId)
                    .catch(() => undefined);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Approve
              </Button>
              <Button
                disabled={controller.isPending}
                onClick={() => {
                  return controller
                    .rejectGate(run.runId, gate.gateId)
                    .catch(() => undefined);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Reject
              </Button>
            </div>
          </div>
        ))}

      {run.status === "completed" ? (
        <div className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs">
          <CheckCircle2 className="size-3.5" /> Aggregate verification complete
        </div>
      ) : null}
      {run.status === "awaiting_approval" && run.plan ? (
        <div className="mt-2 rounded-sm border bg-background/70 px-2 py-2">
          <div className="text-xs">Plan v{run.plan.version}</div>
          <div className="mt-0.5 truncate text-muted-foreground text-xs">
            {run.plan.summary}
          </div>
          <Button
            className="mt-2 h-7"
            disabled={controller.isPending}
            onClick={() => {
              return controller.approvePlan(run).catch(() => undefined);
            }}
            size="sm"
            type="button"
          >
            Approve exact plan
          </Button>
        </div>
      ) : null}
      {terminal ? null : (
        <div className="mt-2 flex flex-wrap gap-1">
          {run.status === "paused" ? (
            <ActionButton
              icon={CirclePlay}
              label="Resume"
              onClick={() => controller.resume(run.runId)}
            />
          ) : null}
          {run.status === "running" || run.status === "queued" ? (
            <ActionButton
              icon={CirclePause}
              label="Pause"
              onClick={() => controller.pause(run.runId)}
            />
          ) : null}
          {run.status === "needs_user" ? (
            <ActionButton
              icon={RotateCcw}
              label="Replan"
              onClick={() => controller.replan(run.runId)}
            />
          ) : null}
          <ActionButton
            icon={Square}
            label="Cancel"
            onClick={() => controller.cancel(run.runId)}
          />
        </div>
      )}
    </article>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof CirclePause;
  label: string;
  onClick: () => Promise<unknown>;
}) {
  return (
    <Button
      className="h-6 gap-1 px-1.5 text-xs"
      onClick={() => {
        return onClick().catch(() => undefined);
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon className="size-3 text-muted-foreground" /> {label}
    </Button>
  );
}

export function isApprovableGate(
  kind: SupervisorRunClientUpdate["gates"][number]["kind"]
): boolean {
  return (
    kind === "scope" || kind === "deletion" || kind === "destructive_action"
  );
}

export function getRunStatusTone(status: SupervisorRunClientUpdate["status"]): {
  label: string;
  variant: "secondary" | "outline" | "destructive";
} {
  if (status === "failed" || status === "needs_user") {
    return {
      label: status === "needs_user" ? "Needs user" : "Failed",
      variant: "destructive",
    };
  }
  if (status === "completed") {
    return { label: "Completed", variant: "secondary" };
  }
  return { label: status.replaceAll("_", " "), variant: "outline" };
}
