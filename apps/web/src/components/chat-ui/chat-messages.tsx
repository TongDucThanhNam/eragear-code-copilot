"use client";

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	Plan,
	PlanContent,
	PlanHeader,
	PlanItem,
	type PlanStatus,
	PlanTitle,
	PlanTrigger,
} from "@/components/ai-elements/plan";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";

export type TextPart = {
	type: "text";
	content: string;
};

export type ToolPart = {
	type: "tool";
	toolCallId: string;
	requestId?: string;
	name: string;
	description: string;
	status: "pending" | "running" | "completed" | "error" | "approval-requested";
	parameters: Record<string, unknown>;
	result: string | undefined;
	error: string | undefined;
	options?: any[];
	terminalId?: string;
	diffs?: { path: string; oldText?: string; newText: string }[];
};

export type PlanPart = {
	type: "plan";
	entries: { content: string; status: PlanStatus }[];
};

export type MessagePart = TextPart | ToolPart | PlanPart;

export type MessageType = {
	key: string;
	from: "user" | "assistant";
	sources?: { href: string; title: string }[];
	parts: MessagePart[];
	reasoning?: {
		content: string;
		duration: number;
	};
};

export type ChatMessagesProps = {
	messages: MessageType[];
	terminalOutputs?: Record<string, string>;
	onApprove?: (requestId: string, decision?: string) => void;
	onReject?: (requestId: string, decision?: string) => void;
	// onRetry? // If we want to support retry in the future without versions
};

import {
	Confirmation,
	ConfirmationAction,
	ConfirmationActions,
	ConfirmationRequest,
	ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { TerminalView } from "./terminal-view";
import { FileDiffView } from "./file-diff-view";

export function ChatMessages({
	messages,
	terminalOutputs,
	onApprove,
	onReject,
}: ChatMessagesProps) {
	return (
		<Conversation className="flex-1 min-h-0 overflow-y-auto">
			<ConversationContent>
				{messages.map((message) => (
					<Message from={message.from} key={message.key}>
						<div>
							{message.reasoning && (
								<Reasoning>
									<ReasoningTrigger />
									<ReasoningContent>
										{message.reasoning.content}
									</ReasoningContent>
								</Reasoning>
							)}
							<MessageContent>
								{message.parts.map((part, index) => {
									if (part.type === "text") {
										return (
											<MessageResponse key={part.content}>
												{part.content}
											</MessageResponse>
										);
									}

									if (part.type === "plan") {
										return (
											<Plan
												key={part.entries[0].content}
												defaultOpen={true}
												className="mb-4"
											>
												<PlanHeader>
													<PlanTitle>Plan</PlanTitle>
													<PlanTrigger />
												</PlanHeader>
												<PlanContent>
													<div className="space-y-2 pt-2">
														{part.entries.map((entry, i) => (
															<PlanItem key={i} status={entry.status}>
																{entry.content}
															</PlanItem>
														))}
													</div>
												</PlanContent>
											</Plan>
										);
									}

									if (part.type === "tool") {
										return (
											<div key={part.toolCallId} className="mb-4 space-y-2">
												<Tool key={part.toolCallId}>
													<ToolHeader
														type="tool-call"
														title={part.name}
														state={part.status}
													/>
													<ToolContent>
														<ToolInput input={part.parameters} />
														<Confirmation
															state={part.status}
															approval={{ id: part.toolCallId }}
														>
															<ConfirmationRequest>
																<ConfirmationTitle>
																	Requesting permission to execute
																</ConfirmationTitle>
																<ConfirmationActions>
																	{/* Check if we have specific options */}
																	{part.options && part.options.length > 0 ? (
																		part.options.map((opt: any) => (
																			<ConfirmationAction
																				key={opt.optionId || opt.id}
																				onClick={() => {
																					// Heuristic mapping for frontend:
																					const id = String(
																						opt.optionId || opt.id || "",
																					).toLowerCase();
																					const isAllow =
																						id === "allow" ||
																						id === "yes" ||
																						id === "allow_once";

																					if (isAllow) {
																						part.requestId &&
																							onApprove?.(
																								part.requestId,
																								opt.optionId || opt.id,
																							);
																					} else {
																						part.requestId &&
																							onReject?.(
																								part.requestId,
																								opt.optionId || opt.id,
																							);
																					}
																				}}
																				variant={
																					String(
																						opt.optionId || opt.id,
																					).includes("allow") ||
																					String(
																						opt.optionId || opt.id,
																					).includes("yes")
																						? "default"
																						: "outline"
																				}
																			>
																				{opt.name ||
																					opt.label ||
																					opt.title ||
																					"Option"}
																			</ConfirmationAction>
																		))
																	) : (
																		// Default fallback
																		<>
																			<ConfirmationAction
																				onClick={() =>
																					part.requestId &&
																					onReject?.(part.requestId)
																				}
																				variant="outline"
																			>
																				Reject
																			</ConfirmationAction>
																			<ConfirmationAction
																				onClick={() =>
																					part.requestId &&
																					onApprove?.(part.requestId)
																				}
																			>
																				Allow
																			</ConfirmationAction>
																		</>
																	)}
																</ConfirmationActions>
															</ConfirmationRequest>
														</Confirmation>
														{part.terminalId && terminalOutputs && (
															<div className="mt-2">
																<TerminalView
																	output={
																		terminalOutputs[part.terminalId] || ""
																	}
																/>
															</div>
														)}
														{part.diffs && part.diffs.length > 0 && (
															<div className="mt-2 space-y-4">
																{part.diffs.map((diff, i) => (
																	<div key={diff.path} className="space-y-1">
																		<FileDiffView
																			original={diff.oldText}
																			modified={diff.newText}
																			filename={diff.path}
																		/>
																	</div>
																))}
															</div>
														)}
														<ToolOutput
															output={part.result}
															errorText={part.error}
														/>
													</ToolContent>
												</Tool>
											</div>
										);
									}
									return null;
								})}
							</MessageContent>
						</div>
					</Message>
				))}
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}
