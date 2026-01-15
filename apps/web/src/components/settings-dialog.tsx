"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
	Terminal,
	Check,
	MessageSquare,
	Cpu,
	Code2,
	Sparkles,
	Folder,
	Edit2,
	Plus,
	Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

import { useSettingsStore, type AgentConfig } from "@/store/settings-store";

export function SettingsDialog() {
	const {
		isOpen,
		setIsOpen,
		settings,
		setSettings,
		activeAgentId,
		setActiveAgentId,
	} = useSettingsStore();

	// Sub-Dialog State (Add/Edit)
	const [isEditOpen, setIsEditOpen] = React.useState(false);
	const [editingName, setEditingName] = React.useState<string | null>(null);
	const [formData, setFormData] = React.useState<{
		name: string;
		type: "claude" | "codex" | "opencode" | "gemini" | "other";
		command: string;
		args: string;
		env: string;
		cwd: string;
	}>({
		name: "",
		type: "opencode",
		command: "",
		args: "",
		env: "{}",
		cwd: "",
	});

	const handleDelete = (name: string) => {
		const newAgents = { ...settings.agent_servers };
		delete newAgents[name];
		setSettings({ ...settings, agent_servers: newAgents });

		if (activeAgentId === name) {
			setActiveAgentId(Object.keys(newAgents)[0] || null);
		}
	};

	const handleEdit = (name: string) => {
		const agent = settings.agent_servers[name];
		setEditingName(name);
		setFormData({
			name: name,
			type: agent.type,
			command: agent.command,
			args: (agent.args || []).join(" "),
			env: JSON.stringify(agent.env || {}, null, 2),
			cwd: agent.cwd || "",
		});
		setIsEditOpen(true);
	};

	const handleAddNew = () => {
		setEditingName(null);
		setFormData({
			name: "",
			type: "opencode",
			command: "",
			args: "",
			env: "{}",
			cwd: "",
		});
		setIsEditOpen(true);
	};

	const handleFormSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		try {
			const envParsed = JSON.parse(formData.env);
			const newAgent = {
				type: formData.type,
				command: formData.command,
				args: formData.args.split(" ").filter(Boolean),
				env: envParsed,
				cwd: formData.cwd || undefined,
			};

			const newAgents = { ...settings.agent_servers };

			if (editingName && editingName !== formData.name) {
				delete newAgents[editingName];
				// If we renamed the active agent, update the ID
				if (activeAgentId === editingName) {
					setActiveAgentId(formData.name);
				}
			}

			newAgents[formData.name] = newAgent;

			setSettings({ ...settings, agent_servers: newAgents });

			// If no active agent, set this one
			if (!activeAgentId) {
				setActiveAgentId(formData.name);
			}

			setIsEditOpen(false);
			toast.success("Settings saved locally");
		} catch (err) {
			console.error("Save error:", err);
			toast.error("Invalid ENV JSON");
		}
	};

	const agents = settings.agent_servers || {};

	const getAgentIcon = (type: string) => {
		switch (type) {
			case "claude":
				return <MessageSquare className="h-4 w-4" />;
			case "codex":
				return <Cpu className="h-4 w-4" />;
			case "opencode":
				return <Code2 className="h-4 w-4" />;
			case "gemini":
				return <Sparkles className="h-4 w-4" />;
			default:
				return <Terminal className="h-4 w-4" />;
		}
	};

	return (
		<>
			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
						<DialogDescription>
							Manage your ACP agent configurations. These are saved in your
							browser.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-6">
						<div className="flex justify-end">
							<Button onClick={handleAddNew} size="sm">
								<Plus className="mr-2 h-4 w-4" /> Add Agent
							</Button>
						</div>

						<div className="grid gap-4">
							{Object.entries(agents).map(([name, config]) => {
								const isActive = activeAgentId === name;
								return (
									<Card
										key={name}
										className={`flex flex-col transition-all ${
											isActive ? "border-primary ring-1 ring-primary" : ""
										}`}
									>
										<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
											<div className="flex items-center gap-2">
												<div className="p-2 bg-muted rounded-md shrink-0">
													{getAgentIcon(config.type)}
												</div>
												<CardTitle className="text-base font-medium">
													{name}
												</CardTitle>
												{isActive && (
													<Badge
														variant="default"
														className="h-5 px-1.5 text-[10px]"
													>
														Active
													</Badge>
												)}
											</div>
											<div className="flex gap-1">
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8"
													onClick={() => handleEdit(name)}
												>
													<Edit2 className="h-3 w-3" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-destructive hover:text-destructive"
													onClick={() => handleDelete(name)}
													disabled={isActive}
													title={
														isActive
															? "Cannot delete active agent"
															: "Delete agent"
													}
												>
													<Trash2 className="h-3 w-3" />
												</Button>
											</div>
										</CardHeader>
										<CardContent className="pt-2 flex-1 flex flex-col justify-between gap-4">
											<div className="flex flex-col gap-2">
												<code className="text-xs bg-muted p-1 rounded flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
													<Terminal className="h-3 w-3 inline shrink-0" />
													{config.command} {(config.args || []).join(" ")}
												</code>
												<div className="flex gap-2">
													<Badge
														variant="secondary"
														className="text-[10px] h-5"
													>
														{config.type}
													</Badge>
													{config.cwd && (
														<Badge
															variant="outline"
															className="text-[10px] h-5 flex items-center gap-1"
														>
															<Folder className="h-2 w-2" />
															{config.cwd}
														</Badge>
													)}
													{config.env && Object.keys(config.env).length > 0 && (
														<Badge
															variant="outline"
															className="text-[10px] h-5"
														>
															{Object.keys(config.env).length} ENV
														</Badge>
													)}
												</div>
											</div>

											{!isActive && (
												<Button
													variant="outline"
													size="sm"
													className="w-full"
													onClick={() => setActiveAgentId(name)}
												>
													<Check className="mr-2 h-3.5 w-3.5" />
													Use This Agent
												</Button>
											)}
										</CardContent>
									</Card>
								);
							})}

							{Object.keys(agents).length === 0 && (
								<div className="col-span-full border border-dashed rounded-lg p-8 text-center text-muted-foreground">
									No agents configured.
								</div>
							)}
						</div>
					</div>
				</DialogContent>
			</Dialog>

			{/* Nested Dialog for Editing */}
			<Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
				<DialogContent className="sm:max-w-[500px]">
					<form onSubmit={handleFormSubmit}>
						<DialogHeader>
							<DialogTitle>
								{editingName ? "Edit Agent" : "Add Agent"}
							</DialogTitle>
						</DialogHeader>
						<div className="grid gap-4 py-4">
							<div className="grid gap-2">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									value={formData.name}
									onChange={(e) =>
										setFormData({ ...formData, name: e.target.value })
									}
									placeholder="My Agent"
									required
								/>
							</div>
							<div className="grid grid-cols-2 gap-4">
								<div className="grid gap-2">
									<Label htmlFor="type">Type</Label>
									<Select
										value={formData.type}
										onValueChange={(v: AgentConfig["type"] | null) => {
											if (v) setFormData({ ...formData, type: v });
										}}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="claude">Claude code</SelectItem>
											<SelectItem value="codex">Codex</SelectItem>
											<SelectItem value="opencode">OpenCode</SelectItem>
											<SelectItem value="gemini">Gemini CLI</SelectItem>
											<SelectItem value="other">Other</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="cmd">Command</Label>
									<Input
										id="cmd"
										value={formData.command}
										onChange={(e) =>
											setFormData({ ...formData, command: e.target.value })
										}
										placeholder="opencode"
										required
									/>
								</div>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="args">Arguments</Label>
								<Input
									id="args"
									value={formData.args}
									onChange={(e) =>
										setFormData({ ...formData, args: e.target.value })
									}
									placeholder="acp"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="cwd">Working Directory (CWD)</Label>
								<Input
									id="cwd"
									value={formData.cwd}
									onChange={(e) =>
										setFormData({ ...formData, cwd: e.target.value })
									}
									placeholder="/path/to/project"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="env">Environment (JSON)</Label>
								<Input
									id="env"
									value={formData.env}
									onChange={(e) =>
										setFormData({ ...formData, env: e.target.value })
									}
									className="font-mono text-xs"
									placeholder="{}"
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setIsEditOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit">Save</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
