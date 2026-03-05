"use client";

import { memo } from "react";
import { formatTitlePreview } from "@/components/chat-ui/permission-dialog/shared";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PermissionDialogHeaderProps {
  title: string;
}

export const PermissionDialogHeader = memo(function PermissionDialogHeader({
  title,
}: PermissionDialogHeaderProps) {
  return (
    <DialogHeader className="min-w-0 pr-8">
      <DialogTitle>Permission required</DialogTitle>
      <DialogDescription className="max-h-24 overflow-y-auto pr-1 [overflow-wrap:anywhere]">
        Allow{" "}
        <span
          className="text-foreground [overflow-wrap:anywhere]"
          title={title}
        >
          &quot;{formatTitlePreview(title)}&quot;
        </span>{" "}
        to execute this step?
      </DialogDescription>
    </DialogHeader>
  );
});
