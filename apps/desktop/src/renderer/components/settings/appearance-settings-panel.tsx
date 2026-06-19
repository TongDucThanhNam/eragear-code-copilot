"use client";

import { Eye, EyeOff, Paintbrush, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

export function AppearanceSettingsPanel() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    staleTime: 30_000,
  });
  const updateUi = trpc.settings.updateUi.useMutation({
    onMutate: async (input) => {
      await utils.settings.get.cancel();
      const previous = utils.settings.get.getData();
      if (previous && typeof input.showReasoning === "boolean") {
        utils.settings.get.setData(undefined, {
          ...previous,
          ui: {
            ...previous.ui,
            showReasoning: input.showReasoning,
          },
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.settings.get.setData(undefined, context.previous);
      }
      if (error.message.includes('No "mutation"-procedure on path')) {
        toast.error(
          "Appearance settings require a desktop server restart before this toggle can be saved."
        );
        return;
      }
      toast.error(error.message || "Failed to update appearance");
    },
    onSuccess: async (result) => {
      utils.settings.get.setData(undefined, result.settings);
      await utils.settings.get.invalidate();
      toast.success("Appearance updated");
    },
  });

  const showReasoning = settingsQuery.data?.ui.showReasoning ?? true;
  const isBusy = settingsQuery.isFetching || updateUi.isPending;
  const StatusIcon = showReasoning ? Eye : EyeOff;

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => {
            settingsQuery.refetch().catch(() => undefined);
          }}
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
      description="Controls client-side display and capture behavior for chat UI."
      icon={Paintbrush}
      title="Appearance"
    >
      <div className="grid max-w-3xl gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={showReasoning ? "secondary" : "outline"}>
            {showReasoning ? "Reasoning visible" : "Reasoning hidden"}
          </Badge>
        </div>

        <label
          className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
          htmlFor="appearance-show-reasoning"
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <StatusIcon className="h-4 w-4 text-muted-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-sm">Show reasoning</span>
              <span className="mt-1 block max-w-2xl text-muted-foreground text-xs leading-5">
                When disabled, incoming ACP thought chunks are ignored before
                they become chat message parts.
              </span>
            </span>
          </span>
          <Switch
            checked={showReasoning}
            disabled={isBusy}
            id="appearance-show-reasoning"
            onCheckedChange={(nextShowReasoning) =>
              updateUi.mutate({ showReasoning: nextShowReasoning })
            }
          />
        </label>
      </div>
    </SettingsSection>
  );
}
