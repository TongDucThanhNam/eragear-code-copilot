import { AppSidebar } from "@/components/app-sidebar";
import { ChatInterface } from "@/components/chat-ui/chat-interface";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/")({
	validateSearch: z.object({
		chatId: z.string().optional(),
	}),
	component: ChatPage,
});

function ChatPage() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { chatId: urlChatId } = Route.useSearch();

	const handleChatIdChange = (newChatId: string | null) => {
		if (newChatId) {
			navigate({ search: { chatId: newChatId } });
		} else {
			navigate({ search: {} });
		}
	};

	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "calc(var(--spacing) * 72)",
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<AppSidebar variant="inset" />
			<SidebarInset>
				<div className="flex flex-1 flex-col min-w-0">
					<div className="@container/main flex flex-1 flex-col gap-2 min-w-0">
						<div className="flex flex-col gap-4 md:gap-6 min-w-0 h-full">
							<ChatInterface
								initialChatId={urlChatId}
								onChatIdChange={handleChatIdChange}
							/>
						</div>
					</div>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
