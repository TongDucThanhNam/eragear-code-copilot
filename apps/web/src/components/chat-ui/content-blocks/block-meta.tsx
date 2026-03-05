"use client";

import {
  formatAnnotations,
  formatBytes,
} from "@/components/chat-ui/content-blocks/shared";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BlockMetaProps {
  mimeType?: string | null;
  size?: number | null;
  annotations?: unknown;
}

export function BlockMeta({ mimeType, size, annotations }: BlockMetaProps) {
  const annotationText = formatAnnotations(annotations);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {mimeType ? <Badge variant="secondary">{mimeType}</Badge> : null}
      {typeof size === "number" ? (
        <Badge variant="secondary">{formatBytes(size)}</Badge>
      ) : null}
      {annotations ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline">annotations</Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs break-words text-xs">{annotationText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}
