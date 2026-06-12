"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Bot,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type BotDefinition = RouterOutput["bots"]["list"]["bots"][number];
type BotRun = RouterOutput["bots"]["list"]["runs"][number];
type BotTrigger =
  | "manual"
  | "quota_refresh"
  | "repository_change"
  | "scheduled"
  | "remote_control";

interface BotFormState {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  trigger: BotTrigger;
  agentId: string;
  projectId: string;
  maxConcurrency: string;
}

const EMPTY_FORM: BotFormState = {
  name: "",
  description: "",
  prompt: "",
  enabled: true,
  trigger: "manual",
  agentId: "",
  projectId: "",
  maxConcurrency: "1",
};

const TRIGGERS: BotTrigger[] = [
  "manual",
  "quota_refresh",
  "repository_change",
  "scheduled",
  "remote_control",
];

export function BotsSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<BotFormState>(EMPTY_FORM);
  const [orchestrationTrigger, setOrchestrationTrigger] =
    useState<BotTrigger>("quota_refresh");
  const botsQuery = trpc.bots.list.useQuery(undefined, { staleTime: 15_000 });
  const upsertBot = trpc.bots.upsert.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      setForm(EMPTY_FORM);
      toast.success("Bot saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save bot");
    },
  });
  const deleteBot = trpc.bots.delete.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      toast.success("Bot deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete bot");
    },
  });
  const startRun = trpc.bots.startRun.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      toast.success("Bot run started");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start bot run");
    },
  });
  const stopRun = trpc.bots.stopRun.useMutation({
    onSuccess: async () => {
      await utils.bots.list.invalidate();
      toast.success("Bot run stopped");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop bot run");
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
      toast.error(error.message || "Bot orchestration failed");
    },
  });

  const bots = botsQuery.data?.bots ?? [];
  const runs = botsQuery.data?.runs ?? [];
  const activeRuns = runs.filter((run) => isActiveRun(run));
  const isBusy =
    botsQuery.isFetching ||
    upsertBot.isPending ||
    deleteBot.isPending ||
    startRun.isPending ||
    stopRun.isPending ||
    orchestrate.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const maxConcurrency = Number(form.maxConcurrency);
    if (!form.name.trim() || !form.prompt.trim()) {
      toast.error("Bot name and prompt are required");
      return;
    }
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      toast.error("Max concurrency must be at least 1");
      return;
    }
    upsertBot.mutate({
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      enabled: form.enabled,
      trigger: form.trigger,
      ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
      ...(form.projectId.trim() ? { projectId: form.projectId.trim() } : {}),
      maxConcurrency,
    });
  };

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy}
            onClick={() => void botsQuery.refetch()}
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
      }
      description="Reusable bot definitions and run lifecycle records for trigger-driven task orchestration."
      icon={Bot}
      title="Bots"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{bots.length} bots</Badge>
          <Badge variant="outline">
            {bots.filter((bot) => bot.enabled).length} enabled
          </Badge>
          <Badge variant="outline">{activeRuns.length} active runs</Badge>
          <select
            className="h-6 rounded-md border bg-background px-2 text-xs"
            onChange={(event) =>
              setOrchestrationTrigger(event.target.value as BotTrigger)
            }
            value={orchestrationTrigger}
          >
            {TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {formatTrigger(trigger)}
              </option>
            ))}
          </select>
        </div>

        <form
          className="grid gap-3 rounded-md border bg-muted/20 p-3"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_120px_120px]">
            <Field id="bot-name" label="Name">
              <Input
                id="bot-name"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Quota queue runner"
                value={form.name}
              />
            </Field>
            <Field id="bot-trigger" label="Trigger">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="bot-trigger"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    trigger: event.target.value as BotTrigger,
                  }))
                }
                value={form.trigger}
              >
                {TRIGGERS.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {formatTrigger(trigger)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="bot-concurrency" label="Concurrency">
              <Input
                id="bot-concurrency"
                min={1}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    maxConcurrency: event.target.value,
                  }))
                }
                type="number"
                value={form.maxConcurrency}
              />
            </Field>
            <label
              className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              htmlFor="bot-enabled"
            >
              <span className="text-sm">Enabled</span>
              <Switch
                checked={form.enabled}
                id="bot-enabled"
                onCheckedChange={(enabled) =>
                  setForm((prev) => ({ ...prev, enabled }))
                }
              />
            </label>
          </div>

          <Field id="bot-description" label="Description">
            <Input
              id="bot-description"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Optional"
              value={form.description}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="bot-agent-id" label="Agent ID">
              <Input
                id="bot-agent-id"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, agentId: event.target.value }))
                }
                placeholder="Optional"
                value={form.agentId}
              />
            </Field>
            <Field id="bot-project-id" label="Project ID">
              <Input
                id="bot-project-id"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    projectId: event.target.value,
                  }))
                }
                placeholder="Optional"
                value={form.projectId}
              />
            </Field>
          </div>

          <Field id="bot-prompt" label="Prompt">
            <Textarea
              className="min-h-28"
              id="bot-prompt"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, prompt: event.target.value }))
              }
              placeholder="Describe what this bot should do when triggered."
              value={form.prompt}
            />
          </Field>

          <div className="flex justify-end gap-2">
            {form.id ? (
              <Button
                onClick={() => setForm(EMPTY_FORM)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            ) : null}
            <Button disabled={isBusy} type="submit">
              {form.id ? "Save bot" : "Add bot"}
            </Button>
          </div>
        </form>

        {botsQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading bots...
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {bots.map((bot) => (
            <BotRow
              bot={bot}
              disabled={isBusy}
              key={bot.id}
              onDelete={() => deleteBot.mutate({ id: bot.id })}
              onEdit={() => setForm(formFromBot(bot))}
              onRun={() =>
                startRun.mutate({
                  botId: bot.id,
                  trigger: "manual",
                  context: { source: "settings" },
                })
              }
            />
          ))}
        </div>

        {runs.length > 0 ? (
          <div className="grid gap-3">
            <div className="font-medium text-sm">Runs</div>
            {runs.map((run) => (
              <RunRow
                botName={bots.find((bot) => bot.id === run.botId)?.name}
                disabled={isBusy}
                key={run.id}
                onStop={() => stopRun.mutate({ runId: run.id })}
                run={run}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function BotRow({
  bot,
  disabled,
  onDelete,
  onEdit,
  onRun,
}: {
  bot: BotDefinition;
  disabled: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onRun: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{bot.name}</h3>
            <Badge variant={bot.enabled ? "secondary" : "outline"}>
              {bot.enabled ? "enabled" : "disabled"}
            </Badge>
            <Badge variant="outline">{formatTrigger(bot.trigger)}</Badge>
          </div>
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {bot.description || bot.id}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            disabled={disabled || !bot.enabled}
            onClick={onRun}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Play className="h-4 w-4" />
            <span className="sr-only">Run bot</span>
          </Button>
          <Button
            disabled={disabled}
            onClick={onEdit}
            size="sm"
            type="button"
            variant="ghost"
          >
            Edit
          </Button>
          <Button
            disabled={disabled}
            onClick={onDelete}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete bot</span>
          </Button>
        </div>
      </div>
      <div className="line-clamp-2 text-muted-foreground text-xs">
        {bot.prompt}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">max {bot.maxConcurrency}</Badge>
        {bot.agentId ? <Badge variant="outline">agent {bot.agentId}</Badge> : null}
        {bot.projectId ? (
          <Badge variant="outline">project {bot.projectId}</Badge>
        ) : null}
      </div>
    </div>
  );
}

function RunRow({
  run,
  botName,
  disabled,
  onStop,
}: {
  run: BotRun;
  botName?: string;
  disabled: boolean;
  onStop: () => void;
}) {
  const canStop = isActiveRun(run);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-sm">
            {botName ?? run.botId}
          </span>
          <Badge variant={run.status === "running" ? "secondary" : "outline"}>
            {run.status}
          </Badge>
          <Badge variant="outline">{formatTrigger(run.trigger)}</Badge>
        </div>
        <div className="mt-1 truncate text-muted-foreground text-xs">
          queued {formatTimestamp(run.queuedAt)}
        </div>
      </div>
      {canStop ? (
        <Button disabled={disabled} onClick={onStop} size="sm" variant="outline">
          <Square className="mr-2 h-4 w-4" />
          Stop
        </Button>
      ) : null}
    </div>
  );
}

function formFromBot(bot: BotDefinition): BotFormState {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    prompt: bot.prompt,
    enabled: bot.enabled,
    trigger: bot.trigger,
    agentId: bot.agentId ?? "",
    projectId: bot.projectId ?? "",
    maxConcurrency: String(bot.maxConcurrency),
  };
}

function isActiveRun(run: BotRun): boolean {
  return run.status === "queued" || run.status === "running";
}

function formatTrigger(trigger: BotTrigger): string {
  return trigger.replaceAll("_", " ");
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
