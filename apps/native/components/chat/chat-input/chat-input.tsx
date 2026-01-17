import { Ionicons } from "@expo/vector-icons";
import { Button, cn, Popover, Surface, TextField } from "heroui-native";
import { useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { withUniwind } from "uniwind";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  onHeightChange?: (height: number) => void;
  onOpenAttachment?: () => void;
  onVoice?: () => void;
  availableModes: { id: string; name: string; description?: string | null }[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: {
    modelId: string;
    name: string;
    description?: string | null;
  }[];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  availableCommands: {
    name: string;
    description: string;
    input?: { hint: string };
  }[];
}

const StyledIonicons = withUniwind(Ionicons);

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
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
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
    const formatted = command.startsWith("/") ? command : `/${command}`;
    setText(`${formatted} `);
    setShowSlashMenu(false);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  const selectedModeLabel =
    availableModes.find((m) => m.id === currentModeId)?.name ||
    availableModes[0]?.name ||
    "Mode";

  const selectedModelLabel =
    availableModels.find((m) => m.modelId === currentModelId)?.modelId ||
    availableModels[0]?.modelId ||
    "Select model";

  return (
    <View className="px-1 pb-3" onLayout={handleLayout}>
      <Surface className="overflow-hidden rounded-2xl border border-divider">
        {/* Mode Selector */}
        {availableModes.length > 0 && (
          <View className="flex-row items-center gap-2 border-divider border-b px-3 py-2">
            <Popover isOpen={showModeMenu} onOpenChange={setShowModeMenu}>
              <Popover.Trigger asChild>
                <Pressable
                  className="flex-row items-center justify-between rounded-md border border-divider px-3 py-1.5"
                  onPress={() => {
                    if (disabled) {
                      return;
                    }
                    setShowModeMenu(true);
                  }}
                >
                  <Text className="text-foreground text-sm">
                    {selectedModeLabel}
                  </Text>
                  <StyledIonicons
                    className="text-muted"
                    name="chevron-down"
                    size={14}
                  />
                </Pressable>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Overlay />
                <Popover.Content className="w-48 p-0">
                  <View className="py-1">
                    {availableModes.map((m) => (
                      <Pressable
                        className="flex-row items-center justify-between px-3 py-2 active:bg-default-100"
                        key={m.id}
                        onPress={() => {
                          if (disabled) {
                            return;
                          }
                          onModeChange(m.id);
                          setShowModeMenu(false);
                        }}
                      >
                        <Text
                          className={`font-medium ${
                            currentModeId === m.id
                              ? "text-blue-600"
                              : "text-foreground"
                          }`}
                        >
                          {m.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Popover.Content>
              </Popover.Portal>
            </Popover>
          </View>
        )}

        {/* Text Input */}
        <View className="px-3 pt-3">
          <TextField isDisabled={disabled}>
            <TextField.Input
              className="min-h-18 w-full border-0 bg-transparent px-1 text-foreground"
              editable={!disabled}
              multiline
              numberOfLines={3}
              onChangeText={setText}
              placeholder="Ask anything or type / for commands"
              placeholderColorClassName="text-muted"
              textAlignVertical="top"
              value={text}
            />
          </TextField>
        </View>

        {/* Action Bar */}
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

            {/* Model Selector - Popover */}
            {availableModels.length > 0 && (
              <Popover isOpen={showModelMenu} onOpenChange={setShowModelMenu}>
                <Popover.Trigger asChild>
                  <Button
                    className="h-9 rounded-full px-3"
                    isDisabled={disabled}
                    size="sm"
                    variant="ghost"
                  >
                    <Button.Label>
                      <Text
                        className="max-w-20 text-foreground/80 text-xs"
                        numberOfLines={1}
                      >
                        {selectedModelLabel}
                      </Text>
                    </Button.Label>
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Overlay />
                  <Popover.Content className="w-56 p-0">
                    <ScrollView className="max-h-60">
                      <View className="py-1">
                        {availableModels.map((m) => (
                          <Pressable
                            className="flex-row items-center justify-between px-3 py-2 active:bg-default-100"
                            key={m.modelId}
                            onPress={() => {
                              onModelChange(m.modelId);
                              setShowModelMenu(false);
                            }}
                          >
                            <Text
                              className={`font-medium ${
                                currentModelId === m.modelId
                                  ? "text-blue-600"
                                  : "text-foreground"
                              }`}
                            >
                              {m.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </Popover.Content>
                </Popover.Portal>
              </Popover>
            )}

            {/* Slash Commands - Popover */}
            <Popover isOpen={showSlashMenu} onOpenChange={setShowSlashMenu}>
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
                          onPress={() => handleSlashCommand(cmd.name)}
                        >
                          <Text className="font-medium text-foreground">
                            {cmd.name.startsWith("/")
                              ? cmd.name
                              : `/${cmd.name}`}
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
          </View>

          {/* Send Button */}
          <Button
            className={cn(
              "h-10 w-10 rounded-full",
              isSendDisabled ? "bg-muted" : "bg-blue-600"
            )}
            isDisabled={isSendDisabled}
            isIconOnly
            onPress={handleSend}
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
      </Surface>
    </View>
  );
}
