"use client";

import { TerminalIcon } from "lucide-react";
import { useCallback, type RefObject } from "react";
import {
  PromptInputCommandItem,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { applySlashCommandSelection } from "@/components/chat-ui/chat-input/shared";
import type { SlashCommand } from "@/components/chat-ui/slash-command-popup";

interface SlashCommandPaletteItemProps {
  command: SlashCommand;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCommandApplied?: (commandName: string) => void;
  onClose: () => void;
}

export function SlashCommandPaletteItem({
  command,
  textareaRef,
  onCommandApplied,
  onClose,
}: SlashCommandPaletteItemProps) {
  const controller = usePromptInputController();

  const handleSelect = useCallback(() => {
    onClose();
    requestAnimationFrame(() => {
      applySlashCommandSelection({
        commandName: command.name,
        setInput: controller.textInput.setInput,
        textareaRef,
      });
      onCommandApplied?.(command.name);
    });
  }, [
    command.name,
    controller.textInput.setInput,
    onClose,
    onCommandApplied,
    textareaRef,
  ]);

  return (
    <PromptInputCommandItem
      onSelect={handleSelect}
      value={`${command.name} ${command.description}`}
    >
      <TerminalIcon className="size-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="font-medium text-xs">/{command.name}</div>
        <div className="truncate text-muted-foreground text-xs">
          {command.description}
        </div>
      </div>
    </PromptInputCommandItem>
  );
}
