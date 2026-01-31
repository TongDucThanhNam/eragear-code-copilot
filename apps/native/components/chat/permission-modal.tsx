import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { PermissionRequest } from "@/store/chat-store";

interface PermissionModalProps {
  request: PermissionRequest | null;
  onRespond: (requestId: string, decision: string) => void;
}

type NormalizedOption = {
  id: string;
  label: string;
  description?: string;
};

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
  const rawOptions = Array.isArray(options) ? options : options.options ?? [];
  return rawOptions
    .map((option) => {
      const id =
        option.optionId ||
        option.id ||
        option.kind ||
        option.name ||
        option.label ||
        "";
      const label = option.label || option.name || option.optionId || id;
      if (!id || !label) {
        return null;
      }
      return { id, label, description: option.description };
    })
    .filter((option): option is NormalizedOption => Boolean(option));
}

function getActionStyle(optionId: string, label: string) {
  const value = `${optionId} ${label}`.toLowerCase();
  if (value.includes("allow") || value.includes("approve") || value.includes("yes")) {
    return "bg-green-600";
  }
  if (value.includes("deny") || value.includes("reject") || value.includes("no")) {
    return "bg-red-600";
  }
  return "bg-zinc-700";
}

export function PermissionModal({
  request,
  onRespond,
}: PermissionModalProps) {
  if (!request) {
    return null;
  }

  const toolCall = request.toolCall;
  const requestId = request.requestId;
  const options = normalizePermissionOptions(request.options);
  const actionOptions = options.length > 0 ? options : DEFAULT_OPTIONS;

  return (
    <Modal animationType="slide" transparent visible={!!request}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="h-[50%] rounded-t-3xl bg-zinc-900 p-6">
          <Text className="mb-4 font-bold text-white text-xl">
            Permission Request
          </Text>
          <Text className="mb-2 text-zinc-300">
            The agent wants to execute:{" "}
            <Text className="font-bold text-yellow-500">
              {toolCall?.title || toolCall?.kind || "Tool"}
            </Text>
          </Text>

          <ScrollView className="mb-4 flex-1 rounded-lg bg-black/30 p-3">
            <Text className="font-mono text-xs text-zinc-400">
              {JSON.stringify(toolCall?.rawInput, null, 2)}
            </Text>
          </ScrollView>

          <View className="flex-row flex-wrap gap-3 pt-2">
            {actionOptions.map((option) => (
              <TouchableOpacity
                className={`flex-1 items-center rounded-xl p-4 ${getActionStyle(
                  option.id,
                  option.label
                )}`}
                key={option.id}
                onPress={() => onRespond(requestId, option.id)}
              >
                <Text className="font-bold text-white">{option.label}</Text>
                {option.description && (
                  <Text className="mt-1 text-xs text-white/80">
                    {option.description}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
