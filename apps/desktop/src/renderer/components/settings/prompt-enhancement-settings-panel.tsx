// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { RefreshCw, Save, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type PromptEnhancementSettings =
  RouterOutput["promptEnhancement"]["getSettings"]["settings"];

const MODE_OPTIONS: Array<{
  value: PromptEnhancementSettings["instructionMode"];
  label: string;
}> = [
  { value: "execution", label: "Execution" },
  { value: "planning", label: "Planning" },
  { value: "concise", label: "Concise" },
];

const EMPTY_SETTINGS: PromptEnhancementSettings = {
  enabled: false,
  includeProjectContext: true,
  includeDate: true,
  instructionMode: "execution",
  customInstruction: "",
};

export function PromptEnhancementSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<PromptEnhancementSettings>(EMPTY_SETTINGS);
  const settingsQuery = trpc.promptEnhancement.getSettings.useQuery(undefined, {
    staleTime: 30_000,
  });
  const updateSettings = trpc.promptEnhancement.updateSettings.useMutation({
    onSuccess: async (result) => {
      setForm(result.settings);
      await utils.promptEnhancement.getSettings.invalidate();
      toast.success("Prompt enhancement settings saved");
    },
    onError: (error) => {
      toast.error(
        error.message || "Failed to save prompt enhancement settings"
      );
    },
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setForm(settingsQuery.data.settings);
    }
  }, [settingsQuery.data?.settings]);

  const isBusy = settingsQuery.isFetching || updateSettings.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSettings.mutate(form);
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
      description="Server-side preprocessing that enriches the prompt sent to the agent while keeping the visible user message unchanged."
      icon={Sparkles}
      title="Prompt Enhancement"
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <Badge variant={form.enabled ? "secondary" : "outline"}>
            {form.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Badge variant="outline">{form.instructionMode}</Badge>
          {form.includeProjectContext ? (
            <Badge variant="outline">project context</Badge>
          ) : null}
          {form.includeDate ? <Badge variant="outline">date</Badge> : null}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleRow
            checked={form.enabled}
            label="Enhance prompts"
            onCheckedChange={(checked) =>
              setForm((prev) => ({ ...prev, enabled: checked }))
            }
          />
          <ToggleRow
            checked={form.includeProjectContext}
            label="Project context"
            onCheckedChange={(checked) =>
              setForm((prev) => ({
                ...prev,
                includeProjectContext: checked,
              }))
            }
          />
          <ToggleRow
            checked={form.includeDate}
            label="Current date"
            onCheckedChange={(checked) =>
              setForm((prev) => ({ ...prev, includeDate: checked }))
            }
          />
        </div>

        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="prompt-enhancement-mode">Instruction preset</Label>
          <Select
            onValueChange={(value) =>
              setForm((prev) => ({
                ...prev,
                instructionMode:
                  value as PromptEnhancementSettings["instructionMode"],
              }))
            }
            value={form.instructionMode}
          >
            <SelectTrigger className="w-full" id="prompt-enhancement-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="prompt-enhancement-custom">Custom instruction</Label>
          <Textarea
            className="min-h-32"
            id="prompt-enhancement-custom"
            maxLength={4000}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                customInstruction: event.target.value,
              }))
            }
            placeholder="Add project-specific prompt enrichment rules."
            value={form.customInstruction}
          />
        </div>

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

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = `prompt-enhancement-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label
      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
      htmlFor={id}
    >
      <span className="text-sm">{label}</span>
      <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
    </label>
  );
}
