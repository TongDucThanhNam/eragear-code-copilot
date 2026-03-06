"use client";

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SourcePart } from "../agentic-message-utils";
import { getSourceIcon } from "./shared";

export interface SourceMessagePartProps {
  part: SourcePart;
}

export const SourceMessagePart = memo(function SourceMessagePart({
  part,
}: SourceMessagePartProps) {
  const Icon = getSourceIcon(part);
  const label =
    part.type === "source-url"
      ? (part.title ?? part.url)
      : (part.title ?? part.filename ?? part.sourceId);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs"
            variant="outline"
          >
            <Icon className="size-3 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="wrap-break-word max-w-xs text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
