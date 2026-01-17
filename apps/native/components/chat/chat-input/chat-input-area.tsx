import { TextField } from "heroui-native";
import { TextInput, View } from "react-native";

interface ChatInputAreaProps {
  value: string;
  onChangeText: (text: string) => void;
  disabled?: boolean;
}

export function ChatInputArea({
  value,
  onChangeText,
  disabled,
}: ChatInputAreaProps) {
  return (
    <View className="px-3 pt-3">
      <TextField isDisabled={disabled}>
        <TextInput
          className="min-h-18 w-full border-0 bg-transparent px-1 text-foreground"
          editable={!disabled}
          multiline
          numberOfLines={3}
          onChangeText={onChangeText}
          placeholder="Ask anything or type / for commands"
          placeholderTextColor="#8e8e93"
          textAlignVertical="top"
          value={value}
        />
      </TextField>
    </View>
  );
}
