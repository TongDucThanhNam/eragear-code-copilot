import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { ChatInterface } from "@/components/chat-ui/chat-interface";
import { CodeViewer } from "@/components/chat-ui/code-viewer";
import { ThreePaneLayout } from "@/components/layout/three-pane-layout";
import { AppSidebar } from "@/components/left-sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useFileStore } from "@/store/file-store";

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    chatId: z.string().optional(),
  }),
  component: ChatPage,
});

function ChatPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { chatId: urlChatId } = useSearch({ from: Route.fullPath });

  // When opening a file, we want to overlay the code viewer on top of the chat interface. This allows users to refer to the chat while viewing the code. The chat interface will still be rendered in the background, but it will be visually de-emphasized when a file is open.
  const selectedFile = useFileStore((state) => state.selectedFile);

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
      {/* App Sidebar */}
      <AppSidebar variant="sidebar" />
      <SidebarInset>
        <ThreePaneLayout>
          <div
            className={
              selectedFile
                ? "hidden"
                : "flex h-dvh min-h-0 flex-col overflow-hidden"
            }
          >
            {/* Chat Interfaces */}
            <ChatInterface
              initialChatId={urlChatId}
              onChatIdChange={handleChatIdChange}
            />
          </div>
          {/* Monaco Editor overlay */}
          {selectedFile ? (
            <div className="absolute inset-0 z-10 flex h-full flex-col bg-background">
              <CodeViewer />
            </div>
          ) : null}
        </ThreePaneLayout>
      </SidebarInset>
    </SidebarProvider>
  );
}
