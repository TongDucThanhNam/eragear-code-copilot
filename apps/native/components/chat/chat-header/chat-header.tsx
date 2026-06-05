import { Ionicons } from "@expo/vector-icons";
import { Button, Spinner, useThemeColor } from "heroui-native";
import { View } from "react-native";
import { BackButton } from "./back-button";
import { HeaderMenu } from "./header-menu";
import { TitleSection } from "./title-section";
import type { ChatHeaderProps } from "./types";

export function ChatHeader({
  canResume = true,
  isSessionStopped,
  isResumePending = false,
  onResume,
  onStop,
  status,
  subtitle,
  title,
  availableModes = [],
  currentModeId = null,
  onModeChange,
  availableModels = [],
  currentModelId = null,
  supportsModelSwitching,
  onModelChange,
  disabled = false,
}: ChatHeaderProps) {
  const handleModeChange = onModeChange ?? (() => undefined);
  const handleModelChange = onModelChange ?? (() => undefined);
  const successColor = useThemeColor("success");
  const showResumeAction = Boolean(isSessionStopped && canResume);

  return (
    <View className="flex-row items-center justify-between bg-background px-5 pt-2 pb-4 dark:bg-black">
      <BackButton />
      <TitleSection status={status} subtitle={subtitle} title={title} />
      {showResumeAction ? (
        <Button
          accessibilityLabel={
            isResumePending ? "Resuming session" : "Resume session"
          }
          className="ml-2"
          isDisabled={isResumePending}
          isIconOnly
          onPress={onResume}
          variant="secondary"
        >
          {isResumePending ? (
            <Spinner color={successColor} size="sm" />
          ) : (
            <Ionicons color={successColor} name="play" size={22} />
          )}
        </Button>
      ) : (
        <HeaderMenu
          availableModels={availableModels}
          availableModes={availableModes}
          canResume={canResume}
          currentModeId={currentModeId}
          currentModelId={currentModelId}
          disabled={disabled}
          isResumePending={isResumePending}
          isSessionStopped={isSessionStopped}
          onModeChange={handleModeChange}
          onModelChange={handleModelChange}
          onResume={onResume}
          onStop={onStop}
          supportsModelSwitching={supportsModelSwitching}
        />
      )}
    </View>
  );
}
