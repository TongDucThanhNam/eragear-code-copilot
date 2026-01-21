import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatInterface } from "@/components/chat-ui/chat-interface";
import { CodeViewer } from "@/components/code-viewer";
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
          <ChatWrapper
            initialChatId={urlChatId}
            onChatIdChange={handleChatIdChange}
          />
        </ThreePaneLayout>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ChatWrapper({
  initialChatId,
  onChatIdChange,
}: {
  initialChatId?: string;
  onChatIdChange: (id: string | null) => void;
}) {
  const selectedFile = useFileStore((state) => state.selectedFile);

  return (
    <>
      <div
        className={
          selectedFile ? "hidden" : "flex h-dvh flex-col overflow-hidden"
        }
      >
        <ChatInterface
          initialChatId={initialChatId}
          onChatIdChange={onChatIdChange}
        />
      </div>
      {selectedFile && (
        <div className="absolute inset-0 z-10 flex h-full flex-col bg-background">
          <CodeViewer />
        </div>
      )}
    </>
  );
}
