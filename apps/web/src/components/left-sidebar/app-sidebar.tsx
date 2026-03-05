"use client";

import { IconInnerShadowTop } from "@tabler/icons-react";
import type * as React from "react";
import { useEffect, useMemo } from "react";
import { getAgentIconComponent } from "@/components/left-sidebar/agent-icons";
import { NavProjectTree } from "@/components/left-sidebar/nav-project-tree";
import { NavUser } from "@/components/left-sidebar/nav-user";
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: me } = trpc.auth.getMe.useQuery();
  const sessionPageQuery = trpc.getSessionsPage.useInfiniteQuery(
    { limit: 500 },
    {
      refetchInterval: 5000,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );
  useEffect(() => {
    if (
      !(sessionPageQuery.hasNextPage && !sessionPageQuery.isFetchingNextPage)
    ) {
      return;
    }
    sessionPageQuery.fetchNextPage();
  }, [
    sessionPageQuery.fetchNextPage,
    sessionPageQuery.hasNextPage,
    sessionPageQuery.isFetchingNextPage,
  ]);
  const sessions = useMemo(
    () => sessionPageQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [sessionPageQuery.data]
  );
  const activeChatId = useChatStatusStore((state) => state.activeChatId);
  const isStreaming = useChatStatusStore((state) => state.isStreaming);

  /* const activeProjectName =
    projects.find((project) => project.id === activeProjectId)?.name ??
    "Select a project"; */

  const sessionDocuments = sessions
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
        agentId: s.agentId,
        sessionId: s.sessionId,
        name: s.name
          ? s.name
          : s.agentName
            ? s.agentName
            : `Session ${s.id.slice(0, 8)}`,
        icon: getAgentIconComponent({
          agentId: s.agentId,
          agentName: s.agentName,
          agentTitle: s.agentInfo?.title,
          agentType: s.agentInfo?.name,
        }),
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
            agentId: s.agentId,
            agentName: s.agentName,
            sessionId: s.sessionId,
            agentInfo: s.agentInfo,
            agentCapabilities: s.agentCapabilities,
            authMethods: s.authMethods,
            pinned: s.pinned,
            lastActiveAt: s.lastActiveAt,
            fullData: s,
          }))}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: me?.user?.name ?? "User",
            email: me?.user?.email ?? "unknown",
            avatar: me?.user?.image ?? "",
          }}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
