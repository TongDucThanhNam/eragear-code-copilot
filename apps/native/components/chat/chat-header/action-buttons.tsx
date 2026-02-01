import { Text, TouchableOpacity } from "react-native";

interface ActionButtonsProps {
  isSessionStopped?: boolean;
  canResume?: boolean;
  onStop: () => void;
  onResume: () => void;
}

export function ActionButtons({
  isSessionStopped,
  canResume = true,
  onStop,
  onResume,
}: ActionButtonsProps) {
  if (isSessionStopped) {
    if (canResume) {
      return (
        <TouchableOpacity
          className="ml-2 rounded-full border border-success/40 bg-success/15 px-3.5 py-1.5"
          onPress={onResume}
        >
          <Text className="text-xs text-success">Resume</Text>
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
