import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Text, TouchableOpacity, View } from "react-native";

interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  status: "idle" | "connecting" | "connected" | "error";
  onStop: () => void;
  onResume: () => void;
  isSessionStopped?: boolean;
  canResume?: boolean;
}

function getStatusColor(status: ChatHeaderProps["status"]): string {
  switch (status) {
    case "connected":
      return "bg-success";
    case "connecting":
      return "bg-warning";
    case "error":
      return "bg-danger";
    default:
      return "bg-muted";
  }
}

function getStatusLabel(status: ChatHeaderProps["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function ChatHeader({
  title,
  subtitle,
  status,
  onStop,
  onResume,
  isSessionStopped,
  canResume = true,
}: ChatHeaderProps) {
  const router = useRouter();
  const statusColor = getStatusColor(status);
  const statusText = subtitle || getStatusLabel(status);

  return (
    <View className="flex-row items-center justify-between border-divider border-b bg-background p-4 pt-12">
      <TouchableOpacity className="mr-2" onPress={() => router.back()}>
        <Ionicons className="text-foreground" name="arrow-back" size={24} />
      </TouchableOpacity>

      <View className="flex-1">
        <Text className="font-bold text-foreground text-lg">{title}</Text>
        <View className="flex-row items-center">
          <View className={`mr-2 h-2 w-2 rounded-full ${statusColor}`} />
          <Text className="text-muted text-sm">{statusText}</Text>
        </View>
      </View>

      <View className="flex-row">
        {(() => {
          if (isSessionStopped) {
            if (canResume) {
              return (
                <TouchableOpacity
                  className="ml-2 rounded bg-success px-3 py-1"
                  onPress={onResume}
                >
                  <Text className="text-sm text-success-foreground">
                    Resume
                  </Text>
                </TouchableOpacity>
              );
            }
            return null;
          }
          return (
            <TouchableOpacity
              className="ml-2 rounded bg-danger px-3 py-1"
              onPress={onStop}
            >
              <Text className="text-danger-foreground text-sm">Stop</Text>
            </TouchableOpacity>
          );
        })()}
      </View>
    </View>
  );
}
