import { FlashList } from "@shopify/flash-list";
import type { ScrollViewProps } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { ChatMessage } from "@/store/chat-store";
import { MessageItem } from "./message-item";

interface ChatMessagesProps {
  messages: ChatMessage[];
  terminalOutputs: Map<string, string>;
  onApprove?: (requestId: string, decision: string) => void;
  onReject?: (requestId: string, decision: string) => void;
  contentPaddingBottom?: number;
  keyboardBottomOffset?: number;
}

export function ChatMessages({
  messages,
  terminalOutputs,
  contentPaddingBottom = 100,
  keyboardBottomOffset = 0,
}: ChatMessagesProps) {
  const listPaddingBottom = Math.max(100, contentPaddingBottom);
  const renderScrollComponent = (props: ScrollViewProps) => (
    <KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
  );

  return (
    <FlashList
      contentContainerStyle={{ padding: 16, paddingBottom: listPaddingBottom }}
      data={messages}
      // estimatedItemSize={100}
      // inverted={false}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <MessageItem message={item} terminalOutputs={terminalOutputs} />
      )}
      renderScrollComponent={renderScrollComponent}
    />
  );
}
