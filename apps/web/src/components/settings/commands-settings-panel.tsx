"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Command, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type SlashCommand = RouterOutput["commands"]["list"]["commands"][number];

interface CommandDraft {
  name: string;
  description: string;
  prompt: string;
  argumentHint: string;
  enabled: boolean;
}

const EMPTY_DRAFT: CommandDraft = {
  name: "",
  description: "",
  prompt: "",
  argumentHint: "",
  enabled: true,
};

export function CommandsSettingsPanel() {
  const utils = trpc.useUtils();
  const commandsQuery = trpc.commands.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const [draft, setDraft] = useState<CommandDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateCache = async (data: RouterOutput["commands"]["list"]) => {
    utils.commands.list.setData(undefined, data);
    await utils.commands.list.invalidate();
  };

  const createCommand = trpc.commands.create.useMutation({
    onSuccess: async (data) => {
      await updateCache(data);
      setDraft(EMPTY_DRAFT);
      toast.success("Command saved");
    },
    onError: (error) => toast.error(error.message || "Failed to save command"),
  });
  const updateCommand = trpc.commands.update.useMutation({
    onSuccess: async (data) => {
      await updateCache(data);
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      toast.success("Command updated");
    },
    onError: (error) => toast.error(error.message || "Failed to update command"),
  });
  const setEnabled = trpc.commands.setEnabled.useMutation({
    onSuccess: updateCache,
    onError: (error) => toast.error(error.message || "Failed to toggle command"),
  });
  const deleteCommand = trpc.commands.delete.useMutation({
    onSuccess: async (data) => {
      await updateCache(data);
      toast.success("Command deleted");
    },
    onError: (error) => toast.error(error.message || "Failed to delete command"),
  });

  const commands = commandsQuery.data?.commands ?? [];
  const customCommands = useMemo(
    () => commands.filter((command) => command.storage === "custom"),
    [commands]
  );
  const discoveredCommands = useMemo(
    () =>
      commands.filter((command) => command.storage === "filesystem-discovery"),
    [commands]
  );
  const isBusy =
    commandsQuery.isLoading ||
    commandsQuery.isFetching ||
    createCommand.isPending ||
    updateCommand.isPending ||
    setEnabled.isPending ||
    deleteCommand.isPending;

  const submitDraft = () => {
    const payload = {
      name: draft.name,
      prompt: draft.prompt,
      enabled: draft.enabled,
      ...(draft.description.trim()
        ? { description: draft.description.trim() }
        : {}),
      ...(draft.argumentHint.trim()
        ? { argumentHint: draft.argumentHint.trim() }
        : {}),
    };
    if (editingId) {
      updateCommand.mutate({ id: editingId, ...payload });
      return;
    }
    createCommand.mutate(payload);
  };

  const startEdit = (command: SlashCommand) => {
    setEditingId(command.id);
    setDraft({
      name: command.name,
      description: command.description ?? "",
      prompt: command.prompt,
      argumentHint: command.argumentHint ?? "",
      enabled: command.enabled,
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void commandsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              commandsQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Create user slash commands and manage discovered command files."
      icon={Command}
      title="Commands"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {commandsQuery.data?.enabledCount ?? 0} enabled
          </Badge>
          <Badge variant="outline">{commandsQuery.data?.totalCount ?? 0} total</Badge>
          <Badge variant="outline">{customCommands.length} custom</Badge>
          <Badge variant="outline">{discoveredCommands.length} discovered</Badge>
        </div>

        <div className="grid gap-3 rounded-md border bg-background p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Input
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="/review"
              value={draft.name}
            />
            <Input
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  argumentHint: event.target.value,
                }))
              }
              placeholder="<files or request>"
              value={draft.argumentHint}
            />
          </div>
          <Input
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="Description"
            value={draft.description}
          />
          <Textarea
            className="min-h-28"
            onChange={(event) =>
              setDraft((current) => ({ ...current, prompt: event.target.value }))
            }
            placeholder="Prompt template. Use $ARGUMENTS to insert user input."
            value={draft.prompt}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) =>
                  setDraft((current) => ({ ...current, enabled }))
                }
                size="sm"
              />
              <span className="text-muted-foreground text-sm">Enabled</span>
            </div>
            <div className="flex items-center gap-2">
              {editingId ? (
                <Button
                  onClick={() => {
                    setEditingId(null);
                    setDraft(EMPTY_DRAFT);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              ) : null}
              <Button
                disabled={isBusy || !draft.name.trim() || !draft.prompt.trim()}
                onClick={submitDraft}
                size="sm"
                type="button"
              >
                {editingId ? (
                  <Save className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {editingId ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>

        {commandsQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading commands...
          </div>
        ) : null}

        {!commandsQuery.isLoading && commands.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No commands registered.
          </div>
        ) : null}

        {commands.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {commands.map((command) => (
              <CommandRow
                command={command}
                disabled={isBusy}
                key={command.id}
                onDelete={() => deleteCommand.mutate({ id: command.id })}
                onEdit={() => startEdit(command)}
                onToggle={(enabled) =>
                  setEnabled.mutate({ id: command.id, enabled })
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function CommandRow({
  command,
  disabled,
  onDelete,
  onEdit,
  onToggle,
}: {
  command: SlashCommand;
  disabled?: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const isCustom = command.storage === "custom";
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{command.name}</h3>
            <Badge variant={command.enabled ? "default" : "outline"}>
              {command.enabled ? "enabled" : "off"}
            </Badge>
            <Badge variant="secondary">{command.storage}</Badge>
            <Badge variant="outline">{command.scope}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
            {command.description || command.argumentHint || "No description"}
          </p>
        </div>
        <Switch
          checked={command.enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          size="sm"
        />
      </div>

      <p className="line-clamp-3 whitespace-pre-wrap rounded bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
        {command.prompt}
      </p>

      <div className="flex items-center justify-between gap-2">
        <code
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
          title={command.sourcePath}
        >
          {shortPath(command.sourcePath)}
        </code>
        <div className="flex shrink-0 items-center gap-1">
          {isCustom ? (
            <>
              <Button
                disabled={disabled}
                onClick={onEdit}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                disabled={disabled}
                onClick={onDelete}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 4) {
    return normalized;
  }
  return `.../${parts.slice(-3).join("/")}`;
}
