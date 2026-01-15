import { ChevronRight, File, Folder } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFileStore, type FileNode } from "@/store/file-store";

export function FileTree() {
	const getFileTree = useFileStore((state) => state.getFileTree);
	const files = getFileTree();

	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-1 p-2">
				{files.map((item) => (
					<FileTreeItem key={item.name} item={item} />
				))}
			</div>
		</ScrollArea>
	);
}

function FileTreeItem({ item, depth = 0 }: { item: FileNode; depth?: number }) {
	const paddingLeft = depth * 12 + 4;
	const setSelectedFile = useFileStore((state) => state.setSelectedFile);
	const selectedFile = useFileStore((state) => state.selectedFile);
	const isSelected = selectedFile === item.path;

	if (item.type === "folder") {
		return (
			<div>
				<div
					className="flex items-center gap-1.5 py-1 px-2 hover:bg-muted/50 rounded-md cursor-pointer text-sm"
					style={{ paddingLeft }}
				>
					<ChevronRight className="size-4 opacity-50" />
					<Folder className="size-4 text-blue-400" />
					<span>{item.name}</span>
				</div>
				{item.children?.map((child) => (
					<FileTreeItem key={child.name} item={child} depth={depth + 1} />
				))}
			</div>
		);
	}

	return (
		<button
			type={"button"}
			className={`flex items-center gap-1.5 py-1 px-2 hover:bg-muted/50 rounded-md cursor-pointer text-sm ${
				isSelected ? "bg-muted text-foreground" : "text-muted-foreground"
			}`}
			style={{ paddingLeft: paddingLeft + 16 }}
			onClick={() => setSelectedFile(item.path)}
		>
			<File className="size-4 opacity-50" />
			<span>{item.name}</span>
		</button>
	);
}
