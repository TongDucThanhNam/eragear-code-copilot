import { Ionicons } from "@expo/vector-icons";
import { Button, PressableFeedback, Text, useThemeColor } from "heroui-native";
import { View } from "react-native";

interface SessionsHeaderProps {
  isCreating: boolean;
  canCreateSession: boolean;
  title: string;
  onCreateSession: () => void;
  onOpenDrawer: () => void;
}

export function SessionsHeader({
  isCreating,
  canCreateSession,
  title,
  onCreateSession,
  onOpenDrawer,
}: SessionsHeaderProps) {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const isCreateDisabled = isCreating || !canCreateSession;

  return (
    <View className="flex-row items-center justify-between px-6 pt-5 pb-5">
      <PressableFeedback
        accessibilityLabel="Open project list"
        accessibilityRole="button"
        className="min-w-0 flex-1 flex-row items-center"
        onPress={onOpenDrawer}
      >
        <Text.Heading
          className="min-w-0 flex-1 text-3xl"
          numberOfLines={1}
          type="h1"
        >
          {title}
        </Text.Heading>
        <Ionicons
          color={themeColorForeground}
          name="chevron-down"
          size={18}
          style={{ marginLeft: 8, marginTop: 4 }}
        />
      </PressableFeedback>

      <Button
        accessibilityLabel="Create new session"
        className="ml-4 rounded-full"
        isDisabled={isCreateDisabled}
        onPress={onCreateSession}
        isIconOnly={true}
        size="sm"
      >
        <Ionicons color={themeColorAccentForeground} name="add" size={18} />
      </Button>
    </View>
  );
}
