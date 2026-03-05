"use client";

import { memo } from "react";
import { CodeBlock } from "@/components/ai-elements/code-block";

interface PermissionDialogInputProps {
  input: string | null;
}

export const PermissionDialogInput = memo(function PermissionDialogInput({
  input,
}: PermissionDialogInputProps) {
  if (!input) {
    return null;
  }
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </div>
      <div className="max-h-[40vh] min-w-0 overflow-auto rounded-md bg-muted/50">
        <CodeBlock
          className="[&_pre]:max-w-full"
          code={input}
          language="json"
        />
      </div>
    </div>
  );
});
