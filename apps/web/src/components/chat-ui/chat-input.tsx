"use client";

import {
	AtSign as AtSignIcon,
	CheckIcon,
	ChevronDown,
	Files as FilesIcon,
	Globe as GlobeIcon,
	Ruler as RulerIcon,
} from "lucide-react";
import { type RefObject, useState } from "react";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputBody,
	PromptInputButton,
	PromptInputCommand,
	PromptInputCommandEmpty,
	PromptInputCommandGroup,
	PromptInputCommandInput,
	PromptInputCommandItem,
	PromptInputCommandList,
	PromptInputCommandSeparator,
	PromptInputFooter,
	PromptInputHeader,
	PromptInputHoverCard,
	PromptInputHoverCardContent,
	PromptInputHoverCardTrigger,
	type PromptInputMessage,
	PromptInputProvider,
	PromptInputSelect,
	PromptInputSelectContent,
	PromptInputSelectItem,
	PromptInputSelectTrigger,
	PromptInputSelectValue,
	PromptInputSubmit,
	PromptInputTab,
	PromptInputTabBody,
	PromptInputTabItem,
	PromptInputTabLabel,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";

export type ChatInputProps = {
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	status: "submitted" | "streaming" | "ready" | "error";
	connStatus: "idle" | "connecting" | "connected" | "error";
	availableModes: { id: string; name: string; description?: string }[];
	currentModeId: string | null;
	onModeChange: (modeId: string) => void;
	availableModels: { modelId: string; name: string; description?: string }[];
	currentModelId: string | null;
	onModelChange: (modelId: string) => void;
	onSubmit: (message: PromptInputMessage) => void;
	// Context Props
	activeTabs?: { path: string }[];
	projectRules?: { path: string; location: string }[];
	availableCommands?: {
		name: string;
		description: string;
		input?: { hint: string };
	}[];
};

export function ChatInput({
	textareaRef,
	status,
	connStatus,
	availableModes,
	currentModeId,
	onModeChange,
	availableModels,
	currentModelId,
	onModelChange,
	onSubmit,
	activeTabs = [],
	projectRules = [],
	availableCommands = [],
}: ChatInputProps) {
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

	const getProviderFromModelId = (modelId: string) => {
		if (modelId.startsWith("anthropic")) return "anthropic";
		if (modelId.startsWith("google") || modelId.startsWith("gemini"))
			return "google";
		if (modelId.startsWith("openai") || modelId.startsWith("gpt"))
			return "openai";
		if (modelId.startsWith("deepseek")) return "deepseek";
		if (modelId.startsWith("mistral")) return "mistral";
		if (modelId.startsWith("meta") || modelId.startsWith("llama"))
			return "meta";
		return "opencode"; // default
	};

	const groupedModels = availableModels.reduce(
		(acc, model) => {
			const provider = getProviderFromModelId(model.modelId);
			if (!acc[provider]) acc[provider] = [];
			acc[provider].push(model);
			return acc;
		},
		{} as Record<
			string,
			{ modelId: string; name: string; description?: string }[]
		>,
	);

	return (
		<div className="w-full px-4 py-4">
			<PromptInputProvider>
				<PromptInput globalDrop multiple onSubmit={onSubmit}>
					<PromptInputHeader>
						<PromptInputHoverCard>
							<PromptInputHoverCardTrigger>
								<PromptInputButton
									className="h-8!"
									size="icon-sm"
									variant="outline"
								>
									<AtSignIcon className="text-muted-foreground" size={12} />
								</PromptInputButton>
							</PromptInputHoverCardTrigger>
							<PromptInputHoverCardContent className="w-[400px] p-0">
								<PromptInputCommand>
									<PromptInputCommandInput
										className="border-none focus-visible:ring-0"
										placeholder="Add files, folders, docs..."
									/>
									<PromptInputCommandList>
										<PromptInputCommandEmpty className="p-3 text-muted-foreground text-sm">
											No results found.
										</PromptInputCommandEmpty>
										<PromptInputCommandGroup heading="Added">
											<PromptInputCommandItem>
												<GlobeIcon />
												<span>Active Tabs</span>
												<span className="ml-auto text-muted-foreground">✓</span>
											</PromptInputCommandItem>
										</PromptInputCommandGroup>
										<PromptInputCommandSeparator />
										{availableCommands.length > 0 && (
											<>
												<PromptInputCommandGroup heading="Slash Commands">
													{availableCommands.map((cmd) => (
														<PromptInputCommandItem key={cmd.name}>
															<span>/{cmd.name}</span>
															<span className="ml-2 text-muted-foreground text-xs">
																- {cmd.description}
															</span>
														</PromptInputCommandItem>
													))}
												</PromptInputCommandGroup>
												<PromptInputCommandSeparator />
											</>
										)}
										<PromptInputCommandGroup heading="Other Files">
											{activeTabs.map((file, index) => (
												<PromptInputCommandItem key={`${file.path}-${index}`}>
													<GlobeIcon className="text-primary" />
													<div className="flex flex-col">
														<span className="font-medium text-sm">
															{file.path}
														</span>
													</div>
												</PromptInputCommandItem>
											))}
										</PromptInputCommandGroup>
									</PromptInputCommandList>
								</PromptInputCommand>
							</PromptInputHoverCardContent>
						</PromptInputHoverCard>
						<PromptInputHoverCard>
							<PromptInputHoverCardTrigger>
								<PromptInputButton size="sm" variant="outline">
									<RulerIcon className="text-muted-foreground" size={12} />
									<span>
										{projectRules.length > 0 ? projectRules.length : ""}
									</span>
								</PromptInputButton>
							</PromptInputHoverCardTrigger>
							<PromptInputHoverCardContent className="divide-y overflow-hidden p-0">
								<div className="space-y-2 p-3">
									<p className="font-medium text-muted-foreground text-sm">
										Attached Project Rules
									</p>
									{projectRules.length > 0 ? (
										<>
											<p className="ml-4 text-muted-foreground text-sm">
												Always Apply:
											</p>
											{projectRules.map((rule) => (
												<p key={rule.path} className="ml-8 text-sm">
													{rule.path}
												</p>
											))}
										</>
									) : (
										<p className="ml-4 text-sm text-muted-foreground">
											No project rules found.
										</p>
									)}
								</div>
								<p className="bg-sidebar px-4 py-3 text-muted-foreground text-sm">
									Click to manage
								</p>
							</PromptInputHoverCardContent>
						</PromptInputHoverCard>
						<PromptInputHoverCard>
							<PromptInputHoverCardTrigger>
								<PromptInputButton size="sm" variant="outline">
									<FilesIcon className="text-muted-foreground" size={12} />
									<span>{activeTabs.length} Tabs</span>
								</PromptInputButton>
							</PromptInputHoverCardTrigger>
							<PromptInputHoverCardContent className="w-[300px] space-y-4 px-0 py-3">
								<PromptInputTab>
									<PromptInputTabLabel>Active Tabs</PromptInputTabLabel>
									<PromptInputTabBody>
										{activeTabs.map((tab) => (
											<PromptInputTabItem key={tab.path}>
												<GlobeIcon className="text-primary" size={16} />
												<span className="truncate" dir="rtl">
													{tab.path}
												</span>
											</PromptInputTabItem>
										))}
									</PromptInputTabBody>
								</PromptInputTab>

								<div className="border-t px-3 pt-2 text-muted-foreground text-xs">
									Only file paths are included
								</div>
							</PromptInputHoverCardContent>
						</PromptInputHoverCard>
						<PromptInputAttachments>
							{(attachment) => <PromptInputAttachment data={attachment} />}
						</PromptInputAttachments>
					</PromptInputHeader>
					<PromptInputBody>
						<PromptInputTextarea ref={textareaRef} />
					</PromptInputBody>
					<PromptInputFooter>
						<PromptInputTools>
							<PromptInputActionMenu>
								<PromptInputActionMenuTrigger />
								<PromptInputActionMenuContent>
									<PromptInputActionAddAttachments />
								</PromptInputActionMenuContent>
							</PromptInputActionMenu>

							{connStatus === "connected" && availableModes.length > 0 && (
								<PromptInputSelect
									value={currentModeId || ""}
									onValueChange={(val: any) => onModeChange(val)}
								>
									<PromptInputSelectTrigger className="h-8 py-0 px-2 min-w-[70px]">
										<PromptInputSelectValue />
									</PromptInputSelectTrigger>
									<PromptInputSelectContent>
										{availableModes.map((mode) => (
											<PromptInputSelectItem key={mode.id} value={mode.id}>
												{mode.name}
											</PromptInputSelectItem>
										))}
									</PromptInputSelectContent>
								</PromptInputSelect>
							)}

							{connStatus === "connected" && availableModels.length > 0 && (
								<ModelSelector
									open={modelSelectorOpen}
									onOpenChange={setModelSelectorOpen}
								>
									<ModelSelectorTrigger
										render={
											<PromptInputButton className="gap-1.5 px-2 min-w-[100px]">
												<ModelSelectorLogo
													provider={getProviderFromModelId(
														currentModelId || "",
													)}
												/>
												<ModelSelectorName>
													{availableModels.find(
														(m) => m.modelId === currentModelId,
													)?.name || "Select Model"}
												</ModelSelectorName>
												<ChevronDown className="h-3.5 w-3.5 opacity-50" />
											</PromptInputButton>
										}
									/>
									<ModelSelectorContent title="Select Assistant Model">
										<ModelSelectorInput placeholder="Search models..." />
										<ModelSelectorList>
											<ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
											{Object.entries(groupedModels).map(
												([provider, models]) => (
													<ModelSelectorGroup
														key={provider}
														heading={provider.toUpperCase()}
													>
														{models.map((m) => (
															<ModelSelectorItem
																key={m.modelId}
																onSelect={() => {
																	onModelChange(m.modelId);
																	setModelSelectorOpen(false);
																}}
																value={m.modelId}
																className="gap-2"
															>
																<ModelSelectorLogo
																	provider={getProviderFromModelId(m.modelId)}
																/>
																<ModelSelectorName>{m.name}</ModelSelectorName>
																{currentModelId === m.modelId ? (
																	<CheckIcon className="ml-auto size-4" />
																) : (
																	<div className="ml-auto size-4" />
																)}
															</ModelSelectorItem>
														))}
													</ModelSelectorGroup>
												),
											)}
										</ModelSelectorList>
									</ModelSelectorContent>
								</ModelSelector>
							)}
						</PromptInputTools>
						<PromptInputSubmit status={status} />
					</PromptInputFooter>
				</PromptInput>
			</PromptInputProvider>
		</div>
	);
}
