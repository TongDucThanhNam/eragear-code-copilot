import { Ionicons } from "@expo/vector-icons";
import { Button, useThemeColor } from "heroui-native";
import { useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
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
  const [accentForegroundColor, defaultForegroundColor, mutedColor] =
    useThemeColor(["accent-foreground", "default-foreground", "muted"]);

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = !disabled && hasContent;
  const canStop = status === "streaming" || status === "awaiting_permission";
  const canRunPrimaryAction = canStop ? Boolean(onStop) : canSend;
  const placeholder =
    availableCommands.length > 0
      ? "Type a message or / for commands..."
      : "Type a message or hold to talk...";

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
      className="bg-background px-5 pt-2 pb-5 dark:bg-black"
      onLayout={handleLayout}
    >
      <View className="rounded-[30px] bg-default px-4 pt-4 pb-3">
        <AttachmentList
          attachments={attachments}
          onRemove={onRemoveAttachment}
        />

        <ChatInputArea
          disabled={disabled}
          onChangeText={setText}
          placeholder={placeholder}
          value={text}
        />

        <View className="mt-2 flex-row items-center justify-between">
          <ActionBar
            availableCommands={availableCommands}
            disabled={disabled}
            onOpenAttachment={onOpenAttachment}
            onSlashCommand={handleSlashCommand}
          />

          <View className="flex-row items-center gap-2">
            <Button
              className="h-12 w-12 rounded-full bg-background"
              feedbackVariant="scale"
              isDisabled={disabled}
              isIconOnly
              size="sm"
              variant="secondary"
            >
              <Button.Label>
                <Ionicons color={defaultForegroundColor} name="mic" size={22} />
              </Button.Label>
            </Button>

            <Button
              className="h-12 w-12 rounded-full"
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
                    canStop ? defaultForegroundColor : accentForegroundColor
                  }
                  name={
                    canStop
                      ? "stop"
                      : hasContent
                        ? "arrow-up"
                        : "chatbubble-ellipses"
                  }
                  size={canStop || hasContent ? 20 : 21}
                />
              </Button.Label>
            </Button>
          </View>
        </View>
      </View>
      <View className="mt-2 flex-row items-center gap-2 pl-6">
        <Ionicons color={mutedColor} name="cloud-outline" size={15} />
        <View className="h-1.5 w-1.5 rounded-full bg-success" />
        <Text className="text-muted-foreground text-sm">Cloud</Text>
      </View>
    </View>
  );
}
