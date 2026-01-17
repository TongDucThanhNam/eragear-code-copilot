import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";

export function BackButton() {
  const router = useRouter();

  return (
    <TouchableOpacity className="mr-2" onPress={() => router.back()}>
      <Ionicons className="text-foreground" name="arrow-back" size={24} />
    </TouchableOpacity>
  );
}
