"use client";

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FilePart } from "../agentic-message-utils";
import { getFileIcon } from "./shared";

export interface FileMessagePartProps {
  part: FilePart;
}

export const FileMessagePart = memo(function FileMessagePart({
  part,
}: FileMessagePartProps) {
  const Icon = getFileIcon(part);
  const label = part.filename ?? part.mediaType ?? "File";

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
