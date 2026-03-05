"use client";

import { memo } from "react";
import type { NormalizedOption } from "@/components/chat-ui/permission-dialog/shared";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface PermissionDialogActionsProps {
  options: NormalizedOption[];
  onSelect: (decision: string) => void;
  onApprove: (decision: string) => void;
  onReject: (decision?: string) => void;
}

export const PermissionDialogActions = memo(function PermissionDialogActions({
  options,
  onSelect,
  onApprove,
  onReject,
}: PermissionDialogActionsProps) {
  return (
    <DialogFooter className="flex shrink-0 flex-col-reverse gap-2 border-border/60 border-t pt-3 sm:flex-row sm:flex-wrap sm:justify-end">
      {options.length > 0 ? (
        options.map((option) => (
          <Button
            className={cn(
              "h-auto max-w-full whitespace-normal px-3 py-2 text-left [overflow-wrap:anywhere]",
              option.description && "items-start"
            )}
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
            variant={
              option.intent === "allow"
                ? "default"
                : option.intent === "reject"
                  ? "outline"
                  : "secondary"
            }
          >
            <span className="flex min-w-0 max-w-full flex-col gap-0.5 text-left">
              <span className="text-sm [overflow-wrap:anywhere]">
                {option.label}
              </span>
              {option.description && (
                <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
                  {option.description}
                </span>
              )}
            </span>
          </Button>
        ))
      ) : (
        <>
          <Button
            onClick={() => onReject("reject")}
            type="button"
            variant="outline"
          >
            Reject
          </Button>
          <Button onClick={() => onApprove("allow")} type="button">
            Allow
          </Button>
        </>
      )}
    </DialogFooter>
  );
});
