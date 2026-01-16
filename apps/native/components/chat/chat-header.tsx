import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

interface ChatHeaderProps {
	title: string;
	subtitle?: string;
	status: "idle" | "connecting" | "connected" | "error";
	onStop: () => void;
	onResume: () => void;
	isSessionStopped?: boolean;
	canResume?: boolean;
}

export function ChatHeader({
	title,
	subtitle,
	status,
	onStop,
	onResume,
	isSessionStopped,
	canResume = true,
}: ChatHeaderProps) {
	const router = useRouter();

	return (
		<View className="flex-row items-center justify-between p-4 border-b border-divider bg-background pt-12">
			<TouchableOpacity onPress={() => router.back()} className="mr-2">
				<Ionicons name="arrow-back" size={24} className="text-foreground" />
			</TouchableOpacity>

			<View className="flex-1">
				<Text className="text-foreground font-bold text-lg">{title}</Text>
				<View className="flex-row items-center">
					<View
						className={`w-2 h-2 rounded-full mr-2 ${
							status === "connected"
								? "bg-success"
								: status === "connecting"
									? "bg-warning"
									: status === "error"
										? "bg-danger"
										: "bg-muted"
						}`}
					/>
					<Text className="text-muted text-sm">{subtitle || status}</Text>
				</View>
			</View>

			<View className="flex-row">
				{isSessionStopped ? (
					canResume ? (
					<TouchableOpacity
						onPress={onResume}
						className="bg-success px-3 py-1 rounded ml-2"
					>
						<Text className="text-success-foreground text-sm">Resume</Text>
					</TouchableOpacity>
					) : null
				) : (
					<TouchableOpacity
						onPress={onStop}
						className="bg-danger px-3 py-1 rounded ml-2"
					>
						<Text className="text-danger-foreground text-sm">Stop</Text>
					</TouchableOpacity>
				)}
			</View>
		</View>
	);
}
