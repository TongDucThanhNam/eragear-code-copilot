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
  return (
    <View className="flex-row items-center justify-between bg-background px-4 pb-4 pt-2 dark:bg-black">
      <BackButton />
      <TitleSection status={status} subtitle={subtitle} title={title} />
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
    </View>
  );
}
