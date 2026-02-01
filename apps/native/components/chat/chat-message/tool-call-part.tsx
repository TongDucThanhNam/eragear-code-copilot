import { Text, View } from "react-native";
import type { ToolUIPart } from "@repo/shared";

interface ToolCallPartProps {
  title: string;
  input: ToolUIPart["input"];
  state: ToolUIPart["state"];
}

const statusMeta: Record<
  ToolUIPart["state"],
  { label: string; className: string }
> = {
  "input-streaming": { label: "Preparing", className: "text-muted" },
  "input-available": { label: "Running", className: "text-warning" },
  "approval-requested": { label: "Awaiting approval", className: "text-warning" },
  "approval-responded": { label: "Approved", className: "text-success" },
  "output-available": { label: "Completed", className: "text-success" },
  "output-error": { label: "Failed", className: "text-danger" },
  "output-denied": { label: "Denied", className: "text-danger" },
};

export function ToolCallPart({ title, input, state }: ToolCallPartProps) {
  const status = statusMeta[state];
  const inputText =
    input === undefined
      ? "(waiting for input)"
      : JSON.stringify(input, null, 2);
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <View className="flex-row items-center justify-between">
        <Text className="font-bold text-warning text-xs">TOOL: {title}</Text>
        <Text className={`text-[10px] ${status.className}`}>{status.label}</Text>
      </View>
      <Text className="mb-2 font-mono text-muted text-xs">
        {inputText}
      </Text>
    </View>
  );
}
