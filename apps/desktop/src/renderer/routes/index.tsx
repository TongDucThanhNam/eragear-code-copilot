import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { ChatInterface } from "@/components/chat-ui/chat-interface";
import { CodeViewer } from "@/components/chat-ui/code-viewer";
import { TerminalDock } from "@/components/chat-ui/terminal-dock";
import { ThreePaneLayout } from "@/components/layout/three-pane-layout";
import { AppSidebar } from "@/components/left-sidebar/app-sidebar";
import { ContextPanel } from "@/components/right-sidebar/context-panel";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useFileStore } from "@/store/file-store";
import { useProjectStore } from "@/store/project-store";

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    chatId: z.string().optional(),
    draftProjectId: z.string().optional(),
  }),
  component: ChatPage,
});

function ChatPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { chatId: urlChatId, draftProjectId } = useSearch({
    from: Route.fullPath,
  });

  // When opening a file, we want to overlay the code viewer on top of the chat interface. This allows users to refer to the chat while viewing the code. The chat interface will still be rendered in the background, but it will be visually de-emphasized when a file is open.
  const selectedFile = useFileStore((state) => state.selectedFile);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;

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
        <ThreePaneLayout
          rightSidebar={({ onClose }) => (
            <ContextPanel
              chatId={urlChatId ?? null}
              onClose={onClose}
              projectId={activeProjectId}
            />
          )}
        >
          <div
            className={
              selectedFile
                ? "hidden"
                : "flex h-dvh min-h-0 flex-col overflow-hidden"
            }
          >
            {/* Chat Interfaces */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatInterface
                initialChatId={urlChatId}
                initialDraftProjectId={draftProjectId}
                onChatIdChange={handleChatIdChange}
              />
            </div>
            <TerminalDock
              projectId={activeProjectId}
              projectName={activeProject?.name ?? null}
              projectPath={activeProject?.path ?? null}
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
