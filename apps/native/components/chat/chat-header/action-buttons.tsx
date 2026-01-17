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
          className="ml-2 rounded bg-success px-3 py-1"
          onPress={onResume}
        >
          <Text className="text-sm text-success-foreground">Resume</Text>
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
}
