import React from "react";
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
	if (!request) return null;

	const toolCall = request.toolCall as any;
	const requestId = request.requestId;

	return (
		<Modal visible={!!request} transparent animationType="slide">
			<View className="flex-1 justify-end bg-black/50">
				<View className="bg-zinc-900 rounded-t-3xl p-6 h-[50%]">
					<Text className="text-white text-xl font-bold mb-4">
						Permission Request
					</Text>
					<Text className="text-zinc-300 mb-2">
						The agent wants to execute:{" "}
						<Text className="font-bold text-yellow-500">
							{toolCall?.kind || "Tool"}
						</Text>
					</Text>

					<ScrollView className="bg-black/30 p-3 rounded-lg mb-4 flex-1">
						<Text className="text-zinc-400 font-mono text-xs">
							{JSON.stringify(toolCall?.rawInput, null, 2)}
						</Text>
					</ScrollView>

					<View className="flex-row justify-between pt-4">
						<TouchableOpacity
							className="flex-1 bg-red-600 p-4 rounded-xl mr-2 items-center"
							onPress={() => onReject(requestId, "reject")}
						>
							<Text className="text-white font-bold">Deny</Text>
						</TouchableOpacity>
						<TouchableOpacity
							className="flex-1 bg-green-600 p-4 rounded-xl ml-2 items-center"
							onPress={() => onApprove(requestId, "allow")}
						>
							<Text className="text-white font-bold">Approve</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>
		</Modal>
	);
}
