import { Text, View } from "react-native";

interface TerminalPartProps {
  // TODO: Embeb Terminal
  // terminalId: string;
  output: string | undefined;
}

export function TerminalPart({
  // terminalId,
  output,
}: TerminalPartProps) {
  if (!output) {
    return null;
  }

  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-success text-xs">TERMINAL</Text>
      <View className="max-h-40 rounded bg-surface-foreground/10 p-2">
        <Text className="font-mono text-success/80 text-xs">
          {output.slice(-2000)}
        </Text>
      </View>
    </View>
  );
}
