"use client";

import type { PermissionRequest } from "@repo/shared";
import { memo, useMemo } from "react";
import { PermissionDialogActions } from "./permission-dialog/permission-dialog-actions";
import { PermissionDialogHeader } from "./permission-dialog/permission-dialog-header";
import { PermissionDialogInput } from "./permission-dialog/permission-dialog-input";
import {
  formatInput,
  normalizePermissionOptions,
} from "./permission-dialog/shared";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export interface PermissionDialogProps {
  open: boolean;
  request: PermissionRequest | null;
  onSelect: (decision: string) => void;
  onApprove: (decision: string) => void;
  onReject: (decision?: string) => void;
  onOpenChange: (open: boolean) => void;
}

export const PermissionDialog = memo(function PermissionDialog({
  open,
  request,
  onSelect,
  onApprove,
  onReject,
  onOpenChange,
}: PermissionDialogProps) {
  const options = useMemo(
    () => normalizePermissionOptions(request?.options),
    [request?.options]
  );
  const inputText = useMemo(() => formatInput(request?.input), [request?.input]);
  const hasInput = Boolean(inputText?.trim());

  if (!request) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="!flex !flex-col max-h-[85vh] w-[calc(100vw-2rem)] min-w-0 max-w-[42rem] overflow-hidden"
        showCloseButton={true}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <PermissionDialogHeader title={request.title} />
          {hasInput ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
              <PermissionDialogInput input={inputText} />
            </div>
          ) : null}
        </div>
        <PermissionDialogActions
          onApprove={onApprove}
          onReject={onReject}
          onSelect={onSelect}
          options={options}
        />
      </DialogContent>
    </Dialog>
  );
});
