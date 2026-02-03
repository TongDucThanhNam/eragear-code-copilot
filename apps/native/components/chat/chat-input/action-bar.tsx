import { Ionicons } from "@expo/vector-icons";
import { Button, cn } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { withUniwind } from "uniwind";
import { ModelSelector } from "./model-selector";
import { SlashCommandMenu } from "./slash-command-menu";
import type { ChatInputProps } from "./types";

const StyledIonicons = withUniwind(Ionicons);

interface ActionBarProps {
  disabled?: boolean;
  status: ChatInputProps["status"];
  onOpenAttachment?: () => void;
  onSend: () => void;
  onStop?: () => void;
  onSlashCommand: (command: string) => void;
  isActionDisabled: boolean;
  availableModels: ChatInputProps["availableModels"];
  currentModelId: string | null;
  supportsModelSwitching?: boolean;
  onModelChange: (modelId: string) => void;
  availableCommands: ChatInputProps["availableCommands"];
}

export function ActionBar({
  disabled,
  onOpenAttachment,
  onSend,
  onStop,
  onSlashCommand,
  isActionDisabled,
  availableModels,
  currentModelId,
  supportsModelSwitching,
  onModelChange,
  availableCommands,
  status,
}: ActionBarProps) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const canStop = status === "streaming" || status === "awaiting_permission";
  const isLoading =
    status === "submitted" || status === "connecting" || status === "cancelling";

  let icon = (
    <StyledIonicons
      className="text-default-foreground"
      name="arrow-up"
      size={18}
    />
  );

  if (isLoading) {
    icon = <ActivityIndicator color="#ffffff" size="small" />;
  } else if (canStop) {
    icon = (
      <StyledIonicons
        className="text-default-foreground"
        name="square"
        size={16}
      />
    );
  } else if (status === "error") {
    icon = (
      <StyledIonicons
        className="text-default-foreground"
        name="close"
        size={18}
      />
    );
  }

  const handleAction = () => {
    if (isActionDisabled) {
      return;
    }
    if (canStop && onStop) {
      onStop();
      return;
    }
    onSend();
  };

  return (
    <View className="mt-2 flex-row items-center justify-between px-3 pb-3">
      <View className="flex-row items-center gap-2">
        {/* Attachment Button */}
        <Button
          className="h-9 w-9 rounded-full"
          isDisabled={disabled}
          isIconOnly
          onPress={onOpenAttachment}
          size="sm"
          variant="ghost"
        >
          <Button.Label>
            <StyledIonicons
              className="text-foreground/80"
              name="add"
              size={20}
            />
          </Button.Label>
        </Button>

        {/* Model Selector */}
        {availableModels.length > 0 && (
          <ModelSelector
            availableModels={availableModels}
            currentModelId={currentModelId}
            disabled={disabled || supportsModelSwitching === false}
            isOpen={showModelMenu}
            onModelChange={onModelChange}
            onOpenChange={setShowModelMenu}
          />
        )}

        {/* Slash Commands */}
        <SlashCommandMenu
          availableCommands={availableCommands}
          disabled={disabled}
          isOpen={showSlashMenu}
          onOpenChange={setShowSlashMenu}
          onSelectCommand={onSlashCommand}
        />
      </View>

      {/* Send Button */}
      <Button
        className={cn(
          "h-10 w-10 rounded-full",
          isActionDisabled
            ? "bg-muted"
            : canStop
              ? "bg-red-600"
              : "bg-blue-600"
        )}
        isDisabled={isActionDisabled}
        isIconOnly
        onPress={handleAction}
        size="sm"
        variant="primary"
      >
        <Button.Label>{icon}</Button.Label>
      </Button>
    </View>
  );
}
