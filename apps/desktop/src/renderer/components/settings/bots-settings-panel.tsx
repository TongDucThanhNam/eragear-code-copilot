"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  History,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type BotDefinition = RouterOutput["bots"]["list"]["bots"][number];
type BotRun = RouterOutput["bots"]["list"]["runs"][number];
type QuotaProvider = RouterOutput["quota"]["list"]["providers"][number];
type SessionSummary = RouterOutput["getSessions"][number];
type BotTrigger =
  | "manual"
  | "quota_refresh"
  | "repository_change"
  | "scheduled"
  | "remote_control";
type BotExecutionTarget = "new_session" | "existing_session" | "queue_only";
type BotWorkMode = "adaptive_session" | "supervisor_run";
type BotPromptStrategy = "supervisor_dynamic" | "fixed";

interface BotFormState {
  id?: string;
  name: string;
  description: string;
  objective: string;
  prompt: string;
  workMode: BotWorkMode;
  promptStrategy: BotPromptStrategy;
  providerId: string;
  windowIds: string[];
  quotaMinPercentRemaining: string;
  quotaMinRemaining: string;
  quotaCooldownMs: string;
  enabled: boolean;
  trigger: BotTrigger;
  agentId: string;
  projectId: string;
  modelId: string;
  maxConcurrency: string;
  executionTarget: BotExecutionTarget;
  executionChatId: string;
}

const EMPTY_FORM: BotFormState = {
  name: "",
  description: "",
  objective: "",
  prompt: "",
  workMode: "adaptive_session",
  promptStrategy: "supervisor_dynamic",
  providerId: "",
  windowIds: [],
  quotaMinPercentRemaining: "20",
  quotaMinRemaining: "",
  quotaCooldownMs: "300000",
  enabled: true,
  trigger: "quota_refresh",
  agentId: "",
  projectId: "",
  modelId: "",
  maxConcurrency: "1",
  executionTarget: "new_session",
  executionChatId: "",
};

const TRIGGERS: BotTrigger[] = [
  "quota_refresh",
  "manual",
  "repository_change",
  "scheduled",
  "remote_control",
];
const LEADING_WORD_PATTERN = /^\w/;

export function BotsSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<BotFormState>(EMPTY_FORM);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [orchestrationTrigger, setOrchestrationTrigger] =
    useState<BotTrigger>("quota_refresh");
  const botsQuery = trpc.bots.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
  const quotaQuery = trpc.quota.list.useQuery(
    { includeUnavailable: true },
    {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    }
  );
  const projectsQuery = trpc.listProjects.useQuery();
  const agentsQuery = trpc.agents.list.useQuery(undefined);
  const sessionsQuery = trpc.getSessions.useQuery({ limit: 200 });

  trpc.bots.updates.useSubscription(undefined, {
    onData: () => utils.bots.list.invalidate(),
  });

  const upsertBot = trpc.bots.upsert.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      setIsEditorOpen(false);
      setForm(EMPTY_FORM);
      toast.success(
        form.id ? "Scheduled task updated" : "Scheduled task added"
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save scheduled task");
    },
  });
  const deleteBot = trpc.bots.delete.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      toast.success("Scheduled task deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete scheduled task");
    },
  });
  const setEnabled = trpc.bots.setEnabled.useMutation({
    onSuccess: async (bot) => {
      await utils.bots.list.invalidate();
      toast.success(
        bot.enabled ? "Scheduled task enabled" : "Scheduled task disabled"
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to change scheduled task");
    },
  });
  const runNow = trpc.bots.runNowIfEligible.useMutation({
    onSuccess: async (run) => {
      await utils.bots.list.invalidate();
      toast.success(
        run.status === "quota_blocked"
          ? "Task queued until quota is eligible"
          : "Scheduled task dispatched"
      );
    },
    onError: (error) => {
      toast.error(error.message || "Scheduled task is not eligible");
    },
  });
  const stopRun = trpc.bots.stopRun.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      toast.success("Scheduled task run stopped");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop scheduled task run");
    },
  });
  const retryRun = trpc.bots.retryRun.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      toast.success("Scheduled task queued for another eligibility check");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to retry scheduled task");
    },
  });
  const orchestrate = trpc.bots.orchestrate.useMutation({
    onSuccess: async (result) => {
      await utils.bots.list.invalidate();
      toast.success(
        `Started ${result.startedRuns.length}, skipped ${result.skippedBotIds.length}`
      );
    },
    onError: (error) => {
      toast.error(error.message || "Legacy Bot orchestration failed");
    },
  });

  const bots = botsQuery.data?.bots ?? [];
  const runs = botsQuery.data?.runs ?? [];
  const providerLeases = botsQuery.data?.providerLeases ?? [];
  const providers = quotaQuery.data?.providers ?? [];
  const projects = projectsQuery.data?.projects ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const sessions = sessionsQuery.data ?? [];
  const runsByBotId = useMemo(() => {
    const result = new Map<string, BotRun[]>();
    for (const run of runs) {
      const existing = result.get(run.botId) ?? [];
      existing.push(run);
      result.set(run.botId, existing);
    }
    for (const botRuns of result.values()) {
      botRuns.sort((left, right) => right.queuedAt - left.queuedAt);
    }
    return result;
  }, [runs]);
  const activeRuns = runs.filter(isActiveRun);
  const isBusy =
    upsertBot.isPending ||
    deleteBot.isPending ||
    setEnabled.isPending ||
    runNow.isPending ||
    stopRun.isPending ||
    retryRun.isPending ||
    orchestrate.isPending;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setIsEditorOpen(true);
  };
  const openEdit = (bot: BotDefinition) => {
    setForm(formFromBot(bot));
    setIsEditorOpen(true);
  };
  const refresh = async () => {
    await Promise.all([
      botsQuery.refetch(),
      quotaQuery.refetch(),
      projectsQuery.refetch(),
      agentsQuery.refetch(),
      sessionsQuery.refetch(),
    ]);
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = validateForm(form);
    if (error) {
      toast.error(error);
      return;
    }
    const maxConcurrency = Number(form.maxConcurrency);
    const quotaMinPercentRemaining = Number(form.quotaMinPercentRemaining);
    const quotaMinRemaining = form.quotaMinRemaining.trim()
      ? Number(form.quotaMinRemaining)
      : undefined;
    const quotaCooldownMs = Number(form.quotaCooldownMs);
    upsertBot.mutate({
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      description: form.description.trim(),
      objective: form.objective.trim(),
      prompt:
        form.promptStrategy === "fixed"
          ? form.prompt.trim()
          : form.prompt.trim() || undefined,
      workMode: form.workMode,
      promptStrategy: form.promptStrategy,
      providerId: form.providerId.trim() || undefined,
      enabled: form.enabled,
      trigger: form.trigger,
      agentId: form.agentId.trim() || undefined,
      projectId: form.projectId.trim() || undefined,
      modelId: form.modelId.trim() || undefined,
      maxConcurrency,
      execution: {
        target: form.executionTarget,
        ...(form.executionTarget === "existing_session"
          ? { chatId: form.executionChatId.trim() }
          : {}),
      },
      ...(form.providerId || form.trigger === "quota_refresh"
        ? {
            triggerConfig: {
              quota: {
                providerIds: form.providerId ? [form.providerId] : [],
                windowIds: form.windowIds,
                minPercentRemaining: quotaMinPercentRemaining,
                ...(quotaMinRemaining === undefined
                  ? {}
                  : { minRemaining: quotaMinRemaining }),
                cooldownMs: quotaCooldownMs,
              },
            },
          }
        : {}),
    });
  };

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={botsQuery.isFetching}
            onClick={() => refresh()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                botsQuery.isFetching ? "animate-spin" : ""
              )}
            />
            Refresh
          </Button>
          <Button disabled={isBusy} onClick={openCreate} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New task
          </Button>
        </div>
      }
      description="Run project objectives automatically when a provider subscription has enough fresh quota."
      icon={Bot}
      title="Scheduled Tasks"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{bots.length} tasks</Badge>
          <Badge variant="outline">
            {bots.filter((bot) => bot.enabled).length} enabled
          </Badge>
          <Badge variant="outline">{activeRuns.length} active</Badge>
          <Badge variant="outline">
            {providerLeases.length} provider leases
          </Badge>
        </div>

        <div className="flex flex-col gap-2 border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium text-xs">Legacy Bot orchestration</div>
            <p className="text-muted-foreground text-xs">
              Keep trigger-driven fixed Bots working during the Scheduled Tasks
              migration.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              onValueChange={(value) =>
                setOrchestrationTrigger(value as BotTrigger)
              }
              value={orchestrationTrigger}
            >
              <SelectTrigger aria-label="Legacy orchestration trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((trigger) => (
                  <SelectItem key={trigger} value={trigger}>
                    {formatLabel(trigger)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={isBusy}
              onClick={() =>
                orchestrate.mutate({
                  trigger: orchestrationTrigger,
                  context: { source: "settings" },
                })
              }
              size="sm"
              variant="outline"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Orchestrate
            </Button>
          </div>
        </div>

        {botsQuery.error ? (
          <InlineState
            icon={AlertCircle}
            message={botsQuery.error.message}
            title="Scheduled tasks could not be loaded"
            tone="destructive"
          />
        ) : null}

        <Tabs defaultValue="tasks">
          <TabsList variant="line">
            <TabsTrigger value="tasks">
              Tasks
              <span className="text-muted-foreground tabular-nums">
                {bots.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="history">
              Run history
              <span className="text-muted-foreground tabular-nums">
                {runs.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-2" value="tasks">
            {botsQuery.isLoading ? <TaskListSkeleton /> : null}
            {!(botsQuery.isLoading || botsQuery.error) && bots.length === 0 ? (
              <EmptyTasks onCreate={openCreate} />
            ) : null}
            <div className="grid gap-3 xl:grid-cols-2">
              {bots.map((bot) => (
                <TaskCard
                  bot={bot}
                  disabled={isBusy}
                  key={bot.id}
                  latestRun={runsByBotId.get(bot.id)?.[0]}
                  onDelete={() => deleteBot.mutate({ id: bot.id })}
                  onEdit={() => openEdit(bot)}
                  onRun={() => runNow.mutate({ botId: bot.id })}
                  onSetEnabled={(enabled) =>
                    setEnabled.mutate({ id: bot.id, enabled })
                  }
                  provider={providers.find(
                    (provider) => provider.providerId === bot.providerId
                  )}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent className="mt-2" value="history">
            {botsQuery.isLoading ? <RunListSkeleton /> : null}
            {!(botsQuery.isLoading || botsQuery.error) && runs.length === 0 ? (
              <InlineState
                icon={History}
                message="Runs appear here after a task passes quota admission or is deferred."
                title="No scheduled runs yet"
              />
            ) : null}
            <div className="grid gap-3">
              {runs.map((run) => (
                <RunRow
                  botName={bots.find((bot) => bot.id === run.botId)?.name}
                  disabled={isBusy}
                  key={run.id}
                  onRetry={() => retryRun.mutate({ runId: run.id })}
                  onStop={() => stopRun.mutate({ runId: run.id })}
                  run={run}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <TaskEditorDialog
        agents={agents}
        form={form}
        isBusy={isBusy}
        onFormChange={setForm}
        onOpenChange={(open) => {
          setIsEditorOpen(open);
          if (!open) {
            setForm(EMPTY_FORM);
          }
        }}
        onSubmit={handleSubmit}
        open={isEditorOpen}
        projects={projects}
        providers={providers}
        quotaError={quotaQuery.error?.message}
        sessions={sessions}
      />
    </SettingsSection>
  );
}

function TaskEditorDialog({
  form,
  agents,
  projects,
  providers,
  sessions,
  quotaError,
  open,
  isBusy,
  onFormChange,
  onOpenChange,
  onSubmit,
}: {
  form: BotFormState;
  agents: RouterOutput["agents"]["list"]["agents"];
  projects: RouterOutput["listProjects"]["projects"];
  providers: QuotaProvider[];
  sessions: SessionSummary[];
  quotaError?: string;
  open: boolean;
  isBusy: boolean;
  onFormChange: (form: BotFormState) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const selectedProvider = providers.find(
    (provider) => provider.providerId === form.providerId
  );
  const compatibleSessions = sessions.filter(
    (session) =>
      (!form.projectId || session.projectId === form.projectId) &&
      (!form.agentId || session.agentId === form.agentId)
  );
  const isLegacy =
    Boolean(form.id) && !form.providerId && form.promptStrategy === "fixed";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {form.id ? "Edit scheduled task" : "New scheduled task"}
          </DialogTitle>
          <DialogDescription>
            Bind one objective to a provider subscription. Quota is checked
            before new work and never interrupts an active ACP turn.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-5" onSubmit={onSubmit}>
          <div className="grid gap-3">
            <SectionHeading
              description="Name the durable intent that Supervisor should evaluate on every iteration."
              title="Objective"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="task-name" label="Name">
                <Input
                  id="task-name"
                  onChange={(event) =>
                    onFormChange({ ...form, name: event.target.value })
                  }
                  placeholder="Finish the desktop migration"
                  value={form.name}
                />
              </Field>
              <Field id="task-description" label="Description">
                <Input
                  id="task-description"
                  onChange={(event) =>
                    onFormChange({
                      ...form,
                      description: event.target.value,
                    })
                  }
                  placeholder="Optional note for this schedule"
                  value={form.description}
                />
              </Field>
            </div>
            <Field id="task-objective" label="Objective">
              <Textarea
                className="min-h-24"
                id="task-objective"
                onChange={(event) =>
                  onFormChange({ ...form, objective: event.target.value })
                }
                placeholder="Describe the outcome and evidence that proves it is complete."
                value={form.objective}
              />
            </Field>
          </div>

          <div className="grid gap-3 border-t pt-4">
            <SectionHeading
              description="Choose how Supervisor turns the objective into ACP work."
              title="Execution"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="task-work-mode" label="Work mode">
                <Select
                  onValueChange={(value) =>
                    onFormChange({
                      ...form,
                      workMode: value as BotWorkMode,
                    })
                  }
                  value={form.workMode}
                >
                  <SelectTrigger className="w-full" id="task-work-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adaptive_session">
                      Adaptive ACP session
                    </SelectItem>
                    <SelectItem value="supervisor_run">
                      Full Supervisor run
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field id="task-prompt-strategy" label="Prompt strategy">
                <Select
                  onValueChange={(value) =>
                    onFormChange({
                      ...form,
                      promptStrategy: value as BotPromptStrategy,
                    })
                  }
                  value={form.promptStrategy}
                >
                  <SelectTrigger className="w-full" id="task-prompt-strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supervisor_dynamic">
                      Supervisor dynamic
                    </SelectItem>
                    <SelectItem value="fixed">Fixed prompt</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {form.promptStrategy === "fixed" ? (
              <Field id="task-fixed-prompt" label="Fixed prompt">
                <Textarea
                  className="min-h-24"
                  id="task-fixed-prompt"
                  onChange={(event) =>
                    onFormChange({ ...form, prompt: event.target.value })
                  }
                  placeholder="Prompt sent for every eligible run."
                  value={form.prompt}
                />
              </Field>
            ) : null}
          </div>

          <div className="grid gap-3 border-t pt-4">
            <SectionHeading
              description="A fresh ready snapshot must satisfy every selected reserve window."
              title="Provider admission"
            />
            {quotaError ? (
              <p className="text-destructive text-xs">{quotaError}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="task-provider" label="Provider subscription">
                <Select
                  onValueChange={(providerId) =>
                    onFormChange({
                      ...form,
                      providerId,
                      windowIds: [],
                    })
                  }
                  value={form.providerId}
                >
                  <SelectTrigger className="w-full" id="task-provider">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem
                        key={provider.providerId}
                        value={provider.providerId}
                      >
                        {provider.displayName} · {formatLabel(provider.status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                hint="Optional absolute reserve in addition to the percentage."
                id="task-min-remaining"
                label="Minimum remaining"
              >
                <Input
                  id="task-min-remaining"
                  min={0}
                  onChange={(event) =>
                    onFormChange({
                      ...form,
                      quotaMinRemaining: event.target.value,
                    })
                  }
                  placeholder="Optional"
                  type="number"
                  value={form.quotaMinRemaining}
                />
              </Field>
            </div>
            <div className="grid gap-1.5">
              <Label>Quota windows</Label>
              {selectedProvider?.windows.length ? (
                <fieldset
                  className="flex flex-wrap gap-2"
                  id="task-quota-windows"
                >
                  <legend className="sr-only">Quota windows</legend>
                  {selectedProvider.windows.map((window) => {
                    const selected = form.windowIds.includes(window.id);
                    return (
                      <Button
                        aria-pressed={selected}
                        key={window.id}
                        onClick={() =>
                          onFormChange({
                            ...form,
                            windowIds: selected
                              ? form.windowIds.filter((id) => id !== window.id)
                              : [...form.windowIds, window.id],
                          })
                        }
                        size="sm"
                        type="button"
                        variant={selected ? "secondary" : "outline"}
                      >
                        {window.label}
                        {window.percentRemaining === undefined
                          ? ""
                          : ` · ${formatNumber(window.percentRemaining)}%`}
                      </Button>
                    );
                  })}
                </fieldset>
              ) : (
                <div
                  className="border border-dashed p-3 text-muted-foreground text-xs"
                  id="task-quota-windows"
                >
                  {form.providerId
                    ? "This provider has no available quota windows."
                    : "Select a provider to choose its quota windows."}
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="task-percent-reserve"
                label="Minimum percent remaining"
              >
                <Input
                  id="task-percent-reserve"
                  max={100}
                  min={0}
                  onChange={(event) =>
                    onFormChange({
                      ...form,
                      quotaMinPercentRemaining: event.target.value,
                    })
                  }
                  type="number"
                  value={form.quotaMinPercentRemaining}
                />
              </Field>
              <Field
                hint="Wait after a quota-window dispatch before another one."
                id="task-cooldown"
                label="Cooldown (ms)"
              >
                <Input
                  id="task-cooldown"
                  min={0}
                  onChange={(event) =>
                    onFormChange({
                      ...form,
                      quotaCooldownMs: event.target.value,
                    })
                  }
                  type="number"
                  value={form.quotaCooldownMs}
                />
              </Field>
            </div>
          </div>

          <div className="grid gap-3 border-t pt-4">
            <SectionHeading
              description="The runtime proves the selected agent, model, and provider are compatible before dispatch."
              title="ACP binding"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="task-project" label="Project">
                <Select
                  onValueChange={(projectId) =>
                    onFormChange({
                      ...form,
                      projectId,
                      executionChatId: "",
                    })
                  }
                  value={form.projectId}
                >
                  <SelectTrigger className="w-full" id="task-project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="task-agent" label="Agent">
                <Select
                  onValueChange={(agentId) =>
                    onFormChange({
                      ...form,
                      agentId,
                      executionChatId: "",
                    })
                  }
                  value={form.agentId}
                >
                  <SelectTrigger className="w-full" id="task-agent">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} · {agent.type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                hint="Optional provider model ID. Compatibility is verified at dispatch."
                id="task-model"
                label="Model"
              >
                <Input
                  id="task-model"
                  onChange={(event) =>
                    onFormChange({ ...form, modelId: event.target.value })
                  }
                  placeholder="Optional model ID"
                  value={form.modelId}
                />
              </Field>
              {form.workMode === "adaptive_session" ? (
                <Field id="task-session-policy" label="Session binding">
                  <Select
                    onValueChange={(target) =>
                      onFormChange({
                        ...form,
                        executionTarget: target as BotExecutionTarget,
                        executionChatId: "",
                      })
                    }
                    value={form.executionTarget}
                  >
                    <SelectTrigger className="w-full" id="task-session-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_session">
                        Create or replace session
                      </SelectItem>
                      <SelectItem value="existing_session">
                        Bind existing session
                      </SelectItem>
                      {isLegacy ? (
                        <SelectItem value="queue_only">
                          Queue only (legacy)
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>
            {form.workMode === "adaptive_session" &&
            form.executionTarget === "existing_session" ? (
              <Field id="task-session" label="Existing ACP session">
                <Select
                  onValueChange={(executionChatId) =>
                    onFormChange({ ...form, executionChatId })
                  }
                  value={form.executionChatId}
                >
                  <SelectTrigger className="w-full" id="task-session">
                    <SelectValue placeholder="Select a compatible session" />
                  </SelectTrigger>
                  <SelectContent>
                    {compatibleSessions.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.name || session.id} · {session.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="grid gap-3 border-t pt-4">
            <SectionHeading
              description="These fields preserve trigger-based Bots while the migration is active."
              title="Compatibility and limits"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="task-trigger" label="Trigger">
                <Select
                  onValueChange={(trigger) =>
                    onFormChange({
                      ...form,
                      trigger: trigger as BotTrigger,
                    })
                  }
                  value={form.trigger}
                >
                  <SelectTrigger className="w-full" id="task-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((trigger) => (
                      <SelectItem key={trigger} value={trigger}>
                        {formatLabel(trigger)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="task-concurrency" label="Task concurrency">
                <Input
                  id="task-concurrency"
                  max={10}
                  min={1}
                  onChange={(event) =>
                    onFormChange({
                      ...form,
                      maxConcurrency: event.target.value,
                    })
                  }
                  type="number"
                  value={form.maxConcurrency}
                />
              </Field>
              <label
                className="flex min-h-8 items-center justify-between gap-3 border bg-background px-3 py-2"
                htmlFor="task-enabled"
              >
                <span className="text-xs">Enabled</span>
                <Switch
                  checked={form.enabled}
                  id="task-enabled"
                  onCheckedChange={(enabled) =>
                    onFormChange({ ...form, enabled })
                  }
                />
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              disabled={isBusy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isBusy} type="submit">
              {form.id ? "Save changes" : "Add scheduled task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskCard({
  bot,
  latestRun,
  provider,
  disabled,
  onEdit,
  onDelete,
  onRun,
  onSetEnabled,
}: {
  bot: BotDefinition;
  latestRun?: BotRun;
  provider?: QuotaProvider;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  onSetEnabled: (enabled: boolean) => void;
}) {
  const status = bot.enabled ? (latestRun?.status ?? "queued") : "disabled";
  const active = latestRun ? isActiveRun(latestRun) : false;
  return (
    <article className="grid gap-3 border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{bot.name}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
            {bot.description || bot.objective}
          </p>
        </div>
        <Switch
          aria-label={`${bot.enabled ? "Disable" : "Enable"} ${bot.name}`}
          checked={bot.enabled}
          disabled={disabled}
          onCheckedChange={onSetEnabled}
        />
      </div>

      <div className="grid gap-1.5">
        <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Objective
        </div>
        <p className="line-clamp-3 text-xs/relaxed">{bot.objective}</p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <span>{formatLabel(bot.workMode)}</span>
        <span>{formatLabel(bot.promptStrategy)}</span>
        <span>
          {provider?.displayName ?? bot.providerId ?? "Legacy provider policy"}
        </span>
        {bot.triggerConfig?.quota?.windowIds.length ? (
          <span>{bot.triggerConfig.quota.windowIds.join(", ")}</span>
        ) : null}
        {bot.triggerConfig?.quota ? (
          <span className="tabular-nums">
            reserve ≥ {bot.triggerConfig.quota.minPercentRemaining}%
          </span>
        ) : null}
      </div>

      {latestRun?.admission && latestRun.admission.status !== "eligible" ? (
        <div className="border bg-muted/30 p-2 text-xs">
          <div className="font-medium">
            {formatLabel(latestRun.admission.status)}
          </div>
          {latestRun.admission.reason ? (
            <p className="mt-0.5 text-muted-foreground">
              {latestRun.admission.reason}
            </p>
          ) : null}
          {latestRun.admission.nextCheckAt ? (
            <p className="mt-0.5 text-muted-foreground">
              Next check {formatTimestamp(latestRun.admission.nextCheckAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap gap-1 text-muted-foreground text-xs">
          {bot.projectId ? <span>Project {shortId(bot.projectId)}</span> : null}
          {bot.agentId ? <span>· Agent {shortId(bot.agentId)}</span> : null}
          {bot.execution.chatId ? (
            <span>· Chat {shortId(bot.execution.chatId)}</span>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button
            disabled={disabled || !bot.enabled || active}
            onClick={onRun}
            size="sm"
            type="button"
            variant="outline"
          >
            <Play className="mr-2 h-4 w-4" />
            Run if eligible
          </Button>
          <Button
            disabled={disabled}
            onClick={onEdit}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Edit {bot.name}</span>
          </Button>
          <Button
            disabled={disabled || active}
            onClick={onDelete}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete {bot.name}</span>
          </Button>
        </div>
      </div>
    </article>
  );
}

function RunRow({
  run,
  botName,
  disabled,
  onStop,
  onRetry,
}: {
  run: BotRun;
  botName?: string;
  disabled: boolean;
  onStop: () => void;
  onRetry: () => void;
}) {
  const canStop = isActiveRun(run);
  const canRetry = ["failed", "stopped", "quota_blocked"].includes(run.status);
  const failure = run.failureReason ?? run.error;
  return (
    <article className="grid gap-3 border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">
              {botName ?? run.botId}
            </h3>
            <StatusBadge status={run.status} />
            {run.completionState === "objective_completed" ? (
              <Badge variant="secondary">Objective complete</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">
            Queued {formatTimestamp(run.queuedAt)}
            {run.nextAttemptAt
              ? ` · next check ${formatTimestamp(run.nextAttemptAt)}`
              : ""}
          </p>
        </div>
        <div className="flex gap-1">
          {canRetry ? (
            <Button
              disabled={disabled}
              onClick={onRetry}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          ) : null}
          {canStop ? (
            <Button
              disabled={disabled}
              onClick={onStop}
              size="sm"
              variant="outline"
            >
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      {run.decision ? (
        <div className="grid gap-1 border-primary/30 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-xs">
              Supervisor: {formatLabel(run.decision.action)}
            </span>
            <span className="text-muted-foreground text-xs">
              {formatTimestamp(run.decision.decidedAt)}
            </span>
          </div>
          <p className="text-xs/relaxed">{run.decision.rationale}</p>
          <p className="text-muted-foreground text-xs/relaxed">
            {run.decision.evidenceSummary}
          </p>
        </div>
      ) : null}

      {run.admission ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          <span>Admission: {formatLabel(run.admission.status)}</span>
          {run.admission.providerId ? (
            <span>{run.admission.providerId}</span>
          ) : null}
          {(run.admission.windowLabel ?? run.admission.windowId) ? (
            <span>
              {run.admission.windowLabel ?? run.admission.windowId}
              {run.admission.percentRemaining === undefined
                ? ""
                : ` · ${formatNumber(run.admission.percentRemaining)}% left`}
            </span>
          ) : null}
          {run.admission.reason ? <span>{run.admission.reason}</span> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        {run.chatId ? <span>Chat {shortId(run.chatId)}</span> : null}
        {run.turnId ? <span>Turn {shortId(run.turnId)}</span> : null}
        {run.agentSessionId ? (
          <span>ACP {shortId(run.agentSessionId)}</span>
        ) : null}
        {run.supervisorRunId ? (
          <span>Supervisor run {shortId(run.supervisorRunId)}</span>
        ) : null}
        {run.promptHash ? (
          <span>Prompt proof {run.promptHash.slice(0, 12)}</span>
        ) : null}
      </div>

      {failure ? (
        <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{failure}</span>
        </div>
      ) : null}
    </article>
  );
}

function EmptyTasks({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid justify-items-center gap-3 border border-dashed p-8 text-center">
      <div className="grid size-10 place-items-center bg-muted">
        <Clock3 className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h3 className="font-medium text-sm">No scheduled tasks yet</h3>
        <p className="mt-1 max-w-md text-muted-foreground text-xs/relaxed">
          Create an objective, bind it to one provider subscription, and let
          Supervisor dispatch work when fresh quota clears the reserve.
        </p>
      </div>
      <Button onClick={onCreate} size="sm">
        <Plus className="mr-2 h-4 w-4" />
        New task
      </Button>
    </div>
  );
}

function InlineState({
  icon: Icon,
  title,
  message,
  tone = "muted",
}: {
  icon: typeof History;
  title: string;
  message: string;
  tone?: "muted" | "destructive";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border border-dashed p-5",
        tone === "destructive"
          ? "border-destructive/40 bg-destructive/5"
          : "bg-muted/20"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "destructive" ? "text-destructive" : "text-muted-foreground"
        )}
      />
      <div>
        <div className="font-medium text-sm">{title}</div>
        <p className="mt-1 text-muted-foreground text-xs/relaxed">{message}</p>
      </div>
    </div>
  );
}

function TaskListSkeleton() {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {[0, 1].map((index) => (
        <div className="grid gap-3 border p-4" key={index}>
          <div className="flex justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-9" />
          </div>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function RunListSkeleton() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((index) => (
        <div className="grid gap-3 border p-4" key={index}>
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  let variant: "destructive" | "secondary" | "outline" = "outline";
  let Icon = Clock3;
  if (status === "failed") {
    variant = "destructive";
    Icon = AlertCircle;
  } else if (status === "running") {
    variant = "secondary";
    Icon = Play;
  } else if (status === "completed") {
    variant = "secondary";
    Icon = CheckCircle2;
  }
  return (
    <Badge variant={variant}>
      <Icon className="mr-1 h-3 w-3" />
      {formatLabel(status)}
    </Badge>
  );
}

function formFromBot(bot: BotDefinition): BotFormState {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    objective: bot.objective,
    prompt: bot.prompt,
    workMode: bot.workMode,
    promptStrategy: bot.promptStrategy,
    providerId: bot.providerId ?? "",
    windowIds: bot.triggerConfig?.quota?.windowIds ?? [],
    quotaMinPercentRemaining: String(
      bot.triggerConfig?.quota?.minPercentRemaining ?? 1
    ),
    quotaMinRemaining:
      bot.triggerConfig?.quota?.minRemaining === undefined
        ? ""
        : String(bot.triggerConfig.quota.minRemaining),
    quotaCooldownMs: String(bot.triggerConfig?.quota?.cooldownMs ?? 300_000),
    enabled: bot.enabled,
    trigger: bot.trigger,
    agentId: bot.agentId ?? "",
    projectId: bot.projectId ?? "",
    modelId: bot.modelId ?? "",
    maxConcurrency: String(bot.maxConcurrency),
    executionTarget: bot.execution.target,
    executionChatId: bot.execution.chatId ?? "",
  };
}

function validateForm(form: BotFormState): string | undefined {
  if (!(form.name.trim() && form.objective.trim())) {
    return "Name and objective are required";
  }
  if (form.promptStrategy === "fixed" && !form.prompt.trim()) {
    return "A fixed prompt is required for the fixed strategy";
  }
  const isLegacy =
    Boolean(form.id) && !form.providerId && form.promptStrategy === "fixed";
  if (!(isLegacy || (form.providerId && form.projectId && form.agentId))) {
    return "Provider, project, and agent are required";
  }
  if (!isLegacy && form.windowIds.length === 0) {
    return "Select at least one quota window";
  }
  if (
    form.workMode === "adaptive_session" &&
    form.executionTarget === "existing_session" &&
    !form.executionChatId
  ) {
    return "Select the existing ACP session";
  }
  const maxConcurrency = Number(form.maxConcurrency);
  if (
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > 10
  ) {
    return "Task concurrency must be between 1 and 10";
  }
  const percent = Number(form.quotaMinPercentRemaining);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return "Quota reserve must be between 0 and 100 percent";
  }
  if (
    form.quotaMinRemaining.trim() &&
    (!Number.isFinite(Number(form.quotaMinRemaining)) ||
      Number(form.quotaMinRemaining) < 0)
  ) {
    return "Minimum remaining must be a non-negative number";
  }
  const cooldown = Number(form.quotaCooldownMs);
  if (!Number.isInteger(cooldown) || cooldown < 0) {
    return "Cooldown must be a non-negative integer";
  }
  return undefined;
}

function isActiveRun(run: BotRun): boolean {
  return (
    run.status === "queued" ||
    run.status === "quota_blocked" ||
    run.status === "running"
  );
}

function formatLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(LEADING_WORD_PATTERN, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

function shortId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
