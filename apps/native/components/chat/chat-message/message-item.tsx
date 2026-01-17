import { View } from "react-native";
import type { ChatMessage } from "@/store/chat-store";
import { MessagePartItem } from "./message-part-item";
import { cn_inline } from "./utils";

interface MessageItemProps {
  message: ChatMessage;
  terminalOutputs: Map<string, string>;
}

export function MessageItem({ message, terminalOutputs }: MessageItemProps) {
  const isUser = message.role === "user";

  return (
    <View
      className={cn_inline(
        "mb-4 flex-row",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <View
        className={cn_inline(
          "max-w-[85%] rounded-2xl p-3",
          isUser ? "bg-accent" : "bg-surface"
        )}
      >
        {message.parts.map((part, index) => (
          <MessagePartItem
            key={`${part.type}-${index}`}
            part={part}
            terminalOutputs={terminalOutputs}
          />
        ))}
      </View>
    </View>
  );
}
