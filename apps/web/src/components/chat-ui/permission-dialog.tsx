"use client";

import { memo, useMemo } from "react";
import type {
  PermissionOption,
  PermissionOptions,
  PermissionRequest,
} from "@repo/shared";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type NormalizedOption = {
  id: string;
  label: string;
  description?: string;
  isAllow: boolean;
};

const normalizePermissionOptions = (
  options?: PermissionOptions
): NormalizedOption[] => {
  const list = Array.isArray(options) ? options : (options?.options ?? []);
  return list.map((option: PermissionOption, index) => {
    const optionId =
      option.optionId ??
      option.id ??
      option.kind ??
      option.name ??
      option.label ??
      `option-${index}`;
    const label =
      option.label ??
      option.name ??
      option.optionId ??
      option.id ??
      option.kind ??
      "Option";
    const normalized = String(optionId).toLowerCase();
    const isAllow =
      normalized.includes("allow") ||
      normalized.includes("yes") ||
      normalized.includes("approve");
    return {
      id: String(optionId),
      label: String(label),
      description: option.description,
      isAllow,
    };
  });
};

const formatInput = (input: unknown) => {
  if (input === undefined) {
    return null;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
};

const PermissionDialogHeader = memo(({ title }: { title: string }) => (
  <DialogHeader>
    <DialogTitle>Permission required</DialogTitle>
    <DialogDescription>
      Allow &quot;{title}&quot; to execute this step? Closing the dialog will
      reject the request.
    </DialogDescription>
  </DialogHeader>
));
PermissionDialogHeader.displayName = "PermissionDialogHeader";

const PermissionDialogInput = memo(({ input }: { input: string | null }) => {
  if (!input) {
    return null;
  }
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </div>
      <div className="overflow-hidden rounded-md bg-muted/50">
        <CodeBlock code={input} language="json" />
      </div>
    </div>
  );
});
PermissionDialogInput.displayName = "PermissionDialogInput";

const PermissionDialogActions = memo(
  ({
    options,
    onApprove,
    onReject,
  }: {
    options: NormalizedOption[];
    onApprove: (decision: string) => void;
    onReject: (decision?: string) => void;
  }) => (
    <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      {options.length > 0 ? (
        options.map((option) => (
          <Button
            className={cn(
              "h-auto px-3 py-2 text-left",
              option.description && "items-start"
            )}
            key={option.id}
            onClick={() =>
              option.isAllow ? onApprove(option.id) : onReject(option.id)
            }
            type="button"
            variant={option.isAllow ? "default" : "outline"}
          >
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-sm">{option.label}</span>
              {option.description && (
                <span className="text-muted-foreground text-xs">
                  {option.description}
                </span>
              )}
            </span>
          </Button>
        ))
      ) : (
        <>
          <Button onClick={() => onReject("reject")} type="button" variant="outline">
            Reject
          </Button>
          <Button onClick={() => onApprove("allow")} type="button">
            Allow
          </Button>
        </>
      )}
    </DialogFooter>
  )
);
PermissionDialogActions.displayName = "PermissionDialogActions";

export interface PermissionDialogProps {
  open: boolean;
  request: PermissionRequest | null;
  onApprove: (decision: string) => void;
  onReject: (decision?: string) => void;
  onOpenChange: (open: boolean) => void;
}

const PermissionDialogBase = ({
  open,
  request,
  onApprove,
  onReject,
  onOpenChange,
}: PermissionDialogProps) => {
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
        className="max-h-[80vh] max-w-xl !flex !flex-col"
        showCloseButton={true}
      >
        <PermissionDialogHeader title={request.title} />
        {hasInput ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <PermissionDialogInput input={inputText} />
          </div>
        ) : null}
        <PermissionDialogActions
          onApprove={onApprove}
          onReject={onReject}
          options={options}
        />
      </DialogContent>
    </Dialog>
  );
};

export const PermissionDialog = memo(PermissionDialogBase);
PermissionDialog.displayName = "PermissionDialog";
