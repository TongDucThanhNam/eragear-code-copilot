import { useThemeColor } from "heroui-native";
import { TextInput } from "react-native";

interface ChatInputAreaProps {
  value: string;
  onChangeText: (text: string) => void;
  disabled?: boolean;
  placeholder: string;
}

export function ChatInputArea({
  value,
  onChangeText,
  disabled,
  placeholder,
}: ChatInputAreaProps) {
  const [accentColor, fieldForegroundColor, fieldPlaceholderColor] =
    useThemeColor(["accent", "field-foreground", "field-placeholder"]);

  return (
    <TextInput
      autoCapitalize="sentences"
      autoCorrect={false}
      className="max-h-32 min-h-8 py-1 text-[17px] leading-6"
      editable={!disabled}
      multiline
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={fieldPlaceholderColor}
      scrollEnabled
      selectionColor={accentColor}
      style={{
        color: fieldForegroundColor,
        textAlignVertical: "top",
      }}
      underlineColorAndroid="transparent"
      value={value}
    />
  );
}
