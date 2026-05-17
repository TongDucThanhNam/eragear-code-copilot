import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { Pressable } from "react-native";

export function BackButton() {
  const router = useRouter();
  const foregroundColor = useThemeColor("foreground");

  return (
    <Pressable
      className="mr-2 h-12 w-12 items-center justify-center rounded-full bg-default active:opacity-80"
      accessibilityLabel="Go back"
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => router.back()}
    >
      <Ionicons color={foregroundColor} name="chevron-back" size={28} />
    </Pressable>
  );
}
