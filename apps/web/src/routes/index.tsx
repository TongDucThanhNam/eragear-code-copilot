import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { AppSidebar } from "@/components/left-sidebar/app-sidebar";
import { ChatInterface } from "@/components/chat-ui/chat-interface";
import { CodeViewer } from "@/components/chat-ui/code-viewer";
import { ThreePaneLayout } from "@/components/layout/three-pane-layout";
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
      <AppSidebar variant="sidebar" />
      <SidebarInset>
        <ThreePaneLayout>
          <>
            <div
              className={
                selectedFile
                  ? "hidden"
                  : "flex h-dvh min-h-0 flex-col overflow-hidden"
              }
            >
              <ChatInterface
                initialChatId={urlChatId}
                onChatIdChange={handleChatIdChange}
              />
            </div>
            {selectedFile ? (
              <div className="absolute inset-0 z-10 flex h-full flex-col bg-background">
                <CodeViewer />
              </div>
            ) : null}
          </>
        </ThreePaneLayout>
      </SidebarInset>
    </SidebarProvider>
  );
}
