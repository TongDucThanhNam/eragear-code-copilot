import { Ionicons } from "@expo/vector-icons";
import { BottomSheet, Menu, useThemeColor } from "heroui-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { withUniwind } from "uniwind";
import type { Mode, Model } from "../chat-input/types";

const StyledIonicons = withUniwind(Ionicons);

interface HeaderMenuProps {
  onStop: () => void;
  isSessionStopped?: boolean;
  canResume?: boolean;
  isResumePending?: boolean;
  onResume: () => void;
  availableModes: Mode[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: Model[];
  currentModelId: string | null;
  supportsModelSwitching?: boolean;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function HeaderMenu({
  onStop,
  isSessionStopped,
  canResume = true,
  isResumePending = false,
  onResume,
  availableModes,
  currentModeId,
  onModeChange,
  availableModels,
  currentModelId,
  supportsModelSwitching,
  onModelChange,
  disabled = false,
}: HeaderMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isModeSheetOpen, setIsModeSheetOpen] = useState(false);
  const [isModelSheetOpen, setIsModelSheetOpen] = useState(false);
  const foregroundColor = useThemeColor("foreground");
  const mutedColor = useThemeColor("muted");

  const selectedMode =
    availableModes.find((m) => m.id === currentModeId) ?? availableModes[0];
  const selectedModel =
    availableModels.find((m) => m.modelId === currentModelId) ??
    availableModels[0];

  const handleModeSelect = (modeId: string) => {
    onModeChange(modeId);
    setIsModeSheetOpen(false);
  };

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsModelSheetOpen(false);
  };

  return (
    <>
      <Menu isOpen={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <Menu.Trigger asChild>
          <Pressable
            className="ml-2 h-10 w-10 items-center justify-center rounded-full active:bg-default/20"
            accessibilityLabel="Open menu"
            accessibilityRole="button"
            onPress={() => setIsMenuOpen(true)}
          >
            <Ionicons
              color={foregroundColor}
              name="ellipsis-vertical"
              size={20}
            />
          </Pressable>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Overlay />
          <Menu.Content
            className="rounded-2xl border border-divider/70 bg-overlay p-1"
            presentation="popover"
            width={200}
          >
            {/* Stop/Resume Action */}
            {isSessionStopped ? (
              canResume && (
                <Menu.Item
                  isDisabled={isResumePending}
                  onPress={() => {
                    setIsMenuOpen(false);
                    onResume();
                  }}
                >
                  <StyledIonicons
                    className="mr-2 text-success"
                    name="play"
                    size={18}
                  />
                  <Menu.ItemTitle className="text-success">
                    {isResumePending ? "Resuming..." : "Resume"}
                  </Menu.ItemTitle>
                </Menu.Item>
              )
            ) : (
              <Menu.Item
                onPress={() => {
                  setIsMenuOpen(false);
                  onStop();
                }}
              >
                <StyledIonicons
                  className="mr-2 text-danger"
                  name="stop"
                  size={18}
                />
                <Menu.ItemTitle className="text-danger">Stop</Menu.ItemTitle>
              </Menu.Item>
            )}

            {/* Set Mode */}
            {availableModes.length > 0 && (
              <Menu.Item
                isDisabled={disabled}
                onPress={() => {
                  setIsMenuOpen(false);
                  setIsModeSheetOpen(true);
                }}
              >
                <StyledIonicons
                  className="mr-2 text-foreground"
                  name="options"
                  size={18}
                />
                <View className="flex-1 flex-row items-center justify-between">
                  <Menu.ItemTitle>Mode</Menu.ItemTitle>
                  <Text className="text-muted-foreground text-sm">
                    {selectedMode?.name ?? "Select"}
                  </Text>
                </View>
              </Menu.Item>
            )}

            {/* Set Model */}
            {availableModels.length > 0 && (
              <Menu.Item
                isDisabled={disabled || supportsModelSwitching === false}
                onPress={() => {
                  setIsMenuOpen(false);
                  setIsModelSheetOpen(true);
                }}
              >
                <StyledIonicons
                  className="mr-2 text-foreground"
                  name="cube-outline"
                  size={18}
                />
                <View className="flex-1 flex-row items-center justify-between">
                  <Menu.ItemTitle>Model</Menu.ItemTitle>
                  <Text
                    className="max-w-20 text-muted-foreground text-sm"
                    numberOfLines={1}
                  >
                    {selectedModel?.name ?? "Select"}
                  </Text>
                </View>
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu>

      {/* Mode Selection BottomSheet */}
      <BottomSheet isOpen={isModeSheetOpen} onOpenChange={setIsModeSheetOpen}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content className="rounded-t-3xl" snapPoints={["50%"]}>
            <View className="flex-1 p-6">
              <View className="mb-4 flex-row items-center justify-between">
                <View>
                  <BottomSheet.Title className="font-semibold text-foreground text-lg">
                    Select Mode
                  </BottomSheet.Title>
                  <BottomSheet.Description className="text-muted-foreground text-sm">
                    Choose an agent mode for this session
                  </BottomSheet.Description>
                </View>
                <BottomSheet.Close hitSlop={12}>
                  <Ionicons color={mutedColor} name="close" size={20} />
                </BottomSheet.Close>
              </View>

              <ScrollView className="flex-1">
                {availableModes.map((mode) => (
                  <Pressable
                    className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
                      currentModeId === mode.id
                        ? "bg-default-100"
                        : "active:bg-default-100"
                    }`}
                    key={mode.id}
                    onPress={() => handleModeSelect(mode.id)}
                  >
                    <View className="flex-1">
                      <Text
                        className={`font-medium ${
                          currentModeId === mode.id
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {mode.name}
                      </Text>
                      {mode.description && (
                        <Text className="mt-0.5 text-muted-foreground text-sm">
                          {mode.description}
                        </Text>
                      )}
                    </View>
                    {currentModeId === mode.id && (
                      <StyledIonicons
                        className="text-primary"
                        name="checkmark"
                        size={20}
                      />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>

      {/* Model Selection BottomSheet */}
      <BottomSheet isOpen={isModelSheetOpen} onOpenChange={setIsModelSheetOpen}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content
            className="rounded-t-3xl"
            snapPoints={["50%", "70%"]}
          >
            <View className="flex-1 p-6">
              <View className="mb-4 flex-row items-center justify-between">
                <View>
                  <BottomSheet.Title className="font-semibold text-foreground text-lg">
                    Select Model
                  </BottomSheet.Title>
                  <BottomSheet.Description className="text-muted-foreground text-sm">
                    Choose an AI model for this session
                  </BottomSheet.Description>
                </View>
                <BottomSheet.Close hitSlop={12}>
                  <Ionicons color={mutedColor} name="close" size={20} />
                </BottomSheet.Close>
              </View>

              <ScrollView className="flex-1">
                {availableModels.map((model) => (
                  <Pressable
                    className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
                      currentModelId === model.modelId
                        ? "bg-default-100"
                        : "active:bg-default-100"
                    }`}
                    key={model.modelId}
                    onPress={() => handleModelSelect(model.modelId)}
                  >
                    <View className="flex-1">
                      <Text
                        className={`font-medium ${
                          currentModelId === model.modelId
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {model.name}
                      </Text>
                      {model.description && (
                        <Text className="mt-0.5 text-muted-foreground text-sm">
                          {model.description}
                        </Text>
                      )}
                    </View>
                    {currentModelId === model.modelId && (
                      <StyledIonicons
                        className="text-primary"
                        name="checkmark"
                        size={20}
                      />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </>
  );
}
