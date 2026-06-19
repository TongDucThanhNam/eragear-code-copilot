"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";
import { MessageAction } from "@/components/ai-elements/message";

export interface CopyMessageActionProps {
  text: string;
}

export const CopyMessageAction = memo(function CopyMessageAction({
  text,
}: CopyMessageActionProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) {
      return;
    }

    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      toast.error("Clipboard API not available");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      toast.success("Copied message");
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast.error("Failed to copy message");
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <MessageAction
      aria-label="Copy message"
      disabled={!text}
      label="Copy message"
      onClick={handleCopy}
      tooltip={isCopied ? "Copied" : "Copy"}
    >
      <Icon className="size-3.5" />
    </MessageAction>
  );
});
