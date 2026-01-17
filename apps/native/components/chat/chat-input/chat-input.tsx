import { Surface } from "heroui-native";
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { ActionBar } from "./action-bar";
import { ChatInputArea } from "./chat-input-area";
import { ModeSelector } from "./mode-selector";
import type { ChatInputProps } from "./types";

export function ChatInput({
  onSend,
  disabled,
  onHeightChange,
  onOpenAttachment,
  availableModes,
  currentModeId,
  onModeChange,
  availableModels,
  currentModelId,
  onModelChange,
  availableCommands,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [showModeMenu, setShowModeMenu] = useState(false);

  const isSendDisabled = disabled || !text.trim();

  const handleSend = () => {
    if (isSendDisabled) {
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
    <View className="px-1 pb-3" onLayout={handleLayout}>
      <Surface className="overflow-hidden rounded-2xl border border-divider">
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
          isSendDisabled={isSendDisabled}
          onModelChange={onModelChange}
          onOpenAttachment={onOpenAttachment}
          onSend={handleSend}
          onSlashCommand={handleSlashCommand}
        />
      </Surface>
    </View>
  );
}
