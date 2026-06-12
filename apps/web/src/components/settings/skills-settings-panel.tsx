"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, BookOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type Skill = RouterOutput["skills"]["list"]["skills"][number];

export function SkillsSettingsPanel() {
  const utils = trpc.useUtils();
  const skillsQuery = trpc.skills.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const setEnabled = trpc.skills.setEnabled.useMutation({
    onSuccess: async (data) => {
      utils.skills.list.setData(undefined, data);
      await utils.settings.getLocalAdeSnapshot.invalidate();
      toast.success("Skill registry updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update skill");
    },
  });

  const skills = skillsQuery.data?.skills ?? [];
  const isBusy = skillsQuery.isLoading || skillsQuery.isFetching || setEnabled.isPending;

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => void skillsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", skillsQuery.isFetching ? "animate-spin" : "")}
          />
          Refresh
        </Button>
      }
      description="Project and user SKILL.md descriptors available to agent prompts."
      icon={BookOpen}
      title="Skills"
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {skillsQuery.data?.enabledCount ?? 0} enabled
          </Badge>
          <Badge variant="outline">{skillsQuery.data?.totalCount ?? 0} total</Badge>
          <Badge variant="outline">{countByScope(skills, "project")} project</Badge>
          <Badge variant="outline">{countByScope(skills, "user")} user</Badge>
        </div>

        {skillsQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading skills...
          </div>
        ) : null}

        {!skillsQuery.isLoading && skills.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            No skills discovered.
          </div>
        ) : null}

        {skills.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {skills.map((skill) => (
              <SkillRow
                disabled={setEnabled.isPending}
                key={skill.id}
                onToggle={(enabled) =>
                  setEnabled.mutate({
                    skillId: skill.id,
                    enabled,
                  })
                }
                skill={skill}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function SkillRow({
  disabled,
  onToggle,
  skill,
}: {
  disabled?: boolean;
  onToggle: (enabled: boolean) => void;
  skill: Skill;
}) {
  const hasDiagnostics = skill.diagnostics.length > 0;
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{skill.name}</h3>
            <Badge variant={skill.enabled ? "default" : "outline"}>
              {skill.enabled ? "enabled" : "off"}
            </Badge>
            <Badge variant="secondary">{skill.scope}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
            {skill.description || "No description"}
          </p>
        </div>
        <Switch
          checked={skill.enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          size="sm"
        />
      </div>

      {skill.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {skill.tags.slice(0, 6).map((tag) => (
            <Badge className="h-5 text-[10px]" key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      {hasDiagnostics ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 text-xs dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">{skill.diagnostics.join(" ")}</span>
        </div>
      ) : null}

      <code
        className="block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
        title={skill.sourcePath}
      >
        {shortPath(skill.sourcePath)}
      </code>
    </div>
  );
}

function countByScope(skills: Skill[], scope: string): number {
  return skills.filter((skill) => skill.scope === scope).length;
}

function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 4) {
    return normalized;
  }
  return `.../${parts.slice(-3).join("/")}`;
}
