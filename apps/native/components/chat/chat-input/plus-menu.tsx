import { Ionicons } from "@expo/vector-icons";
import { BottomSheet, useThemeColor } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { withUniwind } from "uniwind";
import type { Command } from "./types";

const StyledIonicons = withUniwind(Ionicons);

interface PlusMenuProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onOpenAttachment?: () => void;
  availableCommands: Command[];
  onSelectCommand: (command: string) => void;
}

export function PlusMenu({
  isOpen,
  onOpenChange,
  disabled = false,
  onOpenAttachment,
  availableCommands,
  onSelectCommand,
}: PlusMenuProps) {
  const mutedColor = useThemeColor("muted");

  const handleSelectCommand = (command: string) => {
    const formatted = command.startsWith("/") ? command : `/${command}`;
    onSelectCommand(formatted);
    onOpenChange(false);
  };

  const handleOpenAttachment = () => {
    onOpenChange(false);
    onOpenAttachment?.();
  };

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          className="rounded-t-3xl"
          snapPoints={["40%", "60%"]}
        >
          <View className="flex-1 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <View>
                <BottomSheet.Title className="font-semibold text-foreground text-lg">
                  Actions
                </BottomSheet.Title>
                <BottomSheet.Description className="text-muted-foreground text-sm">
                  Add attachments or use slash commands
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close hitSlop={12}>
                <Ionicons color={mutedColor} name="close" size={20} />
              </BottomSheet.Close>
            </View>

            <ScrollView className="flex-1">
              {/* Attachments Section */}
              <View className="mb-4">
                <Text className="mb-2 px-2 font-medium text-muted-foreground text-xs uppercase">
                  Attachments
                </Text>
                <Pressable
                  className="flex-row items-center rounded-xl px-3 py-3 active:bg-default-100"
                  disabled={disabled}
                  onPress={handleOpenAttachment}
                >
                  <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-default-100">
                    <StyledIonicons
                      className="text-foreground"
                      name="attach"
                      size={20}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-foreground">
                      Add Attachment
                    </Text>
                    <Text className="mt-0.5 text-muted-foreground text-sm">
                      Images, audio, or files
                    </Text>
                  </View>
                  <StyledIonicons
                    className="text-muted-foreground"
                    name="chevron-forward"
                    size={18}
                  />
                </Pressable>
              </View>

              {/* Slash Commands Section */}
              {availableCommands.length > 0 && (
                <View>
                  <Text className="mb-2 px-2 font-medium text-muted-foreground text-xs uppercase">
                    Commands
                  </Text>
                  {availableCommands.map((cmd) => (
                    <Pressable
                      className="flex-row items-center rounded-xl px-3 py-3 active:bg-default-100"
                      disabled={disabled}
                      key={cmd.name}
                      onPress={() => handleSelectCommand(cmd.name)}
                    >
                      <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-default-100">
                        <StyledIonicons
                          className="text-foreground"
                          name="code-slash"
                          size={18}
                        />
                      </View>
                      <View className="flex-1">
                        <Text className="font-medium text-foreground">
                          {cmd.name.startsWith("/") ? cmd.name : `/${cmd.name}`}
                        </Text>
                        <Text
                          className="mt-0.5 text-muted-foreground text-sm"
                          numberOfLines={1}
                        >
                          {cmd.input?.hint || cmd.description}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
