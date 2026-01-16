import { FlashList } from "@shopify/flash-list";
import type { ScrollViewProps } from "react-native";
import { Text, View, useColorScheme } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Markdown from "react-native-markdown-display";
import type { ChatMessage, MessagePart } from "@/store/chat-store";

// Inline helper if not exists
const cn_inline = (...classes: (string | undefined)[]) =>
	classes.filter(Boolean).join(" ");

interface ChatMessagesProps {
	messages: ChatMessage[];
	terminalOutputs: Map<string, string>;
	onApprove?: (requestId: string, decision: string) => void;
	onReject?: (requestId: string, decision: string) => void;
	contentPaddingBottom?: number;
	keyboardBottomOffset?: number;
}

export function ChatMessages({
	messages,
	terminalOutputs,
	contentPaddingBottom = 100,
	keyboardBottomOffset = 0,
}: ChatMessagesProps) {
	const listPaddingBottom = Math.max(100, contentPaddingBottom);
	const renderScrollComponent = (props: ScrollViewProps) => (
		<KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
	);

	return (
		<FlashList
			data={messages}
			renderItem={({ item }) => (
				<MessageItem message={item} terminalOutputs={terminalOutputs} />
			)}
			estimatedItemSize={100}
			renderScrollComponent={renderScrollComponent}
			contentContainerStyle={{ padding: 16, paddingBottom: listPaddingBottom }}
			keyboardDismissMode="interactive"
			keyboardShouldPersistTaps="handled"
			inverted={false}
		/>
	);
}

function MessageItem({
	message,
	terminalOutputs,
}: {
	message: ChatMessage;
	terminalOutputs: Map<string, string>;
}) {
	const isUser = message.role === "user";

	return (
		<View
			className={cn_inline(
				"flex-row mb-4",
				isUser ? "justify-end" : "justify-start",
			)}
		>
			<View
				className={cn_inline(
					"max-w-[85%] rounded-2xl p-3",
					isUser ? "bg-accent" : "bg-surface",
				)}
			>
				{message.parts.map((part, index) => (
					<MessagePartItem
						key={index}
						part={part}
						terminalOutputs={terminalOutputs}
					/>
				))}
			</View>
		</View>
	);
}

function MessagePartItem({
	part,
	terminalOutputs,
}: {
	part: MessagePart;
	terminalOutputs: Map<string, string>;
}) {
	const colorScheme = useColorScheme();
	const isDark = colorScheme === "dark";

	if (part.type === "text") {
		return (
			<Markdown
				mergeStyle={false}
				style={{
					text: { color: isDark ? "#ffffff" : "#333333" },
					code: { color: isDark ? "#58a6ff" : "#333333" },
					blockquote: { color: isDark ? "#a0a0a0" : "#666666" },
					link: { color: "#58a6ff" },
				}}
			>
				{part.text}
			</Markdown>
		);
	}

	if (part.type === "reasoning") {
		return (
			<View className="mb-2 border-l-2 border-muted pl-2">
				<Text className="text-muted text-sm italic">{part.text}</Text>
			</View>
		);
	}

	if (part.type === "tool_call") {
		return (
			<View className="mt-2 mb-2 rounded bg-surface p-2">
				<Text className="text-warning font-bold text-xs mb-1">
					TOOL: {part.name}
				</Text>
				<Text className="text-muted text-xs font-mono mb-2">
					{JSON.stringify(part.args, null, 2)}
				</Text>
			</View>
		);
	}

	if (part.type === "tool_result") {
		return (
			<View className="mt-2 mb-2 rounded bg-surface p-2">
				<Text className="text-success font-bold text-xs mb-1">
					RESULT: {part.status}
				</Text>
				<Text className="text-foreground/80 text-xs font-mono">
					{typeof part.output === "string"
						? part.output
						: JSON.stringify(part.output, null, 2)}
				</Text>
			</View>
		);
	}

	if (part.type === "plan") {
		return (
			<View className="mt-2 mb-2 rounded bg-surface p-2">
				<Text className="text-accent font-bold text-xs mb-1">PLAN</Text>
				{part.items.map((item, idx) => (
					<View key={idx} className="flex-row items-start mb-1">
						<Text className="text-foreground/80 mr-2">
							{item.status === "completed"
								? "✓"
								: item.status === "in_progress"
									? "►"
									: "○"}
						</Text>
						<Text className="text-foreground/90 text-sm">{item.content}</Text>
					</View>
				))}
			</View>
		);
	}

	if (part.type === "diff") {
		return (
			<View className="mt-2 mb-2 rounded bg-surface p-2">
				<Text className="text-accent font-bold text-xs mb-1">
					DIFF: {part.path}
				</Text>
				{part.oldText && (
					<View className="mb-1">
						<Text className="text-danger text-xs font-mono">
							-{part.oldText}
						</Text>
					</View>
				)}
				<View>
					<Text className="text-success text-xs font-mono">
						+{part.newText}
					</Text>
				</View>
			</View>
		);
	}

	if (part.type === "terminal") {
		const output = terminalOutputs.get(part.terminalId);
		if (!output) return null;
		return (
			<View className="mt-2 mb-2 rounded bg-surface p-2">
				<Text className="text-success font-bold text-xs mb-1">TERMINAL</Text>
				<View className="bg-surface-foreground/10 rounded p-2 max-h-40">
					<Text className="text-success/80 font-mono text-xs">
						{output.slice(-2000)}
					</Text>
				</View>
			</View>
		);
	}

	return (
		<View>
			<Text className="text-danger">{JSON.stringify(part)}</Text>
		</View>
	);
}
