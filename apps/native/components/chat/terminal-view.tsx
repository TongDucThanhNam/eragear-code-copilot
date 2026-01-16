import React from "react";
import { View, Text, ScrollView } from "react-native";

interface TerminalViewProps {
	output: string;
}

export function TerminalView({ output }: TerminalViewProps) {
	return (
		<ScrollView className="bg-black p-2 rounded h-40">
			<Text className="text-green-500 font-mono text-xs">{output}</Text>
		</ScrollView>
	);
}
