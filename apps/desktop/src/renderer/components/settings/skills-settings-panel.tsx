"use client";

import { AlertCircle, BookOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SkillCard, SkillPathRow } from "@/components/skills/skill-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

export function SkillsSettingsPanel() {
  const skillsQuery = trpc.skills.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const skills = skillsQuery.data?.skills ?? [];
  const diagnostics = skillsQuery.data?.diagnostics ?? [];
  const isBusy = skillsQuery.isLoading || skillsQuery.isFetching;

  return (
    <SettingsSection
      action={
        <Button
          disabled={isBusy}
          onClick={() => {
            skillsQuery.refetch().catch((error: unknown) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Failed to refresh skills"
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
      }
      description="Manage the dormant Global Skills catalog. Add skills to a project from that project's settings."
      icon={BookOpen}
      title="Global Skills"
    >
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {skillsQuery.data?.totalCount ?? 0} skills
            </Badge>
            <Badge
              variant={
                skillsQuery.data?.libraryExists ? "outline" : "destructive"
              }
            >
              {skillsQuery.data?.libraryExists
                ? "Library ready"
                : "Library missing"}
            </Badge>
          </div>
          <SkillPathRow
            label="Library"
            value={skillsQuery.data?.libraryPath ?? "~/AGENTS/skills"}
          />
        </div>

        {skillsQuery.error ? (
          <Notice message={skillsQuery.error.message} tone="error" />
        ) : null}
        {diagnostics.length > 0 ? (
          <Notice message={diagnostics.join(" ")} tone="warning" />
        ) : null}

        {skillsQuery.isLoading ? (
          <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            Loading Global Skills...
          </div>
        ) : null}

        {!(skillsQuery.isLoading || skillsQuery.error) &&
        skills.length === 0 ? (
          <div className="grid gap-2 rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            <p>No global skills found.</p>
            <p>
              Put each library skill at{" "}
              <code>~/AGENTS/skills/&lt;skill-name&gt;/SKILL.md</code>.
            </p>
          </div>
        ) : null}

        {skills.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {skills.map((skill) => (
              <SkillCard key={skill.id} mode="global" skill={skill} />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
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
