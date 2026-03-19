import type { UIMessage } from "@repo/shared";
import { Text, View } from "react-native";
import { formatMessageTime, getMessageTimestamp } from "./message-item.utils";

interface MessageHeaderProps {
  message: UIMessage;
  isLiveMessage: boolean;
}

export function MessageHeader({ message, isLiveMessage }: MessageHeaderProps) {
  const isUserMessage = message.role === "user";
  return (
    <View className="mb-1.5 flex-row items-center gap-2">
      <Text className="text-[10px] text-muted-foreground">
        {isUserMessage ? "You" : "Assistant"}
      </Text>
      <Text className="text-[10px] text-muted-foreground/50">·</Text>
      <Text className="text-[10px] text-muted-foreground/70">
        {formatMessageTime(getMessageTimestamp(message))}
      </Text>
      {isLiveMessage && !isUserMessage && (
        <View className="flex-row items-center gap-1">
          <View className="h-1.5 w-1.5 rounded-full bg-accent" />
          <Text className="text-[10px] text-accent">Thinking...</Text>
        </View>
      )}
    </View>
  );
}
