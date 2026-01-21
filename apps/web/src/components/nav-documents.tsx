import type { Icon } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { GitBranch, type LucideIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export function NavDocuments({
  items,
}: {
  items: {
    name: string;
    url: string;
    icon: LucideIcon | Icon | IconComponent;
    status?: "active" | "inactive" | "streaming";
    chatId?: string;
    sessionId?: string;
    branch?: string;
  }[];
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Sessions</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton asChild className="h-auto py-2">
              <Link
                className="flex flex-col items-start gap-1"
                // href={item.url}
                search={{ chatId: item.chatId }}
                to={"/"}
              >
                <div className="flex w-full items-center gap-2">
                  <item.icon className="size-4 shrink-0" />
                  <span className="truncate font-medium">
                    {item.sessionId || item.name}
                  </span>
                  {item.status === "active" && (
                    <span className="ml-auto size-2 rounded-full bg-green-500" />
                  )}
                  {item.status === "inactive" && (
                    <span className="ml-auto size-2 rounded-full bg-zinc-700" />
                  )}
                  {item.status === "streaming" && (
                    <span className="ml-auto size-2 rounded-full bg-amber-500" />
                  )}
                </div>
                {item.branch && (
                  <div className="ml-6 flex items-center gap-1 text-muted-foreground text-xs">
                    <GitBranch className="size-3" />
                    <span>{item.branch}</span>
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
