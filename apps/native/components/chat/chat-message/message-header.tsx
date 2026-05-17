import type { UIMessage } from "@repo/shared";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import { Text, View } from "react-native";
import { formatMessageTime, getMessageTimestamp } from "./message-item.utils";

interface MessageHeaderProps {
  message: UIMessage;
  isLiveMessage: boolean;
}

export function MessageHeader({ message, isLiveMessage }: MessageHeaderProps) {
  const isUserMessage = message.role === "user";
  const accentForeground = useThemeColor("accent-foreground");
  const muted = useThemeColor("muted");

  if (isUserMessage) {
    return <View className="h-1" />;
  }

  return (
    <View className="mb-2 flex-row items-center gap-3">
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-accent">
        <Ionicons color={accentForeground} name="terminal-outline" size={18} />
      </View>
      <Text className="font-semibold text-base text-foreground">
        SOLO MTC
      </Text>
      <Text className="text-muted-foreground/50 text-xs">·</Text>
      <Text className="text-muted-foreground text-xs">
        {formatMessageTime(getMessageTimestamp(message))}
      </Text>
      {isLiveMessage ? (
        <View className="flex-row items-center gap-1">
          <View className="h-1.5 w-1.5 rounded-full bg-accent" />
          <Text className="text-accent text-xs">Thinking...</Text>
        </View>
      ) : (
        <Ionicons color={muted} name="sparkles-outline" size={14} />
      )}
    </View>
  );
}
