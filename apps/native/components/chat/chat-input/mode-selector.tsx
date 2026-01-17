import { Ionicons } from "@expo/vector-icons";
import { Popover } from "heroui-native";
import { Pressable, Text, View } from "react-native";
import { withUniwind } from "uniwind";
import type { Mode } from "./types";

const StyledIonicons = withUniwind(Ionicons);

interface ModeSelectorProps {
  availableModes: Mode[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

export function ModeSelector({
  availableModes,
  currentModeId,
  onModeChange,
  isOpen,
  onOpenChange,
  disabled,
}: ModeSelectorProps) {
  const selectedLabel =
    availableModes.find((m) => m.id === currentModeId)?.name ||
    availableModes[0]?.name ||
    "Mode";

  return (
    <Popover isOpen={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Pressable
          className="flex-row items-center justify-between rounded-md border border-divider px-3 py-1.5"
          onPress={() => {
            if (disabled) {
              return;
            }
            onOpenChange(true);
          }}
        >
          <Text className="text-foreground text-sm">{selectedLabel}</Text>
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
                  onOpenChange(false);
                }}
              >
                <Text
                  className={`font-medium ${
                    currentModeId === m.id ? "text-blue-600" : "text-foreground"
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
  );
}
