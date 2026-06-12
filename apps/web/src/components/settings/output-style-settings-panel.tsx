"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Check, Paintbrush, RefreshCw, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type OutputStyleSettings =
  RouterOutput["outputStyle"]["getSettings"]["settings"];
type OutputStylePreset =
  RouterOutput["outputStyle"]["getSettings"]["presets"][number];

const EMPTY_SETTINGS: OutputStyleSettings = {
  enabled: false,
  activePresetId: "default",
  updatedAt: 0,
};

export function OutputStyleSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<OutputStyleSettings>(EMPTY_SETTINGS);
  const settingsQuery = trpc.outputStyle.getSettings.useQuery(undefined, {
    staleTime: 30_000,
  });
  const updateSettings = trpc.outputStyle.updateSettings.useMutation({
    onSuccess: async (result) => {
      setForm(result.settings);
      await utils.outputStyle.getSettings.invalidate();
      toast.success("Output style settings saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save output style settings");
    },
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setForm(settingsQuery.data.settings);
    }
  }, [settingsQuery.data?.settings]);

  const presets = settingsQuery.data?.presets ?? [];
  const activePreset = presets.find(
    (preset) => preset.id === form.activePresetId
  );
  const isBusy = settingsQuery.isFetching || updateSettings.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSettings.mutate({
      enabled: form.enabled,
      activePresetId: form.activePresetId,
    });
  };

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void settingsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              settingsQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      }
      description="Persisted response style defaults applied to prompts before they are sent to the agent."
      icon={Paintbrush}
      title="Output Style"
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <Badge variant={form.enabled ? "secondary" : "outline"}>
            {form.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Badge variant="outline">{activePreset?.name ?? "Default"}</Badge>
        </div>

        <label
          className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
          htmlFor="output-style-enabled"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm">Apply by default</span>
            <span className="block text-muted-foreground text-xs">
              The visible chat message stays unchanged; only the agent prompt is
              prefixed.
            </span>
          </span>
          <Switch
            checked={form.enabled}
            disabled={isBusy}
            id="output-style-enabled"
            onCheckedChange={(enabled) =>
              setForm((prev) => ({ ...prev, enabled }))
            }
          />
        </label>

        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="output-style-preset">Default style</Label>
          <Select
            disabled={isBusy}
            onValueChange={(activePresetId) =>
              setForm((prev) => ({
                ...prev,
                activePresetId:
                  activePresetId as OutputStyleSettings["activePresetId"],
              }))
            }
            value={form.activePresetId}
          >
            <SelectTrigger className="w-full" id="output-style-preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {presets.map((preset) => (
            <PresetOption
              active={preset.id === form.activePresetId}
              disabled={isBusy}
              key={preset.id}
              onSelect={() =>
                setForm((prev) => ({
                  ...prev,
                  activePresetId: preset.id,
                }))
              }
              preset={preset}
            />
          ))}
        </div>

        {activePreset?.instructions ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="font-medium text-xs uppercase tracking-normal text-muted-foreground">
              Prompt prefix preview
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {activePreset.instructions}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button disabled={isBusy} type="submit">
            <Save className="mr-2 h-4 w-4" />
            Save settings
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function PresetOption({
  active,
  disabled,
  onSelect,
  preset,
}: {
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  preset: OutputStylePreset;
}) {
  return (
    <button
      className={cn(
        "flex min-h-24 items-start gap-3 rounded-md border bg-background p-3 text-left text-sm transition-colors hover:bg-accent/60",
        active ? "border-primary bg-accent/50" : ""
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-primary",
          active ? "border-primary bg-primary text-primary-foreground" : ""
        )}
      >
        {active ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{preset.name}</span>
        <span className="mt-1 block text-muted-foreground text-xs leading-5">
          {preset.description}
        </span>
      </span>
    </button>
  );
}
