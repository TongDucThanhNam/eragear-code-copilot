import { Ionicons } from "@expo/vector-icons";
import { Button, Popover } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { withUniwind } from "uniwind";
import type { Command } from "./types";

const StyledIonicons = withUniwind(Ionicons);

interface SlashCommandMenuProps {
  availableCommands: Command[];
  onSelectCommand: (command: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

export function SlashCommandMenu({
  availableCommands,
  onSelectCommand,
  isOpen,
  onOpenChange,
  disabled,
}: SlashCommandMenuProps) {
  const handleSelect = (command: string) => {
    const formatted = command.startsWith("/") ? command : `/${command}`;
    onSelectCommand(formatted);
    onOpenChange(false);
  };

  return (
    <Popover isOpen={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button
          className="h-9 w-9 rounded-full"
          isDisabled={disabled}
          isIconOnly
          size="sm"
          variant="ghost"
        >
          <Button.Label>
            <StyledIonicons
              className="text-foreground/80"
              name="code-slash"
              size={20}
            />
          </Button.Label>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay />
        <Popover.Content className="w-52 p-0">
          <ScrollView className="max-h-60">
            <View className="py-1">
              {availableCommands.map((cmd) => (
                <Pressable
                  className="flex-row items-center justify-between px-3 py-2 active:bg-default-100"
                  key={cmd.name}
                  onPress={() => handleSelect(cmd.name)}
                >
                  <Text className="font-medium text-foreground">
                    {cmd.name.startsWith("/") ? cmd.name : `/${cmd.name}`}
                  </Text>
                  <Text
                    className="max-w-28 text-muted text-xs"
                    numberOfLines={1}
                  >
                    {cmd.input?.hint || cmd.description}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
