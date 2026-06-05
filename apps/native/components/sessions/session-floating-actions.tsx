import { Ionicons } from "@expo/vector-icons";
import { Button, useThemeColor } from "heroui-native";
import { View } from "react-native";

interface SessionFloatingActionsProps {
  isCreating: boolean;
  canCreateSession: boolean;
  onCreateSession: () => void;
  onDiscoverSessions: () => void;
}

export function SessionFloatingActions({
  isCreating,
  canCreateSession,
  onCreateSession,
  onDiscoverSessions,
}: SessionFloatingActionsProps) {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const isDisabled = isCreating || !canCreateSession;

  return (
    <View className="absolute right-6 bottom-8 gap-3">
      <Button
        className="h-16 w-16 rounded-full shadow-lg"
        feedbackVariant="scale"
        isDisabled={isDisabled}
        isIconOnly
        onPress={onCreateSession}
      >
        <Button.Label>
          <Ionicons
            color={themeColorAccentForeground}
            name="chatbox-ellipses"
            size={26}
          />
        </Button.Label>
      </Button>
      <Button
        className="h-11 w-11 self-end rounded-full bg-default"
        feedbackVariant="scale"
        isDisabled={isDisabled}
        isIconOnly
        onPress={onDiscoverSessions}
        variant="secondary"
      >
        <Button.Label>
          <Ionicons
            color={themeColorForeground}
            name="cloud-download-outline"
            size={20}
          />
        </Button.Label>
      </Button>
    </View>
  );
}
