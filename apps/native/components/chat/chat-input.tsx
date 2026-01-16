import { Ionicons } from "@expo/vector-icons";
import { Button, cn, Popover, Surface, TextField } from "heroui-native";
import { useState } from "react";
import {
	type LayoutChangeEvent,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { withUniwind } from "uniwind";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	onHeightChange?: (height: number) => void;
	onOpenAttachment?: () => void;
	onVoice?: () => void;
	availableModes: { id: string; name: string; description?: string | null }[];
	currentModeId: string | null;
	onModeChange: (modeId: string) => void;
	availableModels: {
		modelId: string;
		name: string;
		description?: string | null;
	}[];
	currentModelId: string | null;
	onModelChange: (modelId: string) => void;
	availableCommands: {
		name: string;
		description: string;
		input?: { hint: string };
	}[];
}

const StyledIonicons = withUniwind(Ionicons);

export function ChatInput({
	onSend,
	disabled,
	onHeightChange,
	onOpenAttachment,
	availableModes,
	currentModeId,
	onModeChange,
	availableModels,
	currentModelId,
	onModelChange,
	availableCommands,
}: ChatInputProps) {
	const [text, setText] = useState("");
	const [showSlashMenu, setShowSlashMenu] = useState(false);
	const [showModelMenu, setShowModelMenu] = useState(false);
	const [showModeMenu, setShowModeMenu] = useState(false);

	const isSendDisabled = disabled || !text.trim();

	const handleSend = () => {
		if (isSendDisabled) return;
		onSend(text);
		setText("");
	};

	const handleSlashCommand = (command: string) => {
		const formatted = command.startsWith("/") ? command : `/${command}`;
		setText(`${formatted} `);
		setShowSlashMenu(false);
	};

	const handleLayout = (event: LayoutChangeEvent) => {
		onHeightChange?.(event.nativeEvent.layout.height);
	};

	const selectedModeLabel =
		availableModes.find((m) => m.id === currentModeId)?.name ||
		availableModes[0]?.name ||
		"Mode";

	const selectedModelLabel =
		availableModels.find((m) => m.modelId === currentModelId)?.modelId ||
		availableModels[0]?.modelId ||
		"Select model";

	return (
		<View onLayout={handleLayout} className="px-1 pb-3">
			<Surface className="rounded-2xl border border-divider overflow-hidden">
				{/* Mode Selector */}
				{availableModes.length > 0 && (
					<View className="flex-row items-center gap-2 border-b border-divider px-3 py-2">
						<Popover isOpen={showModeMenu} onOpenChange={setShowModeMenu}>
							<Popover.Trigger asChild>
								<Pressable
									onPress={() => {
										if (disabled) return;
										setShowModeMenu(true);
									}}
									className="flex-row items-center justify-between rounded-md border border-divider px-3 py-1.5"
								>
									<Text className="text-sm text-foreground">
										{selectedModeLabel}
									</Text>
									<StyledIonicons
										name="chevron-down"
										size={14}
										className="text-muted"
									/>
								</Pressable>
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Overlay />
								<Popover.Content className="w-48 p-0">
									<View className="py-1">
										{availableModes.map((m) => (
											<Pressable
												key={m.id}
												onPress={() => {
													if (disabled) return;
													onModeChange(m.id);
													setShowModeMenu(false);
												}}
												className="flex-row items-center justify-between px-3 py-2 active:bg-default-100"
											>
												<Text
													className={`font-medium ${
														currentModeId === m.id
															? "text-blue-600"
															: "text-foreground"
													}`}
												>
													{m.name}
												</Text>
											</Pressable>
										))}
									</View>
								</Popover.Content>
							</Popover.Portal>
						</Popover>
					</View>
				)}

				{/* Text Input */}
				<View className="px-3 pt-3">
					<TextField isDisabled={disabled}>
						<TextField.Input
							placeholder="Ask anything or type / for commands"
							placeholderColorClassName="text-muted"
							className="min-h-18 w-full border-0 bg-transparent px-1 text-foreground"
							multiline
							textAlignVertical="top"
							value={text}
							numberOfLines={3}
							onChangeText={setText}
							editable={!disabled}
						/>
					</TextField>
				</View>

				{/* Action Bar */}
				<View className="mt-2 flex-row items-center justify-between px-3 pb-3">
					<View className="flex-row items-center gap-2">
						{/* Attachment Button */}
						<Button
							variant="ghost"
							size="sm"
							isIconOnly
							className="h-9 w-9 rounded-full"
							onPress={onOpenAttachment}
							isDisabled={disabled}
						>
							<Button.Label>
								<StyledIonicons
									name="add"
									size={20}
									className="text-foreground/80"
								/>
							</Button.Label>
						</Button>

						{/* Model Selector - Popover */}
						{availableModels.length > 0 && (
							<Popover isOpen={showModelMenu} onOpenChange={setShowModelMenu}>
								<Popover.Trigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="h-9 rounded-full px-3"
										isDisabled={disabled}
									>
										<Button.Label>
											<Text
												className="text-foreground/80 text-xs max-w-20"
												numberOfLines={1}
											>
												{selectedModelLabel}
											</Text>
										</Button.Label>
									</Button>
								</Popover.Trigger>
								<Popover.Portal>
									<Popover.Overlay />
									<Popover.Content className="w-56 p-0">
										<ScrollView className="max-h-60">
											<View className="py-1">
												{availableModels.map((m) => (
													<Pressable
														key={m.modelId}
														onPress={() => {
															onModelChange(m.modelId);
															setShowModelMenu(false);
														}}
														className="flex-row items-center justify-between px-3 py-2 active:bg-default-100"
													>
														<Text
															className={`font-medium ${
																currentModelId === m.modelId
																	? "text-blue-600"
																	: "text-foreground"
															}`}
														>
															{m.name}
														</Text>
													</Pressable>
												))}
											</View>
										</ScrollView>
									</Popover.Content>
								</Popover.Portal>
							</Popover>
						)}

						{/* Slash Commands - Popover */}
						<Popover isOpen={showSlashMenu} onOpenChange={setShowSlashMenu}>
							<Popover.Trigger asChild>
								<Button
									variant="ghost"
									size="sm"
									isIconOnly
									className="h-9 w-9 rounded-full"
									isDisabled={disabled}
								>
									<Button.Label>
										<StyledIonicons
											name="code-slash"
											size={20}
											className="text-foreground/80"
										/>
									</Button.Label>
								</Button>
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Overlay />
								<Popover.Content className="w-52 p-0">
									<ScrollView className="max-h-60">
										<View className="py-1">
											{availableCommands.map((cmd) => (
												<Pressable
													key={cmd.name}
													onPress={() => handleSlashCommand(cmd.name)}
													className="flex-row items-center justify-between px-3 py-2 active:bg-default-100"
												>
													<Text className="font-medium text-foreground">
														{cmd.name.startsWith("/")
															? cmd.name
															: `/${cmd.name}`}
													</Text>
													<Text
														numberOfLines={1}
														className="max-w-28 text-xs text-muted"
													>
														{cmd.input?.hint || cmd.description}
													</Text>
												</Pressable>
											))}
										</View>
									</ScrollView>
								</Popover.Content>
							</Popover.Portal>
						</Popover>
					</View>

					{/* Send Button */}
					<Button
						size="sm"
						isIconOnly
						variant="primary"
						className={cn(
							"h-10 w-10 rounded-full",
							isSendDisabled ? "bg-muted" : "bg-blue-600",
						)}
						onPress={handleSend}
						isDisabled={isSendDisabled}
					>
						<Button.Label>
							<StyledIonicons
								name="arrow-up"
								size={18}
								className="text-default-foreground"
							/>
						</Button.Label>
					</Button>
				</View>
			</Surface>
		</View>
	);
}
