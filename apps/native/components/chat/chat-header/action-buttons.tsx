import { Button } from "heroui-native";
import { Text } from "react-native";

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
        <Button
          className="ml-2"
          isDisabled={isResumePending}
          size="sm"
          variant={isResumePending ? "tertiary" : "primary"}
          onPress={onResume}
        >
          <Button.Label>
            {isResumePending ? "Resuming..." : "Resume"}
          </Button.Label>
        </Button>
      );
    }
    return null;
  }

  return (
    <Button
      className="ml-2"
      size="sm"
      variant="danger"
      onPress={onStop}
    >
      <Button.Label>Stop</Button.Label>
    </Button>
  );
}
