import { Button, Popover } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Model } from "./types";

interface ModelSelectorProps {
  availableModels: Model[];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

export function ModelSelector({
  availableModels,
  currentModelId,
  onModelChange,
  isOpen,
  onOpenChange,
  disabled,
}: ModelSelectorProps) {
  const selectedLabel =
    availableModels.find((m) => m.modelId === currentModelId)?.modelId ||
    availableModels[0]?.modelId ||
    "Select model";

  return (
    <Popover isOpen={isOpen} onOpenChange={onOpenChange}>
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
              {selectedLabel}
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
                    onOpenChange(false);
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
  );
}
