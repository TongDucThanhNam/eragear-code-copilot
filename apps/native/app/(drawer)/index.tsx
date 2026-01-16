import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Button, Card, Spinner, Tabs } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import {
	FlatList,
	Modal,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

type FilterTab = "all" | "active" | "inactive";

function truncateSessionId(id: string | undefined): string {
	if (!id) return "Unknown";
	if (id.length <= 12) return id;
	return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

export default function SessionsScreen() {
	const router = useRouter();
	const { setActiveChatId, setSessions, setConnStatus, setModes, setModels } =
		useChatStore();
	const activeAgentId = useSettingsStore((s) => s.activeAgentId);
	const setActiveAgentId = useSettingsStore((s) => s.setActiveAgentId);
	const getAgents = useSettingsStore((s) => s.getAgents);
	const [error, setError] = useState<string | null>(null);
	const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<FilterTab>("active");

	const sessionsQuery = trpc.getSessions.useQuery(undefined, {
		refetchOnWindowFocus: true,
	});

	const createSessionMutation = trpc.createSession.useMutation();

	const deleteSessionMutation = trpc.deleteSession.useMutation({
		onSuccess: () => {
			sessionsQuery.refetch();
		},
	});

	const handleCreateSession = () => {
		setError(null);
		const agents = getAgents();
		if (agents.length === 0) {
			setError("Please configure an ACP agent before starting a session.");
			router.push("/settings" as any);
			return;
		}

		setIsAgentPickerOpen(true);
	};

	const handleSelectAgent = async (agentId: string) => {
		setError(null);
		setIsAgentPickerOpen(false);

		const agent = getAgents().find((a) => a.id === agentId);
		if (!agent) {
			setError("Selected agent not found. Please configure an ACP agent.");
			router.push("/settings" as any);
			return;
		}

		setActiveAgentId(agentId);
		setConnStatus("connecting");

		try {
			const data = await createSessionMutation.mutateAsync({
				projectRoot: ".",
				command: agent.command,
				args: agent.args,
				env: agent.env,
				cwd: agent.cwd,
			});

			setActiveChatId(data.chatId);
			if (data.modes) setModes(data.modes);
			if (data.models) setModels(data.models);
			setConnStatus("connected");

			sessionsQuery.refetch();
			router.push(`/chats/${data.chatId}` as any);
		} catch (err) {
			const message =
				typeof err === "object" && err && "message" in err
					? String((err as { message: string }).message)
					: "Failed to create session.";
			setConnStatus("error");
			setError(message);
		}
	};

	const handleOpenSession = (chatId: string, isActive?: boolean) => {
		const readOnly = !isActive;
		setActiveChatId(chatId, readOnly);
		// Pass isActive as query param so chat screen knows if it's read-only
		router.push(`/chats/${chatId}?readonly=${readOnly}` as any);
	};

	const handleDeleteSession = (chatId: string) => {
		deleteSessionMutation.mutate({ chatId });
	};

	const sessions = sessionsQuery.data ?? [];
	const agents = getAgents();

	// Filter sessions based on active tab
	const filteredSessions = useMemo(() => {
		if (activeTab === "all") return sessions;
		if (activeTab === "active") return sessions.filter((s) => s.isActive);
		return sessions.filter((s) => !s.isActive); // inactive
	}, [sessions, activeTab]);

	useEffect(() => {
		if (!sessionsQuery.data) return;
		setSessions(sessionsQuery.data);
	}, [sessionsQuery.data, setSessions]);

	const activeCount = sessions.filter((s) => s.isActive).length;
	const inactiveCount = sessions.filter((s) => !s.isActive).length;

	return (
		<Container className="flex-1" scroll={false}>
			<View className="flex-1 p-4">
				{error ? (
					<View className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
						<Text className="text-sm text-destructive">{error}</Text>
					</View>
				) : null}
				{/* Header with New Chat button */}
				<View className="flex-row justify-between items-center mb-4">
					<Text className="text-xl font-semibold text-foreground">
						Chat Sessions
					</Text>
					<Button
						onPress={handleCreateSession}
						isDisabled={createSessionMutation.isPending}
					>
						{createSessionMutation.isPending ? (
							<Spinner size="sm" />
						) : (
							<>
								<Ionicons name="add" size={20} color="white" />
								<Text className="text-white ml-1">New Chat</Text>
							</>
						)}
					</Button>
				</View>
				{/* Filter Tabs */}
				<Tabs
					value={activeTab}
					onValueChange={(key) => setActiveTab(key as FilterTab)}
					variant="pill"
				>
					<Tabs.List>
						<Tabs.ScrollView scrollAlign="center" className="w-full">
							<Tabs.Indicator />
							<Tabs.Trigger value="active">
								<Tabs.Label>Active ({activeCount})</Tabs.Label>
							</Tabs.Trigger>
							<Tabs.Trigger value="inactive">
								<Tabs.Label>Inactive ({inactiveCount})</Tabs.Label>
							</Tabs.Trigger>
							<Tabs.Trigger value="all">
								<Tabs.Label>All ({sessions.length})</Tabs.Label>
							</Tabs.Trigger>
						</Tabs.ScrollView>
					</Tabs.List>
				</Tabs>
				{/* Sessions List */}
				{sessionsQuery.isLoading ? (
					<View className="flex-1 justify-center items-center">
						<Spinner size="lg" />
						<Text className="text-muted-foreground mt-2">
							Loading sessions...
						</Text>
					</View>
				) : filteredSessions.length === 0 ? (
					<View className="flex-1 justify-center items-center">
						<Ionicons name="chatbubbles-outline" size={64} color="#888" />
						<Text className="text-muted-foreground mt-4 text-center">
							{activeTab === "active"
								? "No active sessions.\nStart a new chat to begin!"
								: activeTab === "inactive"
									? "No inactive sessions."
									: "No chat sessions yet.\nCreate one to get started!"}
						</Text>
					</View>
				) : (
					<FlatList
						data={filteredSessions}
						keyExtractor={(item) => item.id}
						refreshControl={
							<RefreshControl
								refreshing={sessionsQuery.isFetching}
								onRefresh={() => sessionsQuery.refetch()}
							/>
						}
						renderItem={({ item }) => (
							<Pressable
								onPress={() => handleOpenSession(item.id, item.isActive)}
							>
								<Card className="mb-3 p-4">
									<View className="flex-row justify-between items-center">
										<View className="flex-1">
											<View className="flex-row items-center">
												<Text
													className="text-foreground font-medium flex-1"
													numberOfLines={1}
												>
													{truncateSessionId(item.sessionId)}
												</Text>
												{!item.isActive && (
													<View className="bg-zinc-700 rounded px-2 py-0.5 ml-2">
														<Text className="text-xs text-zinc-300">
															{item.loadSessionSupported
																? "Resume available"
																: "Read-only"}
														</Text>
													</View>
												)}
											</View>
											<View className="flex-row items-center mt-1">
												<View
													className={`w-2 h-2 rounded-full mr-2 ${
														item.isActive ? "bg-green-500" : "bg-zinc-500"
													}`}
												/>
												<Text className="text-muted-foreground text-sm">
													{item.isActive ? "Active" : "Inactive"}
												</Text>
												{item.modeId && (
													<Text className="text-muted-foreground text-sm ml-2">
														• {item.modeId}
													</Text>
												)}
											</View>
										</View>
										<Pressable
											onPress={() => handleDeleteSession(item.id)}
											className="p-2"
										>
											<Ionicons
												name="trash-outline"
												size={20}
												color="#ef4444"
											/>
										</Pressable>
									</View>
								</Card>
							</Pressable>
						)}
					/>
				)}
			</View>

			<Modal
				visible={isAgentPickerOpen}
				transparent
				animationType="slide"
				onRequestClose={() => setIsAgentPickerOpen(false)}
			>
				<View className="flex-1 justify-end bg-black/60">
					<View className="bg-zinc-900 rounded-t-3xl p-6 max-h-[70%]">
						<View className="flex-row items-center justify-between mb-4">
							<Text className="text-white text-lg font-semibold">
								Select Agent
							</Text>
							<Pressable onPress={() => setIsAgentPickerOpen(false)}>
								<Ionicons name="close" size={20} color="#94a3b8" />
							</Pressable>
						</View>

						<ScrollView>
							{agents.length === 0 ? (
								<Text className="text-sm text-zinc-400">
									No agents configured.
								</Text>
							) : (
								agents.map((agent) => (
									<Pressable
										key={agent.id}
										onPress={() => handleSelectAgent(agent.id)}
										className="mb-3 rounded-xl border border-zinc-700 p-4"
										disabled={createSessionMutation.isPending}
									>
										<View className="flex-row items-center justify-between">
											<View className="flex-1">
												<Text className="text-white font-semibold">
													{agent.name}
												</Text>
												<Text className="text-xs text-zinc-400 mt-1">
													{agent.type} • {agent.command}
												</Text>
											</View>
											{activeAgentId === agent.id ? (
												<Ionicons
													name="checkmark-circle"
													size={18}
													color="#22c55e"
												/>
											) : null}
										</View>
									</Pressable>
								))
							)}
						</ScrollView>

						<View className="pt-2">
							<Button
								variant="ghost"
								onPress={() => setIsAgentPickerOpen(false)}
								isDisabled={createSessionMutation.isPending}
							>
								<Button.Label>Cancel</Button.Label>
							</Button>
						</View>
					</View>
				</View>
			</Modal>
		</Container>
	);
}
