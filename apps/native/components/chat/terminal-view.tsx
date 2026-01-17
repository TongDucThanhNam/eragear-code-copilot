import { ScrollView, Text } from "react-native";

interface TerminalViewProps {
  output: string;
}

export function TerminalView({ output }: TerminalViewProps) {
  return (
    <ScrollView className="h-40 rounded bg-black p-2">
      <Text className="font-mono text-green-500 text-xs">{output}</Text>
    </ScrollView>
  );
}
