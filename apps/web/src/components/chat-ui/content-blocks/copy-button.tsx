"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CopyButtonProps {
  value?: string;
  label: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const Icon = isCopied ? CheckIcon : CopyIcon;
  const disabled = !value;

  const handleCopy = async () => {
    if (!value || typeof navigator === "undefined") {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            disabled={disabled}
            onClick={handleCopy}
            size="icon-sm"
            variant="ghost"
          >
            <Icon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isCopied ? "Copied" : label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
