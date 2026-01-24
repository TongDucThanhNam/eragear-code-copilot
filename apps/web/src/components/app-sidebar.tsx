"use client";

import { IconFileAi, IconInnerShadowTop } from "@tabler/icons-react";
import type * as React from "react";
import { NavProjectTree } from "@/components/nav-project-tree";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { trpc } from "@/lib/trpc";
import { useChatStatusStore } from "@/store/chat-status-store";
import { ClaudeAI, OpenAI, OpenCode } from "./ui/icons";

const getAgentIcon = (agentTitle: string | undefined) => {
  // console.log("agentTitle:", agentTitle);
  switch (agentTitle) {
    case "Claude Code":
      return ClaudeAI;
    case "OpenCode":
      return OpenCode;
    case "Codex":
      return OpenAI;
    default:
      return IconFileAi;
  }
};

const data = {
  user: {
    name: "Vide Coder",
    email: "admin@openai.com",
    avatar: "",
  },
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: sessions } = trpc.getSessions.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const activeChatId = useChatStatusStore((state) => state.activeChatId);
  const isStreaming = useChatStatusStore((state) => state.isStreaming);

  /* const activeProjectName =
    projects.find((project) => project.id === activeProjectId)?.name ??
    "Select a project"; */

  const sessionDocuments = (sessions || [])
    .slice()
    .filter((s) => !s.archived)
    .sort((a, b) => {
      const pinnedA = a.pinned ?? false;
      const pinnedB = b.pinned ?? false;
      if (pinnedA !== pinnedB) {
        return pinnedA ? -1 : 1;
      }
      return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
    })
    .map((s) => {
      const getStatus = () => {
        if (s.id === activeChatId && isStreaming) {
          return "streaming" as const;
        }
        if (s.isActive) {
          return "active" as const;
        }
        return "inactive" as const;
      };

      return {
        chatId: s.id,
        projectId: s.projectId,
        sessionId: s.sessionId,
        name: s.name
          ? s.name
          : s.agentName
          ? s.agentName
          : `Session ${s.id.slice(0, 8)}`,
        icon: getAgentIcon(s.agentName),
        agentName: s.agentName,
        agentInfo: s.agentInfo,
        agentCapabilities: s.agentCapabilities,
        authMethods: s.authMethods,
        status: getStatus(),
        pinned: s.pinned ?? false,
        lastActiveAt: s.lastActiveAt ?? 0,
      };
    });

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href="/">
                <IconInnerShadowTop className="size-5!" />
                <span className="font-semibold text-base">Eragear Copilot</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavProjectTree
          sessions={sessionDocuments.map((s) => ({
            id: s.chatId,
            projectId: s.projectId || null,
            name: s.name,
            isActive: s.status === "active",
            status: s.status,
            agentName: s.agentName,
            sessionId: s.sessionId,
            agentInfo: s.agentInfo,
            agentCapabilities: s.agentCapabilities,
            authMethods: s.authMethods,
            fullData: s,
          }))}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
