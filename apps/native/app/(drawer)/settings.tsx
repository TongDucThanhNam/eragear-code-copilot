import { Ionicons } from "@expo/vector-icons";
import { Button, Card, ErrorView, Surface, TextField } from "heroui-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useSettingsStore, type AgentConfig } from "@/store/settings-store";

type AgentFormState = {
	name: string;
	type: AgentConfig["type"];
	command: string;
	args: string;
	env: string;
	cwd: string;
};

const AGENT_TYPES: AgentConfig["type"][] = [
	"opencode",
	"codex",
	"claude",
	"gemini",
	"other",
];

const emptyForm: AgentFormState = {
	name: "",
	type: "opencode",
	command: "",
	args: "acp",
	env: "{}",
	cwd: "",
};

export default function SettingsScreen() {
	const { settings, setSettings, activeAgentId, setActiveAgentId } =
		useSettingsStore();
	const [editingName, setEditingName] = useState<string | null>(null);
	const [formData, setFormData] = useState<AgentFormState>(emptyForm);
	const [error, setError] = useState<string | null>(null);

	const agents = useMemo(
		() => settings.agent_servers || {},
		[settings.agent_servers],
	);

	const handleEdit = (name: string) => {
		const agent = agents[name];
		setEditingName(name);
		setFormData({
			name,
			type: agent.type,
			command: agent.command,
			args: (agent.args || []).join(" "),
			env: JSON.stringify(agent.env || {}, null, 2),
			cwd: agent.cwd || "",
		});
	};

	const handleDelete = (name: string) => {
		if (activeAgentId === name) return;
		const newAgents = { ...agents };
		delete newAgents[name];
		setSettings({ ...settings, agent_servers: newAgents });

		if (activeAgentId === name) {
			setActiveAgentId(Object.keys(newAgents)[0] || null);
		}
	};

	const handleSave = () => {
		setError(null);
		try {
			const envParsed =
				formData.env.trim().length === 0 ? {} : JSON.parse(formData.env);

			const newAgent: AgentConfig = {
				type: formData.type,
				command: formData.command.trim(),
				args: formData.args.split(" ").filter(Boolean),
				env: envParsed,
				cwd: formData.cwd.trim() || undefined,
			};

			const newAgents = { ...agents };

			if (editingName && editingName !== formData.name) {
				delete newAgents[editingName];
				if (activeAgentId === editingName) {
					setActiveAgentId(formData.name);
				}
			}

			newAgents[formData.name] = newAgent;
			setSettings({ ...settings, agent_servers: newAgents });

			if (!activeAgentId) {
				setActiveAgentId(formData.name);
			}

			setEditingName(null);
			setFormData(emptyForm);
		} catch (err) {
			console.warn("Invalid env JSON", err);
			setError("Invalid ENV JSON. Please fix and save again.");
		}
	};

	const handleAddNew = () => {
		setEditingName(null);
		setFormData(emptyForm);
		setError(null);
	};

	return (
		<Container className="flex-1">
			<View className="flex-1 gap-4 p-4">
				<View className="flex-row items-center justify-between">
					<Text className="text-xl font-semibold text-foreground">
						ACP Agents
					</Text>
					<Button onPress={handleAddNew}>
						<Button.Label>Add Agent</Button.Label>
					</Button>
				</View>

				{Object.keys(agents).length === 0 ? (
					<Surface variant="secondary" className="p-4 rounded-lg">
						<Text className="text-sm text-muted-foreground">
							No agents configured. Add one to start a session.
						</Text>
					</Surface>
				) : (
					Object.entries(agents).map(([name, agent]) => {
						const isActive = activeAgentId === name;
						return (
							<Card key={name} className="p-4 gap-3">
								<View className="flex-row items-center justify-between">
									<View className="flex-row items-center gap-2">
										<Ionicons
											name={isActive ? "radio-button-on" : "radio-button-off"}
											size={16}
											color={isActive ? "#22c55e" : "#94a3b8"}
										/>
										<Text className="text-base font-semibold text-foreground">
											{name}
										</Text>
									</View>
									<View className="flex-row items-center gap-2">
										<Pressable onPress={() => handleEdit(name)}>
											<Ionicons name="create-outline" size={18} color="#64748b" />
										</Pressable>
										<Pressable onPress={() => handleDelete(name)}>
											<Ionicons name="trash-outline" size={18} color="#ef4444" />
										</Pressable>
									</View>
								</View>

								<Text className="text-xs text-muted-foreground">
									{agent.command} {(agent.args || []).join(" ")}
								</Text>

								<View className="flex-row flex-wrap gap-2">
									<View className="rounded-full border border-muted-foreground/40 px-2 py-1">
										<Text className="text-[10px] text-muted-foreground">
											{agent.type}
										</Text>
									</View>
									{agent.cwd ? (
										<View className="rounded-full border border-muted-foreground/40 px-2 py-1">
											<Text className="text-[10px] text-muted-foreground">
												{agent.cwd}
											</Text>
										</View>
									) : null}
									{agent.env && Object.keys(agent.env).length > 0 ? (
										<View className="rounded-full border border-muted-foreground/40 px-2 py-1">
											<Text className="text-[10px] text-muted-foreground">
												{Object.keys(agent.env).length} ENV
											</Text>
										</View>
									) : null}
								</View>

								{!isActive ? (
									<Button
										variant="outline"
										onPress={() => setActiveAgentId(name)}
									>
										<Button.Label>Use This Agent</Button.Label>
									</Button>
								) : null}
							</Card>
						);
					})
				)}

				<Surface variant="secondary" className="p-4 rounded-lg">
					<Text className="text-base font-semibold text-foreground mb-3">
						{editingName ? "Edit Agent" : "Add Agent"}
					</Text>

					<ErrorView isInvalid={!!error} className="mb-3">
						{error}
					</ErrorView>

					<View className="gap-3">
						<TextField>
							<TextField.Label>Name</TextField.Label>
							<TextField.Input
								value={formData.name}
								onChangeText={(value) =>
									setFormData((prev) => ({ ...prev, name: value }))
								}
								placeholder="Default (Opencode)"
								autoCapitalize="none"
							/>
						</TextField>

						<View className="gap-2">
							<Text className="text-xs text-muted-foreground">Type</Text>
							<View className="flex-row flex-wrap gap-2">
								{AGENT_TYPES.map((type) => {
									const isActive = formData.type === type;
									return (
										<Pressable
											key={type}
											onPress={() =>
												setFormData((prev) => ({ ...prev, type }))
											}
											className={`rounded-full border px-3 py-1 ${
												isActive
													? "border-primary bg-primary/10"
													: "border-muted-foreground/40"
											}`}
										>
											<Text
												className={`text-xs ${
													isActive ? "text-primary" : "text-muted-foreground"
												}`}
											>
												{type}
											</Text>
										</Pressable>
									);
								})}
							</View>
						</View>

						<TextField>
							<TextField.Label>Command</TextField.Label>
							<TextField.Input
								value={formData.command}
								onChangeText={(value) =>
									setFormData((prev) => ({ ...prev, command: value }))
								}
								placeholder="opencode"
								autoCapitalize="none"
							/>
						</TextField>

						<TextField>
							<TextField.Label>Arguments</TextField.Label>
							<TextField.Input
								value={formData.args}
								onChangeText={(value) =>
									setFormData((prev) => ({ ...prev, args: value }))
								}
								placeholder="acp"
								autoCapitalize="none"
							/>
						</TextField>

						<TextField>
							<TextField.Label>Working Directory (CWD)</TextField.Label>
							<TextField.Input
								value={formData.cwd}
								onChangeText={(value) =>
									setFormData((prev) => ({ ...prev, cwd: value }))
								}
								placeholder="/path/to/project"
								autoCapitalize="none"
							/>
						</TextField>

						<TextField>
							<TextField.Label>Environment (JSON)</TextField.Label>
							<TextField.Input
								value={formData.env}
								onChangeText={(value) =>
									setFormData((prev) => ({ ...prev, env: value }))
								}
								placeholder="{}"
								autoCapitalize="none"
								multiline
								numberOfLines={4}
								className="font-mono text-xs"
							/>
						</TextField>

						<Button onPress={handleSave}>
							<Button.Label>Save Agent</Button.Label>
						</Button>
					</View>
				</Surface>
			</View>
		</Container>
	);
}
