import { Text, View } from "react-native";

interface ToolCallPartProps {
  name: string;
  args: Record<string, unknown>;
}

export function ToolCallPart({ name, args }: ToolCallPartProps) {
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-warning text-xs">TOOL: {name}</Text>
      <Text className="mb-2 font-mono text-muted text-xs">
        {JSON.stringify(args, null, 2)}
      </Text>
    </View>
  );
}
