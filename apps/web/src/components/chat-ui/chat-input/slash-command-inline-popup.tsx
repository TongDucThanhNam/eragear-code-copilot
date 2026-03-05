"use client";

import { useCallback, type RefObject } from "react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { applySlashCommandSelection } from "@/components/chat-ui/chat-input/shared";
import {
  type SlashCommand,
  SlashCommandPopup,
  type SlashCommandPopupRef,
} from "@/components/chat-ui/slash-command-popup";

interface SlashCommandInlinePopupProps {
  commands: SlashCommand[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  popupRef: RefObject<SlashCommandPopupRef | null>;
  onCommandApplied?: (commandName: string) => void;
}

export function SlashCommandInlinePopup({
  commands,
  textareaRef,
  popupRef,
  onCommandApplied,
}: SlashCommandInlinePopupProps) {
  const controller = usePromptInputController();

  const handleSelectCommand = useCallback(
    (command: SlashCommand) => {
      applySlashCommandSelection({
        commandName: command.name,
        setInput: controller.textInput.setInput,
        textareaRef,
      });
      onCommandApplied?.(command.name);
    },
    [controller.textInput.setInput, onCommandApplied, textareaRef]
  );

  return (
    <SlashCommandPopup
      commands={commands}
      inputValue={controller.textInput.value}
      onSelectCommand={handleSelectCommand}
      ref={popupRef}
    />
  );
}
