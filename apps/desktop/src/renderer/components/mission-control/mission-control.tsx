import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitCommit,
  Network,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";

const RUN_LIST_INPUT = { includeTerminal: true } as const;

export function MissionControl() {
  const utils = trpc.useUtils();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = projects.find((item) => item.id === activeProjectId);
  const runsQuery = trpc.supervisorRuns.list.useQuery(RUN_LIST_INPUT, {
    refetchOnWindowFocus: false,
  });
  const profilesQuery = trpc.supervisorRuns.profiles.list.useQuery(
    activeProjectId ? { projectId: activeProjectId } : undefined
  );
  const telegramStatus = trpc.supervisorRuns.telegram.status.useQuery();
  trpc.supervisorRuns.updates.useSubscription(undefined, {
    onData(update) {
      utils.supervisorRuns.list.setData(RUN_LIST_INPUT, (current) => [
        update,
        ...(current ?? []).filter((item) => item.runId !== update.runId),
      ]);
    },
  });
  const invalidate = () => utils.supervisorRuns.list.invalidate();
  const approve = trpc.supervisorRuns.approvePlan.useMutation({
    onSuccess: invalidate,
  });
  const requestChanges = trpc.supervisorRuns.requestPlanChanges.useMutation({
    onSuccess: invalidate,
  });
  const answerDecision = trpc.supervisorRuns.answerDecision.useMutation({
    onSuccess: invalidate,
  });
  const setPriority = trpc.supervisorRuns.setPriority.useMutation({
    onSuccess: invalidate,
  });
  const testResume = trpc.supervisorRuns.profiles.testResume.useMutation({
    onSuccess: () => utils.supervisorRuns.profiles.list.invalidate(),
  });
  const configureTelegram = trpc.supervisorRuns.telegram.configure.useMutation({
    onSuccess: () => utils.supervisorRuns.telegram.status.invalidate(),
  });
  const beginTelegramPairing =
    trpc.supervisorRuns.telegram.beginPairing.useMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramTimezone, setTelegramTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const runs = runsQuery.data ?? [];
  const stats = useMemo(
    () => ({
      approvals: runs.filter((run) => run.status === "awaiting_approval")
        .length,
      capacity: runs.filter((run) => run.status === "waiting_capacity").length,
      decisions: runs.reduce(
        (count, run) =>
          count +
          run.decisions.filter((decision) => decision.status === "open").length,
        0
      ),
      active: runs.filter((run) =>
        ["planning", "queued", "running", "completing"].includes(run.status)
      ).length,
    }),
    [runs]
  );

  const pending =
    approve.isPending ||
    requestChanges.isPending ||
    answerDecision.isPending ||
    setPriority.isPending;
  let telegramStatusLabel = "not configured";
  if (telegramStatus.data?.configured) {
    telegramStatusLabel = "configured";
  }
  if (telegramStatus.data?.paired) {
    telegramStatusLabel = "paired";
  }

  const approveRunPlan = (run: SupervisorRunClientUpdate) => {
    if (!run.plan) {
      return;
    }
    approve.mutate({
      runId: run.runId,
      planVersion: run.plan.version,
      planHash: run.plan.hash,
      expectedRevision: run.revision,
    });
  };

  return (
    <main className="min-h-dvh bg-background p-6">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header>
          <div className="flex items-center gap-2">
            <Network className="size-5" />
            <h1 className="font-semibold text-xl">Mission Control</h1>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            Global goals, approvals, capacity, decisions, evidence, and
            delivery.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Awaiting approval" value={stats.approvals} />
          <Stat label="Waiting capacity" value={stats.capacity} />
          <Stat label="Open decisions" value={stats.decisions} />
          <Stat label="Active goals" value={stats.active} />
        </section>

        <RuntimeDaemonControl />

        <section className="grid gap-3">
          <div>
            <h2 className="font-medium">Telegram control</h2>
            <p className="text-muted-foreground text-xs">
              Outbound long polling only. Bot tokens are encrypted by the
              runtime and are never returned to the renderer.
            </p>
          </div>
          <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[2fr_1fr_auto]">
            <Input
              autoComplete="off"
              onChange={(event) => setTelegramToken(event.target.value)}
              placeholder="Telegram bot token"
              type="password"
              value={telegramToken}
            />
            <Input
              onChange={(event) => setTelegramTimezone(event.target.value)}
              placeholder="Timezone"
              value={telegramTimezone}
            />
            <Button
              disabled={
                configureTelegram.isPending || telegramToken.trim().length < 20
              }
              onClick={() =>
                configureTelegram.mutate({
                  botToken: telegramToken.trim(),
                  timezone: telegramTimezone.trim(),
                })
              }
              size="sm"
            >
              Save encrypted
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
            <Badge
              variant={telegramStatus.data?.paired ? "secondary" : "outline"}
            >
              {telegramStatusLabel}
            </Badge>
            <Button
              disabled={
                !telegramStatus.data?.configured ||
                beginTelegramPairing.isPending
              }
              onClick={() => beginTelegramPairing.mutate()}
              size="sm"
              variant="outline"
            >
              Create one-time code
            </Button>
            {beginTelegramPairing.data ? (
              <span className="font-mono">
                {beginTelegramPairing.data.code} · expires{" "}
                {new Date(
                  beginTelegramPairing.data.expiresAt
                ).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="font-medium">Goals</h2>
          {runs.map((run) => (
            <article className="rounded-xl border bg-card p-4" key={run.runId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{run.runId}</div>
                  <div className="mt-1 text-muted-foreground text-xs">
                    {run.tasks.length} tasks · plan v{run.plan?.version ?? "—"}{" "}
                    · revision {run.revision}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Priority for ${run.runId}`}
                    className="h-7 rounded-md border bg-background px-2 text-xs"
                    disabled={pending}
                    onChange={(event) =>
                      setPriority.mutate({
                        runId: run.runId,
                        priority: event.target
                          .value as SupervisorRunClientUpdate["priority"],
                        expectedRevision: run.revision,
                      })
                    }
                    value={run.priority}
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  <Badge
                    variant={
                      run.status === "needs_user" ? "destructive" : "outline"
                    }
                  >
                    {run.status.replaceAll("_", " ")}
                  </Badge>
                </div>
              </div>

              {run.plan ? (
                <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs">
                  <div className="font-medium">{run.plan.summary}</div>
                  <div className="mt-1 text-muted-foreground">
                    {run.plan.envelope.fileScopes.length} file scopes ·{" "}
                    {run.plan.envelope.verificationCommands.length} checks ·{" "}
                    {run.plan.hash.slice(0, 12)}
                  </div>
                  {run.status === "awaiting_approval" ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                      <Button
                        disabled={pending}
                        onClick={() => approveRunPlan(run)}
                        size="sm"
                      >
                        Approve exact plan
                      </Button>
                      <Input
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [`plan:${run.runId}`]: event.target.value,
                          }))
                        }
                        placeholder="Request bounded plan changes"
                        value={drafts[`plan:${run.runId}`] ?? ""}
                      />
                      <Button
                        disabled={
                          pending || !(drafts[`plan:${run.runId}`] ?? "").trim()
                        }
                        onClick={() =>
                          requestChanges.mutate({
                            runId: run.runId,
                            requestedChanges: (
                              drafts[`plan:${run.runId}`] ?? ""
                            ).trim(),
                            expectedRevision: run.revision,
                          })
                        }
                        size="sm"
                        variant="outline"
                      >
                        Request changes
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {run.capacityWaits.length > 0 ? (
                <div className="mt-3 grid gap-1 text-xs">
                  {run.capacityWaits.map((wait) => (
                    <div className="flex items-center gap-2" key={wait.waitId}>
                      <Clock3 className="size-3.5" />
                      {wait.agentId} · {wait.kind} · retry{" "}
                      {new Date(wait.retryAt).toLocaleString()}
                    </div>
                  ))}
                </div>
              ) : null}

              {run.decisions
                .filter((decision) => decision.status === "open")
                .map((decision) => (
                  <div
                    className="mt-3 rounded-lg border border-amber-500/30 p-3"
                    key={decision.decisionId}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <AlertTriangle className="size-3.5 text-amber-500" />
                      {decision.prompt}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [decision.decisionId]: event.target.value,
                          }))
                        }
                        placeholder="Answer this exception"
                        value={drafts[decision.decisionId] ?? ""}
                      />
                      <Button
                        disabled={
                          pending || !(drafts[decision.decisionId] ?? "").trim()
                        }
                        onClick={() =>
                          answerDecision.mutate({
                            runId: run.runId,
                            decisionId: decision.decisionId,
                            answer: (drafts[decision.decisionId] ?? "").trim(),
                            expectedRevision: run.revision,
                          })
                        }
                        size="sm"
                      >
                        Answer
                      </Button>
                    </div>
                  </div>
                ))}

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {run.tasks.map((task) => (
                  <div
                    className="rounded-lg border p-3 text-xs"
                    key={task.taskId}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{task.title}</span>
                      <span className="text-muted-foreground">
                        {task.status}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {task.role} · {task.dependencies.length} dependencies ·{" "}
                      {task.attempts.length} attempts
                    </div>
                  </div>
                ))}
              </div>

              {run.finalCommitSha ? (
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <GitCommit className="size-3.5" /> Final commit{" "}
                  {run.finalCommitSha}
                </div>
              ) : null}
              {!run.finalCommitSha && run.status === "completed" ? (
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <CheckCircle2 className="size-3.5" /> Deterministic
                  verification complete
                </div>
              ) : null}
            </article>
          ))}
        </section>

        <section className="grid gap-3">
          <h2 className="font-medium">Agent capacity & readiness</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(profilesQuery.data ?? []).map((profile) => (
              <article
                className="rounded-xl border bg-card p-4"
                key={profile.agentId}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{profile.agentId}</span>
                  <Badge variant={profile.enabled ? "secondary" : "outline"}>
                    {profile.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
                <div className="mt-2 text-muted-foreground text-xs">
                  {profile.roles.join(", ")} · max{" "}
                  {profile.maxConcurrentSessions}
                </div>
                <div className="mt-1 text-xs">
                  Handshake {profile.readiness.handshake} · exact resume{" "}
                  {profile.readiness.exactResume}
                </div>
                <Button
                  className="mt-3"
                  disabled={!activeProject || testResume.isPending}
                  onClick={() =>
                    activeProject &&
                    testResume.mutate({
                      agentId: profile.agentId,
                      projectId: activeProject.id,
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  Test exact resume
                </Button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-semibold text-2xl">{value}</div>
    </div>
  );
}

interface RuntimeDaemonStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  endpoint?: string;
  message: string;
}

function RuntimeDaemonControl() {
  const [status, setStatus] = useState<RuntimeDaemonStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const bridge = window.eragearDesktop?.runtimeDaemon;
    if (!bridge) {
      return;
    }
    setStatus(toRuntimeDaemonStatus(await bridge.status()));
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const invoke = async (action: "install" | "start" | "stop") => {
    const bridge = window.eragearDesktop?.runtimeDaemon;
    if (!bridge) {
      return;
    }
    setBusy(true);
    try {
      setStatus(toRuntimeDaemonStatus(await bridge[action]()));
    } finally {
      setBusy(false);
    }
  };

  if (!window.eragearDesktop?.runtimeDaemon) {
    return null;
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-medium text-sm">User runtime daemon</h2>
        <p className="text-muted-foreground text-xs">
          {status?.message ?? "Checking daemon status…"}
          {status?.endpoint ? ` ${status.endpoint}` : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy || !status?.supported || status.installed}
          onClick={() => invoke("install")}
          size="sm"
          variant="outline"
        >
          Install
        </Button>
        <Button
          disabled={busy || !status?.supported || status.running}
          onClick={() => invoke("start")}
          size="sm"
          variant="outline"
        >
          Start
        </Button>
        <Button
          disabled={busy || !status?.running}
          onClick={() => invoke("stop")}
          size="sm"
          variant="outline"
        >
          Stop
        </Button>
      </div>
    </section>
  );
}

function toRuntimeDaemonStatus(value: unknown): RuntimeDaemonStatus {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid runtime daemon status");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.supported !== "boolean" ||
    typeof candidate.installed !== "boolean" ||
    typeof candidate.running !== "boolean" ||
    typeof candidate.message !== "string"
  ) {
    throw new Error("Invalid runtime daemon status");
  }
  return {
    supported: candidate.supported,
    installed: candidate.installed,
    running: candidate.running,
    message: candidate.message,
    ...(typeof candidate.endpoint === "string"
      ? { endpoint: candidate.endpoint }
      : {}),
  };
}
