import { View } from "react-native";
import { ActionButtons } from "./action-buttons";
import { BackButton } from "./back-button";
import { TitleSection } from "./title-section";
import type { ChatHeaderProps } from "./types";

export function ChatHeader({
  canResume = true,
  isSessionStopped,
  onResume,
  onStop,
  status,
  subtitle,
  title,
}: ChatHeaderProps) {
  return (
    <View className="flex-row items-center justify-between border-divider border-b bg-background px-4 py-3">
      <BackButton />
      <TitleSection status={status} subtitle={subtitle} title={title} />
      <ActionButtons
        canResume={canResume}
        isSessionStopped={isSessionStopped}
        onResume={onResume}
        onStop={onStop}
      />
    </View>
  );
}
