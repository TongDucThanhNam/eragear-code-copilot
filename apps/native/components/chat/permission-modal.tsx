import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { PermissionRequest } from "@/store/chat-store";

interface PermissionModalProps {
  request: PermissionRequest | null;
  onApprove: (requestId: string, decision: string) => void;
  onReject: (requestId: string, decision: string) => void;
}

export function PermissionModal({
  request,
  onApprove,
  onReject,
}: PermissionModalProps) {
  if (!request) {
    return null;
  }

  const toolCall = request.toolCall;
  const requestId = request.requestId;

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
              {toolCall?.kind || "Tool"}
            </Text>
          </Text>

          <ScrollView className="mb-4 flex-1 rounded-lg bg-black/30 p-3">
            <Text className="font-mono text-xs text-zinc-400">
              {JSON.stringify(toolCall?.rawInput, null, 2)}
            </Text>
          </ScrollView>

          <View className="flex-row justify-between pt-4">
            <TouchableOpacity
              className="mr-2 flex-1 items-center rounded-xl bg-red-600 p-4"
              onPress={() => onReject(requestId, "reject")}
            >
              <Text className="font-bold text-white">Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="ml-2 flex-1 items-center rounded-xl bg-green-600 p-4"
              onPress={() => onApprove(requestId, "allow")}
            >
              <Text className="font-bold text-white">Approve</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
