"use client";

import { TerminalIcon } from "lucide-react";
import { useCallback, type RefObject } from "react";
import {
  PromptInputActionMenuItem,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { applySlashCommandSelection } from "@/components/chat-ui/chat-input/shared";
import type { SlashCommand } from "@/components/chat-ui/slash-command-popup";

interface SlashCommandActionMenuItemProps {
  command: SlashCommand;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCommandApplied?: (commandName: string) => void;
}

export function SlashCommandActionMenuItem({
  command,
  textareaRef,
  onCommandApplied,
}: SlashCommandActionMenuItemProps) {
  const controller = usePromptInputController();

  const handleSelect = useCallback(() => {
    applySlashCommandSelection({
      commandName: command.name,
      setInput: controller.textInput.setInput,
      textareaRef,
    });
    onCommandApplied?.(command.name);
  }, [
    command.name,
    controller.textInput.setInput,
    onCommandApplied,
    textareaRef,
  ]);

  return (
    <PromptInputActionMenuItem className="items-start" onSelect={handleSelect}>
      <TerminalIcon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium text-xs">/{command.name}</div>
        <div className="truncate text-muted-foreground text-xs">
          {command.description}
        </div>
      </div>
    </PromptInputActionMenuItem>
  );
}
