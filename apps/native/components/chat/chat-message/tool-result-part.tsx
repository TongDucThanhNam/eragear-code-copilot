import { Accordion } from "heroui-native";
import { Text, View } from "react-native";
import { ToolResultDisplay } from "./tool-result-display";

interface ToolResultPartProps {
  toolCallId: string;
  content?: Array<{
    type: string;
    text?: string;
    source?: {
      type: string;
      text?: string;
      oldText?: string;
      path?: string;
    };
  }>;
  status: string;
}

export function ToolResultPart({
  toolCallId,
  content,
  status,
}: ToolResultPartProps) {
  const isError = status === "error" || status === "failed";
  const statusIcon = isError ? "✗" : "✓";

  return (
    <View className="mt-2">
      <Accordion variant="surface">
        <Accordion.Item value={toolCallId}>
          <Accordion.Trigger className="min-h-8 py-2">
            <View className="flex-row items-center gap-2">
              <Text
                className={`font-bold text-xs ${isError ? "text-danger" : "text-success"}`}
              >
                {statusIcon}
              </Text>
              <Text
                className={`font-mono text-xs ${isError ? "text-danger" : "text-success"}`}
              >
                {toolCallId}
              </Text>
            </View>
            <Accordion.Indicator />
          </Accordion.Trigger>
          <Accordion.Content className="px-2 pt-0 pb-2">
            <ToolResultDisplay content={content} status={status} />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </View>
  );
}
