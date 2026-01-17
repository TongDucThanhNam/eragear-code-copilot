import { Ionicons } from "@expo/vector-icons";
import { Button, cn } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { withUniwind } from "uniwind";
import { ModelSelector } from "./model-selector";
import { SlashCommandMenu } from "./slash-command-menu";
import type { ChatInputProps } from "./types";

const StyledIonicons = withUniwind(Ionicons);

interface ActionBarProps {
  disabled?: boolean;
  onOpenAttachment?: () => void;
  onSend: () => void;
  onSlashCommand: (command: string) => void;
  isSendDisabled: boolean;
  availableModels: ChatInputProps["availableModels"];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  availableCommands: ChatInputProps["availableCommands"];
}

export function ActionBar({
  disabled,
  onOpenAttachment,
  onSend,
  onSlashCommand,
  isSendDisabled,
  availableModels,
  currentModelId,
  onModelChange,
  availableCommands,
}: ActionBarProps) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);

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
            disabled={disabled}
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
          isSendDisabled ? "bg-muted" : "bg-blue-600"
        )}
        isDisabled={isSendDisabled}
        isIconOnly
        onPress={onSend}
        size="sm"
        variant="primary"
      >
        <Button.Label>
          <StyledIonicons
            className="text-default-foreground"
            name="arrow-up"
            size={18}
          />
        </Button.Label>
      </Button>
    </View>
  );
}
