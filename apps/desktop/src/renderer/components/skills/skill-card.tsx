"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, FolderMinus, FolderPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppRouter } from "@/lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type Skill = RouterOutput["skills"]["list"]["skills"][number];

interface SkillCardProps {
  disabled?: boolean;
  mode: "global" | "project";
  onAdd?: () => void;
  onRemove?: () => void;
  skill: Skill;
}

export function SkillCard({
  disabled,
  mode,
  onAdd,
  onRemove,
  skill,
}: SkillCardProps) {
  const diagnostics = skill.diagnostics ?? [];
  const tags = skill.tags ?? [];
  const isProjectMode = mode === "project";
  const isInstalled =
    skill.status === "installed" || skill.status === "missing-source";

  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-sm">{skill.name}</h3>
            {isProjectMode ? <SkillStatusBadge status={skill.status} /> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
            {skill.description || "No description"}
          </p>
        </div>

        {isProjectMode && isInstalled ? (
          <Button
            disabled={disabled}
            onClick={onRemove}
            size="sm"
            type="button"
            variant="outline"
          >
            <FolderMinus className="mr-2 h-4 w-4" />
            Remove
          </Button>
        ) : null}
        {isProjectMode && !isInstalled ? (
          <Button
            disabled={disabled || skill.status === "conflict"}
            onClick={onAdd}
            size="sm"
            type="button"
            variant="outline"
          >
            <FolderPlus className="mr-2 h-4 w-4" />
            {skill.status === "conflict" ? "Conflict" : "Add"}
          </Button>
        ) : null}
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 6).map((tag) => (
            <Badge className="h-5 text-[10px]" key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      {diagnostics.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 text-xs dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-3">{diagnostics.join(" ")}</span>
        </div>
      ) : null}

      <SkillPathRow label="Source" value={skill.sourcePath} />
      {isProjectMode && skill.installedPath ? (
        <SkillPathRow label="Project" value={skill.installedPath} />
      ) : null}
    </div>
  );
}

export function SkillPathRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <code
        className="block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
        title={value}
      >
        {shortPath(value)}
      </code>
    </div>
  );
}

function SkillStatusBadge({ status }: { status: Skill["status"] }) {
  if (status === "installed") {
    return <Badge>in project</Badge>;
  }
  if (status === "missing-source") {
    return <Badge variant="secondary">source missing</Badge>;
  }
  if (status === "conflict") {
    return <Badge variant="destructive">name conflict</Badge>;
  }
  return <Badge variant="outline">available</Badge>;
}

function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 5) {
    return normalized;
  }
  return `.../${parts.slice(-4).join("/")}`;
}
