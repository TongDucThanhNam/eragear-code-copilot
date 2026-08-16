"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SkillCard, SkillPathRow } from "./skill-card";

export function ProjectSkillsPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const skillsQuery = trpc.skills.list.useQuery(
    { projectId },
    { staleTime: 30_000 }
  );
  const addToProject = trpc.skills.addToProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.skills.list.invalidate(),
        utils.settings.getLocalAdeSnapshot.invalidate(),
      ]);
      toast.success("Skill added to project");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add skill to project");
    },
  });
  const removeFromProject = trpc.skills.removeFromProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.skills.list.invalidate(),
        utils.settings.getLocalAdeSnapshot.invalidate(),
      ]);
      toast.success("Skill removed from project");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to remove skill from project");
    },
  });

  const skills = skillsQuery.data?.skills ?? [];
  const diagnostics = skillsQuery.data?.diagnostics ?? [];
  const isBusy =
    skillsQuery.isLoading ||
    skillsQuery.isFetching ||
    addToProject.isPending ||
    removeFromProject.isPending;

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm">Project Skills</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Add only the Global Skills this project needs. Managed copies live
            in <code>.agents/skills</code>.
          </p>
        </div>
        <Button
          disabled={isBusy}
          onClick={() => {
            skillsQuery.refetch().catch((error: unknown) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Failed to refresh project skills"
              );
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw
            className={cn(
              "mr-2 h-4 w-4",
              skillsQuery.isFetching ? "animate-spin" : ""
            )}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {skillsQuery.data?.totalCount ?? 0} global
          </Badge>
          <Badge variant="outline">
            {skillsQuery.data?.installedCount ?? 0} added
          </Badge>
        </div>
        <SkillPathRow
          label="Library"
          value={skillsQuery.data?.libraryPath ?? "~/AGENTS/skills"}
        />
        {skillsQuery.data?.projectPath ? (
          <SkillPathRow label="Project" value={skillsQuery.data.projectPath} />
        ) : null}
      </div>

      {skillsQuery.error ? (
        <Notice message={skillsQuery.error.message} tone="error" />
      ) : null}
      {diagnostics.length > 0 ? (
        <Notice message={diagnostics.join(" ")} tone="warning" />
      ) : null}

      {skillsQuery.isLoading ? (
        <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          Loading project skills...
        </div>
      ) : null}

      {!(skillsQuery.isLoading || skillsQuery.error) && skills.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          No Global Skills found in <code>~/AGENTS/skills</code>.
        </div>
      ) : null}

      {skills.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {skills.map((skill) => (
            <SkillCard
              disabled={isBusy}
              key={skill.id}
              mode="project"
              onAdd={() =>
                addToProject.mutate({ projectId, skillId: skill.id })
              }
              onRemove={() =>
                removeFromProject.mutate({ projectId, skillId: skill.id })
              }
              skill={skill}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Notice({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border p-3 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
