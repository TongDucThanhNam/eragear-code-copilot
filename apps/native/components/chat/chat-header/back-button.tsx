import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { TouchableOpacity } from "react-native";

export function BackButton() {
  const router = useRouter();
  const foregroundColor = useThemeColor("foreground");

  return (
    <TouchableOpacity
      className="mr-2 h-10 w-10 items-center justify-center rounded-full active:bg-default-100"
      hitSlop={10}
      onPress={() => router.back()}
    >
      <Ionicons color={foregroundColor} name="arrow-back" size={24} />
    </TouchableOpacity>
  );
}
