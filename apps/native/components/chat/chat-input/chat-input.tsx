import { Surface } from "heroui-native";
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { ActionBar } from "./action-bar";
import { AttachmentList } from "./attachment-list";
import { ChatInputArea } from "./chat-input-area";
import { ModeSelector } from "./mode-selector";
import type { ChatInputProps } from "./types";

export function ChatInput({
  onSend,
  onStop,
  disabled,
  status,
  onHeightChange,
  onOpenAttachment,
  attachments,
  onRemoveAttachment,
  availableModes,
  currentModeId,
  onModeChange,
  availableModels,
  currentModelId,
  supportsModelSwitching,
  onModelChange,
  availableCommands,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [showModeMenu, setShowModeMenu] = useState(false);

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = !disabled && hasContent;
  const canStop = status === "streaming" || status === "awaiting_permission";
  const isActionDisabled = canStop ? !onStop : !canSend;

  const handleSend = () => {
    if (!canSend) {
      return;
    }
    onSend(text);
    setText("");
  };

  const handleSlashCommand = (command: string) => {
    setText(`${command} `);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View className="px-3 pb-4" onLayout={handleLayout}>
      <Surface className="overflow-hidden rounded-2xl border border-divider bg-surface">
        {/* Mode Selector */}
        {availableModes.length > 0 && (
          <View className="flex-row items-center gap-2 border-divider border-b px-3 py-2">
            <ModeSelector
              availableModes={availableModes}
              currentModeId={currentModeId}
              disabled={disabled}
              isOpen={showModeMenu}
              onModeChange={onModeChange}
              onOpenChange={setShowModeMenu}
            />
          </View>
        )}

        {/* Text Input */}
        <AttachmentList
          attachments={attachments}
          onRemove={onRemoveAttachment}
        />
        <ChatInputArea
          disabled={disabled}
          onChangeText={setText}
          value={text}
        />

        {/* Action Bar */}
        <ActionBar
          availableCommands={availableCommands}
          availableModels={availableModels}
          currentModelId={currentModelId}
          disabled={disabled}
          isActionDisabled={isActionDisabled}
          onModelChange={onModelChange}
          onOpenAttachment={onOpenAttachment}
          onSend={handleSend}
          onStop={onStop}
          onSlashCommand={handleSlashCommand}
          status={status}
          supportsModelSwitching={supportsModelSwitching}
        />
      </Surface>
    </View>
  );
}
