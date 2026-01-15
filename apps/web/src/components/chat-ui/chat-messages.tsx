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
	tools?: {
		name: string;
		description: string;
		status: ToolUIPart["state"];
		parameters: Record<string, unknown>;
		result: string | undefined;
		error: string | undefined;
	}[];
};

export type ChatMessagesProps = {
	messages: MessageType[];
};

export function ChatMessages({ messages }: ChatMessagesProps) {
	return (
		// <div className="flex-1">
		<Conversation>
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
											<Reasoning duration={message.reasoning.duration}>
												<ReasoningTrigger />
												<ReasoningContent>
													{message.reasoning.content}
												</ReasoningContent>
											</Reasoning>
										)}
										<MessageContent>
											<MessageResponse>{version.content}</MessageResponse>
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
		// </div>
	);
}
