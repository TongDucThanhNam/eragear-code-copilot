"use client";

import type {
  PermissionOption,
  PermissionOptions,
  PermissionRequest,
} from "@repo/shared";
import { memo, useMemo } from "react";
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

interface NormalizedOption {
  id: string;
  label: string;
  description?: string;
  intent: PermissionIntent | "neutral";
}

const TITLE_PREVIEW_MAX_CHARS = 180;
type PermissionIntent = "allow" | "reject";

const ALLOW_KEYWORDS = [
  "allow",
  "approve",
  "approved",
  "accept",
  "accepted",
  "grant",
  "granted",
  "yes",
  "ok",
];
const REJECT_KEYWORDS = [
  "reject",
  "rejected",
  "deny",
  "denied",
  "block",
  "blocked",
  "cancel",
  "cancelled",
  "decline",
  "declined",
  "disallow",
  "no",
];

const formatTitlePreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= TITLE_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, TITLE_PREVIEW_MAX_CHARS)}...`;
};

const normalizeToken = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
};

const tokenize = (value: string): string[] => {
  if (value.length === 0) {
    return [];
  }
  const words = value.split(/[^a-z0-9]+/).filter((part) => part.length > 0);
  return [value, ...words];
};

const includesKeyword = (value: string, keywords: readonly string[]) => {
  const tokens = tokenize(normalizeToken(value));
  return keywords.some((keyword) => tokens.includes(keyword));
};

const inferIntentFromKind = (kind?: string): PermissionIntent | null => {
  const normalizedKind = normalizeToken(kind);
  if (normalizedKind.startsWith("allow_")) {
    return "allow";
  }
  if (normalizedKind.startsWith("reject_")) {
    return "reject";
  }
  return null;
};

const inferIntentFromOption = (
  option: PermissionOption
): PermissionIntent | null => {
  const kindIntent = inferIntentFromKind(option.kind);
  if (kindIntent) {
    return kindIntent;
  }

  const values = [option.optionId, option.id, option.name, option.label]
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeToken(value))
    .filter((value) => value.length > 0);
  for (const value of values) {
    if (includesKeyword(value, REJECT_KEYWORDS)) {
      return "reject";
    }
    if (includesKeyword(value, ALLOW_KEYWORDS)) {
      return "allow";
    }
  }

  return null;
};

const normalizePermissionOptions = (
  options?: PermissionOptions
): NormalizedOption[] => {
  const list = Array.isArray(options) ? options : (options?.options ?? []);
  return list.map((option: PermissionOption, index: number) => {
    const optionIntent = inferIntentFromOption(option);

    const optionId =
      option.optionId ??
      option.id ??
      option.kind ??
      `option-${index + 1}`;
    const label =
      option.label ??
      option.name ??
      option.optionId ??
      option.id ??
      option.kind ??
      "Option";
    return {
      id: String(optionId),
      label: String(label),
      description: option.description,
      intent: optionIntent ?? "neutral",
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
  <DialogHeader className="min-w-0 pr-8">
    <DialogTitle>Permission required</DialogTitle>
    <DialogDescription className="max-h-24 overflow-y-auto pr-1 [overflow-wrap:anywhere]">
      Allow{" "}
      <span className="text-foreground [overflow-wrap:anywhere]" title={title}>
        &quot;{formatTitlePreview(title)}&quot;
      </span>{" "}
      to execute this step?
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
PermissionDialogInput.displayName = "PermissionDialogInput";

const PermissionDialogActions = memo(
  ({
    options,
    onSelect,
    onApprove,
    onReject,
  }: {
    options: NormalizedOption[];
    onSelect: (decision: string) => void;
    onApprove: (decision: string) => void;
    onReject: (decision?: string) => void;
  }) => (
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
  )
);
PermissionDialogActions.displayName = "PermissionDialogActions";

export interface PermissionDialogProps {
  open: boolean;
  request: PermissionRequest | null;
  onSelect: (decision: string) => void;
  onApprove: (decision: string) => void;
  onReject: (decision?: string) => void;
  onOpenChange: (open: boolean) => void;
}

const PermissionDialogBase = ({
  open,
  request,
  onSelect,
  onApprove,
  onReject,
  onOpenChange,
}: PermissionDialogProps) => {
  const options = useMemo(
    () => normalizePermissionOptions(request?.options),
    [request?.options]
  );
  const inputText = useMemo(
    () => formatInput(request?.input),
    [request?.input]
  );
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
          onSelect={onSelect}
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
