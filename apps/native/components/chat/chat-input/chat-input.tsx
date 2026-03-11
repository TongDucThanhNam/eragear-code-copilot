import { Ionicons } from "@expo/vector-icons";
import { Button, useThemeColor } from "heroui-native";
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { ActionBar } from "./action-bar";
import { AttachmentList } from "./attachment-list";
import { ChatInputArea } from "./chat-input-area";
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
  availableCommands,
}: Omit<
  ChatInputProps,
  | "availableModes"
  | "currentModeId"
  | "onModeChange"
  | "availableModels"
  | "currentModelId"
  | "supportsModelSwitching"
  | "onModelChange"
>) {
  const [text, setText] = useState("");
  const [accentForegroundColor, defaultForegroundColor] = useThemeColor([
    "accent-foreground",
    "default-foreground",
  ]);

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = !disabled && hasContent;
  const canStop = status === "streaming" || status === "awaiting_permission";
  const canRunPrimaryAction = canStop ? Boolean(onStop) : canSend;
  const placeholder =
    availableCommands.length > 0
      ? "Type / for commands"
      : "Message the assistant";

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

  const handlePrimaryAction = () => {
    if (canStop) {
      onStop?.();
      return;
    }

    handleSend();
  };

  return (
    <View
      className="bg-background px-4 pb-4 pt-2 dark:bg-black"
      onLayout={handleLayout}
    >
      <View className="flex-row items-end gap-2">
        <ActionBar
          availableCommands={availableCommands}
          disabled={disabled}
          onOpenAttachment={onOpenAttachment}
          onSlashCommand={handleSlashCommand}
        />

        <View className="min-h-12 flex-1 rounded-[26px] bg-default px-2 pb-2 pt-2">
          <AttachmentList
            attachments={attachments}
            onRemove={onRemoveAttachment}
          />

          <View className="flex-row items-end gap-2 px-2">
            <ChatInputArea
              disabled={disabled}
              onChangeText={setText}
              placeholder={placeholder}
              value={text}
            />

            {(hasContent || canStop) && (
              <Button
                className="mb-0.5 h-9 w-9 self-end rounded-full"
                feedbackVariant="scale"
                isDisabled={!canRunPrimaryAction}
                isIconOnly
                onPress={handlePrimaryAction}
                size="sm"
                variant={canStop ? "secondary" : "primary"}
              >
                <Button.Label>
                  <Ionicons
                    color={
                      canStop
                        ? defaultForegroundColor
                        : accentForegroundColor
                    }
                    name={canStop ? "stop" : "arrow-up"}
                    size={18}
                  />
                </Button.Label>
              </Button>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
