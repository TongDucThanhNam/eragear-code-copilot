import { Text, TouchableOpacity } from "react-native";

interface ActionButtonsProps {
  isSessionStopped?: boolean;
  canResume?: boolean;
  isResumePending?: boolean;
  onStop: () => void;
  onResume: () => void;
}

export function ActionButtons({
  isSessionStopped,
  canResume = true,
  isResumePending = false,
  onStop,
  onResume,
}: ActionButtonsProps) {
  if (isSessionStopped) {
    if (canResume) {
      return (
        <TouchableOpacity
          className={`ml-2 rounded-full border px-3.5 py-1.5 ${
            isResumePending
              ? "border-default/30 bg-default/10"
              : "border-success/40 bg-success/15"
          }`}
          disabled={isResumePending}
          onPress={onResume}
        >
          <Text
            className={`text-xs ${
              isResumePending ? "text-muted-foreground" : "text-success"
            }`}
          >
            {isResumePending ? "Resuming..." : "Resume"}
          </Text>
        </TouchableOpacity>
      );
    }
    return null;
  }

  return (
    <TouchableOpacity
      className="ml-2 rounded-full border border-danger/40 bg-danger/15 px-3.5 py-1.5"
      onPress={onStop}
    >
      <Text className="text-xs text-danger">Stop</Text>
    </TouchableOpacity>
  );
}
