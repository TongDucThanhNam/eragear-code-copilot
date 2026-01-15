import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileIcon, GitBranchIcon } from "lucide-react";
import { DiffViewer } from "./diff-viewer";
import { FileTree } from "./file-tree";

export function ContextPanel() {
	return (
		<div className="h-full border-l bg-muted/10">
			<Tabs defaultValue="files" className="h-full flex flex-col">
				<div className="border-b px-4 py-2">
					<TabsList className="w-full justify-start h-auto p-0 bg-transparent gap-4">
						<TabsTrigger
							value="files"
							className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-9 px-1"
						>
							<FileIcon className="mr-2 size-4" />
							Files
						</TabsTrigger>
						<TabsTrigger
							value="changes"
							className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-9 px-1"
						>
							<GitBranchIcon className="mr-2 size-4" />
							Changes
						</TabsTrigger>
					</TabsList>
				</div>
				<div className="flex-1 overflow-hidden min-h-0 flex flex-col relative">
					<TabsContent value="files" className="m-0 h-full relative">
						<FileTree />
					</TabsContent>
					<TabsContent value="changes" className="m-0 h-full relative">
						<DiffViewer />
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}
