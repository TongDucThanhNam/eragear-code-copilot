import { Text, View } from "react-native";

interface DiffPartProps {
  path: string;
  oldText?: string;
  newText?: string;
}

export function DiffPart({ path, oldText, newText }: DiffPartProps) {
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-accent text-xs">DIFF: {path}</Text>
      {oldText && (
        <View className="mb-1">
          <Text className="font-mono text-danger text-xs">-{oldText}</Text>
        </View>
      )}
      <View>
        <Text className="font-mono text-success text-xs">+{newText}</Text>
      </View>
    </View>
  );
}
