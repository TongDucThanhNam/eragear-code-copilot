import { FileIcon, GitBranchIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiffViewer } from "./diff-viewer";
import { FileTree } from "./file-tree";

export function ContextPanel() {
  return (
    <div className="h-full max-h-dvh border-l bg-muted/10">
      <Tabs className="flex h-full flex-col" defaultValue="files">
        <div className="border-b px-4 py-2">
          <TabsList className="h-auto w-full justify-start gap-4 bg-transparent p-0">
            <TabsTrigger
              className="h-9 rounded-none px-1 data-[state=active]:border-primary data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              value="files"
            >
              <FileIcon className="mr-2 size-4" />
              Files
            </TabsTrigger>
            <TabsTrigger
              className="h-9 rounded-none px-1 data-[state=active]:border-primary data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              value="changes"
            >
              <GitBranchIcon className="mr-2 size-4" />
              Changes
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsContent className="relative m-0 h-full" value="files">
            <FileTree />
          </TabsContent>
          <TabsContent className="relative m-0 h-full" value="changes">
            <DiffViewer />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
