import { Ionicons } from "@expo/vector-icons";
import { Button, useThemeColor } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { PlusMenu } from "./plus-menu";
import type { ChatInputProps } from "./types";

interface ActionBarProps {
  disabled?: boolean;
  onOpenAttachment?: () => void;
  onSlashCommand: (command: string) => void;
  availableCommands: ChatInputProps["availableCommands"];
}

export function ActionBar({
  disabled,
  onOpenAttachment,
  onSlashCommand,
  availableCommands,
}: ActionBarProps) {
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const defaultForegroundColor = useThemeColor("default-foreground");

  return (
    <View>
      <Button
        className="h-12 w-12 shrink-0 rounded-full bg-background"
        feedbackVariant="scale"
        isDisabled={disabled}
        isIconOnly
        onPress={() => setShowPlusMenu(true)}
        size="sm"
        variant="secondary"
      >
        <Button.Label>
          <Ionicons color={defaultForegroundColor} name="add" size={20} />
        </Button.Label>
      </Button>

      <PlusMenu
        availableCommands={availableCommands}
        disabled={disabled}
        isOpen={showPlusMenu}
        onOpenAttachment={onOpenAttachment}
        onOpenChange={setShowPlusMenu}
        onSelectCommand={onSlashCommand}
      />
    </View>
  );
}
