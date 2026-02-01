import { Text, View } from "react-native";

interface ReasoningPartProps {
  text: string;
}

export function ReasoningPart({ text }: ReasoningPartProps) {
  return (
    <View className="mb-2 border-muted border-l-2 pl-2">
      <Text className="text-muted text-sm italic">{text}</Text>
    </View>
  );
}
