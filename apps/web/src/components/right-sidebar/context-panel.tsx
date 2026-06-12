import { FileIcon, GitBranchIcon, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChangedFilesViewer } from "./changed-files-viewer";
import { FileTree } from "./file-tree";

interface ContextPanelProps {
  onClose: () => void;
}

export function ContextPanel({ onClose }: ContextPanelProps) {
  return (
    <aside
      aria-label="Context sidebar"
      className="hidden h-full min-h-0 w-80 shrink-0 border-l bg-background/95 p-3 md:flex xl:w-96"
      id="context-panel"
    >
      <Tabs
        className="flex h-full min-w-0 w-full flex-col overflow-hidden rounded-md border bg-background shadow-sm"
        defaultValue="files"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b bg-muted/20 px-2">
          <TabsList
            className="h-full flex-1 justify-start gap-1 bg-transparent p-0"
            variant="line"
          >
            <TabsTrigger
              className="h-9 flex-none px-2 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:opacity-100"
              value="files"
            >
              <FileIcon className="mr-2 size-4" />
              Files
            </TabsTrigger>
            <TabsTrigger
              className="h-9 flex-none px-2 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:opacity-100"
              value="changes"
            >
              <GitBranchIcon className="mr-2 size-4" />
              Changes
            </TabsTrigger>
          </TabsList>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Close context sidebar"
                className="ml-2 text-muted-foreground hover:text-foreground"
                onClick={onClose}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <PanelRightClose className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Close context sidebar</TooltipContent>
          </Tooltip>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsContent
            className="relative m-0 h-full min-h-0 overflow-hidden"
            value="files"
          >
            <FileTree />
          </TabsContent>
          <TabsContent
            className="relative m-0 h-full min-h-0 overflow-hidden"
            value="changes"
          >
            <ChangedFilesViewer />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
