"use client";

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageBranch,
	MessageBranchContent,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
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
import type { ToolUIPart } from "ai";

export type MessageType = {
	key: string;
	from: "user" | "assistant";
	sources?: { href: string; title: string }[];
	versions: {
		id: string;
		content: string;
	}[];
	reasoning?: {
		content: string;
		duration: number;
	};
	plan?: {
		entries: { content: string; status: string }[];
	};
	tools?: {
		toolCallId: string;
		requestId?: string;
		name: string;
		description: string;
		status: ToolUIPart["state"];
		parameters: Record<string, unknown>;
		result: string | undefined;
		error: string | undefined;
		options?: any[];
	}[];
};

export type ChatMessagesProps = {
	messages: MessageType[];
	onApprove?: (requestId: string, decision?: string) => void;
	onReject?: (requestId: string, decision?: string) => void;
};

import {
	Confirmation,
	ConfirmationAction,
	ConfirmationActions,
	ConfirmationRequest,
	ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { cn } from "@/lib/utils";
import { CheckIcon, CircleIcon, Loader2Icon } from "lucide-react";

export function ChatMessages({
	messages,
	onApprove,
	onReject,
}: ChatMessagesProps) {
	return (
		<Conversation className="flex-1 min-h-0 overflow-y-auto">
			<ConversationContent>
				{messages.map(({ versions, ...message }) => (
					<MessageBranch defaultBranch={0} key={message.key}>
						<MessageBranchContent>
							{versions.map((version) => (
								<Message
									from={message.from}
									key={`${message.key}-${version.id}`}
								>
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
											<MessageResponse>{version.content}</MessageResponse>

											{/* Agent Plan */}
											{message.plan && message.plan.entries.length > 0 && (
												<div className="mt-4 rounded-md border bg-muted/40 p-3">
													<div className="mb-2 font-medium text-sm">Plan</div>
													<div className="space-y-2">
														{message.plan.entries.map((entry, i) => (
															<div
																key={i}
																className="flex items-start gap-2 text-sm"
															>
																<div className="mt-0.5">
																	{entry.status === "completed" ? (
																		<CheckIcon className="size-3.5 text-green-500" />
																	) : entry.status === "in_progress" ? (
																		<Loader2Icon className="size-3.5 animate-spin text-blue-500" />
																	) : (
																		<CircleIcon className="size-3.5 text-muted-foreground" />
																	)}
																</div>
																<span
																	className={cn(
																		entry.status === "completed" &&
																			"text-muted-foreground line-through",
																	)}
																>
																	{entry.content}
																</span>
															</div>
														))}
													</div>
												</div>
											)}

											{message.tools && message.tools.length > 0 && (
												<div className="mt-4 space-y-2">
													{message.tools.map((tool, index) => (
														<Tool key={`${tool.toolCallId}-${index}`}>
															<ToolHeader
																type="tool-call"
																title={tool.name}
																state={tool.status}
															/>
															<ToolContent>
																<ToolInput input={tool.parameters} />
																<Confirmation
																	state={tool.status}
																	approval={{ id: tool.toolCallId }}
																>
																	<ConfirmationRequest>
																		<ConfirmationTitle>
																			Requesting permission to execute
																		</ConfirmationTitle>
																		<ConfirmationActions>
																			{/* Check if we have specific options */}
																			{tool.options &&
																			tool.options.length > 0 ? (
																				tool.options.map((opt: any) => (
																					<ConfirmationAction
																						key={opt.optionId || opt.id}
																						onClick={() => {
																							// We need to pass the decision back
																							// Our current callback onApprove/onReject only takes requestId
																							// We might need to update the callback signature or infer 'allow'/'reject'

																							// Heuristic mapping for frontend:
																							const id = String(
																								opt.optionId || opt.id || "",
																							).toLowerCase();
																							const isAllow =
																								id === "allow" ||
																								id === "yes" ||
																								id === "allow_once";

																							if (isAllow) {
																								tool.requestId &&
																									onApprove?.(
																										tool.requestId,
																										opt.optionId || opt.id,
																									);
																							} else {
																								tool.requestId &&
																									onReject?.(
																										tool.requestId,
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
																							tool.requestId &&
																							onReject?.(tool.requestId)
																						}
																						variant="outline"
																					>
																						Reject
																					</ConfirmationAction>
																					<ConfirmationAction
																						onClick={() =>
																							tool.requestId &&
																							onApprove?.(tool.requestId)
																						}
																					>
																						Allow
																					</ConfirmationAction>
																				</>
																			)}
																		</ConfirmationActions>
																	</ConfirmationRequest>
																</Confirmation>
																<ToolOutput
																	output={tool.result}
																	errorText={tool.error}
																/>
															</ToolContent>
														</Tool>
													))}
												</div>
											)}
										</MessageContent>
									</div>
								</Message>
							))}
						</MessageBranchContent>
					</MessageBranch>
				))}
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}
