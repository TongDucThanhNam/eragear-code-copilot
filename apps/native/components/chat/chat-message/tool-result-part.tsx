import { Accordion } from "heroui-native";
import { Text, View } from "react-native";
import type { ToolUIPart } from "@repo/shared";
import { ToolResultDisplay } from "./tool-result-display";

interface ToolResultPartProps {
  toolCallId: string;
  output?: unknown;
  state: ToolUIPart["state"];
  terminalOutputs: Map<string, string>;
  errorText?: string;
}

export function ToolResultPart({
  toolCallId,
  output,
  state,
  terminalOutputs,
  errorText,
}: ToolResultPartProps) {
  const isError = state === "output-error" || state === "output-denied";
  const statusIcon = isError ? "✗" : "✓";
  const statusLabel =
    state === "output-error"
      ? "Error"
      : state === "output-denied"
        ? "Denied"
        : "Completed";

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
                {toolCallId} · {statusLabel}
              </Text>
            </View>
            <Accordion.Indicator />
          </Accordion.Trigger>
          <Accordion.Content className="px-2 pt-0 pb-2">
            <ToolResultDisplay
              errorText={errorText}
              output={output}
              state={state}
              terminalOutputs={terminalOutputs}
            />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </View>
  );
}
