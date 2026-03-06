"use client";

import { memo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

export interface TextMessagePartProps {
  text: string;
  variant?: "chain" | "final";
}

export const TextMessagePart = memo(function TextMessagePart({
  text,
  variant,
}: TextMessagePartProps) {
  return (
    <MessageResponse
      className={cn(
        variant === "chain" && "text-muted-foreground",
        variant === "final" && "leading-relaxed"
      )}
    >
      {text}
    </MessageResponse>
  );
});
