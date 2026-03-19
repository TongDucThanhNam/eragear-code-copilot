import { Ionicons } from "@expo/vector-icons";
import { BottomSheet, Button, Surface, useThemeColor } from "heroui-native";
import type { ComponentProps } from "react";
import { ScrollView, Text, View } from "react-native";
import { withUniwind } from "uniwind";
import type { PermissionRequest } from "@/store/chat-store";

const StyledIonicons = withUniwind(Ionicons);

interface PermissionModalProps {
  request: PermissionRequest | null;
  onRespond: (requestId: string, decision: string) => void;
}

interface NormalizedOption {
  id: string;
  label: string;
  description?: string;
}

interface ActionTone {
  buttonVariant: "primary" | "secondary" | "danger-soft";
  descriptionClassName: string;
  iconColor: string;
  iconName: ComponentProps<typeof Ionicons>["name"];
}

const DEFAULT_OPTIONS: NormalizedOption[] = [
  { id: "reject", label: "Deny", description: "Reject this tool call." },
  { id: "allow", label: "Approve", description: "Allow once." },
];

function normalizePermissionOptions(
  options: PermissionRequest["options"]
): NormalizedOption[] {
  if (!options) {
    return [];
  }

  const rawOptions = Array.isArray(options) ? options : (options.options ?? []);
  const normalized: NormalizedOption[] = [];

  for (const option of rawOptions) {
    const id =
      option.optionId ||
      option.id ||
      option.kind ||
      option.name ||
      option.label ||
      "";
    const label = option.label || option.name || option.optionId || id;

    if (!(id && label)) {
      continue;
    }

    normalized.push({ id, label, description: option.description });
  }

  return normalized;
}

function getActionTone(
  optionId: string,
  label: string,
  colors: {
    accentForeground: string;
    danger: string;
    foreground: string;
  }
): ActionTone {
  const value = `${optionId} ${label}`.toLowerCase();

  if (
    value.includes("allow") ||
    value.includes("approve") ||
    value.includes("yes")
  ) {
    return {
      buttonVariant: "primary",
      descriptionClassName: "text-accent-foreground/80",
      iconColor: colors.accentForeground,
      iconName: "checkmark-circle",
    };
  }

  if (
    value.includes("deny") ||
    value.includes("reject") ||
    value.includes("no")
  ) {
    return {
      buttonVariant: "danger-soft",
      descriptionClassName: "text-danger/70",
      iconColor: colors.danger,
      iconName: "close-circle",
    };
  }

  return {
    buttonVariant: "secondary",
    descriptionClassName: "text-muted-foreground",
    iconColor: colors.foreground,
    iconName: "arrow-forward-circle",
  };
}

export function PermissionModal({ request, onRespond }: PermissionModalProps) {
  const warningColor = useThemeColor("warning");
  const accentForegroundColor = useThemeColor("accent-foreground");
  const dangerColor = useThemeColor("danger");
  const foregroundColor = useThemeColor("foreground");

  if (!request) {
    return null;
  }

  const requestId = request.requestId;
  const inputText =
    request.input === undefined
      ? "(no input provided)"
      : JSON.stringify(request.input, null, 2);
  const options = normalizePermissionOptions(request.options);
  const actionOptions = options.length > 0 ? options : DEFAULT_OPTIONS;

  return (
    <BottomSheet isOpen onOpenChange={undefined}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay isCloseOnPress={false} />
        <BottomSheet.Content
          className="rounded-t-3xl"
          enablePanDownToClose={false}
          snapPoints={["58%", "82%"]}
        >
          <View className="flex-1 p-6">
            <View className="mb-6 flex-row items-start gap-4">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-warning/10">
                <StyledIonicons
                  className="text-warning"
                  name="shield-checkmark"
                  size={24}
                />
              </View>
              <View className="flex-1">
                <BottomSheet.Title className="font-semibold text-foreground text-lg">
                  Permission Request
                </BottomSheet.Title>
                <BottomSheet.Description className="mt-1 text-muted-foreground text-sm">
                  Review the tool call and choose how to proceed.
                </BottomSheet.Description>
              </View>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 12 }}
              showsVerticalScrollIndicator={false}
            >
              <Surface
                className="overflow-hidden border border-warning/20 p-0"
                variant="secondary"
              >
                <View className="border-warning/20 border-b bg-warning/10 px-4 py-3">
                  <View className="flex-row items-center gap-2">
                    <Ionicons color={warningColor} name="terminal" size={16} />
                    <Text className="font-semibold text-foreground text-sm">
                      {request.title || "Tool"}
                    </Text>
                  </View>
                </View>
                <View className="px-4 py-4">
                  <Text className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
                    Request payload
                  </Text>
                  <Text className="font-mono text-foreground/80 text-xs leading-5">
                    {inputText}
                  </Text>
                </View>
              </Surface>
            </ScrollView>

            <View className="border-divider border-t pt-4">
              <Text className="mb-3 text-muted-foreground text-xs uppercase tracking-wide">
                Choose an action
              </Text>
              <View className="gap-3">
                {actionOptions.map((option) => {
                  const tone = getActionTone(option.id, option.label, {
                    accentForeground: accentForegroundColor,
                    danger: dangerColor,
                    foreground: foregroundColor,
                  });

                  return (
                    <Button
                      className="justify-start rounded-2xl px-4 py-4"
                      key={option.id}
                      onPress={() => onRespond(requestId, option.id)}
                      variant={tone.buttonVariant}
                    >
                      <View className="flex-1 flex-row items-center gap-3">
                        <View className="flex-1">
                          <Button.Label className="text-left">
                            {option.label}
                          </Button.Label>
                          {option.description ? (
                            <Text
                              className={`mt-1 text-left text-xs ${tone.descriptionClassName}`}
                            >
                              {option.description}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons
                          color={tone.iconColor}
                          name={tone.iconName}
                          size={20}
                        />
                      </View>
                    </Button>
                  );
                })}
              </View>
            </View>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
